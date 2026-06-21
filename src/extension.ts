import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildAnalysisPersistenceContract, createAnalysisStore } from './analysisStore';
import { createAnalysisCandidates, createAnalyzeSessionsFlowDeps, registerChatParticipant, resolveAnalysisSelection, runAnalyzeSessionsFlow, runResumeIntoOriginAgent, type ResumeOverflowStrategy, type ResumeTargetMode } from './chatParticipant';
import { createClaudeCodeSessionReader, deriveClaudeCodeProjectSlug, deriveClaudeCodeProjectsPath, readClaudeCodeSessions } from './claudeCodeSessionReader';
import { deriveCursorProjectSlug } from './cursorAgentTranscriptReader';
import { createCursorSessionReader, getDefaultCursorProjectsPath, getDefaultCursorUserDataPath, readCursorSessions } from './cursorSessionReader';
import { createCodexSkillImporter } from './codexSkillImporter';
import { createCodexSessionReader, readCodexSessions } from './codexSessionReader';
import { getGitContext } from './gitIntegration';
import { CopilotSession, deriveChatSessionsPath, readCopilotSessions } from './sessionReader';
import { ANALYSIS_PROMPT_VERSION, buildImplementationHandoffPrompt, filterCandidatesForAnalysis, type AnalysisCandidateSession } from './sessionAnalysis';
import { SessionExplorerProvider, SessionExplorerSessionItem } from './sessionExplorer';
import { ResumeProviderCommands } from './resumeTarget';
import { SessionViewerPanel } from './sessionViewer';
import { createSessionStore, SessionFileNameOptions, SessionPruneAction } from './sessionStore';
import { applySaveBloatControls, createChatSession, SaveOverflowStrategy } from './sessionWriter';
import { type AnalysisReportReference, type AnalysisSelection, isChatSession, isSessionProviderId, SessionMeta, SessionProviderId, SourceChatSession } from './types';
import { parseFileSize } from './utils';

const sessionStore = createSessionStore();
const analysisStore = createAnalysisStore();

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

function filterSessionsForWorkspace(
	sessions: SourceChatSession[],
	workspaceFolder: vscode.WorkspaceFolder,
	provider: SessionProviderId,
): SourceChatSession[] {
	const matches = sessions.filter(
		(session) => session.provider === provider
			&& typeof session.cwd === 'string'
			&& session.cwd.length > 0
			&& pathsOverlap(session.cwd, workspaceFolder.uri.fsPath),
	);

	return matches.length > 0 ? matches : sessions;
}

export interface WorkspaceSessionMeta extends SavedSessionPickItem, SessionMeta {
	displayTitle: string;
	storageDirectory: string;
	workspaceFolder: vscode.WorkspaceFolder;
}

interface SourceSessionPickItem extends vscode.QuickPickItem {
	session: SourceChatSession;
}

interface ProviderPickItem extends vscode.QuickPickItem {
	provider: SessionProviderId;
}

interface SavedSessionPickItem extends vscode.QuickPickItem {
	fileName: string;
}

interface OpenSessionTarget {
	storageDirectory: string;
	fileName: string;
}

type ImplementationHandoffTarget = 'chat' | 'agentSession';

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
	pruneSessions: (storageDirectory: string, maxSavedSessions: number, action: SessionPruneAction) => Promise<{ archived: number; deleted: number }>;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface SaveSessionFlowDeps extends SaveSourceSessionFlowDeps {
	readCopilotSessions: typeof readCopilotSessions;
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

interface ChatResponseFileWatcher {
	onDidChange: (listener: () => void) => vscode.Disposable;
	onDidCreate: (listener: () => void) => vscode.Disposable;
	dispose: () => void;
}

interface AutoSaveWatchTarget {
	provider: SessionProviderId;
	directory: string;
	glob: string;
	label: string;
}

interface AutoSaveOnChatResponseDeps {
	getStorageUri: () => { fsPath: string } | undefined;
	createWatcher: (sessionsDirectory: string, globPattern: string) => ChatResponseFileWatcher;
	getImplicitWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
	getSaveProvider: (workspaceFolder: vscode.WorkspaceFolder) => SessionProviderId;
	getAutoSaveProviders: (workspaceFolder: vscode.WorkspaceFolder) => SessionProviderId[];
	getCodexHomePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	getClaudeCodeHomePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	getCursorProjectsPath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	readCopilotSessions: () => Promise<CopilotSession[]>;
	readCodexSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	readClaudeCodeSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	readCursorSessions: (workspaceFolder: vscode.WorkspaceFolder) => Promise<SourceChatSession[]>;
	saveSessionSilently: (
		workspaceFolder: vscode.WorkspaceFolder,
		storageDirectory: string,
		provider: SessionProviderId,
		sessions: SourceChatSession[],
	) => Promise<string | undefined>;
	deleteOldAutoSave: (storageDirectory: string, fileName: string) => Promise<void>;
	showWarningMessage: (message: string) => Thenable<unknown>;
	schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearSchedule: (handle: ReturnType<typeof setTimeout>) => void;
}

interface OpenSavedSessionDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	listSessionsAcrossWorkspaceFolders: (workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined) => Promise<WorkspaceSessionMeta[]>;
	pickSession: (sessions: WorkspaceSessionMeta[]) => Promise<WorkspaceSessionMeta | undefined>;
	readSession: (storageDirectory: string, fileName: string) => Promise<ReturnType<typeof createChatSession>>;
	showSession: (session: ReturnType<typeof createChatSession>, extensionUri: vscode.Uri, storageDirectory: string, fileName: string) => void;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface ViewSessionFileDeps {
	getActiveEditor: () => vscode.TextEditor | undefined;
	showSession: (session: ReturnType<typeof createChatSession>, extensionUri: vscode.Uri, storageDirectory: string, fileName: string) => void;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface ImplementLatestAnalysisDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	readIndex: (storageDirectory: string) => Promise<{ reports: AnalysisReportReference[] }>;
	readReport: (storageDirectory: string, reportPath: string) => Promise<string>;
	buildPrompt: (reportFilePath: string, userPrompt: string) => string;
	getCommands: () => Promise<readonly string[]>;
	pickTarget: (agentSessionAvailable: boolean) => Promise<ImplementationHandoffTarget | undefined>;
	openChat: (prompt: string) => Promise<void>;
	openAgentSession: (commandId: string) => Promise<void>;
	writeClipboard: (text: string) => Promise<void>;
	showInformationMessage: (message: string) => Thenable<unknown>;
	showWarningMessage: (message: string) => Thenable<unknown>;
}

interface AnalyzeSavedChatsCommandDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	listSessionsAcrossWorkspaceFolders: (workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined) => Promise<WorkspaceSessionMeta[]>;
	resolveSelection: (requestPrompt: string) => Promise<AnalysisSelection | undefined>;
	selectChatModels: () => Promise<readonly vscode.LanguageModelChat[]>;
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
	buildCursorHandoffPrompt: (
		workspaceFolders: readonly vscode.WorkspaceFolder[],
		workspaceSessions: WorkspaceSessionMeta[],
		selection: AnalysisSelection,
	) => Promise<{ prompt?: string; infoMessage?: string }>;
	openChat: (prompt: string) => Promise<void>;
	openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
	showTextDocument: (document: vscode.TextDocument) => Thenable<vscode.TextEditor>;
	showInformationMessage: (message: string) => Thenable<unknown>;
	showWarningMessage: (message: string) => Thenable<unknown>;
}

type ParsedSessionDocument =
	| { kind: 'ok'; session: ReturnType<typeof createChatSession> }
	| { kind: 'invalid-json' }
	| { kind: 'not-session' };

interface ManualWorkspaceSelectionDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getActiveEditorUri: () => vscode.Uri | undefined;
	getWorkspaceFolder: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined;
	pickWorkspaceFolder: (items: vscode.QuickPickItem[]) => Promise<vscode.QuickPickItem | undefined>;
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

	const hasEntry = existing
		.split(/\r?\n/)
		.some((line) => normalizeGitignoreEntry(line) === entry);
	if (hasEntry) {
		return false;
	}

	const nextContent = existing.length === 0
		? `${entry}\n`
		: `${existing.replace(/\s*$/, '')}\n${entry}\n`;
	await fs.writeFile(gitignorePath, nextContent, 'utf8');
	return true;
}

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	return validateStoragePath(workspaceFolder, configured);
}

function getSaveConfiguration(workspaceFolder: vscode.WorkspaceFolder): SaveConfiguration {
	const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
	const configuredSize = config.get<string>('save.maxFileSize', '1mb');
	const parsedSize = parseFileSize(configuredSize);
	const overflowStrategy = config.get<SaveOverflowStrategy>('save.overflowStrategy', 'split');
	const stripToolOutput = config.get<boolean>('save.stripToolOutput', false);
	const includeTimestampRaw = config.get<unknown>('save.useTimestampInFileName', true);
	const includeTimestampInFileName = typeof includeTimestampRaw === 'boolean'
		? includeTimestampRaw
		: true;

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

export function resolveAutoSaveProvidersForHost(
	configuredProvider: SessionProviderId | undefined,
	appName: string,
): SessionProviderId[] {
	if (configuredProvider) {
		return [configuredProvider];
	}

	const implicitProvider = resolveImplicitSaveProviderForHost(appName);
	if (implicitProvider === 'cursor') {
		return ['cursor'];
	}

	return ['copilot', 'codex', 'claude-code'];
}

function getConfiguredSaveProvider(workspaceFolder: vscode.WorkspaceFolder): SessionProviderId | undefined {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.inspect<string>('save.provider');

	const explicitValue = configured?.workspaceFolderValue
		?? configured?.workspaceValue
		?? configured?.globalValue;

	if (explicitValue === undefined) {
		return undefined;
	}

	if (isSessionProviderId(explicitValue)) {
		return explicitValue;
	}

	console.warn(`Invalid session-control.save.provider value (${String(explicitValue)}). Falling back to host default.`);
	return undefined;
}

function getSaveProvider(workspaceFolder: vscode.WorkspaceFolder): SessionProviderId {
	return resolveSaveProviderForHost(getConfiguredSaveProvider(workspaceFolder), vscode.env.appName);
}

function getAutoSaveProviders(workspaceFolder: vscode.WorkspaceFolder): SessionProviderId[] {
	return resolveAutoSaveProvidersForHost(getConfiguredSaveProvider(workspaceFolder), vscode.env.appName);
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
		pickWorkspaceFolder: async (items: vscode.QuickPickItem[]) => vscode.window.showQuickPick(items, {
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

	return results.flat().sort((a, b) => Date.parse(b.detail.split('|')[0]?.trim() ?? '') - Date.parse(a.detail.split('|')[0]?.trim() ?? ''));
}

function findAgentSessionCommandId(commands: readonly string[]): string | undefined {
	const preferred = [
		'workbench.action.chat.openSessions',
		'workbench.action.chat.openSessionsInNewWindow',
		'workbench.action.chat.openAgentsWindow',
		'workbench.action.chat.openAgents',
		'github.copilot.cli.newSession',
	];

	for (const candidate of preferred) {
		if (commands.includes(candidate)) {
			return candidate;
		}
	}

	return commands.find((command) => {
		const normalized = command.toLowerCase();
		if (normalized.includes('debug')) {
			return false;
		}

		return normalized.startsWith('workbench.action.chat.')
			&& normalized.includes('open')
			&& (normalized.includes('agent') || normalized.includes('session'));
	});
}

function createDefaultImplementLatestAnalysisDeps(): ImplementLatestAnalysisDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getStoragePath,
		readIndex: async (storageDirectory: string) => analysisStore.readIndex(storageDirectory),
		readReport: async (storageDirectory: string, reportPath: string) => analysisStore.readReport(storageDirectory, reportPath),
		buildPrompt: (reportFilePath: string, userPrompt: string) => buildImplementationHandoffPrompt(reportFilePath, userPrompt),
		getCommands: async () => vscode.commands.getCommands(true),
		pickTarget: async (agentSessionAvailable: boolean) => {
			if (!agentSessionAvailable) {
				return 'chat';
			}

			const pick = await vscode.window.showQuickPick<
				vscode.QuickPickItem & { target: ImplementationHandoffTarget }
			>([
				{
					label: 'Chat',
					description: 'Prefill a new chat with the generated implementation prompt',
					target: 'chat',
				},
				{
					label: 'Agent Session',
					description: 'Open an agent session and copy the generated implementation prompt to the clipboard',
					target: 'agentSession',
				},
			], {
				title: 'Open latest analysis implementation in',
			});

			return pick?.target;
		},
		openChat: async (prompt: string) => {
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
		},
		openAgentSession: async (commandId: string) => {
			await vscode.commands.executeCommand(commandId);
		},
		writeClipboard: async (text: string) => vscode.env.clipboard.writeText(text),
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

function normalizePathForPrompt(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

function toWorkspaceRelativePath(workspaceFolder: vscode.WorkspaceFolder, absolutePath: string): string {
	return normalizePathForPrompt(path.relative(workspaceFolder.uri.fsPath, absolutePath));
}

async function loadAnalyzedFingerprintsForCandidates(candidates: readonly AnalysisCandidateSession[]): Promise<Set<string>> {
	const storageDirectories = [...new Set(candidates.map((candidate) => candidate.storageDirectory))];
	const indexes = await Promise.all(storageDirectories.map(async (storageDirectory) => ({
		storageDirectory,
		index: await analysisStore.readIndex(storageDirectory),
	})));

	const analyzed = new Set<string>();
	for (const item of indexes) {
		for (const entry of item.index.analyzedSessions) {
			analyzed.add(entry.fingerprint);
		}
	}

	return analyzed;
}

function buildCursorAnalyzeHandoffPrompt(
	selection: AnalysisSelection,
	candidates: readonly AnalysisCandidateSession[],
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	ownerWorkspace: vscode.WorkspaceFolder,
	ownerStorageDirectory: string,
): string {
	const ownerReportsDirectory = toWorkspaceRelativePath(ownerWorkspace, path.join(ownerStorageDirectory, 'analysis', 'reports'));
	const ownerIndexPath = toWorkspaceRelativePath(ownerWorkspace, path.join(ownerStorageDirectory, 'analysis', 'index.json'));
	const persistenceContract = buildAnalysisPersistenceContract(ANALYSIS_PROMPT_VERSION);
	const workspaceByName = new Map(workspaceFolders.map((workspaceFolder) => [workspaceFolder.name, workspaceFolder]));
	const formatCandidatePath = (candidate: AnalysisCandidateSession, absolutePath: string): string => {
		const workspaceFolder = workspaceByName.get(candidate.workspaceName);
		if (workspaceFolder) {
			return toWorkspaceRelativePath(workspaceFolder, absolutePath);
		}

		if (absolutePath === candidate.storageDirectory) {
			return normalizePathForPrompt(path.basename(candidate.storageDirectory));
		}

		return normalizePathForPrompt(path.join(path.basename(candidate.storageDirectory), path.basename(absolutePath)));
	};
	const uniqueStorageDirectories = [...new Map(
		candidates.map((candidate) => [
			`${candidate.workspaceName}::${candidate.storageDirectory}`,
			`- [${candidate.workspaceName}] ${formatCandidatePath(candidate, candidate.storageDirectory)}`,
		]),
	).values()];
	const sessionLines = candidates
		.slice(0, 30)
		.map((candidate) => {
			const sessionFilePath = path.join(candidate.storageDirectory, candidate.rootFileName);
			return `- [${candidate.workspaceName}] ${formatCandidatePath(candidate, sessionFilePath)} | ${candidate.session.savedAt} | ${candidate.session.title}`;
		});
	const omittedCount = Math.max(0, candidates.length - sessionLines.length);

	return [
		'Analyze saved chat sessions using full workspace access. Session Control could not call a host language model directly in this environment, so this prompt is a handoff fallback.',
		'This handoff runs inside the target repository workspace, not inside the Session Control source repository.',
		'Start by reading AGENTS.md, .github/copilot-instructions.md, and any repository-local *.instructions.md, *.prompt.md, *.agent.md, or SKILL.md files only when they exist in the target repository.',
		'Do not search the target repository for Session Control implementation files or Session Control-only instruction files. Use the persistence contract below instead.',
		'Restrict all recommendations to repository-local AI control files and compare them against the existing AI instruction and skill files before recommending changes.',
		'Analyze only the saved-session roots and storage directories listed below. Treat them as the source of truth for this task rather than reverse-engineering Session Control itself.',
		`Selection: ${selection.label}`,
		`Selection mode: ${selection.mode}`,
		`Only unanalyzed: ${selection.onlyUnanalyzed === true ? 'yes' : 'no'}`,
		`Matching root sessions: ${candidates.length}`,
		`Owner workspace for persisted output: ${ownerWorkspace.name}`,
		`Write the markdown report using the existing Session Control format under "${ownerReportsDirectory}".`,
		`Update the relevant analysis indexes using the existing Session Control schema, including "${ownerIndexPath}" for the owner workspace and any source storage indexes that need report references.`,
		'',
		persistenceContract,
		'Source storage directories:',
		...uniqueStorageDirectories,
		'',
		'Matching root session files:',
		...sessionLines,
		...(omittedCount > 0 ? [`- ... ${omittedCount} additional matching sessions omitted from this prompt. Use the listed storage directories and selection criteria to include them.`] : []),
		'',
		'If you cannot safely persist the report and analysis indexes from chat, return the completed report in chat and explain what blocked persistence.',
	].join('\n');
}

async function buildCursorAnalyzeHandoffPromptForSelection(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	workspaceSessions: WorkspaceSessionMeta[],
	selection: AnalysisSelection,
): Promise<{ prompt?: string; infoMessage?: string }> {
	const candidates = await createAnalysisCandidates(workspaceSessions);
	if (!candidates.length) {
		return { infoMessage: 'No usable saved sessions found. Some saved sessions could not be read.' };
	}

	const analyzedFingerprints = await loadAnalyzedFingerprintsForCandidates(candidates);
	const filtered = filterCandidatesForAnalysis(candidates, selection, analyzedFingerprints);
	if (!filtered.length) {
		return {
			infoMessage: selection.mode === 'needsAnalysis'
				? 'No saved sessions currently need analysis.'
				: `No saved sessions matched ${selection.label.toLowerCase()}.`,
		};
	}

	const ownerWorkspace = getImplicitWorkspaceFolder() ?? workspaceFolders[0];
	if (!ownerWorkspace) {
		return { infoMessage: 'Open a workspace folder before analyzing saved chats.' };
	}

	const ownerStorageDirectory = getStoragePath(ownerWorkspace);
	return {
		prompt: buildCursorAnalyzeHandoffPrompt(selection, filtered, workspaceFolders, ownerWorkspace, ownerStorageDirectory),
	};
}

function createDefaultAnalyzeSavedChatsCommandDeps(): AnalyzeSavedChatsCommandDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		listSessionsAcrossWorkspaceFolders,
		resolveSelection: async (requestPrompt: string) => resolveAnalysisSelection(requestPrompt),
		selectChatModels: async () => vscode.lm.selectChatModels(),
		getAppName: () => vscode.env.appName,
		runAnalyzeFlow: async (
			workspaceFolders,
			workspaceSessions,
			selection,
			model,
			token,
			onStatus,
		) => runAnalyzeSessionsFlow(
			'',
			workspaceFolders,
			workspaceSessions,
			createAnalyzeSessionsFlowDeps({
				resolveSelection: async () => selection,
				runModelPrompt: async (prompt: string) => {
					const response = await model.sendRequest(
						[vscode.LanguageModelChatMessage.User(prompt)],
						{},
						token,
					);

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
		buildCursorHandoffPrompt: async (
			workspaceFolders: readonly vscode.WorkspaceFolder[],
			workspaceSessions: WorkspaceSessionMeta[],
			selection: AnalysisSelection,
		) => buildCursorAnalyzeHandoffPromptForSelection(workspaceFolders, workspaceSessions, selection),
		openChat: async (prompt: string) => {
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
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
		getIncludeInGitignore: (workspaceFolder) => vscode.workspace
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

async function runSaveSourceSessionFlow(
	provider: SessionProviderId,
	sessions: SourceChatSession[],
	workspaceFolder: vscode.WorkspaceFolder,
	storageDirectory: string,
	depsOverrides: Partial<SaveSourceSessionFlowDeps> = {},
): Promise<string | undefined> {
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

	if (saveResult.warning) {
		await deps.showInformationMessage(saveResult.warning);
	}

	if (writtenFiles.length === 1) {
		await deps.showInformationMessage(`Saved chat session to ${path.join(storageDirectory, writtenFiles[0] ?? '')}`);
	} else {
		await deps.showInformationMessage(`Saved ${writtenFiles.length} session part files to ${storageDirectory}`);
	}

	const pruneConfig = deps.getPruneConfiguration(workspaceFolder);
	if (pruneConfig.maxSavedSessions > 0) {
		const pruneResult = await deps.pruneSessions(storageDirectory, pruneConfig.maxSavedSessions, pruneConfig.pruneAction);
		if (pruneResult.archived > 0) {
			await deps.showInformationMessage(`Archived ${pruneResult.archived} old session file(s) after save.`);
		}

		if (pruneResult.deleted > 0) {
			await deps.showInformationMessage(`Deleted ${pruneResult.deleted} old session file(s) after save.`);
		}
	}

	return writtenFiles[0];
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
	return runSaveSourceSessionFlow('copilot', sessions, workspaceFolder, storageDirectory, deps);
}

async function runSaveSessionCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = await resolveManualWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
		return;
	}

	const storageDirectory = getStoragePath(workspaceFolder);
	const provider = getSaveProvider(workspaceFolder);
	const sessions = await loadSessionsForProvider(context, workspaceFolder, provider);
	await runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory);
}

async function pickSessionProvider(): Promise<SessionProviderId | undefined> {
	const pick = await vscode.window.showQuickPick<ProviderPickItem>([
		{
			label: 'Copilot',
			description: 'Save from VS Code Copilot chat storage',
			provider: 'copilot',
		},
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
	], {
		title: 'Choose a session provider',
	});

	return pick?.provider;
}

async function loadSessionsForProvider(
	context: vscode.ExtensionContext,
	workspaceFolder: vscode.WorkspaceFolder,
	provider: SessionProviderId,
): Promise<SourceChatSession[]> {
	if (provider === 'codex') {
		return filterSessionsForWorkspace(
			await readCodexSessions(getCodexHomePath(workspaceFolder)),
			workspaceFolder,
			'codex',
		);
	}

	if (provider === 'claude-code') {
		return filterSessionsForWorkspace(
			await readClaudeCodeSessions(getClaudeCodeHomePath(workspaceFolder), workspaceFolder.uri.fsPath),
			workspaceFolder,
			'claude-code',
		);
	}

	if (provider === 'cursor') {
		return readCursorSessions(
			workspaceFolder,
			getCursorUserDataPath(workspaceFolder),
			context,
			getCursorProjectsPath(workspaceFolder),
		);
	}

	return readCopilotSessions(context);
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
		await vscode.window.showInformationMessage(`Open a workspace folder before importing ${options.skillLabel} skills.`);
		return;
	}

	const importer = createCodexSkillImporter();
	const result = await importer.importSkills(
		workspaceFolder.uri.fsPath,
		options.skillDirectorySegments ? { skillDirectorySegments: [...options.skillDirectorySegments] } : {},
	);
	if (!result.created.length && !result.skipped.length) {
		await vscode.window.showInformationMessage(`No Copilot guidance files were found to import as ${options.skillLabel} skills.`);
		return;
	}

	const summaryParts = [
		`${result.created.length} created`,
		`${result.skipped.length} skipped`,
	];
	await vscode.window.showInformationMessage(`Imported Copilot guidance to ${options.targetDirectory} for ${workspaceFolder.name}: ${summaryParts.join(', ')}.`);
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

async function runListSessionsCommand(): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		await vscode.window.showInformationMessage('Open a workspace folder before listing sessions.');
		return;
	}

	const sessions = await listSessionsAcrossWorkspaceFolders(vscode.workspace.workspaceFolders);
	if (!sessions.length) {
		await vscode.window.showInformationMessage('No saved sessions found.');
		return;
	}

	await vscode.window.showQuickPick<SavedSessionPickItem>(
		sessions,
		{ title: 'Saved chat sessions' },
	);
}

async function runDeleteSessionCommand(): Promise<void> {
	if (!vscode.workspace.workspaceFolders?.length) {
		await vscode.window.showInformationMessage('Open a workspace folder before deleting sessions.');
		return;
	}

	const sessions = await listSessionsAcrossWorkspaceFolders(vscode.workspace.workspaceFolders);
	if (!sessions.length) {
		await vscode.window.showInformationMessage('No saved sessions found.');
		return;
	}

	const pick = await vscode.window.showQuickPick<WorkspaceSessionMeta>(
		sessions,
		{ title: 'Select saved session to delete' },
	);

	if (!pick) {
		return;
	}

	const confirmation = await vscode.window.showWarningMessage(
		`Delete session '${pick.label}'?`,
		{ modal: true },
		'Delete',
	);

	if (confirmation !== 'Delete') {
		return;
	}

	const deleted = await sessionStore.deleteSession(pick.storageDirectory, pick.fileName);
	if (!deleted) {
		await vscode.window.showInformationMessage('Session file no longer exists.');
		return;
	}

	await vscode.window.showInformationMessage(`Deleted session ${pick.label}`);
}

function createDefaultOpenSavedSessionDeps(): OpenSavedSessionDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		listSessionsAcrossWorkspaceFolders,
		pickSession: async (sessions: WorkspaceSessionMeta[]) => vscode.window.showQuickPick<WorkspaceSessionMeta>(
			sessions,
			{ title: 'Select saved session to open' },
		),
		readSession: async (storageDirectory: string, fileName: string) => sessionStore.readSession(storageDirectory, fileName),
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

		await deps.showInformationMessage('No saved analysis reports found. Run Session Control: Analyze Saved Chats or @session-control /analyze first.');
		return;
	}

	const prompt = deps.buildPrompt(path.join(latest.report.storageDirectory, latest.report.reportPath), '');
	const agentSessionCommandId = findAgentSessionCommandId(await deps.getCommands());
	const target = await deps.pickTarget(agentSessionCommandId !== undefined);
	if (!target) {
		return;
	}

	if (target === 'agentSession' && agentSessionCommandId) {
		try {
			await deps.writeClipboard(prompt);
			await deps.openAgentSession(agentSessionCommandId);
			await deps.showInformationMessage(
				`Opened an agent session for the latest saved analysis from ${latest.report.workspaceFolder.name}. The generated implementation prompt is on the clipboard.`,
			);
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await deps.showWarningMessage(`Failed to open an agent session (${message}). Opening chat instead.`);
		}
	}

	try {
		await deps.openChat(prompt);
		await deps.showInformationMessage(
			`Opened chat with an implementation prompt for ${latest.report.selectionLabel}.`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
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

	const model = models[0];
	if (!model) {
		if (/cursor/i.test(deps.getAppName())) {
			let handoff: { prompt?: string; infoMessage?: string };
			try {
				handoff = await deps.buildCursorHandoffPrompt(workspaceFolders, workspaceSessions, selection);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await deps.showWarningMessage(`Cursor does not currently expose extension-callable chat models, and Session Control could not build an analysis handoff prompt: ${message}`);
				return;
			}

			if (handoff.infoMessage) {
				await deps.showInformationMessage(handoff.infoMessage);
				return;
			}

			if (!handoff.prompt) {
				await deps.showWarningMessage('Cursor does not currently expose extension-callable chat models, and no analysis handoff prompt could be generated.');
				return;
			}

			try {
				await deps.openChat(handoff.prompt);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await deps.showWarningMessage(`Cursor does not currently expose extension-callable chat models, and opening chat with the analysis handoff prompt failed: ${message}`);
				return;
			}

			await deps.showInformationMessage(
				'Cursor does not currently expose extension-callable chat models, so Session Control opened chat with an analysis handoff prompt. Send it in chat to continue.',
			);
			return;
		}

		await deps.showWarningMessage('No host chat model is available for analysis. Sign in or enable a chat model, then try again.');
		return;
	}

	let lastStatusMessage = '';
	const result = await deps.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Session Control',
			cancellable: true,
		},
		async (progress, token) => {
			progress.report({ message: 'Analyzing saved chats...' });
			return deps.runAnalyzeFlow(
				workspaceFolders,
				workspaceSessions,
				selection,
				model,
				token,
				(markdown: string) => {
					lastStatusMessage = sanitizeMarkdownForStatusMessage(markdown);
					if (lastStatusMessage) {
						progress.report({ message: lastStatusMessage });
					}
				},
			);
		},
	);

	if (!result) {
		if (lastStatusMessage) {
			await deps.showInformationMessage(lastStatusMessage);
		}
		return;
	}

	const reportUri = vscode.Uri.file(path.join(result.metadata.analysisStorageDirectory, result.metadata.analysisReportPath));
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
	const autoSaveCursorSessionReader = createCursorSessionReader({
		showInformationMessage: async () => undefined,
	});
	const autoSaveCodexSessionReader = createCodexSessionReader({
		showInformationMessage: async () => undefined,
	});
	const autoSaveClaudeCodeSessionReader = createClaudeCodeSessionReader({
		showInformationMessage: async () => undefined,
	});

	return {
		getStorageUri: () => context.storageUri,
		createWatcher: (sessionsDirectory, globPattern) => {
			const pattern = new vscode.RelativePattern(
				vscode.Uri.file(sessionsDirectory),
				globPattern,
			);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			return {
				onDidChange: (listener: () => void) => watcher.onDidChange(() => listener()),
				onDidCreate: (listener: () => void) => watcher.onDidCreate(() => listener()),
				dispose: () => watcher.dispose(),
			};
		},
		getImplicitWorkspaceFolder,
		getSaveProvider,
		getAutoSaveProviders,
		getCodexHomePath,
		getClaudeCodeHomePath,
		getCursorProjectsPath,
		readCopilotSessions: () => readCopilotSessions(context),
		readCodexSessions: async (workspaceFolder) => filterSessionsForWorkspace(
			await autoSaveCodexSessionReader.readCodexSessions(getCodexHomePath(workspaceFolder)),
			workspaceFolder,
			'codex',
		),
		readClaudeCodeSessions: async (workspaceFolder) => filterSessionsForWorkspace(
			await autoSaveClaudeCodeSessionReader.readClaudeCodeSessions(
				getClaudeCodeHomePath(workspaceFolder),
				workspaceFolder.uri.fsPath,
			),
			workspaceFolder,
			'claude-code',
		),
		readCursorSessions: (workspaceFolder) => autoSaveCursorSessionReader.readCursorSessions(
			workspaceFolder,
			{
				cursorUserDataPath: getCursorUserDataPath(workspaceFolder),
				cursorProjectsPath: getCursorProjectsPath(workspaceFolder),
			},
			context,
		),
		saveSessionSilently: async (workspaceFolder, storageDirectory, provider, sessions) =>
			runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory, {
				selectSession: async (sessions) => sessions[0],
				promptTitle: async (defaultTitle) => defaultTitle,
				showInformationMessage: async () => undefined,
			}),
		deleteOldAutoSave: async (storageDirectory, fileName) => {
			await sessionStore.deleteSession(storageDirectory, fileName);
		},
		showWarningMessage: (message: string) => vscode.window.showWarningMessage(message),
		schedule: (callback, delayMs) => setTimeout(callback, delayMs),
		clearSchedule: (handle) => clearTimeout(handle),
	};
}

function resolveAutoSaveWatchTargets(
	workspaceFolder: vscode.WorkspaceFolder,
	provider: SessionProviderId,
	storageUri: { fsPath: string } | undefined,
	deps: Pick<AutoSaveOnChatResponseDeps, 'getCodexHomePath' | 'getClaudeCodeHomePath' | 'getCursorProjectsPath'>,
): AutoSaveWatchTarget[] {
	if (provider === 'copilot') {
		if (!storageUri) {
			return [];
		}

		return [{
			provider,
			directory: deriveChatSessionsPath(storageUri.fsPath),
			glob: '*.{json,jsonl}',
			label: 'Copilot chatSessions',
		}];
	}

	if (provider === 'cursor') {
		const projectSlug = deriveCursorProjectSlug(workspaceFolder.uri.fsPath);
		const projectRoot = path.join(deps.getCursorProjectsPath(workspaceFolder), projectSlug);
		return [{
			provider,
			directory: projectRoot,
			glob: 'agent-transcripts/**/*.jsonl',
			label: 'Cursor agent transcripts',
		}];
	}

	if (provider === 'codex') {
		return [{
			provider,
			directory: deps.getCodexHomePath(workspaceFolder),
			glob: 'sessions/**/*.{json,jsonl}',
			label: 'Codex session transcripts',
		}];
	}

	if (provider === 'claude-code') {
		const projectSlug = deriveClaudeCodeProjectSlug(workspaceFolder.uri.fsPath);
		const projectDirectory = path.join(deriveClaudeCodeProjectsPath(deps.getClaudeCodeHomePath(workspaceFolder)), projectSlug);
		return [{
			provider,
			directory: projectDirectory,
			glob: '*.jsonl',
			label: 'Claude Code transcripts',
		}];
	}

	return [];
}

async function readAutoSaveSessionsForProvider(
	provider: SessionProviderId,
	workspaceFolder: vscode.WorkspaceFolder,
	deps: Pick<AutoSaveOnChatResponseDeps, 'readCopilotSessions' | 'readCodexSessions' | 'readClaudeCodeSessions' | 'readCursorSessions'>,
): Promise<SourceChatSession[]> {
	if (provider === 'cursor') {
		return deps.readCursorSessions(workspaceFolder);
	}

	if (provider === 'codex') {
		return deps.readCodexSessions(workspaceFolder);
	}

	if (provider === 'claude-code') {
		return deps.readClaudeCodeSessions(workspaceFolder);
	}

	return deps.readCopilotSessions();
}

export function registerAutoSaveOnChatResponseListener(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	depsOverrides: Partial<AutoSaveOnChatResponseDeps> = {},
): vscode.Disposable | undefined {
	const deps = {
		...createDefaultAutoSaveOnChatResponseDeps(context),
		...depsOverrides,
	};

	const storageUri = deps.getStorageUri();
	const workspaceFolder = deps.getImplicitWorkspaceFolder();
	if (!workspaceFolder) {
		output.appendLine('[auto-save] No workspace folder is open. Chat response auto-save is disabled.');
		return undefined;
	}

	const providers = deps.getAutoSaveProviders(workspaceFolder);
	const watchTargets = providers.flatMap((provider) => resolveAutoSaveWatchTargets(workspaceFolder, provider, storageUri, deps));
	if (!watchTargets.length) {
		output.appendLine(`[auto-save] No watch targets available for providers ${providers.join(', ')}.`);
		return undefined;
	}

	const watchers = watchTargets.map((target) => {
		output.appendLine(`[auto-save] Watching ${target.label}: ${target.directory} (${target.glob})`);
		return deps.createWatcher(target.directory, target.glob);
	});

	const lastAutoSave = new Map<string, { fileName: string; turnCount: number }>();
	const debounceTimers = new Map<SessionProviderId, ReturnType<typeof setTimeout>>();
	let disabled = false;
	const disposables: vscode.Disposable[] = [];

	const onStorageChanged = (provider: SessionProviderId) => {
		if (disabled) {
			output.appendLine('[auto-save] Skipped — listener disabled due to a previous error. Reload VS Code to re-enable.');
			return;
		}

		output.appendLine('[auto-save] File change detected, debouncing 5 s…');
		const debounceTimer = debounceTimers.get(provider);
		if (debounceTimer) {
			deps.clearSchedule(debounceTimer);
		}

		const nextDebounceTimer = deps.schedule(() => {
			debounceTimers.delete(provider);
			void (async () => {
				try {
					const sessions = await readAutoSaveSessionsForProvider(provider, workspaceFolder, deps);
					output.appendLine(`[auto-save] Read ${sessions.length} ${getProviderLabel(provider)} session(s).`);
					if (!sessions.length) {
						output.appendLine('[auto-save] No sessions found — nothing to save.');
						return;
					}

					const latest = sessions[0];
					if (!latest) {
						return;
					}
					output.appendLine(`[auto-save] Latest: "${latest.title}" id=${latest.id} turns=${latest.turns.length}`);
					const autoSaveKey = `${provider}:${latest.id}`;
					const prev = lastAutoSave.get(autoSaveKey);
					if (prev && prev.turnCount >= latest.turns.length) {
						output.appendLine(`[auto-save] Skipped — turn count unchanged (${latest.turns.length}).`);
						return;
					}

					const storageDirectory = getStoragePath(workspaceFolder);
					output.appendLine(`[auto-save] Saving to ${storageDirectory}…`);
					const newFileName = await deps.saveSessionSilently(workspaceFolder, storageDirectory, provider, sessions);
					if (!newFileName) {
						output.appendLine('[auto-save] Save returned no filename — session may already be up to date.');
						return;
					}

					if (prev?.fileName && prev.fileName !== newFileName) {
						try {
							await deps.deleteOldAutoSave(storageDirectory, prev.fileName);
						} catch {
							// Ignore cleanup errors for previous auto-save files
						}
					}

					lastAutoSave.set(autoSaveKey, {
						fileName: newFileName,
						turnCount: latest.turns.length,
					});
					output.appendLine(
						`[auto-save] Saved "${latest.title}" (${latest.turns.length} turns) after chat response.`,
					);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					output.appendLine(`[auto-save] Disabled after chat response save error: ${message}`);
					void deps.showWarningMessage(
						'Session Control auto-save on chat response encountered an error and was disabled for this session.',
					);
					disabled = true;
				}
			})();
		}, 5000);
		debounceTimers.set(provider, nextDebounceTimer);
	};

	for (let index = 0; index < watchers.length; index += 1) {
		const watcher = watchers[index];
		const target = watchTargets[index];
		if (!watcher || !target) {
			continue;
		}

		disposables.push(
			watcher.onDidChange(() => onStorageChanged(target.provider)),
			watcher.onDidCreate(() => onStorageChanged(target.provider)),
		);
	}

	const registration = {
		dispose: () => {
			for (const debounceTimer of debounceTimers.values()) {
				deps.clearSchedule(debounceTimer);
			}
			debounceTimers.clear();
			for (const watcher of watchers) {
				watcher.dispose();
			}
			for (const d of disposables) {
				d.dispose();
			}
		},
	};
	context.subscriptions.push(registration);
	return registration;
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

function isAnyWorkspaceAutoSaveOnChatResponseEnabled(): boolean {
	return (vscode.workspace.workspaceFolders ?? []).some((workspaceFolder) => vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<boolean>('autoSaveOnChatResponse', false));
}

function updateAutoSaveStatusBar(item: vscode.StatusBarItem): void {
	const workspaceFolder = getImplicitWorkspaceFolder();
	if (!workspaceFolder) {
		item.hide();
		return;
	}

	const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
	const chatResponseEnabled = config.get<boolean>('autoSaveOnChatResponse', false);
	item.text = `$(history) Session Control ${chatResponseEnabled ? 'Auto-Save On' : 'Auto-Save Off'}`;

	if (chatResponseEnabled) {
		item.tooltip = `${workspaceFolder.name}: auto-save on chat response`;
	} else {
		item.tooltip = `${workspaceFolder.name}: click to enable auto-save`;
	}

	item.show();
}

export async function runResumeSessionFromViewerCommand(): Promise<void> {
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
					writeClipboard: async (text: string) => vscode.env.clipboard.writeText(text),
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

export function activate(context: vscode.ExtensionContext): void {
	const sessionExplorerProvider = new SessionExplorerProvider();
	const sessionExplorerView = vscode.window.createTreeView('session-control.sessionExplorer', {
		treeDataProvider: sessionExplorerProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(sessionExplorerView);
	const autoSaveStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	autoSaveStatusBar.command = 'session-control.toggleAutoSave';
	context.subscriptions.push(autoSaveStatusBar);

	const output = vscode.window.createOutputChannel('Session Control');
	context.subscriptions.push(output);

	let autoSaveOnChatResponseListener: vscode.Disposable | undefined;
	const syncAutoSaveOnChatResponseListener = () => {
		const enabled = isAnyWorkspaceAutoSaveOnChatResponseEnabled();
		if (enabled && !autoSaveOnChatResponseListener) {
			autoSaveOnChatResponseListener = registerAutoSaveOnChatResponseListener(context, output);
			return;
		}

		if (!enabled && autoSaveOnChatResponseListener) {
			autoSaveOnChatResponseListener.dispose();
			autoSaveOnChatResponseListener = undefined;
		}
	};

	syncAutoSaveOnChatResponseListener();
	updateAutoSaveStatusBar(autoSaveStatusBar);
	const updateSessionFileContext = (editor: vscode.TextEditor | undefined) => {
		const document = editor?.document;
		const isSessionFile = document?.uri.scheme === 'file'
			&& (path.extname(document.uri.fsPath).toLowerCase() === '.json' || path.extname(document.uri.fsPath).toLowerCase() === '.jsonl')
			&& parseSessionDocument(document.getText()).kind === 'ok';
		void vscode.commands.executeCommand('setContext', 'session-control.isSessionFile', Boolean(isSessionFile));
	};
	updateSessionFileContext(vscode.window.activeTextEditor);

	context.subscriptions.push(
		vscode.commands.registerCommand('session-control.saveSession', async () => {
			await runSaveSessionCommand(context);
			sessionExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('session-control.saveSessionFromProvider', async () => {
			await runSaveSessionFromProviderCommand(context);
			sessionExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('session-control.listSessions', async () => runListSessionsCommand()),
		vscode.commands.registerCommand('session-control.deleteSession', async () => {
			await runDeleteSessionCommand();
			sessionExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('session-control.refreshSessionExplorer', () => sessionExplorerProvider.refresh()),
		vscode.commands.registerCommand('session-control.openSessionFromExplorer', async (item: SessionExplorerSessionItem | undefined) => {
			try {
				await runOpenSavedSessionCommand(context, item);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await vscode.window.showErrorMessage(`Failed to open session: ${message}`);
			}
		}),
		vscode.commands.registerCommand('session-control.viewSessionFile', async () => {
			await runViewSessionFileCommand(context);
		}),
		vscode.commands.registerCommand('session-control.resumeSessionFromViewer', async () => {
			await runResumeSessionFromViewerCommand();
		}),
		vscode.commands.registerCommand('session-control.analyzeSavedChats', async () => {
			await runAnalyzeSavedChatsCommand();
		}),
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
		vscode.commands.registerCommand('session-control.deleteSessionFromExplorer', async (item: SessionExplorerSessionItem) => {
			const confirmation = await vscode.window.showWarningMessage(
				`Delete session '${item.label}'?`,
				{ modal: true },
				'Delete',
			);

			if (confirmation !== 'Delete') {
				return;
			}

			const deleted = await sessionStore.deleteSession(item.storageDirectory, item.fileName);
			if (!deleted) {
				await vscode.window.showInformationMessage('Session file no longer exists.');
				sessionExplorerProvider.refresh();
				return;
			}

			await vscode.window.showInformationMessage(`Deleted session ${item.label}`);
			sessionExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('session-control.toggleAutoSave', async () => {
			const workspaceFolder = await resolveManualWorkspaceFolder({
				getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
			});
			if (!workspaceFolder) {
				await vscode.window.showInformationMessage('Open a workspace folder before changing auto-save.');
				return;
			}

			const configuration = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
			const current = configuration.get<boolean>('autoSaveOnChatResponse', false);
			await configuration.update('autoSaveOnChatResponse', !current, vscode.ConfigurationTarget.WorkspaceFolder);
			updateAutoSaveStatusBar(autoSaveStatusBar);
			syncAutoSaveOnChatResponseListener();
			await vscode.window.showInformationMessage(
				`${workspaceFolder.name}: auto-save on chat response ${current ? 'disabled' : 'enabled'}.`,
			);
		}),
	);

	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
		sessionExplorerProvider.refresh();
		syncAutoSaveOnChatResponseListener();
		updateAutoSaveStatusBar(autoSaveStatusBar);
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (
			event.affectsConfiguration('session-control.autoSaveOnChatResponse')
			|| event.affectsConfiguration('session-control.save.provider')
			|| event.affectsConfiguration('session-control.codex.homePath')
			|| event.affectsConfiguration('session-control.claudeCode.homePath')
			|| event.affectsConfiguration('session-control.cursor.projectsPath')
			|| event.affectsConfiguration('session-control.cursor.userDataPath')
		) {
			if (autoSaveOnChatResponseListener) {
				autoSaveOnChatResponseListener.dispose();
				autoSaveOnChatResponseListener = undefined;
			}
			syncAutoSaveOnChatResponseListener();
			updateAutoSaveStatusBar(autoSaveStatusBar);
		}

		if (event.affectsConfiguration('session-control.storagePath')) {
			sessionExplorerProvider.refresh();
		}
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
		updateAutoSaveStatusBar(autoSaveStatusBar);
		updateSessionFileContext(editor);
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.document === vscode.window.activeTextEditor?.document) {
			updateSessionFileContext(vscode.window.activeTextEditor);
		}
	}));

	registerChatParticipant(context);
}

export function deactivate(): void {
	// Cleanup handled via context.subscriptions disposal above.
}
