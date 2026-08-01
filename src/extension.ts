import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAnalysisStore } from './analysisStore';
import {
	buildAutoSaveDiagnosticReport,
	buildAutoSaveStatusTooltip,
	createAutoSaveDiagnosticState,
	type AutoSaveDiagnosticState,
	type AutoSaveSourceDiagnostic,
	type AutoSaveSourceId,
} from './autoSaveDiagnostics';
import {
	type AutoSaveCheckpointState,
	type AutoSaveController,
	createAutoSaveController,
	createAutoSaveSourceRevisionInput,
	type AutoSaveControllerWatcher,
	type AutoSaveSource,
} from './autoSaveController';
import { migrateLegacyAutoSaveProviderSettings } from './autoSaveConfigurationMigration';
import { createAutoSaveWorkspaceLifecycle } from './autoSaveWorkspaceManager';
import {
	buildAnalysisHandoffPrompt,
	createAnalyzeSessionsFlowDeps,
	findAvailableAnalysisAgentProviders,
	pickAnalysisProvider as pickAnalysisProviderFromChat,
	registerChatParticipant,
	resolveAnalysisSelection,
	runAnalyzeSessionsFlow,
	runResumeIntoOriginAgent,
	type AnalysisAgentProviderId,
	type AnalysisProviderSelection,
	type ResumeOverflowStrategy,
	type ResumeTargetMode,
} from './chatParticipant';
import {
	createClaudeCodeSessionReader,
	deriveClaudeCodeProjectSlug,
	deriveClaudeCodeProjectsPath,
	readClaudeCodeSessions,
} from './claudeCodeSessionReader';
import {
	createCopilotCliSessionReader,
	deriveCopilotCliSessionStatePath,
	resolveCopilotCliHomePath,
} from './copilotCliSessionReader';
import {
	resolveCopilotWorkspaceStore,
	type CopilotWorkspaceStorageUriLike,
	type CopilotWorkspaceStoreResolution,
} from './copilotWorkspaceStore';
import { createCursorCliSessionReader, resolveCursorCliSessionLocation } from './cursorCliSessionReader';
import { getDefaultCursorProjectsPath, getDefaultCursorUserDataPath, readCursorSessions } from './cursorSessionReader';
import { createCodexSkillImporter } from './codexSkillImporter';
import { createCodexSessionReader, readCodexSessions } from './codexSessionReader';
import { getGitContext } from './gitIntegration';
import {
	createVSCodeHandoffDispatcher,
	type HandoffDispatchResult,
	type HandoffSelectionId,
} from './handoffDispatcher';
import { CopilotSession, readCopilotSessions } from './sessionReader';
import { buildImplementationHandoffPrompt, createSingleSessionSelection } from './sessionAnalysis';
import {
	DEFAULT_SESSION_EXPLORER_SORT_ORDER,
	SESSION_EXPLORER_SORT_ORDER_STATE_KEY,
	SORT_SESSION_EXPLORER_COMMAND,
	SessionExplorerProvider,
	SessionExplorerSessionItem,
	isSessionExplorerSortOrder,
	registerSessionExplorerAnalysisCommands,
	registerSessionExplorerVisibilityRefresh,
	runSortSessionExplorerCommand,
} from './sessionExplorer';
import { ResumeProviderCommands } from './resumeTarget';
import { SessionViewerPanel } from './sessionViewer';
import { createSessionStore, OrphanedPartFile, SessionFileNameOptions, SessionPruneAction } from './sessionStore';
import { applySaveBloatControls, createChatSession, SaveOverflowStrategy } from './sessionWriter';
import { activateProFeatures, hasProLicense, initializeProLicenseCommands, showUpgradePrompt } from './pro';
import {
	type AnalysisReportReference,
	type AnalysisSelection,
	isChatSession,
	isSessionProviderId,
	SessionMeta,
	type SessionOrigin,
	SessionProviderId,
	SourceChatSession,
} from './types';
import { parseFileSize } from './utils';

const sessionStore = createSessionStore();
const analysisStore = createAnalysisStore();
const AUTO_SAVE_CHECKPOINT_STATE_KEY_PREFIX = 'session-control.autoSaveCheckpoints.v1';

function createAutoSaveCheckpointStateKey(
	workspaceFolder: vscode.WorkspaceFolder,
	storageDirectory: string,
): string {
	const scopeHash = createHash('sha256')
		.update(JSON.stringify([workspaceFolder.uri.toString(), normalizeComparablePath(storageDirectory)]))
		.digest('hex');
	return `${AUTO_SAVE_CHECKPOINT_STATE_KEY_PREFIX}.${scopeHash}`;
}

function isAbsolutePathLike(value: string): boolean {
	return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeComparablePath(value: string): string {
	const normalized = path.resolve(value);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSameOrDescendantPath(candidatePath: string, basePath: string): boolean {
	const relative = path.relative(basePath, candidatePath);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
	const left = normalizeComparablePath(leftPath);
	const right = normalizeComparablePath(rightPath);
	return isSameOrDescendantPath(left, right) || isSameOrDescendantPath(right, left);
}

type WorkspaceSessionFilterMode = 'interactive-import' | 'auto-save';

function filterSessionsForWorkspace(
	sessions: SourceChatSession[],
	workspaceFolder: vscode.WorkspaceFolder,
	provider: SessionProviderId,
	mode: WorkspaceSessionFilterMode,
): SourceChatSession[] {
	const forProvider = sessions.filter((session) => session.provider === provider);

	const matches = forProvider.filter(
		(session) =>
			typeof session.cwd === 'string' &&
			session.cwd.length > 0 &&
			pathsOverlap(session.cwd, workspaceFolder.uri.fsPath),
	);
	if (matches.length > 0) {
		return matches;
	}

	// No session's cwd overlaps this workspace. Only fall back to the unfiltered
	// list when NONE of the sessions carry cwd metadata (we genuinely cannot tell
	// which workspace they belong to). When sessions DO have cwd values that just
	// don't match, they belong to other workspaces and must be excluded — otherwise
	// a globally-shared store (e.g. Codex's ~/.codex/sessions, watched by every VS
	// Code window) leaks another workspace's sessions into this one's auto-save.
	// Interactive imports may surface sessions with no cwd because the user still
	// chooses one explicitly; unattended auto-save must fail closed instead.
	const anyHasCwd = forProvider.some((session) => typeof session.cwd === 'string' && session.cwd.length > 0);
	return anyHasCwd || mode === 'auto-save' ? [] : forProvider;
}

export interface WorkspaceSessionMeta extends SavedSessionPickItem, SessionMeta {
	displayTitle: string;
	storageDirectory: string;
	workspaceFolder: vscode.WorkspaceFolder;
}

interface SourceSessionPickItem extends vscode.QuickPickItem {
	session: SourceChatSession;
}

export interface ProviderPickItem extends vscode.QuickPickItem {
	provider: SessionProviderId;
}

interface SavedSessionPickItem extends vscode.QuickPickItem {
	fileName: string;
}

interface OpenSessionTarget {
	storageDirectory: string;
	fileName: string;
}

interface LatestAnalysisReportTarget {
	storageDirectory: string;
	reportPath: string;
	createdAt: string;
	selectionLabel: string;
	workspaceFolder: vscode.WorkspaceFolder;
}

interface ImportCopilotGuidanceCommandOptions {
	skillLabel: 'Codex' | 'Cursor' | 'Claude Code';
	targetDirectory: string;
	skillDirectorySegments?: readonly string[];
}

interface ResumeSessionFromViewerCommandDeps {
	writeClipboard: (text: string) => Promise<void>;
}

interface SaveSourceSessionFlowDeps {
	selectSession: (sessions: SourceChatSession[], provider: SessionProviderId) => Promise<SourceChatSession | undefined>;
	promptTitle: (defaultTitle: string, provider: SessionProviderId) => Promise<string | undefined>;
	getGitContext: typeof getGitContext;
	createChatSession: typeof createChatSession;
	applySaveBloatControls: typeof applySaveBloatControls;
	getIncludeInGitignore: (workspaceFolder: vscode.WorkspaceFolder) => boolean;
	ensureGitignoreEntry: (workspaceFolder: vscode.WorkspaceFolder, storageDirectory: string) => Promise<boolean>;
	getPruneConfiguration: (workspaceFolder: vscode.WorkspaceFolder) => PruneConfiguration;
	writeSession: (
		storageDirectory: string,
		sessions: ReturnType<typeof createChatSession>[],
		options: SessionFileNameOptions,
	) => Promise<string[]>;
	pruneSessions: (
		storageDirectory: string,
		maxSavedSessions: number,
		action: SessionPruneAction,
	) => Promise<{ archived: number; deleted: number }>;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface SaveSessionFlowDeps extends SaveSourceSessionFlowDeps {
	readCopilotSessions: typeof readCopilotSessions;
}

interface ManualSessionProviderLoaderDeps {
	getCodexHomePath: typeof getCodexHomePath;
	getClaudeCodeHomePath: typeof getClaudeCodeHomePath;
	getCursorUserDataPath: typeof getCursorUserDataPath;
	getCursorProjectsPath: typeof getCursorProjectsPath;
	readCopilotSessions: typeof readCopilotSessions;
	readCodexSessions: typeof readCodexSessions;
	readClaudeCodeSessions: typeof readClaudeCodeSessions;
	readCursorSessions: typeof readCursorSessions;
}

interface SaveConfiguration {
	maxFileSizeBytes: number;
	overflowStrategy: SaveOverflowStrategy;
	stripToolOutput: boolean;
	includeTimestampInFileName: boolean;
}

interface PruneConfiguration {
	maxSavedSessions: number;
	pruneAction: SessionPruneAction;
}

interface AutoSaveWatchTarget {
	sourceId: AutoSaveSourceId;
	provider: SessionProviderId;
	directory: string;
	glob: string;
	label: string;
}

interface AutoSaveOnChatResponseDeps {
	getStorageUri: () => CopilotWorkspaceStorageUriLike | undefined;
	getStorageDirectory: (workspaceFolder: vscode.WorkspaceFolder) => string;
	createWatcher: (sessionsDirectory: string, globPattern: string) => AutoSaveControllerWatcher;
	getImplicitWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
	getWorkspaceFolderCount: () => number;
	getRemoteName: () => string | undefined;
	getAutoSaveProviders: (workspaceFolder: vscode.WorkspaceFolder) => SessionProviderId[];
	getCopilotHomePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	getCodexHomePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	getClaudeCodeHomePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	getCursorProjectsPath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	pathExists: (sourcePath: string) => boolean;
	isDirectory: (sourcePath: string) => boolean;
	diagnosticState: AutoSaveDiagnosticState;
	readCopilotSessions: () => Promise<CopilotSession[]>;
	readCopilotCliSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	readCodexSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	readClaudeCodeSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	readCursorSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	saveSessionSilently: (
		workspaceFolder: vscode.WorkspaceFolder,
		storageDirectory: string,
		provider: SessionProviderId,
		sessions: SourceChatSession[],
		origin: SessionOrigin,
	) => Promise<string[] | undefined>;
	refreshSessionExplorer: () => void;
	findExistingAutoSaves: (
		storageDirectory: string,
		sourceId: AutoSaveSourceId,
		sourceSessionId: string,
	) => ReturnType<typeof sessionStore.findAutoSaveSessionFiles>;
	showWarningMessage: (message: string) => Thenable<unknown>;
	hash: (value: string) => string;
	schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearSchedule: (handle: ReturnType<typeof setTimeout>) => void;
	scheduleMaintenance: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearMaintenanceSchedule: (handle: ReturnType<typeof setTimeout>) => void;
	readAutoSaveCheckpointState: (
		workspaceFolder: vscode.WorkspaceFolder,
		storageDirectory: string,
	) => unknown;
	writeAutoSaveCheckpointState: (
		workspaceFolder: vscode.WorkspaceFolder,
		storageDirectory: string,
		state: AutoSaveCheckpointState,
	) => PromiseLike<void>;
	settleReadDelayMs: number;
}

interface CleanupOrphanedPartsCommandDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	findOrphanedPartFiles: (storageDirectory: string) => Promise<OrphanedPartFile[]>;
	confirmCleanup: (fileCount: number, sessionCount: number) => Promise<boolean>;
	deleteSession: (storageDirectory: string, fileName: string) => Promise<boolean>;
	refreshSessionExplorer: () => void;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface OpenSavedSessionDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	listSessionsAcrossWorkspaceFolders: (
		workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
	) => Promise<WorkspaceSessionMeta[]>;
	pickSession: (sessions: WorkspaceSessionMeta[]) => Promise<WorkspaceSessionMeta | undefined>;
	readSession: (storageDirectory: string, fileName: string) => Promise<ReturnType<typeof createChatSession>>;
	showSession: (
		session: ReturnType<typeof createChatSession>,
		extensionUri: vscode.Uri,
		storageDirectory: string,
		fileName: string,
	) => void;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface DeleteSessionFromExplorerCommandDeps {
	confirmDelete: (label: string) => Promise<boolean>;
	deleteSession: (storageDirectory: string, fileName: string) => Promise<boolean>;
	refreshSessionExplorer: () => void;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface DeleteSessionCommandDeps extends DeleteSessionFromExplorerCommandDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	listSessionsAcrossWorkspaceFolders: (
		workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
	) => Promise<WorkspaceSessionMeta[]>;
	pickSession: (sessions: WorkspaceSessionMeta[]) => Promise<WorkspaceSessionMeta | undefined>;
}

interface ViewSessionFileDeps {
	getActiveEditor: () => vscode.TextEditor | undefined;
	showSession: (
		session: ReturnType<typeof createChatSession>,
		extensionUri: vscode.Uri,
		storageDirectory: string,
		fileName: string,
	) => void;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface ImplementLatestAnalysisDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	readIndex: (storageDirectory: string) => Promise<{ reports: AnalysisReportReference[] }>;
	readReport: (storageDirectory: string, reportPath: string) => Promise<string>;
	buildPrompt: (reportFilePath: string, userPrompt: string) => string;
	selectChatModels: () => Promise<readonly vscode.LanguageModelChat[]>;
	getCommands: () => Promise<readonly string[]>;
	pickProvider: (
		models: readonly vscode.LanguageModelChat[],
		agentProviders: readonly AnalysisAgentProviderId[],
	) => Promise<AnalysisProviderSelection | undefined>;
	dispatchHandoff: (prompt: string, target: HandoffSelectionId) => Promise<HandoffDispatchResult>;
	showInformationMessage: (message: string) => Thenable<unknown>;
	showWarningMessage: (message: string) => Thenable<unknown>;
}

interface AnalyzeSavedChatsCommandDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	listSessionsAcrossWorkspaceFolders: (
		workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
	) => Promise<WorkspaceSessionMeta[]>;
	resolveSelection: (requestPrompt: string) => Promise<AnalysisSelection | undefined>;
	selectChatModels: () => Promise<readonly vscode.LanguageModelChat[]>;
	getCommands: () => Promise<readonly string[]>;
	pickAnalysisProvider: (
		models: readonly vscode.LanguageModelChat[],
		agentProviders: readonly AnalysisAgentProviderId[],
	) => Promise<AnalysisProviderSelection | undefined>;
	getAppName: () => string;
	runAnalyzeFlow: (
		workspaceFolders: readonly vscode.WorkspaceFolder[],
		workspaceSessions: WorkspaceSessionMeta[],
		selection: AnalysisSelection,
		model: vscode.LanguageModelChat,
		token: vscode.CancellationToken,
		onStatus: (markdown: string) => void,
	) => Promise<{ metadata: import('./types').AnalysisReportResultMetadata } | undefined>;
	withProgress: <T>(
		options: vscode.ProgressOptions,
		task: (
			progress: vscode.Progress<{ message?: string; increment?: number }>,
			token: vscode.CancellationToken,
		) => Thenable<T>,
	) => Thenable<T>;
	buildAgentHandoffPrompt: (
		workspaceFolders: readonly vscode.WorkspaceFolder[],
		workspaceSessions: WorkspaceSessionMeta[],
		selection: AnalysisSelection,
	) => Promise<{ prompt?: string; infoMessage?: string }>;
	dispatchHandoff: (prompt: string, target: HandoffSelectionId) => Promise<HandoffDispatchResult>;
	openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
	showTextDocument: (document: vscode.TextDocument) => Thenable<vscode.TextEditor>;
	showInformationMessage: (message: string) => Thenable<unknown>;
	showWarningMessage: (message: string) => Thenable<unknown>;
	// Invoked after the language-model flow persists a report, before it is
	// opened, so callers can refresh UI that reflects analysis state.
	onReportSaved?: () => void;
}

type ParsedSessionDocument =
	{ kind: 'ok'; session: ReturnType<typeof createChatSession> } | { kind: 'invalid-json' } | { kind: 'not-session' };

interface ManualWorkspaceSelectionDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getActiveEditorUri: () => vscode.Uri | undefined;
	getWorkspaceFolder: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined;
	pickWorkspaceFolder: (items: vscode.QuickPickItem[]) => Promise<vscode.QuickPickItem | undefined>;
}

interface AutoSaveToggleConfiguration {
	get<T>(section: string, defaultValue: T): T;
	update(section: string, value: unknown, target: vscode.ConfigurationTarget): Thenable<void>;
}

export interface AutoSaveToggleCommandDeps {
	resolveWorkspaceFolder: () => Promise<vscode.WorkspaceFolder | undefined>;
	getConfiguration: (workspaceFolder: vscode.WorkspaceFolder) => AutoSaveToggleConfiguration;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	ensureStoragePathInGitignore: typeof ensureStoragePathInGitignore;
	showInformationMessage: (message: string) => Thenable<unknown>;
	showWarningMessage: (
		message: string,
		options: vscode.MessageOptions,
		...items: string[]
	) => Thenable<string | undefined>;
	showErrorMessage: (message: string) => Thenable<unknown>;
	onDidChange: () => void;
}

export function validateStoragePath(workspaceFolder: vscode.WorkspaceFolder, configured: string): string {
	if (!configured.trim()) {
		throw new Error('session-control.storagePath must not be empty.');
	}

	if (isAbsolutePathLike(configured)) {
		throw new Error('session-control.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
	const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
	if (relative.startsWith('..') || isAbsolutePathLike(relative)) {
		throw new Error('session-control.storagePath must stay within the workspace folder.');
	}

	return resolved;
}

function normalizeGitignoreEntry(value: string): string {
	const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
	if (!normalized || normalized.startsWith('#')) {
		return '';
	}

	return `${normalized}/`;
}

export function createStorageGitignoreEntry(workspaceFolder: vscode.WorkspaceFolder, storageDirectory: string): string {
	const relative = path.relative(workspaceFolder.uri.fsPath, storageDirectory);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('Storage directory must be inside the workspace folder before updating .gitignore.');
	}

	return normalizeGitignoreEntry(relative);
}

export async function ensureStoragePathInGitignore(
	workspaceFolder: vscode.WorkspaceFolder,
	storageDirectory: string,
): Promise<boolean> {
	const entry = createStorageGitignoreEntry(workspaceFolder, storageDirectory);
	const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');

	let existing = '';
	try {
		existing = await fs.readFile(gitignorePath, 'utf8');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/no such file|cannot find|enoent/i.test(message)) {
			throw error;
		}
	}

	const hasEntry = existing.split(/\r?\n/).some((line) => normalizeGitignoreEntry(line) === entry);
	if (hasEntry) {
		return false;
	}

	const nextContent = existing.length === 0 ? `${entry}\n` : `${existing.replace(/\s*$/, '')}\n${entry}\n`;
	await fs.writeFile(gitignorePath, nextContent, 'utf8');
	return true;
}

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	return validateStoragePath(workspaceFolder, configured);
}

export const ENABLE_AUTO_SAVE_WITH_GITIGNORE = 'Enable and Add to .gitignore';
export const ENABLE_AUTO_SAVE_WITHOUT_GITIGNORE = 'Enable Without Adding to .gitignore';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function runToggleAutoSaveCommand(deps: AutoSaveToggleCommandDeps): Promise<void> {
	const workspaceFolder = await deps.resolveWorkspaceFolder();
	if (!workspaceFolder) {
		await deps.showInformationMessage('Open a workspace folder before changing auto-save.');
		return;
	}

	const configuration = deps.getConfiguration(workspaceFolder);
	const current = configuration.get<boolean>('autoSaveOnChatResponse', false);
	if (current) {
		await configuration.update('autoSaveOnChatResponse', false, vscode.ConfigurationTarget.WorkspaceFolder);
		deps.onDidChange();
		await deps.showInformationMessage(`${workspaceFolder.name}: auto-save on chat response disabled.`);
		return;
	}

	let storageDirectory: string;
	let gitignoreEntry: string;
	try {
		storageDirectory = deps.getStoragePath(workspaceFolder);
		gitignoreEntry = createStorageGitignoreEntry(workspaceFolder, storageDirectory);
	} catch (error) {
		await deps.showErrorMessage(`Cannot enable auto-save: ${getErrorMessage(error)}`);
		return;
	}

	const choice = await deps.showWarningMessage(
		`Auto-save writes chat sessions to ${gitignoreEntry}. ` +
			'Saved prompts, workspace paths, file content, and tool output may be sensitive. ' +
			`Choose whether to add ${gitignoreEntry} to this project's .gitignore before enabling auto-save.`,
		{ modal: true },
		ENABLE_AUTO_SAVE_WITH_GITIGNORE,
		ENABLE_AUTO_SAVE_WITHOUT_GITIGNORE,
	);
	if (choice !== ENABLE_AUTO_SAVE_WITH_GITIGNORE && choice !== ENABLE_AUTO_SAVE_WITHOUT_GITIGNORE) {
		return;
	}

	try {
		let gitignoreEntryAdded = false;
		if (choice === ENABLE_AUTO_SAVE_WITH_GITIGNORE) {
			gitignoreEntryAdded = await deps.ensureStoragePathInGitignore(workspaceFolder, storageDirectory);
		}
		await configuration.update(
			'includeInGitignore',
			choice === ENABLE_AUTO_SAVE_WITH_GITIGNORE,
			vscode.ConfigurationTarget.WorkspaceFolder,
		);
		await configuration.update('autoSaveOnChatResponse', true, vscode.ConfigurationTarget.WorkspaceFolder);
		deps.onDidChange();

		const privacySummary =
			choice === ENABLE_AUTO_SAVE_WITH_GITIGNORE
				? `${gitignoreEntry} ${gitignoreEntryAdded ? 'was added to' : 'is already in'} .gitignore.`
				: `${gitignoreEntry} was not added to .gitignore; saved sessions may be tracked by git.`;
		await deps.showInformationMessage(`${workspaceFolder.name}: auto-save on chat response enabled. ${privacySummary}`);
	} catch (error) {
		await deps.showErrorMessage(`Could not enable auto-save: ${getErrorMessage(error)}`);
	}
}

function getSaveConfiguration(workspaceFolder: vscode.WorkspaceFolder): SaveConfiguration {
	const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
	const configuredSize = config.get<string>('save.maxFileSize', '1mb');
	const parsedSize = parseFileSize(configuredSize);
	const overflowStrategy = config.get<SaveOverflowStrategy>('save.overflowStrategy', 'split');
	const stripToolOutput = config.get<boolean>('save.stripToolOutput', false);
	const includeTimestampRaw = config.get<unknown>('save.useTimestampInFileName', true);
	const includeTimestampInFileName = typeof includeTimestampRaw === 'boolean' ? includeTimestampRaw : true;

	if (typeof includeTimestampRaw !== 'boolean') {
		console.warn(
			`Invalid session-control.save.useTimestampInFileName value (${String(includeTimestampRaw)}). Falling back to true.`,
		);
	}

	return {
		maxFileSizeBytes: parsedSize,
		overflowStrategy,
		stripToolOutput,
		includeTimestampInFileName,
	};
}

function getProviderLabel(provider: SessionProviderId): string {
	switch (provider) {
		case 'codex':
			return 'Codex';
		case 'cursor':
			return 'Cursor';
		case 'claude-code':
			return 'Claude Code';
		default:
			return 'Copilot';
	}
}

export function resolveImplicitSaveProviderForHost(appName: string): SessionProviderId {
	if (/cursor/i.test(appName)) {
		return 'cursor';
	}

	if (/codex/i.test(appName)) {
		return 'codex';
	}

	if (/claude/i.test(appName)) {
		return 'claude-code';
	}

	return 'copilot';
}

export function resolveSaveProviderForHost(
	configuredProvider: SessionProviderId | undefined,
	appName: string,
): SessionProviderId {
	if (configuredProvider) {
		return configuredProvider;
	}

	return resolveImplicitSaveProviderForHost(appName);
}

const DEFAULT_AUTO_SAVE_PROVIDERS: readonly SessionProviderId[] = ['copilot', 'codex', 'claude-code', 'cursor'];

export function resolveAutoSaveProviders(configuredProviders: readonly unknown[] | undefined): SessionProviderId[] {
	if (configuredProviders === undefined) {
		return [...DEFAULT_AUTO_SAVE_PROVIDERS];
	}

	const providers: SessionProviderId[] = [];
	for (const configuredProvider of configuredProviders) {
		if (isSessionProviderId(configuredProvider) && !providers.includes(configuredProvider)) {
			providers.push(configuredProvider);
		}
	}

	return providers;
}

function getAutoSaveProviders(workspaceFolder: vscode.WorkspaceFolder): SessionProviderId[] {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<unknown[]>('autoSave.providers');

	return resolveAutoSaveProviders(configured);
}

function getCopilotHomePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('copilot.homePath', '');

	return resolveCopilotCliHomePath(configured, process.env, os.homedir());
}

function getCodexHomePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('codex.homePath', '')
		.trim();

	if (configured) {
		return configured;
	}

	const fromEnvironment = process.env.CODEX_HOME?.trim();
	if (fromEnvironment) {
		return fromEnvironment;
	}

	return path.join(os.homedir(), '.codex');
}

function getClaudeCodeHomePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('claudeCode.homePath', '')
		.trim();

	if (configured) {
		return configured;
	}

	const fromEnvironment = process.env.CLAUDE_CONFIG_DIR?.trim();
	if (fromEnvironment) {
		return fromEnvironment;
	}

	return path.join(os.homedir(), '.claude');
}

function getCursorUserDataPath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('cursor.userDataPath', '')
		.trim();

	if (configured) {
		return configured;
	}

	return getDefaultCursorUserDataPath();
}

function getCursorProjectsPath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('cursor.projectsPath', '')
		.trim();

	if (configured) {
		return configured;
	}

	return getDefaultCursorProjectsPath();
}

export function resolveResumeConfiguration(workspaceFolder: vscode.WorkspaceFolder): {
	maxTurns: number;
	maxContextChars: number;
} {
	const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
	const maxTurns = Math.max(1, config.get<number>('resume.maxTurns', 50));
	const maxContextChars = Math.max(1000, config.get<number>('resume.maxContextChars', 80000));

	return { maxTurns, maxContextChars };
}

function getPruneConfiguration(workspaceFolder: vscode.WorkspaceFolder): PruneConfiguration {
	const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
	return {
		maxSavedSessions: config.get<number>('save.maxSavedSessions', 0),
		pruneAction: config.get<SessionPruneAction>('save.pruneAction', 'archive'),
	};
}

export async function resolveManualWorkspaceFolder(
	depsOverrides: Partial<ManualWorkspaceSelectionDeps> = {},
): Promise<vscode.WorkspaceFolder | undefined> {
	const deps: ManualWorkspaceSelectionDeps = {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
		getWorkspaceFolder: (uri: vscode.Uri) => vscode.workspace.getWorkspaceFolder(uri),
		pickWorkspaceFolder: async (items: vscode.QuickPickItem[]) =>
			vscode.window.showQuickPick(items, {
				title: 'Select workspace folder',
			}),
		...depsOverrides,
	};

	const activeUri = deps.getActiveEditorUri();
	if (activeUri) {
		const fromActiveEditor = deps.getWorkspaceFolder(activeUri);
		if (fromActiveEditor) {
			return fromActiveEditor;
		}
	}

	const folders = deps.getWorkspaceFolders();
	if (!folders?.length) {
		return undefined;
	}

	if (folders.length === 1) {
		return folders[0];
	}

	const pick = await deps.pickWorkspaceFolder(
		folders.map((folder) => ({
			label: folder.name,
			detail: folder.uri.fsPath,
		})),
	);

	if (!pick) {
		return undefined;
	}

	return folders.find((folder) => folder.name === pick.label && folder.uri.fsPath === pick.detail);
}

export async function listSessionsAcrossWorkspaceFolders(
	workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
): Promise<WorkspaceSessionMeta[]> {
	if (!workspaceFolders?.length) {
		return [];
	}

	const results = await Promise.all(
		workspaceFolders.map(async (workspaceFolder) => {
			const storageDirectory = getStoragePath(workspaceFolder);
			const sessions = await sessionStore.listSessions(storageDirectory);
			return sessions.map((session) => ({
				...session,
				label: `[${workspaceFolder.name}] ${session.title}`,
				description: `${session.turnCount} turns`,
				detail: `${session.savedAt} | ${session.fileName}`,
				displayTitle: `[${workspaceFolder.name}] ${session.title}`,
				storageDirectory,
				workspaceFolder,
			}));
		}),
	);

	return results
		.flat()
		.sort(
			(a, b) => Date.parse(b.detail.split('|')[0]?.trim() ?? '') - Date.parse(a.detail.split('|')[0]?.trim() ?? ''),
		);
}

function createDefaultImplementLatestAnalysisDeps(): ImplementLatestAnalysisDeps {
	const handoffDispatcher = createVSCodeHandoffDispatcher();
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getStoragePath,
		readIndex: async (storageDirectory: string) => analysisStore.readIndex(storageDirectory),
		readReport: async (storageDirectory: string, reportPath: string) =>
			analysisStore.readReport(storageDirectory, reportPath),
		buildPrompt: (reportFilePath: string, userPrompt: string) =>
			buildImplementationHandoffPrompt(reportFilePath, userPrompt),
		selectChatModels: async () => vscode.lm.selectChatModels(),
		getCommands: async () => vscode.commands.getCommands(true),
		pickProvider: async (models, agentProviders) =>
			pickAnalysisProviderFromChat(models, agentProviders, undefined, 'implementation'),
		dispatchHandoff: async (prompt: string, target: HandoffSelectionId) => {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const providerCommands = workspaceFolder
				? vscode.workspace
						.getConfiguration('session-control', workspaceFolder.uri)
						.get<ResumeProviderCommands>('resume.providerCommands', {})
				: {};
			return handoffDispatcher.dispatchSelection(prompt, target, {
				configuredProviderCommands: providerCommands,
				promptLabel: 'implementation prompt',
			});
		},
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
		showWarningMessage: (message: string) => vscode.window.showWarningMessage(message),
	};
}

function sanitizeMarkdownForStatusMessage(markdown: string): string {
	return markdown
		.replace(/\[(.*?)\]\((.*?)\)/g, '$1')
		.replace(/[`*_>#]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function createDefaultAnalyzeSavedChatsCommandDeps(): AnalyzeSavedChatsCommandDeps {
	const handoffDispatcher = createVSCodeHandoffDispatcher();
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		listSessionsAcrossWorkspaceFolders,
		resolveSelection: async (requestPrompt: string) => resolveAnalysisSelection(requestPrompt),
		selectChatModels: async () => vscode.lm.selectChatModels(),
		getCommands: async () => vscode.commands.getCommands(true),
		pickAnalysisProvider: async (
			models: readonly vscode.LanguageModelChat[],
			agentProviders: readonly AnalysisAgentProviderId[],
		) => pickAnalysisProviderFromChat(models, agentProviders),
		getAppName: () => vscode.env.appName,
		runAnalyzeFlow: async (workspaceFolders, workspaceSessions, selection, model, token, onStatus) =>
			runAnalyzeSessionsFlow(
				'',
				workspaceFolders,
				workspaceSessions,
				createAnalyzeSessionsFlowDeps({
					resolveSelection: async () => selection,
					runModelPrompt: async (prompt: string) => {
						const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);

						let text = '';
						for await (const part of response.stream) {
							if (part instanceof vscode.LanguageModelTextPart) {
								text += part.value;
							}
						}

						return text.trim();
					},
					streamMarkdown: (markdown: string) => onStatus(markdown),
				}),
			),
		withProgress: <T>(
			options: vscode.ProgressOptions,
			task: (
				progress: vscode.Progress<{ message?: string; increment?: number }>,
				token: vscode.CancellationToken,
			) => Thenable<T>,
		) => vscode.window.withProgress(options, task),
		buildAgentHandoffPrompt: async (
			workspaceFolders: readonly vscode.WorkspaceFolder[],
			workspaceSessions: WorkspaceSessionMeta[],
			selection: AnalysisSelection,
		) => buildAnalysisHandoffPrompt(selection, workspaceFolders, workspaceSessions),
		dispatchHandoff: async (prompt: string, target: HandoffSelectionId) => {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const providerCommands = workspaceFolder
				? vscode.workspace
						.getConfiguration('session-control', workspaceFolder.uri)
						.get<ResumeProviderCommands>('resume.providerCommands', {})
				: {};
			return handoffDispatcher.dispatchSelection(prompt, target, {
				configuredProviderCommands: providerCommands,
				promptLabel: 'analysis handoff prompt',
			});
		},
		openTextDocument: (uri: vscode.Uri) => vscode.workspace.openTextDocument(uri),
		showTextDocument: (document: vscode.TextDocument) => vscode.window.showTextDocument(document, { preview: false }),
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
		showWarningMessage: (message: string) => vscode.window.showWarningMessage(message),
	};
}

async function findLatestUsableAnalysisReport(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	deps: ImplementLatestAnalysisDeps,
): Promise<{ report?: LatestAnalysisReportTarget; warnings: string[] }> {
	const candidates: LatestAnalysisReportTarget[] = [];
	const warnings: string[] = [];

	for (const workspaceFolder of workspaceFolders) {
		const storageDirectory = deps.getStoragePath(workspaceFolder);

		try {
			const index = await deps.readIndex(storageDirectory);
			for (const report of index.reports) {
				candidates.push({
					storageDirectory,
					reportPath: report.reportPath,
					createdAt: report.createdAt,
					selectionLabel: report.selection.label,
					workspaceFolder,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${workspaceFolder.name}: ${message}`);
		}
	}

	candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

	for (const candidate of candidates) {
		try {
			await deps.readReport(candidate.storageDirectory, candidate.reportPath);
			return { report: candidate, warnings };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${candidate.workspaceFolder.name}: ${message}`);
		}
	}

	return { warnings };
}

function toSessionQuickPickItem(session: SourceChatSession): SourceSessionPickItem {
	return {
		label: session.title,
		description: `${session.turns.length} turns`,
		detail: `${session.lastMessageDate} (${session.id})`,
		session,
	};
}

function createDefaultSaveSourceSessionFlowDeps(): SaveSourceSessionFlowDeps {
	return {
		selectSession: async (sessions: SourceChatSession[], provider: SessionProviderId) => {
			const pick = await vscode.window.showQuickPick(
				sessions.map((session) => toSessionQuickPickItem(session)),
				{ title: `Select ${getProviderLabel(provider)} session to save` },
			);

			return pick?.session;
		},
		promptTitle: async (defaultTitle: string) =>
			vscode.window.showInputBox({
				title: 'Session title',
				value: defaultTitle,
				prompt: 'Edit the title before saving (optional)',
			}),
		getGitContext,
		createChatSession,
		applySaveBloatControls,
		getIncludeInGitignore: (workspaceFolder) =>
			vscode.workspace
				.getConfiguration('session-control', workspaceFolder.uri)
				.get<boolean>('includeInGitignore', false),
		ensureGitignoreEntry: ensureStoragePathInGitignore,
		getPruneConfiguration,
		writeSession: async (storageDirectory, sessions, options) =>
			sessionStore.writeSessions(storageDirectory, sessions, options),
		pruneSessions: async (storageDirectory, maxSavedSessions, action) =>
			sessionStore.pruneSessions(storageDirectory, maxSavedSessions, action),
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
	};
}

function createDefaultSaveFlowDeps(): SaveSessionFlowDeps {
	return {
		readCopilotSessions,
		...createDefaultSaveSourceSessionFlowDeps(),
	};
}

export async function runSaveSourceSessionFlow(
	provider: SessionProviderId,
	sessions: SourceChatSession[],
	workspaceFolder: vscode.WorkspaceFolder,
	storageDirectory: string,
	depsOverrides: Partial<SaveSourceSessionFlowDeps> = {},
): Promise<string[] | undefined> {
	const deps = {
		...createDefaultSaveSourceSessionFlowDeps(),
		...depsOverrides,
	};

	if (!sessions.length) {
		return undefined;
	}

	const selected = await deps.selectSession(sessions, provider);
	if (!selected) {
		return undefined;
	}

	const title = await deps.promptTitle(selected.title, provider);
	if (title === undefined) {
		return undefined;
	}

	const git = await deps.getGitContext(workspaceFolder.uri);
	const chatSession = deps.createChatSession(selected, {
		title,
		git,
		vscodeVersion: vscode.version,
	});
	const saveConfig = getSaveConfiguration(workspaceFolder);
	const saveResult = deps.applySaveBloatControls(chatSession, {
		maxFileSizeBytes: saveConfig.maxFileSizeBytes,
		overflowStrategy: saveConfig.overflowStrategy,
		stripToolOutput: saveConfig.stripToolOutput,
	});

	const writtenFiles = await deps.writeSession(storageDirectory, saveResult.sessions, {
		includeTimestampInFileName: saveConfig.includeTimestampInFileName,
	});

	if (deps.getIncludeInGitignore(workspaceFolder)) {
		await deps.ensureGitignoreEntry(workspaceFolder, storageDirectory);
	}

	// Never await these notification toasts: vscode.window.showInformationMessage
	// only resolves once the notification is dismissed, and a toast that auto-hides
	// into the notification center may never resolve. Awaiting it here stalled the
	// rest of the flow (pruning) and the caller's sidebar refresh, so freshly saved
	// sessions did not appear in the Session Control explorer until reload.
	if (saveResult.warning) {
		void deps.showInformationMessage(saveResult.warning);
	}

	if (writtenFiles.length === 1) {
		void deps.showInformationMessage(`Saved chat session to ${path.join(storageDirectory, writtenFiles[0] ?? '')}`);
	} else {
		void deps.showInformationMessage(`Saved ${writtenFiles.length} session part files to ${storageDirectory}`);
	}

	const pruneConfig = deps.getPruneConfiguration(workspaceFolder);
	if (pruneConfig.maxSavedSessions > 0) {
		const pruneResult = await deps.pruneSessions(
			storageDirectory,
			pruneConfig.maxSavedSessions,
			pruneConfig.pruneAction,
		);
		if (pruneResult.archived > 0) {
			void deps.showInformationMessage(`Archived ${pruneResult.archived} old session file(s) after save.`);
		}

		if (pruneResult.deleted > 0) {
			void deps.showInformationMessage(`Deleted ${pruneResult.deleted} old session file(s) after save.`);
		}
	}

	return writtenFiles;
}

export async function runSaveSessionFlow(
	context: vscode.ExtensionContext,
	workspaceFolder: vscode.WorkspaceFolder,
	storageDirectory: string,
	depsOverrides: Partial<SaveSessionFlowDeps> = {},
): Promise<string | undefined> {
	const deps = {
		...createDefaultSaveFlowDeps(),
		...depsOverrides,
	};

	const sessions = await deps.readCopilotSessions(context);
	const writtenFiles = await runSaveSourceSessionFlow('copilot', sessions, workspaceFolder, storageDirectory, deps);
	return writtenFiles?.[0];
}

export function createSessionProviderPickItems(appName: string): ProviderPickItem[] {
	// Inside Cursor the workbench has no Copilot chat storage to save from, and
	// the host's own agent transcripts are what the user means by "this chat",
	// so the Copilot entry is replaced by Cursor.
	const hostItem: ProviderPickItem = /cursor/i.test(appName)
		? {
				label: 'Cursor',
				description: 'Import from local Cursor agent transcripts',
				provider: 'cursor',
			}
		: {
				label: 'Copilot',
				description: 'Save from VS Code Copilot chat storage',
				provider: 'copilot',
			};

	return [
		hostItem,
		{
			label: 'Codex',
			description: 'Import from local Codex session transcripts',
			provider: 'codex',
		},
		{
			label: 'Claude Code',
			description: 'Import from local Claude Code JSONL transcripts',
			provider: 'claude-code',
		},
	];
}

async function pickSessionProvider(): Promise<SessionProviderId | undefined> {
	const pick = await vscode.window.showQuickPick<ProviderPickItem>(createSessionProviderPickItems(vscode.env.appName), {
		title: 'Choose a session provider',
	});

	return pick?.provider;
}

function createDefaultManualSessionProviderLoaderDeps(): ManualSessionProviderLoaderDeps {
	return {
		getCodexHomePath,
		getClaudeCodeHomePath,
		getCursorUserDataPath,
		getCursorProjectsPath,
		readCopilotSessions,
		readCodexSessions,
		readClaudeCodeSessions,
		readCursorSessions,
	};
}

export async function loadSessionsForProvider(
	context: vscode.ExtensionContext,
	workspaceFolder: vscode.WorkspaceFolder,
	provider: SessionProviderId,
	depsOverrides: Partial<ManualSessionProviderLoaderDeps> = {},
): Promise<SourceChatSession[]> {
	const deps = {
		...createDefaultManualSessionProviderLoaderDeps(),
		...depsOverrides,
	};

	if (provider === 'codex') {
		return filterSessionsForWorkspace(
			await deps.readCodexSessions(deps.getCodexHomePath(workspaceFolder)),
			workspaceFolder,
			'codex',
			'interactive-import',
		);
	}

	if (provider === 'claude-code') {
		return filterSessionsForWorkspace(
			await deps.readClaudeCodeSessions(deps.getClaudeCodeHomePath(workspaceFolder), workspaceFolder.uri.fsPath),
			workspaceFolder,
			'claude-code',
			'interactive-import',
		);
	}

	if (provider === 'cursor') {
		return deps.readCursorSessions(
			workspaceFolder,
			deps.getCursorUserDataPath(workspaceFolder),
			context,
			deps.getCursorProjectsPath(workspaceFolder),
		);
	}

	return deps.readCopilotSessions(context);
}

async function runSaveSessionFromProviderCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = await resolveManualWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
		return;
	}

	const provider = await pickSessionProvider();
	if (!provider) {
		return;
	}

	const storageDirectory = getStoragePath(workspaceFolder);
	const sessions = await loadSessionsForProvider(context, workspaceFolder, provider);
	await runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory);
}

async function runImportCopilotGuidanceCommand(options: ImportCopilotGuidanceCommandOptions): Promise<void> {
	const workspaceFolder = await resolveManualWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage(
			`Open a workspace folder before importing ${options.skillLabel} skills.`,
		);
		return;
	}

	const importer = createCodexSkillImporter();
	const result = await importer.importSkills(
		workspaceFolder.uri.fsPath,
		options.skillDirectorySegments ? { skillDirectorySegments: [...options.skillDirectorySegments] } : {},
	);
	if (!result.created.length && !result.skipped.length) {
		await vscode.window.showInformationMessage(
			`No Copilot guidance files were found to import as ${options.skillLabel} skills.`,
		);
		return;
	}

	const summaryParts = [`${result.created.length} created`, `${result.skipped.length} skipped`];
	await vscode.window.showInformationMessage(
		`Imported Copilot guidance to ${options.targetDirectory} for ${workspaceFolder.name}: ${summaryParts.join(', ')}.`,
	);
}

async function runImportCopilotSkillsToCodexCommand(): Promise<void> {
	await runImportCopilotGuidanceCommand({
		skillLabel: 'Codex',
		targetDirectory: '.agents/skills',
	});
}

async function runImportCopilotSkillsToCursorCommand(): Promise<void> {
	await runImportCopilotGuidanceCommand({
		skillLabel: 'Cursor',
		targetDirectory: '.cursor/skills',
		skillDirectorySegments: ['.cursor', 'skills'],
	});
}

async function runImportCopilotSkillsToClaudeCodeCommand(): Promise<void> {
	await runImportCopilotGuidanceCommand({
		skillLabel: 'Claude Code',
		targetDirectory: '.claude/skills',
		skillDirectorySegments: ['.claude', 'skills'],
	});
}

function createDefaultDeleteSessionCommandDeps(): DeleteSessionCommandDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		listSessionsAcrossWorkspaceFolders,
		pickSession: async (sessions: WorkspaceSessionMeta[]) =>
			vscode.window.showQuickPick<WorkspaceSessionMeta>(sessions, {
				title: 'Select saved session to delete',
			}),
		confirmDelete: async (label: string) => {
			const confirmation = await vscode.window.showWarningMessage(
				`Delete session '${label}'?`,
				{ modal: true },
				'Delete',
			);
			return confirmation === 'Delete';
		},
		deleteSession: (storageDirectory: string, fileName: string) =>
			sessionStore.deleteSession(storageDirectory, fileName),
		refreshSessionExplorer: () => undefined,
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
	};
}

export async function runDeleteSessionCommand(depsOverrides: Partial<DeleteSessionCommandDeps> = {}): Promise<void> {
	const deps = {
		...createDefaultDeleteSessionCommandDeps(),
		...depsOverrides,
	};

	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		await deps.showInformationMessage('Open a workspace folder before deleting sessions.');
		return;
	}

	const sessions = await deps.listSessionsAcrossWorkspaceFolders(workspaceFolders);
	if (!sessions.length) {
		await deps.showInformationMessage('No saved sessions found.');
		return;
	}

	const pick = await deps.pickSession(sessions);
	if (!pick) {
		return;
	}

	if (!(await deps.confirmDelete(pick.label))) {
		return;
	}

	const deleted = await deps.deleteSession(pick.storageDirectory, pick.fileName);
	// Refresh before notifying: a non-modal notification's promise only
	// resolves once the toast is dismissed, so refreshing after it would leave
	// the deleted entry visible in the Session Explorer until then. Refresh
	// even when the file was already gone so the stale entry disappears.
	deps.refreshSessionExplorer();
	if (!deleted) {
		await deps.showInformationMessage('Session file no longer exists.');
		return;
	}

	await deps.showInformationMessage(`Deleted session ${pick.label}`);
}

function createDefaultDeleteSessionFromExplorerCommandDeps(): DeleteSessionFromExplorerCommandDeps {
	const defaults = createDefaultDeleteSessionCommandDeps();
	return {
		confirmDelete: defaults.confirmDelete,
		deleteSession: defaults.deleteSession,
		refreshSessionExplorer: defaults.refreshSessionExplorer,
		showInformationMessage: defaults.showInformationMessage,
	};
}

export async function runDeleteSessionFromExplorerCommand(
	item: SessionExplorerSessionItem,
	depsOverrides: Partial<DeleteSessionFromExplorerCommandDeps> = {},
): Promise<void> {
	const deps = {
		...createDefaultDeleteSessionFromExplorerCommandDeps(),
		...depsOverrides,
	};

	if (!(await deps.confirmDelete(String(item.label)))) {
		return;
	}

	const deleted = await deps.deleteSession(item.storageDirectory, item.fileName);
	// Refresh before notifying — see runDeleteSessionCommand for why.
	deps.refreshSessionExplorer();
	if (!deleted) {
		await deps.showInformationMessage('Session file no longer exists.');
		return;
	}

	await deps.showInformationMessage(`Deleted session ${item.label}`);
}

function createDefaultCleanupOrphanedPartsCommandDeps(): CleanupOrphanedPartsCommandDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getStoragePath,
		findOrphanedPartFiles: (storageDirectory: string) => sessionStore.findOrphanedPartFiles(storageDirectory),
		confirmCleanup: async (fileCount: number, sessionCount: number) => {
			const confirmation = await vscode.window.showWarningMessage(
				`Delete ${fileCount} orphaned session part file(s) from ${sessionCount} session(s)? Each is a stale auto-save whose linked part file no longer exists; a newer intact copy of every session remains.`,
				{ modal: true },
				'Delete',
			);
			return confirmation === 'Delete';
		},
		deleteSession: (storageDirectory: string, fileName: string) =>
			sessionStore.deleteSession(storageDirectory, fileName),
		refreshSessionExplorer: () => undefined,
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
	};
}

export async function runCleanupOrphanedPartsCommand(
	depsOverrides: Partial<CleanupOrphanedPartsCommandDeps> = {},
): Promise<void> {
	const deps = {
		...createDefaultCleanupOrphanedPartsCommandDeps(),
		...depsOverrides,
	};

	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		await deps.showInformationMessage('Open a workspace folder before cleaning up orphaned session parts.');
		return;
	}

	const removable: Array<{
		storageDirectory: string;
		orphan: OrphanedPartFile;
	}> = [];
	let unsupersededCount = 0;
	for (const workspaceFolder of workspaceFolders) {
		const storageDirectory = deps.getStoragePath(workspaceFolder);
		for (const orphan of await deps.findOrphanedPartFiles(storageDirectory)) {
			if (orphan.superseded) {
				removable.push({ storageDirectory, orphan });
			} else {
				unsupersededCount += 1;
			}
		}
	}

	if (removable.length === 0) {
		await deps.showInformationMessage(
			unsupersededCount === 0
				? 'No orphaned session part files found.'
				: `Found ${unsupersededCount} session file(s) with broken part links but no newer intact copy; they may hold unique turns, so nothing was removed.`,
		);
		return;
	}

	const sessionCount = new Set(removable.map(({ orphan }) => orphan.sessionId)).size;
	if (!(await deps.confirmCleanup(removable.length, sessionCount))) {
		return;
	}

	let deletedCount = 0;
	for (const { storageDirectory, orphan } of removable) {
		if (await deps.deleteSession(storageDirectory, orphan.fileName)) {
			deletedCount += 1;
		}
	}

	// Refresh before notifying — see runDeleteSessionCommand for why.
	deps.refreshSessionExplorer();
	const skippedNote =
		unsupersededCount > 0
			? ` ${unsupersededCount} file(s) with broken links were kept because no newer intact copy exists.`
			: '';
	await deps.showInformationMessage(`Deleted ${deletedCount} orphaned session part file(s).${skippedNote}`);
}

function createDefaultOpenSavedSessionDeps(): OpenSavedSessionDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		listSessionsAcrossWorkspaceFolders,
		pickSession: async (sessions: WorkspaceSessionMeta[]) =>
			vscode.window.showQuickPick<WorkspaceSessionMeta>(sessions, {
				title: 'Select saved session to open',
			}),
		readSession: async (storageDirectory: string, fileName: string) =>
			sessionStore.readSession(storageDirectory, fileName),
		showSession: (session, extensionUri, storageDirectory, fileName) => {
			SessionViewerPanel.createOrShow(session, extensionUri, storageDirectory, fileName);
		},
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
	};
}

export async function runOpenSavedSessionCommand(
	context: vscode.ExtensionContext,
	target: OpenSessionTarget | undefined,
	depsOverrides: Partial<OpenSavedSessionDeps> = {},
): Promise<void> {
	const deps = {
		...createDefaultOpenSavedSessionDeps(),
		...depsOverrides,
	};

	let selectedTarget = target;
	if (!selectedTarget) {
		const workspaceFolders = deps.getWorkspaceFolders();
		if (!workspaceFolders?.length) {
			await deps.showInformationMessage('Open a workspace folder before opening saved sessions.');
			return;
		}

		const sessions = await deps.listSessionsAcrossWorkspaceFolders(workspaceFolders);
		if (!sessions.length) {
			await deps.showInformationMessage('No saved sessions found.');
			return;
		}

		const pick = await deps.pickSession(sessions);
		if (!pick) {
			return;
		}

		selectedTarget = pick;
	}

	const session = await deps.readSession(selectedTarget.storageDirectory, selectedTarget.fileName);
	deps.showSession(session, context.extensionUri, selectedTarget.storageDirectory, selectedTarget.fileName);
}

export async function runViewSessionFileCommand(
	context: vscode.ExtensionContext,
	depsOverrides: Partial<ViewSessionFileDeps> = {},
): Promise<void> {
	const deps: ViewSessionFileDeps = {
		getActiveEditor: () => vscode.window.activeTextEditor,
		showSession: (session, extensionUri, storageDirectory, fileName) => {
			SessionViewerPanel.createOrShow(session, extensionUri, storageDirectory, fileName);
		},
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
		...depsOverrides,
	};

	const editor = deps.getActiveEditor();
	if (!editor) {
		await deps.showInformationMessage('Open a JSON session file before using Session Viewer.');
		return;
	}

	const document = editor.document;
	if (document.uri.scheme !== 'file') {
		await deps.showInformationMessage('Only local JSON files can be opened in Session Viewer.');
		return;
	}

	const parsed = parseSessionDocument(document.getText());
	if (parsed.kind === 'invalid-json') {
		await deps.showInformationMessage('The active file is not valid JSON.');
		return;
	}

	if (parsed.kind === 'not-session') {
		await deps.showInformationMessage('This file is not a recognized Session Control session format.');
		return;
	}

	const filePath = document.uri.fsPath;
	deps.showSession(parsed.session, context.extensionUri, path.dirname(filePath), path.basename(filePath));
}

export async function runImplementLatestAnalysisCommand(
	depsOverrides: Partial<ImplementLatestAnalysisDeps> = {},
): Promise<void> {
	const deps = {
		...createDefaultImplementLatestAnalysisDeps(),
		...depsOverrides,
	};

	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		await deps.showInformationMessage('Open a workspace folder before implementing from a saved analysis.');
		return;
	}

	const latest = await findLatestUsableAnalysisReport(workspaceFolders, deps);
	if (!latest.report) {
		if (latest.warnings.length > 0) {
			await deps.showWarningMessage(`No usable saved analysis report was found. ${latest.warnings[0] ?? ''}`.trim());
			return;
		}

		await deps.showInformationMessage(
			'No saved analysis reports found. Run Session Control: Analyze Saved Chats or @session-control /analyze first.',
		);
		return;
	}

	const prompt = deps.buildPrompt(path.join(latest.report.storageDirectory, latest.report.reportPath), '');
	let models: readonly vscode.LanguageModelChat[] = [];
	try {
		models = await deps.selectChatModels();
	} catch {
		// Agent providers remain available when host model discovery fails.
	}

	let availableCommands: readonly string[] = [];
	try {
		availableCommands = await deps.getCommands();
	} catch {
		// Direct host chat remains available when command discovery fails.
	}

	const agentProviders = findAvailableAnalysisAgentProviders(availableCommands);
	const providerSelection = await deps.pickProvider(models, agentProviders);
	if (!providerSelection) {
		if (models.length === 0 && agentProviders.length === 0) {
			await deps.showWarningMessage(
				'No implementation provider is available. Sign in or install Codex, Claude Code, or Cursor, then try again.',
			);
		}
		return;
	}

	try {
		const target = providerSelection.kind === 'agent' ? providerSelection.provider : 'chat';
		const result = await deps.dispatchHandoff(prompt, target);
		const contextMessage =
			providerSelection.kind === 'agent'
				? ` Source analysis workspace: ${latest.report.workspaceFolder.name}.`
				: ` Analysis: ${latest.report.selectionLabel}.`;
		const message = `${result.instruction}${contextMessage}`;
		if (result.method === 'failed') {
			await deps.showWarningMessage(message);
			return;
		}

		await deps.showInformationMessage(message);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (providerSelection.kind === 'agent') {
			await deps.showWarningMessage(
				`Could not open ${getProviderLabel(providerSelection.provider)} for implementation (${message}).`,
			);
			return;
		}

		await deps.showWarningMessage(`Failed to open chat with the generated implementation prompt: ${message}`);
	}
}

export async function runAnalyzeSavedChatsCommand(
	requestPrompt = '',
	depsOverrides: Partial<AnalyzeSavedChatsCommandDeps> = {},
): Promise<void> {
	const deps = {
		...createDefaultAnalyzeSavedChatsCommandDeps(),
		...depsOverrides,
	};

	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		await deps.showInformationMessage('Open a workspace folder before analyzing saved chats.');
		return;
	}

	const workspaceSessions = await deps.listSessionsAcrossWorkspaceFolders(workspaceFolders);
	if (!workspaceSessions.length) {
		await deps.showInformationMessage('No saved sessions found. Save chat sessions before running analysis.');
		return;
	}

	const selection = await deps.resolveSelection(requestPrompt);
	if (!selection) {
		return;
	}

	let models: readonly vscode.LanguageModelChat[];
	try {
		models = await deps.selectChatModels();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await deps.showWarningMessage(`Failed to access a chat model for analysis: ${message}`);
		return;
	}

	let availableCommands: readonly string[] = [];
	try {
		availableCommands = await deps.getCommands();
	} catch {
		// Keep direct language-model analysis available even when command discovery fails.
	}

	const providerSelection = await deps.pickAnalysisProvider(
		models,
		findAvailableAnalysisAgentProviders(availableCommands),
	);
	if (!providerSelection) {
		if (models.length === 0 && /cursor/i.test(deps.getAppName())) {
			let handoff: { prompt?: string; infoMessage?: string };
			try {
				handoff = await deps.buildAgentHandoffPrompt(workspaceFolders, workspaceSessions, selection);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await deps.showWarningMessage(
					`Cursor does not currently expose extension-callable chat models, and Session Control could not build an analysis handoff prompt: ${message}`,
				);
				return;
			}

			if (handoff.infoMessage) {
				await deps.showInformationMessage(handoff.infoMessage);
				return;
			}

			if (!handoff.prompt) {
				await deps.showWarningMessage(
					'Cursor does not currently expose extension-callable chat models, and no analysis handoff prompt could be generated.',
				);
				return;
			}

			try {
				const dispatchResult = await deps.dispatchHandoff(handoff.prompt, 'chat');
				const message = `Cursor does not currently expose extension-callable chat models. ${dispatchResult.instruction}`;
				if (dispatchResult.method === 'failed') {
					await deps.showWarningMessage(message);
					return;
				}

				await deps.showInformationMessage(message);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await deps.showWarningMessage(
					`Cursor does not currently expose extension-callable chat models, and opening chat with the analysis handoff prompt failed: ${message}`,
				);
			}
			return;
		}

		if (models.length === 0) {
			await deps.showWarningMessage(
				'No host chat model or installed analysis agent is available. Sign in, enable a chat model, or install Codex/Claude Code, then try again.',
			);
		}
		return;
	}

	if (providerSelection.kind === 'agent') {
		let handoff: { prompt?: string; infoMessage?: string };
		try {
			handoff = await deps.buildAgentHandoffPrompt(workspaceFolders, workspaceSessions, selection);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await deps.showWarningMessage(
				`Could not build the ${getProviderLabel(providerSelection.provider)} analysis handoff prompt: ${message}`,
			);
			return;
		}

		if (handoff.infoMessage) {
			await deps.showInformationMessage(handoff.infoMessage);
			return;
		}
		if (!handoff.prompt) {
			await deps.showWarningMessage(
				`Could not build the ${getProviderLabel(providerSelection.provider)} analysis handoff prompt.`,
			);
			return;
		}

		try {
			const dispatchResult = await deps.dispatchHandoff(handoff.prompt, providerSelection.provider);
			if (dispatchResult.method === 'failed') {
				await deps.showWarningMessage(dispatchResult.instruction);
				return;
			}

			await deps.showInformationMessage(dispatchResult.instruction);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await deps.showWarningMessage(
				`Could not open the installed ${getProviderLabel(providerSelection.provider)} chat (${message}).`,
			);
		}
		return;
	}

	const model = providerSelection.model;

	let lastStatusMessage = '';
	const result = await deps.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Session Control',
			cancellable: true,
		},
		async (progress, token) => {
			progress.report({ message: 'Analyzing saved chats...' });
			return deps.runAnalyzeFlow(workspaceFolders, workspaceSessions, selection, model, token, (markdown: string) => {
				lastStatusMessage = sanitizeMarkdownForStatusMessage(markdown);
				if (lastStatusMessage) {
					progress.report({ message: lastStatusMessage });
				}
			});
		},
	);

	if (!result) {
		if (lastStatusMessage) {
			await deps.showInformationMessage(lastStatusMessage);
		}
		return;
	}

	deps.onReportSaved?.();

	const reportUri = vscode.Uri.file(
		path.join(result.metadata.analysisStorageDirectory, result.metadata.analysisReportPath),
	);
	try {
		const document = await deps.openTextDocument(reportUri);
		await deps.showTextDocument(document);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await deps.showWarningMessage(`Saved the analysis report, but failed to open it: ${message}`);
		return;
	}

	await deps.showInformationMessage(
		`Saved analysis report to ${result.metadata.analysisReportPath}. Run Session Control: Implement Latest Analysis to continue.`,
	);
}

export async function runAnalyzeSessionFromExplorerCommand(
	item: SessionExplorerSessionItem | undefined,
	depsOverrides: Partial<AnalyzeSavedChatsCommandDeps> = {},
): Promise<void> {
	if (!item) {
		const showInformationMessage =
			depsOverrides.showInformationMessage ?? ((message: string) => vscode.window.showInformationMessage(message));
		await showInformationMessage('Select a saved session in the Session Control explorer to analyze it.');
		return;
	}

	// Scope the shared analyze flow to exactly the clicked session: the session
	// list contains only this session and the selection pins its id, so the
	// report, index entries, and handoff prompt reference one session. The
	// scoping deps intentionally win over depsOverrides.
	await runAnalyzeSavedChatsCommand('', {
		...depsOverrides,
		listSessionsAcrossWorkspaceFolders: async () => [
			{
				...item.session,
				label: item.session.title,
				displayTitle: `[${item.workspaceFolder.name}] ${item.session.title}`,
				storageDirectory: item.storageDirectory,
				workspaceFolder: item.workspaceFolder,
			},
		],
		resolveSelection: async () => createSingleSessionSelection(item.session),
	});
}

function parseSessionDocument(text: string): ParsedSessionDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		return { kind: 'invalid-json' };
	}

	if (!isChatSession(parsed)) {
		return { kind: 'not-session' };
	}

	return { kind: 'ok', session: parsed };
}

function createDefaultAutoSaveOnChatResponseDeps(context: vscode.ExtensionContext): AutoSaveOnChatResponseDeps {
	const autoSaveCursorCliSessionReader = createCursorCliSessionReader();
	const autoSaveCodexSessionReader = createCodexSessionReader({
		showInformationMessage: async () => undefined,
	});
	const autoSaveClaudeCodeSessionReader = createClaudeCodeSessionReader({
		showInformationMessage: async () => undefined,
	});
	const autoSaveCopilotCliSessionReader = createCopilotCliSessionReader();

	return {
		getStorageUri: () => context.storageUri,
		getStorageDirectory: getStoragePath,
		createWatcher: (sessionsDirectory, globPattern) => {
			const pattern = new vscode.RelativePattern(vscode.Uri.file(sessionsDirectory), globPattern);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			return {
				onDidChange: (listener) => watcher.onDidChange((uri) => listener(uri.fsPath)),
				onDidCreate: (listener) => watcher.onDidCreate((uri) => listener(uri.fsPath)),
				dispose: () => watcher.dispose(),
			};
		},
		getImplicitWorkspaceFolder: getUnambiguousAutoSaveWorkspaceFolder,
		getWorkspaceFolderCount: () => vscode.workspace.workspaceFolders?.length ?? 0,
		getRemoteName: () => vscode.env.remoteName,
		getAutoSaveProviders,
		getCopilotHomePath,
		getCodexHomePath,
		getClaudeCodeHomePath,
		getCursorProjectsPath,
		pathExists: existsSync,
		isDirectory: (sourcePath) => {
			try {
				return statSync(sourcePath).isDirectory();
			} catch {
				return false;
			}
		},
		diagnosticState: createAutoSaveDiagnosticState(),
		readCopilotSessions: () => readCopilotSessions(context),
		readCopilotCliSessions: (workspaceFolder) =>
			autoSaveCopilotCliSessionReader.readCopilotCliSessions({
				workspacePath: workspaceFolder.uri.fsPath,
				homePath: getCopilotHomePath(workspaceFolder),
			}),
		readCodexSessions: async (workspaceFolder) =>
			filterSessionsForWorkspace(
				await autoSaveCodexSessionReader.readCodexSessions(getCodexHomePath(workspaceFolder)),
				workspaceFolder,
				'codex',
				'auto-save',
			),
		readClaudeCodeSessions: async (workspaceFolder) =>
			filterSessionsForWorkspace(
				await autoSaveClaudeCodeSessionReader.readClaudeCodeSessions(
					getClaudeCodeHomePath(workspaceFolder),
					workspaceFolder.uri.fsPath,
				),
				workspaceFolder,
				'claude-code',
				'auto-save',
			),
		readCursorSessions: (workspaceFolder) =>
			autoSaveCursorCliSessionReader.readCursorCliSessions(
				workspaceFolder.uri.fsPath,
				getCursorProjectsPath(workspaceFolder),
			),
		saveSessionSilently: async (workspaceFolder, storageDirectory, provider, sessions, origin) =>
			runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory, {
				selectSession: async (sessions) => sessions[0],
				promptTitle: async (defaultTitle) => defaultTitle,
				showInformationMessage: async () => undefined,
				createChatSession: (source, options) =>
					createChatSession(source, {
						...options,
						origin,
					}),
				writeSession: (storageDirectory, sessions, options) =>
					sessionStore.upsertAutoSaveSessions(
						storageDirectory,
						sessions,
						{
							sourceId: origin.sourceId,
							sourceSessionId: origin.sourceSessionId,
						},
						options,
					),
			}),
		refreshSessionExplorer: () => undefined,
		findExistingAutoSaves: (storageDirectory, sourceId, sourceSessionId) =>
			sessionStore.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId),
		showWarningMessage: (message: string) => vscode.window.showWarningMessage(message),
		hash: (value) => createHash('sha256').update(value).digest('hex'),
		schedule: (callback, delayMs) => setTimeout(callback, delayMs),
		clearSchedule: (handle) => clearTimeout(handle),
		scheduleMaintenance: (callback, delayMs) => setTimeout(callback, delayMs),
		clearMaintenanceSchedule: (handle) => clearTimeout(handle),
		readAutoSaveCheckpointState: (workspaceFolder, storageDirectory) => {
			const workspaceState = context.workspaceState as vscode.Memento | undefined;
			return workspaceState?.get<unknown>(
				createAutoSaveCheckpointStateKey(workspaceFolder, storageDirectory),
			);
		},
		writeAutoSaveCheckpointState: (workspaceFolder, storageDirectory, state) => {
			const workspaceState = context.workspaceState as vscode.Memento | undefined;
			return (
				workspaceState?.update(
					createAutoSaveCheckpointStateKey(workspaceFolder, storageDirectory),
					state,
				) ?? Promise.resolve()
			);
		},
		settleReadDelayMs: 250,
	};
}

function resolveAutoSaveWatchTargets(
	workspaceFolder: vscode.WorkspaceFolder,
	provider: SessionProviderId,
	copilotWorkspaceStore: CopilotWorkspaceStoreResolution | undefined,
	deps: Pick<
		AutoSaveOnChatResponseDeps,
		'getCopilotHomePath' | 'getCodexHomePath' | 'getClaudeCodeHomePath' | 'getCursorProjectsPath'
	>,
): AutoSaveWatchTarget[] {
	if (provider === 'copilot') {
		const targets: AutoSaveWatchTarget[] = [];
		if (copilotWorkspaceStore?.kind === 'resolved') {
			targets.push({
				sourceId: 'copilot-vscode',
				provider,
				directory: copilotWorkspaceStore.sessionsDirectory,
				glob: '*.{json,jsonl}',
				label: 'Copilot chatSessions',
			});
		}

		targets.push({
			sourceId: 'copilot-cli',
			provider,
			directory: deriveCopilotCliSessionStatePath(deps.getCopilotHomePath(workspaceFolder)),
			glob: '*/events.jsonl',
			label: 'GitHub Copilot CLI event logs',
		});
		return targets;
	}

	if (provider === 'cursor') {
		const location = resolveCursorCliSessionLocation(
			workspaceFolder.uri.fsPath,
			deps.getCursorProjectsPath(workspaceFolder),
		);
		return [
			{
				sourceId: 'cursor-cli',
				provider,
				directory: location.projectDirectory,
				glob: 'agent-transcripts/**/*.jsonl',
				label: 'Cursor CLI agent transcripts',
			},
		];
	}

	if (provider === 'codex') {
		return [
			{
				sourceId: 'codex-cli',
				provider,
				directory: deps.getCodexHomePath(workspaceFolder),
				glob: 'sessions/**/*.{json,jsonl}',
				label: 'Codex session transcripts',
			},
		];
	}

	if (provider === 'claude-code') {
		const projectSlug = deriveClaudeCodeProjectSlug(workspaceFolder.uri.fsPath);
		const projectDirectory = path.join(
			deriveClaudeCodeProjectsPath(deps.getClaudeCodeHomePath(workspaceFolder)),
			projectSlug,
		);
		return [
			{
				sourceId: 'claude-code-cli',
				provider,
				directory: projectDirectory,
				glob: '*.jsonl',
				label: 'Claude Code transcripts',
			},
		];
	}

	return [];
}

function getConfiguredAutoSaveSourceDiagnostics(
	workspaceFolder: vscode.WorkspaceFolder,
	deps: AutoSaveOnChatResponseDeps,
): AutoSaveSourceDiagnostic[] {
	const diagnosticState = createAutoSaveDiagnosticState();
	const providers = deps.getAutoSaveProviders(workspaceFolder);
	const copilotWorkspaceStore = providers.includes('copilot')
		? resolveCopilotWorkspaceStore(
				{
					storageUri: deps.getStorageUri(),
					workspaceFolder,
					workspaceFolderCount: deps.getWorkspaceFolderCount(),
					remoteName: deps.getRemoteName(),
				},
				{
					isDirectory: deps.isDirectory,
					pathExists: deps.pathExists,
				},
			)
		: undefined;
	if (copilotWorkspaceStore) {
		diagnosticState.registerSource(
			'copilot-vscode',
			copilotWorkspaceStore.resolvedPath,
			copilotWorkspaceStore.pathExists,
			copilotWorkspaceStore.validation,
		);
	}

	const targets = providers.flatMap((provider) =>
		resolveAutoSaveWatchTargets(workspaceFolder, provider, copilotWorkspaceStore, deps),
	);
	for (const target of targets) {
		if (diagnosticState.getSource(target.sourceId)) {
			continue;
		}

		diagnosticState.registerSource(target.sourceId, target.directory, deps.pathExists(target.directory));
	}
	return diagnosticState.getAll();
}

function mergeAutoSaveSourceDiagnostics(
	configuredSources: readonly AutoSaveSourceDiagnostic[],
	liveSources: readonly AutoSaveSourceDiagnostic[],
): AutoSaveSourceDiagnostic[] {
	const sourcesById = new Map<AutoSaveSourceId, AutoSaveSourceDiagnostic>();
	for (const source of configuredSources) {
		sourcesById.set(source.sourceId, source);
	}
	for (const source of liveSources) {
		sourcesById.set(source.sourceId, source);
	}
	return [...sourcesById.values()];
}

async function readAutoSaveSessionsForSource(
	sourceId: AutoSaveSourceId,
	provider: SessionProviderId,
	workspaceFolder: vscode.WorkspaceFolder,
	deps: Pick<
		AutoSaveOnChatResponseDeps,
		| 'readCopilotSessions'
		| 'readCopilotCliSessions'
		| 'readCodexSessions'
		| 'readClaudeCodeSessions'
		| 'readCursorSessions'
	>,
): Promise<SourceChatSession[]> {
	if (sourceId === 'copilot-cli') {
		return deps.readCopilotCliSessions(workspaceFolder);
	}

	if (sourceId === 'copilot-vscode') {
		return deps.readCopilotSessions();
	}

	if (provider === 'cursor') {
		return deps.readCursorSessions(workspaceFolder);
	}

	if (provider === 'codex') {
		return deps.readCodexSessions(workspaceFolder);
	}

	if (provider === 'claude-code') {
		return deps.readClaudeCodeSessions(workspaceFolder);
	}

	return [];
}

function createAutoSaveOnChatResponseListener(
	output: vscode.OutputChannel,
	deps: AutoSaveOnChatResponseDeps,
): AutoSaveController | undefined {
	const storageUri = deps.getStorageUri();
	const workspaceFolderCount = deps.getWorkspaceFolderCount();
	const workspaceFolder = deps.getImplicitWorkspaceFolder();
	if (!workspaceFolder) {
		output.appendLine(
			workspaceFolderCount > 1
				? '[auto-save] Auto-save requires one explicit workspace folder; ambiguous multi-root sessions are skipped.'
				: '[auto-save] No workspace folder is open. Chat response auto-save is disabled.',
		);
		return undefined;
	}

	const providers = deps.getAutoSaveProviders(workspaceFolder);
	const copilotWorkspaceStore = providers.includes('copilot')
		? resolveCopilotWorkspaceStore(
				{
					storageUri,
					workspaceFolder,
					workspaceFolderCount,
					remoteName: deps.getRemoteName(),
				},
				{
					isDirectory: deps.isDirectory,
					pathExists: deps.pathExists,
				},
			)
		: undefined;
	if (copilotWorkspaceStore) {
		deps.diagnosticState.registerSource(
			'copilot-vscode',
			copilotWorkspaceStore.resolvedPath,
			copilotWorkspaceStore.pathExists,
			copilotWorkspaceStore.validation,
		);
		if (copilotWorkspaceStore.kind === 'resolved') {
			output.appendLine(
				`[auto-save] Validated VS Code Copilot workspace store for "${workspaceFolder.name}": ${copilotWorkspaceStore.workspaceStorePath}; chatSessions=${copilotWorkspaceStore.sessionsDirectory}; profile=${copilotWorkspaceStore.validation.profileKind}; formats=${copilotWorkspaceStore.validation.supportedFormats.join(',')}.`,
			);
		} else {
			deps.diagnosticState.recordSkip('copilot-vscode', copilotWorkspaceStore.validation.reason);
			output.appendLine(
				`[auto-save] Skipped VS Code Copilot workspace store for "${workspaceFolder.name}": ${copilotWorkspaceStore.validation.reason} Candidate=${copilotWorkspaceStore.resolvedPath}.`,
			);
		}
	}

	const watchTargets = providers.flatMap((provider) => {
		return resolveAutoSaveWatchTargets(workspaceFolder, provider, copilotWorkspaceStore, deps);
	});
	if (!watchTargets.length) {
		output.appendLine(`[auto-save] No watch targets available for providers ${providers.join(', ')}.`);
		return undefined;
	}

	const storageDirectory = deps.getStorageDirectory(workspaceFolder);
	const sources: AutoSaveSource<SourceChatSession>[] = watchTargets.map((target) => ({
		sourceId: target.sourceId,
		directory: target.directory,
		glob: target.glob,
		label: target.label,
		sessionLabel: getProviderLabel(target.provider),
		storageDirectory,
		readCandidates: async () => {
			const sessions = await readAutoSaveSessionsForSource(target.sourceId, target.provider, workspaceFolder, deps);
			const requiresPositiveWorkspaceMatch = target.provider === 'codex' || target.provider === 'claude-code';
			const projectSessions = requiresPositiveWorkspaceMatch
				? filterSessionsForWorkspace(sessions, workspaceFolder, target.provider, 'auto-save')
				: sessions;
			return projectSessions.map((session) => ({
				identity: `${target.sourceId}:${session.id}`,
				sourceSessionId: session.id,
				sourcePath: session.sourceFile,
				sourceRevision: deps.hash(createAutoSaveSourceRevisionInput(target.sourceId, session)),
				title: session.title,
				turnCount: session.turns.length,
				session,
			}));
		},
		findExistingAutoSaves: (sourceSessionId) =>
			deps.findExistingAutoSaves(storageDirectory, target.sourceId, sourceSessionId),
		saveCandidates: async (candidates) => {
			const selected = candidates[0];
			if (!selected) {
				return undefined;
			}

			const savedFileNames = await deps.saveSessionSilently(
				workspaceFolder,
				storageDirectory,
				target.provider,
				candidates.map((candidate) => candidate.session),
				{
					saveKind: 'auto',
					sourceId: target.sourceId,
					sourceSessionId: selected.sourceSessionId,
					sourceRevision: selected.sourceRevision,
				},
			);
			if (savedFileNames && savedFileNames.length > 0) {
				deps.refreshSessionExplorer();
			}
			return savedFileNames;
		},
	}));
	const registration = createAutoSaveController(sources, {
		createWatcher: deps.createWatcher,
		pathExists: deps.pathExists,
		diagnosticState: deps.diagnosticState,
		appendLine: (value) => output.appendLine(value),
		showWarningMessage: deps.showWarningMessage,
		hash: deps.hash,
		schedule: deps.schedule,
		clearSchedule: deps.clearSchedule,
		scheduleMaintenance: deps.scheduleMaintenance,
		clearMaintenanceSchedule: deps.clearMaintenanceSchedule,
		debounceDelayMs: 5000,
		settleReadDelayMs: deps.settleReadDelayMs,
		maxSettleReadAttempts: 4,
		incompleteRetryDelaysMs: [250, 500, 1000],
		failureRetryDelayMs: 60_000,
		directoryRecoveryDelayMs: 30_000,
		fallbackScanIntervalMs: 5 * 60_000,
		checkpointStorage: {
			read: () => deps.readAutoSaveCheckpointState(workspaceFolder, storageDirectory),
			write: (state) => deps.writeAutoSaveCheckpointState(workspaceFolder, storageDirectory, state),
		},
	});
	return registration;
}

export function registerAutoSaveOnChatResponseListener(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	depsOverrides: Partial<AutoSaveOnChatResponseDeps> = {},
): AutoSaveController | undefined {
	const registration = createAutoSaveOnChatResponseListener(output, {
		...createDefaultAutoSaveOnChatResponseDeps(context),
		...depsOverrides,
	});
	if (registration) {
		context.subscriptions.push(registration);
	}

	return registration;
}

function getUnambiguousAutoSaveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	return workspaceFolders?.length === 1 ? workspaceFolders[0] : undefined;
}

function getImplicitWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
		if (workspaceFolder) {
			return workspaceFolder;
		}
	}

	return vscode.workspace.workspaceFolders?.[0];
}

function isWorkspaceAutoSaveOnChatResponseEnabled(workspaceFolder: vscode.WorkspaceFolder): boolean {
	return vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<boolean>('autoSaveOnChatResponse', false);
}

function getAutoSaveConfigurationFingerprint(workspaceFolder: vscode.WorkspaceFolder): string {
	return JSON.stringify({
		providers: getAutoSaveProviders(workspaceFolder),
		copilotHomePath: getCopilotHomePath(workspaceFolder),
		codexHomePath: getCodexHomePath(workspaceFolder),
		claudeCodeHomePath: getClaudeCodeHomePath(workspaceFolder),
		cursorProjectsPath: getCursorProjectsPath(workspaceFolder),
		cursorUserDataPath: getCursorUserDataPath(workspaceFolder),
	});
}

function updateAutoSaveStatusBar(
	item: vscode.StatusBarItem,
	diagnosticsByWorkspace: ReadonlyMap<string, AutoSaveDiagnosticState>,
): void {
	const workspaceFolder = getImplicitWorkspaceFolder();
	if (!workspaceFolder) {
		item.hide();
		return;
	}

	const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
	const chatResponseEnabled = config.get<boolean>('autoSaveOnChatResponse', false);
	item.text = `$(history) Session Control ${chatResponseEnabled ? 'Auto-Save On' : 'Auto-Save Off'}`;
	const diagnosticState = diagnosticsByWorkspace.get(workspaceFolder.uri.toString());
	item.tooltip = buildAutoSaveStatusTooltip(workspaceFolder.name, chatResponseEnabled, diagnosticState?.getAll() ?? []);

	item.show();
}

export async function runResumeSessionFromViewerCommand(
	depsOverrides: Partial<ResumeSessionFromViewerCommandDeps> = {},
): Promise<void> {
	const deps: ResumeSessionFromViewerCommandDeps = {
		writeClipboard: async (text: string) => vscode.env.clipboard.writeText(text),
		...depsOverrides,
	};
	const panel = SessionViewerPanel.currentPanel;
	if (!panel) {
		await vscode.window.showInformationMessage('No session viewer is currently open.');
		return;
	}

	const sessionTitle = panel.getSessionTitle();
	if (!sessionTitle) {
		await vscode.window.showWarningMessage('Unable to determine session title.');
		return;
	}

	const openCopilotResume = async (): Promise<void> => {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: `@session-control /resume ${sessionTitle}`,
		});
	};

	const session = panel.getSession();
	const provider = panel.getSessionProvider();
	if (session && provider && provider !== 'copilot') {
		const fileUri = vscode.Uri.file(panel.getFilePath());
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) ?? getImplicitWorkspaceFolder();
		const configuration = vscode.workspace.getConfiguration('session-control', workspaceFolder?.uri ?? fileUri);
		const resumeTargetMode = configuration.get<ResumeTargetMode>('resume.target', 'origin-agent');
		if (resumeTargetMode === 'origin-agent') {
			const openedOriginAgent = await runResumeIntoOriginAgent(
				session,
				'Continue this session.',
				{
					maxTurns: configuration.get<number>('resume.maxTurns', 50),
					maxContextChars: configuration.get<number>('resume.maxContextChars', 80000),
					overflowStrategy: configuration.get<ResumeOverflowStrategy>('resume.overflowStrategy', 'summarize'),
					providerCommands: configuration.get<ResumeProviderCommands>('resume.providerCommands', {}),
				},
				{
					getCommands: async () => vscode.commands.getCommands(true),
					executeCommand: async (commandId: string, args?: unknown) => {
						if (args === undefined) {
							await vscode.commands.executeCommand(commandId);
							return;
						}

						await vscode.commands.executeCommand(commandId, args);
					},
					writeClipboard: deps.writeClipboard,
					streamMarkdown: (markdown: string) => {
						void vscode.window.showInformationMessage(markdown.replace(/\s+/g, ' ').trim());
					},
				},
			);
			if (openedOriginAgent) {
				return;
			}
		}
	}

	// Open the chat panel with a pre-filled resume command
	try {
		await openCopilotResume();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await vscode.window.showErrorMessage(`Failed to open chat: ${message}`);
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('Session Control');
	context.subscriptions.push(output);
	const legacyProviderMigrations = await migrateLegacyAutoSaveProviderSettings({
		workspaceFolders: vscode.workspace.workspaceFolders ?? [],
		workspaceKey:
			vscode.workspace.workspaceFile?.toString() ??
			(vscode.workspace.workspaceFolders ?? [])
				.map((workspaceFolder) => workspaceFolder.uri.toString())
				.sort()
				.join('|'),
		getConfiguration: (workspaceFolder) => vscode.workspace.getConfiguration('session-control', workspaceFolder.uri),
		state: context.globalState,
	});
	for (const migration of legacyProviderMigrations) {
		output.appendLine(
			`[configuration] Migrated legacy ${migration.scope} save provider "${migration.provider}" to session-control.autoSave.providers for ${migration.workspaceFolder}.`,
		);
	}

	// Route session files skipped by listSessions (parse/validation failures) to
	// the Session Control output channel so they are diagnosable instead of
	// silently missing from the sidebar.
	const explorerSessionStore = createSessionStore({
		logWarning: (message) => output.appendLine(`[session-explorer] ${message}`),
	});
	const storedSessionExplorerSortOrder = context.workspaceState.get<unknown>(SESSION_EXPLORER_SORT_ORDER_STATE_KEY);
	const sessionExplorerProvider = new SessionExplorerProvider(
		{
			listSessions: (storageDirectory) => explorerSessionStore.listSessions(storageDirectory),
		},
		isSessionExplorerSortOrder(storedSessionExplorerSortOrder)
			? storedSessionExplorerSortOrder
			: DEFAULT_SESSION_EXPLORER_SORT_ORDER,
	);
	const sessionExplorerView = vscode.window.createTreeView('session-control.sessionExplorer', {
		treeDataProvider: sessionExplorerProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(sessionExplorerView);
	context.subscriptions.push(
		registerSessionExplorerVisibilityRefresh(sessionExplorerView, () => sessionExplorerProvider.refresh()),
	);
	const autoSaveStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	autoSaveStatusBar.command = 'session-control.toggleAutoSave';
	context.subscriptions.push(autoSaveStatusBar);

	const autoSaveDeps = createDefaultAutoSaveOnChatResponseDeps(context);
	const autoSaveDiagnosticsByWorkspace = new Map<string, AutoSaveDiagnosticState>();
	const autoSaveWorkspaceManager = createAutoSaveWorkspaceLifecycle<
		vscode.WorkspaceFolder,
		vscode.ConfigurationChangeEvent
	>({
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getWorkspaceKey: (workspaceFolder) => workspaceFolder.uri.toString(),
		isEnabled: isWorkspaceAutoSaveOnChatResponseEnabled,
		getStorageDirectory: getStoragePath,
		getConfigurationFingerprint: getAutoSaveConfigurationFingerprint,
		createController: ({ workspaceFolder, workspaceFolderCount, storageDirectory }) => {
			const workspaceKey = workspaceFolder.uri.toString();
			const diagnosticState = createAutoSaveDiagnosticState({
				onDidChange: () => {
					updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
				},
			});
			autoSaveDiagnosticsByWorkspace.set(workspaceKey, diagnosticState);
			let controller: AutoSaveController | undefined;
			try {
				controller = createAutoSaveOnChatResponseListener(output, {
					...autoSaveDeps,
					diagnosticState,
					refreshSessionExplorer: () => sessionExplorerProvider.refresh(),
					getStorageDirectory: () => storageDirectory,
					getImplicitWorkspaceFolder: () => workspaceFolder,
					getWorkspaceFolderCount: () => workspaceFolderCount,
				});
			} catch (error) {
				autoSaveDiagnosticsByWorkspace.delete(workspaceKey);
				throw error;
			}

			return {
				reconcile: () => controller?.reconcile(),
				dispose: () => {
					controller?.dispose();
					autoSaveDiagnosticsByWorkspace.delete(workspaceKey);
					updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
				},
			};
		},
		onDidChangeWorkspaceFolders: (listener) => vscode.workspace.onDidChangeWorkspaceFolders(listener),
		onDidChangeConfiguration: (listener) => vscode.workspace.onDidChangeConfiguration(listener),
		afterWorkspaceFoldersChanged: () => {
			sessionExplorerProvider.refresh();
			updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
		},
		afterAutoSaveConfigurationChanged: (event) => {
			updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
			if (event.affectsConfiguration('session-control.storagePath')) {
				sessionExplorerProvider.refresh();
			}
		},
	});
	context.subscriptions.push(autoSaveWorkspaceManager);
	updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
	const updateSessionFileContext = (editor: vscode.TextEditor | undefined) => {
		const document = editor?.document;
		const isSessionFile =
			document?.uri.scheme === 'file' &&
			(path.extname(document.uri.fsPath).toLowerCase() === '.json' ||
				path.extname(document.uri.fsPath).toLowerCase() === '.jsonl') &&
			parseSessionDocument(document.getText()).kind === 'ok';
		void vscode.commands.executeCommand('setContext', 'session-control.isSessionFile', Boolean(isSessionFile));
	};
	updateSessionFileContext(vscode.window.activeTextEditor);

	const analyzeSessionFromExplorer = async (item: SessionExplorerSessionItem | undefined): Promise<void> => {
		await runAnalyzeSessionFromExplorerCommand(item, {
			onReportSaved: () => sessionExplorerProvider.refresh(),
		});
	};

	context.subscriptions.push(
		...initializeProLicenseCommands(context),
		vscode.commands.registerCommand('session-control.saveSessionFromProvider', async () => {
			await runSaveSessionFromProviderCommand(context);
			sessionExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('session-control.listSessions', async () =>
			runOpenSavedSessionCommand(context, undefined),
		),
		vscode.commands.registerCommand('session-control.deleteSession', async () => {
			await runDeleteSessionCommand({
				refreshSessionExplorer: () => sessionExplorerProvider.refresh(),
			});
		}),
		vscode.commands.registerCommand('session-control.refreshSessionExplorer', () => sessionExplorerProvider.refresh()),
		vscode.commands.registerCommand(SORT_SESSION_EXPLORER_COMMAND, () =>
			runSortSessionExplorerCommand({
				getSortOrder: () => sessionExplorerProvider.currentSortOrder,
				showQuickPick: async (items, options) => vscode.window.showQuickPick(items, options),
				setSortOrder: (sortOrder) => sessionExplorerProvider.setSortOrder(sortOrder),
				persistSortOrder: (sortOrder) =>
					context.workspaceState.update(SESSION_EXPLORER_SORT_ORDER_STATE_KEY, sortOrder),
			}),
		),
		vscode.commands.registerCommand(
			'session-control.openSessionFromExplorer',
			async (item: SessionExplorerSessionItem | undefined) => {
				try {
					await runOpenSavedSessionCommand(context, item);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					await vscode.window.showErrorMessage(`Failed to open session: ${message}`);
				}
			},
		),
		vscode.commands.registerCommand('session-control.viewSessionFile', async () => {
			await runViewSessionFileCommand(context);
		}),
		vscode.commands.registerCommand('session-control.resumeSessionFromViewer', async () => {
			await runResumeSessionFromViewerCommand();
		}),
		vscode.commands.registerCommand('session-control.analyzeSavedChats', async () => {
			await runAnalyzeSavedChatsCommand();
		}),
		...registerSessionExplorerAnalysisCommands(
			(command, handler) => vscode.commands.registerCommand(command, handler),
			analyzeSessionFromExplorer,
		),
		vscode.commands.registerCommand('session-control.implementLatestAnalysis', async () => {
			await runImplementLatestAnalysisCommand();
		}),
		vscode.commands.registerCommand('session-control.importCopilotSkillsToCursor', async () => {
			await runImportCopilotSkillsToCursorCommand();
		}),
		vscode.commands.registerCommand('session-control.importCopilotSkillsToCodex', async () => {
			await runImportCopilotSkillsToCodexCommand();
		}),
		vscode.commands.registerCommand('session-control.importCopilotSkillsToClaudeCode', async () => {
			await runImportCopilotSkillsToClaudeCodeCommand();
		}),
		vscode.commands.registerCommand(
			'session-control.deleteSessionFromExplorer',
			async (item: SessionExplorerSessionItem) => {
				await runDeleteSessionFromExplorerCommand(item, {
					refreshSessionExplorer: () => sessionExplorerProvider.refresh(),
				});
			},
		),
		vscode.commands.registerCommand('session-control.cleanupOrphanedParts', async () => {
			await runCleanupOrphanedPartsCommand({
				refreshSessionExplorer: () => sessionExplorerProvider.refresh(),
			});
		}),
		vscode.commands.registerCommand('session-control.diagnoseAutoSave', async () => {
			const workspaceFolder = await resolveManualWorkspaceFolder({
				getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
			});
			if (!workspaceFolder) {
				await vscode.window.showInformationMessage('Open a workspace folder before diagnosing auto-save.');
				return;
			}

			const diagnosticState = autoSaveDiagnosticsByWorkspace.get(workspaceFolder.uri.toString());
			const configuredSources = getConfiguredAutoSaveSourceDiagnostics(workspaceFolder, autoSaveDeps);
			const report = buildAutoSaveDiagnosticReport({
				generatedAt: new Date().toISOString(),
				workspaceName: workspaceFolder.name,
				workspacePath: workspaceFolder.uri.fsPath,
				storagePath: getStoragePath(workspaceFolder),
				enabled: isWorkspaceAutoSaveOnChatResponseEnabled(workspaceFolder),
				selectedProviders: getAutoSaveProviders(workspaceFolder),
				...(vscode.env.remoteName === undefined ? {} : { remoteName: vscode.env.remoteName }),
				sources: mergeAutoSaveSourceDiagnostics(configuredSources, diagnosticState?.getAll() ?? []),
			});
			await vscode.env.clipboard.writeText(report);
			output.appendLine(`[auto-save diagnostics]\n${report}`);
			await vscode.window.showInformationMessage(
				`${workspaceFolder.name}: auto-save diagnostic report copied to the clipboard.`,
			);
		}),
		vscode.commands.registerCommand('session-control.toggleAutoSave', async () => {
			await runToggleAutoSaveCommand({
				resolveWorkspaceFolder: () =>
					resolveManualWorkspaceFolder({
						getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
					}),
				getConfiguration: (workspaceFolder) =>
					vscode.workspace.getConfiguration('session-control', workspaceFolder.uri),
				getStoragePath,
				ensureStoragePathInGitignore,
				showInformationMessage: (message) => vscode.window.showInformationMessage(message),
				showWarningMessage: (message, options, ...items) =>
					vscode.window.showWarningMessage(message, options, ...items),
				showErrorMessage: (message) => vscode.window.showErrorMessage(message),
				onDidChange: () => {
					updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
					autoSaveWorkspaceManager.sync();
				},
			});
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			updateAutoSaveStatusBar(autoSaveStatusBar, autoSaveDiagnosticsByWorkspace);
			updateSessionFileContext(editor);
		}),
	);
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document === vscode.window.activeTextEditor?.document) {
				updateSessionFileContext(vscode.window.activeTextEditor);
			}
		}),
	);

	void activateProFeatures({
		extensionContext: context,
		hasProLicense,
		showUpgradePrompt,
		log: (message) => output.appendLine(`[pro] ${message}`),
		registerDisposable: (disposable) => context.subscriptions.push(disposable),
	});

	registerChatParticipant(context);
}

export function deactivate(): void {
	// Cleanup handled via context.subscriptions disposal above.
}
