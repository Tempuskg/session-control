import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runSaveSessionFlow } from '../../src/extension';
import { CopilotSession } from '../../src/sessionReader';
import { createSessionStore } from '../../src/sessionStore';
import { createChatSession } from '../../src/sessionWriter';
import { isChatSession } from '../../src/types';

function createCopilotSession(): CopilotSession {
	return {
		id: 'session-roundtrip',
		title: 'Initial Session Title',
		lastMessageDate: '2026-04-12T12:05:00.000Z',
		sourceFile: 'session-roundtrip',
		turns: [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Please summarize the auth bug investigation.',
				references: ['src/auth.ts'],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'The bug appears to be a missing token refresh path.',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
		],
	};
}

suite('extension save flow', () => {
	test('runSaveSessionFlow saves and round-trips a valid chat session', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-extension-save-flow-'));
		const workspaceRoot = path.join(tempRoot, 'workspace');
		const storageDirectory = path.join(workspaceRoot, '.chat');
		const infoMessages: string[] = [];
		const store = createSessionStore();

		try {
			await fs.mkdir(workspaceRoot, { recursive: true });

			const workspaceFolder = {
				uri: vscode.Uri.file(workspaceRoot),
				name: 'workspace',
				index: 0,
			} as vscode.WorkspaceFolder;

			const fileName = await runSaveSessionFlow(
				{} as vscode.ExtensionContext,
				workspaceFolder,
				storageDirectory,
				{
					readCopilotSessions: async () => [createCopilotSession()],
					selectSession: async (sessions) => sessions[0],
					promptTitle: async () => 'Auth Bug Investigation',
					getGitContext: async () => ({
						branch: 'main',
						commit: 'abcdef1234567890',
						dirty: false,
					}),
					showInformationMessage: async (message: string) => {
						infoMessages.push(message);
						return undefined;
					},
				},
			);

			assert.ok(fileName);
			const restored = await store.readSession(storageDirectory, fileName as string);
			assert.equal(isChatSession(restored), true);
			assert.equal(restored.title, 'Auth Bug Investigation');
			assert.equal(restored.git?.branch, 'main');
			assert.equal(restored.git?.commit, 'abcdef1234567890');
			assert.equal(restored.totalTurns, 2);
			assert.equal(restored.turns.length, 2);
			assert.equal(infoMessages.some((message) => message.includes(fileName as string)), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('runSaveSessionFlow writes split sessions and emits warning', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-extension-save-flow-split-'));
		const workspaceRoot = path.join(tempRoot, 'workspace');
		const storageDirectory = path.join(workspaceRoot, '.chat');
		const infoMessages: string[] = [];
		const store = createSessionStore();

		try {
			await fs.mkdir(workspaceRoot, { recursive: true });

			const workspaceFolder = {
				uri: vscode.Uri.file(workspaceRoot),
				name: 'workspace',
				index: 0,
			} as vscode.WorkspaceFolder;

			const base = createChatSession(createCopilotSession(), {
				title: 'Auth Bug Investigation',
				savedAt: '2026-04-12T12:00:00.000Z',
				vscodeVersion: '1.115.0',
			});

			const partOne = { ...base, title: 'Auth Bug Investigation (Part 1/2)', part: 1, totalParts: 2 };
			const partTwo = { ...base, title: 'Auth Bug Investigation (Part 2/2)', part: 2, totalParts: 2 };

			await runSaveSessionFlow(
				{} as vscode.ExtensionContext,
				workspaceFolder,
				storageDirectory,
				{
					readCopilotSessions: async () => [createCopilotSession()],
					selectSession: async (sessions) => sessions[0],
					promptTitle: async () => 'Auth Bug Investigation',
					applySaveBloatControls: () => ({
						sessions: [partOne, partTwo],
						warning: 'Session exceeded save.maxFileSize and was split into 2 part files.',
					}),
					showInformationMessage: async (message: string) => {
						infoMessages.push(message);
						return undefined;
					},
				},
			);

			const written = await store.listSessions(storageDirectory);
			assert.equal(written.length, 2);
			assert.equal(infoMessages.some((message) => message.includes('split into 2 part files')), true);
			assert.equal(infoMessages.some((message) => message.includes('Saved 2 session part files')), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('runSaveSessionFlow triggers pruning notifications when limits are exceeded', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-extension-save-flow-prune-'));
		const workspaceRoot = path.join(tempRoot, 'workspace');
		const storageDirectory = path.join(workspaceRoot, '.chat');
		const infoMessages: string[] = [];

		try {
			await fs.mkdir(workspaceRoot, { recursive: true });

			const workspaceFolder = {
				uri: vscode.Uri.file(workspaceRoot),
				name: 'workspace',
				index: 0,
			} as vscode.WorkspaceFolder;

			await runSaveSessionFlow(
				{} as vscode.ExtensionContext,
				workspaceFolder,
				storageDirectory,
				{
					readCopilotSessions: async () => [createCopilotSession()],
					selectSession: async (sessions) => sessions[0],
					promptTitle: async () => 'Auth Bug Investigation',
					getPruneConfiguration: () => ({ maxSavedSessions: 1, pruneAction: 'archive' }),
					pruneSessions: async () => ({ archived: 1, deleted: 0 }),
					showInformationMessage: async (message: string) => {
						infoMessages.push(message);
						return undefined;
					},
				},
			);

			assert.equal(infoMessages.some((message) => message.includes('Archived 1 old session file(s)')), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});
