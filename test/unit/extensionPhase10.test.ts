import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	createStorageGitignoreEntry,
	ensureStoragePathInGitignore,
	listSessionsAcrossWorkspaceFolders,
	runOpenSavedSessionCommand,
	runResumeSessionFromViewerCommand,
	runViewSessionFileCommand,
	resolveManualWorkspaceFolder,
	validateStoragePath,
} from '../../src/extension';
import { SessionViewerPanel } from '../../src/sessionViewer';
import { createSessionStore } from '../../src/sessionStore';
import { createChatSession } from '../../src/sessionWriter';
import { CopilotSession } from '../../src/sessionReader';

function createWorkspaceFolder(rootPath: string, name: string, index: number): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name,
		index,
	} as vscode.WorkspaceFolder;
}

function createCopilotSession(title: string): CopilotSession {
	return {
		id: `${title}-id`,
		title,
		lastMessageDate: '2026-04-12T12:05:00.000Z',
		sourceFile: `${title}-source`,
		turns: [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Prompt',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'Response',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
		],
	};
}

suite('extension phase 10', () => {
	test('validateStoragePath accepts in-workspace relative paths and rejects invalid ones', () => {
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);

		assert.equal(validateStoragePath(workspaceFolder, '.chat').toLowerCase(), path.resolve('C:/repo', '.chat').toLowerCase());
		assert.throws(() => validateStoragePath(workspaceFolder, '../outside'));
		assert.throws(() => validateStoragePath(workspaceFolder, ''));
		assert.throws(() => validateStoragePath(workspaceFolder, 'C:/absolute'));
	});

	test('resolveManualWorkspaceFolder prefers active editor workspace', async () => {
		const first = createWorkspaceFolder('C:/repo-one', 'one', 0);
		const second = createWorkspaceFolder('C:/repo-two', 'two', 1);
		const activeUri = vscode.Uri.file('C:/repo-two/src/file.ts');

		const resolved = await resolveManualWorkspaceFolder({
			getWorkspaceFolders: () => [first, second],
			getActiveEditorUri: () => activeUri,
			getWorkspaceFolder: (uri) => (uri.fsPath.startsWith(second.uri.fsPath) ? second : first),
			pickWorkspaceFolder: async () => undefined,
		});

		assert.equal(resolved?.name, 'two');
	});

	test('resolveManualWorkspaceFolder prompts when multiple folders are open without an active editor', async () => {
		const first = createWorkspaceFolder('C:/repo-one', 'one', 0);
		const second = createWorkspaceFolder('C:/repo-two', 'two', 1);

		const resolved = await resolveManualWorkspaceFolder({
			getWorkspaceFolders: () => [first, second],
			getActiveEditorUri: () => undefined,
			getWorkspaceFolder: () => undefined,
			pickWorkspaceFolder: async (items) => items[1],
		});

		assert.equal(resolved?.name, 'two');
	});

	test('listSessionsAcrossWorkspaceFolders aggregates saved sessions from all folders', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-phase10-'));
		const store = createSessionStore();

		try {
			const workspaceAPath = path.join(tempRoot, 'workspace-a');
			const workspaceBPath = path.join(tempRoot, 'workspace-b');
			await fs.mkdir(workspaceAPath, { recursive: true });
			await fs.mkdir(workspaceBPath, { recursive: true });

			const workspaceA = createWorkspaceFolder(workspaceAPath, 'alpha', 0);
			const workspaceB = createWorkspaceFolder(workspaceBPath, 'beta', 1);

			await store.writeSession(
				path.join(workspaceAPath, '.chat'),
				createChatSession(createCopilotSession('Alpha Session'), {
					title: 'Alpha Session',
					savedAt: '2026-04-12T13:00:00.000Z',
					vscodeVersion: '1.115.0',
				}),
			);

			await store.writeSession(
				path.join(workspaceBPath, '.chat'),
				createChatSession(createCopilotSession('Beta Session'), {
					title: 'Beta Session',
					savedAt: '2026-04-12T14:00:00.000Z',
					vscodeVersion: '1.115.0',
				}),
			);

			const sessions = await listSessionsAcrossWorkspaceFolders([workspaceA, workspaceB]);

			assert.equal(sessions.length, 2);
			assert.equal(sessions[0]?.label, '[beta] Beta Session');
			assert.equal(sessions[1]?.label, '[alpha] Alpha Session');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('ensureStoragePathInGitignore appends the relative storage path once', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-gitignore-'));

		try {
			const workspaceFolder = createWorkspaceFolder(tempRoot, 'repo', 0);
			const storageDirectory = path.join(tempRoot, '.chat');
			const entry = createStorageGitignoreEntry(workspaceFolder, storageDirectory);

			assert.equal(entry, '.chat/');

			const created = await ensureStoragePathInGitignore(workspaceFolder, storageDirectory);
			const duplicated = await ensureStoragePathInGitignore(workspaceFolder, storageDirectory);
			const gitignore = await fs.readFile(path.join(tempRoot, '.gitignore'), 'utf8');

			assert.equal(created, true);
			assert.equal(duplicated, false);
			assert.equal(gitignore, '.chat/\n');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('runOpenSavedSessionCommand prompts for a session when no explorer item is provided', async () => {
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
		const opened: Array<{ storageDirectory: string; fileName: string; extensionUri: vscode.Uri }> = [];

		await runOpenSavedSessionCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			undefined,
			{
				getWorkspaceFolders: () => [workspaceFolder],
				listSessionsAcrossWorkspaceFolders: async () => [
					{
						label: '[repo] Session 1',
						description: '2 turns',
						detail: '2026-04-13T00:00:00.000Z | saved.json',
						fileName: 'saved.json',
						storageDirectory: 'C:/repo/.chat',
						workspaceFolder,
					},
				],
				pickSession: async (sessions) => sessions[0],
				readSession: async () => ({ id: 's1' } as ReturnType<typeof createChatSession>),
				showSession: (_session, extensionUri, storageDirectory, fileName) => {
					opened.push({ extensionUri, storageDirectory, fileName });
				},
				showInformationMessage: async () => undefined,
			},
		);

		assert.equal(opened.length, 1);
		assert.equal(opened[0]?.storageDirectory, 'C:/repo/.chat');
		assert.equal(opened[0]?.fileName, 'saved.json');
		assert.equal(opened[0]?.extensionUri.fsPath.toLowerCase(), vscode.Uri.file('C:/extension').fsPath.toLowerCase());
	});

	test('runOpenSavedSessionCommand shows guidance when no workspace is open', async () => {
		const infoMessages: string[] = [];

		await runOpenSavedSessionCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			undefined,
			{
				getWorkspaceFolders: () => undefined,
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
			},
		);

		assert.equal(infoMessages.length, 1);
		assert.equal(infoMessages[0], 'Open a workspace folder before opening saved sessions.');
	});

	test('runViewSessionFileCommand opens session viewer for valid session JSON', async () => {
		const session = createChatSession(createCopilotSession('Viewer Session'), {
			title: 'Viewer Session',
			savedAt: '2026-04-13T12:00:00.000Z',
			vscodeVersion: '1.115.0',
		});
		const opened: Array<{ storageDirectory: string; fileName: string; extensionUri: vscode.Uri }> = [];

		await runViewSessionFileCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				getActiveEditor: () => ({
					document: {
						uri: vscode.Uri.file('C:/repo/.chat/viewer-session.json'),
						getText: () => JSON.stringify(session),
					},
				} as unknown as vscode.TextEditor),
				showSession: (_session, extensionUri, storageDirectory, fileName) => {
					opened.push({ extensionUri, storageDirectory, fileName });
				},
				showInformationMessage: async () => undefined,
			},
		);

		assert.equal(opened.length, 1);
		assert.equal(opened[0]?.storageDirectory.toLowerCase(), path.normalize('C:/repo/.chat').toLowerCase());
		assert.equal(opened[0]?.fileName, 'viewer-session.json');
		assert.equal(opened[0]?.extensionUri.fsPath.toLowerCase(), vscode.Uri.file('C:/extension').fsPath.toLowerCase());
	});

	test('runViewSessionFileCommand shows message for invalid JSON', async () => {
		const infoMessages: string[] = [];

		await runViewSessionFileCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				getActiveEditor: () => ({
					document: {
						uri: vscode.Uri.file('C:/repo/.chat/bad.json'),
						getText: () => '{ bad json',
					},
				} as unknown as vscode.TextEditor),
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
			},
		);

		assert.equal(infoMessages[0], 'The active file is not valid JSON.');
	});

	test('runViewSessionFileCommand shows message for non-session JSON', async () => {
		const infoMessages: string[] = [];

		await runViewSessionFileCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				getActiveEditor: () => ({
					document: {
						uri: vscode.Uri.file('C:/repo/.chat/not-session.json'),
						getText: () => JSON.stringify({ hello: 'world' }),
					},
				} as unknown as vscode.TextEditor),
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
			},
		);

		assert.equal(infoMessages[0], 'This file is not a recognized Session Control session format.');
	});
});

suite('runResumeSessionFromViewerCommand', () => {
	test('shows info message when no session viewer is open', async () => {
		const infoMessages: string[] = [];
		let originalExecuteCommand = vscode.commands.executeCommand;
		const executedCommands: string[] = [];

		// Store original state to restore later
		const originalCurrentPanel = (SessionViewerPanel as any).currentPanel;

		try {
			// Mock vscode.commands.executeCommand temporarily
			(vscode.commands as any).executeCommand = async (...args: unknown[]) => {
				executedCommands.push(String(args[0]));
				return undefined;
			};

			// Ensure no panel is open
			(SessionViewerPanel as any).currentPanel = undefined;

			// Mock window methods
			const originalShowMessage = vscode.window.showInformationMessage;
			(vscode.window as any).showInformationMessage = async (message: string) => {
				infoMessages.push(message);
				return undefined;
			};

			await runResumeSessionFromViewerCommand();

			assert.equal(infoMessages.length, 1);
			assert.equal(infoMessages[0], 'No session viewer is currently open.');
			assert.equal(executedCommands.length, 0, 'No commands should be executed when no viewer is open');

			// Restore
			(vscode.window as any).showInformationMessage = originalShowMessage;
		} finally {
			// Restore original state
			(vscode.commands as any).executeCommand = originalExecuteCommand;
			(SessionViewerPanel as any).currentPanel = originalCurrentPanel;
		}
	});
});