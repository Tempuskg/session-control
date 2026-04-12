import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerChatParticipant } from './chatParticipant';
import { getGitContext } from './gitIntegration';
import { CopilotSession, readCopilotSessions } from './sessionReader';
import { createSessionStore } from './sessionStore';
import { createChatSession } from './sessionWriter';

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
	writeSession: (storageDirectory: string, session: ReturnType<typeof createChatSession>) => Promise<string>;
	showInformationMessage: (message: string) => Thenable<unknown>;
}

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('chat-commit', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	return path.join(workspaceFolder.uri.fsPath, configured);
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
		writeSession: async (storageDirectory, session) => sessionStore.writeSession(storageDirectory, session),
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

	const fileName = await deps.writeSession(storageDirectory, chatSession);
	await deps.showInformationMessage(`Saved chat session to ${path.join(storageDirectory, fileName)}`);
 return fileName;
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

export function activate(context: vscode.ExtensionContext): void {
	// The onStartupFinished activation event fires here; check autoSaveOnCommit
	// and register the git listener only if enabled (implemented in Phase 9).
	const autoSave = vscode.workspace
		.getConfiguration('chat-commit')
		.get<boolean>('autoSaveOnCommit', false);

	if (autoSave) {
		void vscode.window.showInformationMessage('Chat Commit auto-save on commit will be wired in Phase 9.');
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
