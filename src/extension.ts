import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerChatParticipant } from './chatParticipant';
import { getGitContext } from './gitIntegration';
import { CopilotSession, readCopilotSessions } from './sessionReader';
import { createSessionStore, SessionPruneAction } from './sessionStore';
import { applySaveBloatControls, createChatSession, SaveOverflowStrategy } from './sessionWriter';
import { parseFileSize } from './utils';

const sessionStore = createSessionStore();

interface CopilotSessionPickItem extends vscode.QuickPickItem {
	session: CopilotSession;
}

interface SavedSessionPickItem extends vscode.QuickPickItem {
	fileName: string;
}

interface SaveSessionFlowDeps {
	readCopilotSessions: typeof readCopilotSessions;
	selectSession: (sessions: CopilotSession[]) => Promise<CopilotSession | undefined>;
	promptTitle: (defaultTitle: string) => Promise<string | undefined>;
	getGitContext: typeof getGitContext;
	createChatSession: typeof createChatSession;
	applySaveBloatControls: typeof applySaveBloatControls;
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

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('chat-commit', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	return path.join(workspaceFolder.uri.fsPath, configured);
}

function getSaveConfiguration(workspaceFolder: vscode.WorkspaceFolder): SaveConfiguration {
	const config = vscode.workspace.getConfiguration('chat-commit', workspaceFolder.uri);
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

function getPruneConfiguration(workspaceFolder: vscode.WorkspaceFolder): PruneConfiguration {
	const config = vscode.workspace.getConfiguration('chat-commit', workspaceFolder.uri);
	return {
		maxSavedSessions: config.get<number>('save.maxSavedSessions', 0),
		pruneAction: config.get<SessionPruneAction>('save.pruneAction', 'archive'),
	};
}

function pickWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		const fromActiveEditor = vscode.workspace.getWorkspaceFolder(activeUri);
		if (fromActiveEditor) {
			return fromActiveEditor;
		}
	}

	return vscode.workspace.workspaceFolders?.[0];
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
	const workspaceFolder = pickWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
		return;
	}

	const storageDirectory = getStoragePath(workspaceFolder);
	await runSaveSessionFlow(context, workspaceFolder, storageDirectory);
}

async function runListSessionsCommand(): Promise<void> {
	const workspaceFolder = pickWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before listing sessions.');
		return;
	}

	const storageDirectory = getStoragePath(workspaceFolder);
	const sessions = await sessionStore.listSessions(storageDirectory);

	if (!sessions.length) {
		await vscode.window.showInformationMessage('No saved sessions found.');
		return;
	}

	await vscode.window.showQuickPick<SavedSessionPickItem>(
		sessions.map((session) => ({
			label: session.title,
			description: `${session.turnCount} turns`,
			detail: `${session.savedAt} | ${session.fileName}`,
			fileName: session.fileName,
		})),
		{ title: 'Saved chat sessions' },
	);
}

async function runDeleteSessionCommand(): Promise<void> {
	const workspaceFolder = pickWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before deleting sessions.');
		return;
	}

	const storageDirectory = getStoragePath(workspaceFolder);
	const sessions = await sessionStore.listSessions(storageDirectory);
	if (!sessions.length) {
		await vscode.window.showInformationMessage('No saved sessions found.');
		return;
	}

	const pick = await vscode.window.showQuickPick<SavedSessionPickItem>(
		sessions.map((session) => ({
			label: session.title,
			description: `${session.turnCount} turns`,
			detail: `${session.savedAt} | ${session.fileName}`,
			fileName: session.fileName,
		})),
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

	const deleted = await sessionStore.deleteSession(storageDirectory, pick.fileName);
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

function registerAutoSaveOnCommitListener(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
): void {
	const gitApi = tryGetGitApi();
	if (!gitApi) {
		void vscode.window.showInformationMessage('Git extension not available. Auto-save on commit is disabled.');
		return;
	}

	const lastCommitByRepo = new Map<string, string | undefined>();
	const debounceTimers = new Map<string, NodeJS.Timeout>();

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
				clearTimeout(existingTimer);
			}

			const timer = setTimeout(() => {
				void (async () => {
					try {
						const workspaceFolder = vscode.workspace.getWorkspaceFolder(repository.rootUri);
						if (!workspaceFolder) {
							return;
						}

						await runSaveSessionFlow(
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

									await vscode.window.showInformationMessage(message);
								},
							},
						);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						output.appendLine(`[auto-save] Disabled after listener error: ${message}`);
						void vscode.window.showWarningMessage('Chat Commit auto-save on commit encountered an error and was disabled for this session.');
						disposable.dispose();
					}
				})();
			}, 750);

			debounceTimers.set(repoKey, timer);
		});

		context.subscriptions.push(disposable);
	}

	context.subscriptions.push({
		dispose: () => {
			for (const timer of debounceTimers.values()) {
				clearTimeout(timer);
			}
			debounceTimers.clear();
		},
	});
}

export function activate(context: vscode.ExtensionContext): void {
	// The onStartupFinished activation event fires here; check autoSaveOnCommit
	// and register the git listener only if enabled.
	const autoSave = vscode.workspace
		.getConfiguration('chat-commit')
		.get<boolean>('autoSaveOnCommit', false);
	const output = vscode.window.createOutputChannel('Chat Commit');
	context.subscriptions.push(output);

	if (autoSave) {
		registerAutoSaveOnCommitListener(context, output);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('chat-commit.saveSession', async () => runSaveSessionCommand(context)),
		vscode.commands.registerCommand('chat-commit.listSessions', async () => runListSessionsCommand()),
		vscode.commands.registerCommand('chat-commit.deleteSession', async () => runDeleteSessionCommand()),
	);

	registerChatParticipant(context);
}

export function deactivate(): void {
	// Cleanup handled via context.subscriptions disposal above.
}
