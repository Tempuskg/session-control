import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerChatParticipant } from './chatParticipant';
import { getGitContext } from './gitIntegration';
import { CopilotSession, deriveChatSessionsPath, readCopilotSessions } from './sessionReader';
import { SessionExplorerProvider, SessionExplorerSessionItem } from './sessionExplorer';
import { SessionViewerPanel } from './sessionViewer';
import { createSessionStore, SessionPruneAction } from './sessionStore';
import { applySaveBloatControls, createChatSession, SaveOverflowStrategy } from './sessionWriter';
import { isChatSession } from './types';
import { parseFileSize } from './utils';

const sessionStore = createSessionStore();

function isAbsolutePathLike(value: string): boolean {
	return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

export interface WorkspaceSessionMeta extends SavedSessionPickItem {
	storageDirectory: string;
	workspaceFolder: vscode.WorkspaceFolder;
}

interface CopilotSessionPickItem extends vscode.QuickPickItem {
	session: CopilotSession;
}

interface SavedSessionPickItem extends vscode.QuickPickItem {
	fileName: string;
}

interface OpenSessionTarget {
	storageDirectory: string;
	fileName: string;
}

interface SaveSessionFlowDeps {
	readCopilotSessions: typeof readCopilotSessions;
	selectSession: (sessions: CopilotSession[]) => Promise<CopilotSession | undefined>;
	promptTitle: (defaultTitle: string) => Promise<string | undefined>;
	getGitContext: typeof getGitContext;
	createChatSession: typeof createChatSession;
	applySaveBloatControls: typeof applySaveBloatControls;
	getIncludeInGitignore: (workspaceFolder: vscode.WorkspaceFolder) => boolean;
	ensureGitignoreEntry: (workspaceFolder: vscode.WorkspaceFolder, storageDirectory: string) => Promise<boolean>;
	getPruneConfiguration: (workspaceFolder: vscode.WorkspaceFolder) => PruneConfiguration;
	writeSession: (storageDirectory: string, session: ReturnType<typeof createChatSession>) => Promise<string>;
	pruneSessions: (storageDirectory: string, maxSavedSessions: number, action: SessionPruneAction) => Promise<{ archived: number; deleted: number }>;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

interface SaveConfiguration {
	maxFileSizeBytes: number;
	overflowStrategy: SaveOverflowStrategy;
	stripToolOutput: boolean;
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

interface AutoSaveOnChatResponseDeps {
	getStorageUri: () => { fsPath: string } | undefined;
	createWatcher: (sessionsDirectory: string) => ChatResponseFileWatcher;
	getImplicitWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
	readCopilotSessions: () => Promise<CopilotSession[]>;
	saveSessionSilently: (workspaceFolder: vscode.WorkspaceFolder, storageDirectory: string) => Promise<string | undefined>;
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

	return {
		maxFileSizeBytes: parsedSize,
		overflowStrategy,
		stripToolOutput,
	};
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
				label: `[${workspaceFolder.name}] ${session.title}`,
				description: `${session.turnCount} turns`,
				detail: `${session.savedAt} | ${session.fileName}`,
				fileName: session.fileName,
				storageDirectory,
				workspaceFolder,
			}));
		}),
	);

	return results.flat().sort((a, b) => Date.parse(b.detail.split('|')[0]?.trim() ?? '') - Date.parse(a.detail.split('|')[0]?.trim() ?? ''));
}

function toSessionQuickPickItem(session: CopilotSession): CopilotSessionPickItem {
	return {
		label: session.title,
		description: `${session.turns.length} turns`,
		detail: `${session.lastMessageDate} (${session.id})`,
		session,
	};
}

function createDefaultSaveFlowDeps(): SaveSessionFlowDeps {
	return {
		readCopilotSessions,
		selectSession: async (sessions: CopilotSession[]) => {
			const pick = await vscode.window.showQuickPick(
				sessions.map((session) => toSessionQuickPickItem(session)),
				{ title: 'Select Copilot session to save' },
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
		writeSession: async (storageDirectory, session) => sessionStore.writeSession(storageDirectory, session),
		pruneSessions: async (storageDirectory, maxSavedSessions, action) =>
			sessionStore.pruneSessions(storageDirectory, maxSavedSessions, action),
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
	};
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
	if (!sessions.length) {
		return undefined;
	}

	const selected = await deps.selectSession(sessions);
	if (!selected) {
		return undefined;
	}

	const title = await deps.promptTitle(selected.title);
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

	const writtenFiles: string[] = [];
	for (const sessionToWrite of saveResult.sessions) {
		const fileName = await deps.writeSession(storageDirectory, sessionToWrite);
		writtenFiles.push(fileName);
	}

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

async function runSaveSessionCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = await resolveManualWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
		return;
	}

	const storageDirectory = getStoragePath(workspaceFolder);
	await runSaveSessionFlow(context, workspaceFolder, storageDirectory);
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
	return {
		getStorageUri: () => context.storageUri,
		createWatcher: (sessionsDirectory) => {
			const pattern = new vscode.RelativePattern(
				vscode.Uri.file(sessionsDirectory),
				'*.{json,jsonl}',
			);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			return {
				onDidChange: (listener: () => void) => watcher.onDidChange(() => listener()),
				onDidCreate: (listener: () => void) => watcher.onDidCreate(() => listener()),
				dispose: () => watcher.dispose(),
			};
		},
		getImplicitWorkspaceFolder,
		readCopilotSessions: () => readCopilotSessions(context),
		saveSessionSilently: async (workspaceFolder, storageDirectory) =>
			runSaveSessionFlow(context, workspaceFolder, storageDirectory, {
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
	if (!storageUri) {
		output.appendLine('[auto-save] No workspace storage available. Chat response auto-save is disabled.');
		return undefined;
	}

	const sessionsDirectory = deriveChatSessionsPath(storageUri.fsPath);
	output.appendLine(`[auto-save] Watching: ${sessionsDirectory}`);
	const watcher = deps.createWatcher(sessionsDirectory);

	const lastAutoSave = new Map<string, { fileName: string; turnCount: number }>();
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let disabled = false;
	const disposables: vscode.Disposable[] = [];

	const onStorageChanged = () => {
		if (disabled) {
			output.appendLine('[auto-save] Skipped — listener disabled due to a previous error. Reload VS Code to re-enable.');
			return;
		}

		output.appendLine('[auto-save] File change detected, debouncing 5 s…');
		if (debounceTimer) {
			deps.clearSchedule(debounceTimer);
		}

		debounceTimer = deps.schedule(() => {
			void (async () => {
				try {
					const sessions = await deps.readCopilotSessions();
					output.appendLine(`[auto-save] Read ${sessions.length} session(s).`);
					if (!sessions.length) {
						output.appendLine('[auto-save] No sessions found — nothing to save.');
						return;
					}

					const latest = sessions[0];
					if (!latest) {
						return;
					}
					output.appendLine(`[auto-save] Latest: "${latest.title}" id=${latest.id} turns=${latest.turns.length}`);
					const prev = lastAutoSave.get(latest.id);
					if (prev && prev.turnCount >= latest.turns.length) {
						output.appendLine(`[auto-save] Skipped — turn count unchanged (${latest.turns.length}).`);
						return;
					}

					const workspaceFolder = deps.getImplicitWorkspaceFolder();
					if (!workspaceFolder) {
						output.appendLine('[auto-save] Skipped — no workspace folder is open.');
						return;
					}

					const storageDirectory = getStoragePath(workspaceFolder);
					output.appendLine(`[auto-save] Saving to ${storageDirectory}…`);
					const newFileName = await deps.saveSessionSilently(workspaceFolder, storageDirectory);
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

					lastAutoSave.set(latest.id, {
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
	};

	disposables.push(
		watcher.onDidChange(onStorageChanged),
		watcher.onDidCreate(onStorageChanged),
	);

	const registration = {
		dispose: () => {
			if (debounceTimer) {
				deps.clearSchedule(debounceTimer);
			}
			watcher.dispose();
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

	// Open the chat panel with a pre-filled resume command
	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query: `@session-control /resume ${sessionTitle}`,
		});
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
		if (event.affectsConfiguration('session-control.autoSaveOnChatResponse')) {
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
