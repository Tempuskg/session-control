import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	createStorageGitignoreEntry,
	ensureStoragePathInGitignore,
	listSessionsAcrossWorkspaceFolders,
	resolveManualWorkspaceFolder,
	validateStoragePath,
} from '../../src/extension';
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
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-phase10-'));
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
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-gitignore-'));

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
});