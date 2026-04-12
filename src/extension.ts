import * as vscode from 'vscode';
import * as path from 'node:path';
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

async function runSaveSessionCommand(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = pickWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
		return;
	}

	const sessions = await readCopilotSessions(context);
	if (!sessions.length) {
		return;
	}

	const pick = await vscode.window.showQuickPick(
		sessions.map((session) => toSessionQuickPickItem(session)),
		{ title: 'Select Copilot session to save' },
	);

	if (!pick) {
		return;
	}

	const title = await vscode.window.showInputBox({
		title: 'Session title',
		value: pick.session.title,
		prompt: 'Edit the title before saving (optional)',
	});

	if (title === undefined) {
		return;
	}

	const git = await getGitContext(workspaceFolder.uri);
	const chatSession = createChatSession(pick.session, {
		title,
		git,
		vscodeVersion: vscode.version,
	});

	const storageDirectory = getStoragePath(workspaceFolder);
	const fileName = await sessionStore.writeSession(storageDirectory, chatSession);

	await vscode.window.showInformationMessage(`Saved chat session to ${path.join(storageDirectory, fileName)}`);
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
		// Git commit listener registered in Phase 9 (src/gitIntegration.ts).
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('chat-commit.saveSession', async () => runSaveSessionCommand(context)),
		vscode.commands.registerCommand('chat-commit.listSessions', async () => runListSessionsCommand()),
		vscode.commands.registerCommand('chat-commit.deleteSession', async () => runDeleteSessionCommand()),
	);

	// Chat participant registered in Phase 7 (src/chatParticipant.ts).
}

export function deactivate(): void {
	// Cleanup handled via context.subscriptions disposal above.
}
