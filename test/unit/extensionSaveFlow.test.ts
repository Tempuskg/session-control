import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runSaveSessionFlow } from '../../src/extension';
import { CopilotSession } from '../../src/sessionReader';
import { createSessionStore } from '../../src/sessionStore';
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
});
