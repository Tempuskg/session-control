import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerChatParticipant } from './chatParticipant';
import { getGitContext } from './gitIntegration';
import { CopilotSession, readCopilotSessions } from './sessionReader';
import { SessionExplorerProvider, SessionExplorerSessionItem } from './sessionExplorer';
import { SessionViewerPanel } from './sessionViewer';
import { createSessionStore, SessionPruneAction } from './sessionStore';
import { applySaveBloatControls, createChatSession, SaveOverflowStrategy } from './sessionWriter';
import { parseFileSize } from './utils';

const sessionStore = createSessionStore();

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

interface GitRepositoryLike {
	rootUri: vscode.Uri;
	state: {
		HEAD?: {
			commit?: string;
		};
		onDidChange: (listener: () => void) => vscode.Disposable;
	};
}

interface GitApiLike {
	repositories: GitRepositoryLike[];
}

interface AutoSaveListenerDeps {
	getGitApi: () => GitApiLike | null;
	getWorkspaceFolder: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined;
	runSaveSessionFlow: typeof runSaveSessionFlow;
	showInformationMessage: (message: string) => Thenable<unknown>;
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

	if (path.isAbsolute(configured)) {
		throw new Error('session-control.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
	const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
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

function tryGetGitApi(): GitApiLike | null {
	const extension = vscode.extensions.getExtension<{ getAPI(version: number): GitApiLike }>('vscode.git');
	if (!extension) {
		return null;
	}

	const gitExports = extension.isActive ? extension.exports : undefined;
	if (!gitExports || typeof gitExports.getAPI !== 'function') {
		return null;
	}

	return gitExports.getAPI(1);
}

function createDefaultAutoSaveDeps(): AutoSaveListenerDeps {
	return {
		getGitApi: tryGetGitApi,
		getWorkspaceFolder: (uri: vscode.Uri) => vscode.workspace.getWorkspaceFolder(uri),
		runSaveSessionFlow,
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
		showWarningMessage: (message: string) => vscode.window.showWarningMessage(message),
		schedule: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
		clearSchedule: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
	};
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

export function registerAutoSaveOnCommitListener(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
 	depsOverrides: Partial<AutoSaveListenerDeps> = {},
): vscode.Disposable | undefined {
	const deps = {
		...createDefaultAutoSaveDeps(),
		...depsOverrides,
	};
	const disposables: vscode.Disposable[] = [];

	const gitApi = deps.getGitApi();
	if (!gitApi) {
		void deps.showInformationMessage('Git extension not available. Auto-save on commit is disabled.');
		return undefined;
	}

	const lastCommitByRepo = new Map<string, string | undefined>();
	const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	for (const repository of gitApi.repositories) {
		const repoKey = repository.rootUri.toString();
		lastCommitByRepo.set(repoKey, repository.state.HEAD?.commit);

		const disposable = repository.state.onDidChange(() => {
			const currentCommit = repository.state.HEAD?.commit;
			const previousCommit = lastCommitByRepo.get(repoKey);
			if (!currentCommit || currentCommit === previousCommit) {
				return;
			}

			lastCommitByRepo.set(repoKey, currentCommit);
			const existingTimer = debounceTimers.get(repoKey);
			if (existingTimer) {
				deps.clearSchedule(existingTimer);
			}

			const timer = deps.schedule(() => {
				void (async () => {
					try {
						const workspaceFolder = deps.getWorkspaceFolder(repository.rootUri);
						if (!workspaceFolder) {
							return;
						}

						await deps.runSaveSessionFlow(
							context,
							workspaceFolder,
							getStoragePath(workspaceFolder),
							{
								selectSession: async (sessions) => sessions[0],
								promptTitle: async (defaultTitle) => defaultTitle,
								showInformationMessage: async (message) => {
									if (/Saved\s+(chat session|\d+ session part files)/i.test(message)) {
										return;
									}

									await deps.showInformationMessage(message);
								},
							},
						);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						output.appendLine(`[auto-save] Disabled after listener error: ${message}`);
						void deps.showWarningMessage('Session Control auto-save on commit encountered an error and was disabled for this session.');
						disposable.dispose();
					}
				})();
			}, 750);

			debounceTimers.set(repoKey, timer);
		});

		disposables.push(disposable);
	}

	disposables.push({
		dispose: () => {
			for (const timer of debounceTimers.values()) {
				deps.clearSchedule(timer);
			}
			debounceTimers.clear();
		},
	});

	const registration = {
		dispose: () => {
			for (const disposable of disposables) {
				disposable.dispose();
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

function isAnyWorkspaceAutoSaveEnabled(): boolean {
	return (vscode.workspace.workspaceFolders ?? []).some((workspaceFolder) => vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<boolean>('autoSaveOnCommit', false));
}

function updateAutoSaveStatusBar(item: vscode.StatusBarItem): void {
	const workspaceFolder = getImplicitWorkspaceFolder();
	if (!workspaceFolder) {
		item.hide();
		return;
	}

	const enabled = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<boolean>('autoSaveOnCommit', false);
	item.text = `$(history) Session Control ${enabled ? 'Auto-Save On' : 'Auto-Save Off'}`;
	item.tooltip = `${workspaceFolder.name}: click to ${enabled ? 'disable' : 'enable'} auto-save on commit`;
	item.show();
}

export function activate(context: vscode.ExtensionContext): void {
	const sessionExplorerProvider = new SessionExplorerProvider();
	const sessionExplorerView = vscode.window.createTreeView('session-control.sessionExplorer', {
		treeDataProvider: sessionExplorerProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(sessionExplorerView);
	const autoSaveStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	autoSaveStatusBar.command = 'session-control.toggleAutoSaveOnCommit';
	context.subscriptions.push(autoSaveStatusBar);

	// The onStartupFinished activation event fires here; check autoSaveOnCommit
	// and register the git listener only if enabled.
	const output = vscode.window.createOutputChannel('Session Control');
	context.subscriptions.push(output);
	let autoSaveListener: vscode.Disposable | undefined;
	const syncAutoSaveListener = () => {
		const enabled = isAnyWorkspaceAutoSaveEnabled();
		if (enabled && !autoSaveListener) {
			autoSaveListener = registerAutoSaveOnCommitListener(context, output);
			return;
		}

		if (!enabled && autoSaveListener) {
			autoSaveListener.dispose();
			autoSaveListener = undefined;
		}
	};

	syncAutoSaveListener();
	updateAutoSaveStatusBar(autoSaveStatusBar);

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
		vscode.commands.registerCommand('session-control.toggleAutoSaveOnCommit', async () => {
			const workspaceFolder = await resolveManualWorkspaceFolder({
				getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
			});
			if (!workspaceFolder) {
				await vscode.window.showInformationMessage('Open a workspace folder before changing auto-save on commit.');
				return;
			}

			const configuration = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
			const current = configuration.get<boolean>('autoSaveOnCommit', false);
			await configuration.update('autoSaveOnCommit', !current, vscode.ConfigurationTarget.WorkspaceFolder);
			updateAutoSaveStatusBar(autoSaveStatusBar);
			syncAutoSaveListener();
			await vscode.window.showInformationMessage(
				`${workspaceFolder.name}: auto-save on commit ${current ? 'disabled' : 'enabled'}.`,
			);
		}),
	);

	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
		sessionExplorerProvider.refresh();
		syncAutoSaveListener();
		updateAutoSaveStatusBar(autoSaveStatusBar);
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('session-control.autoSaveOnCommit')) {
			syncAutoSaveListener();
			updateAutoSaveStatusBar(autoSaveStatusBar);
		}

		if (event.affectsConfiguration('session-control.storagePath')) {
			sessionExplorerProvider.refresh();
		}
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateAutoSaveStatusBar(autoSaveStatusBar)));

	registerChatParticipant(context);
}

export function deactivate(): void {
	// Cleanup handled via context.subscriptions disposal above.
}
