import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSessionReader, deriveChatSessionsPath } from '../../src/sessionReader';

async function setupWorkspaceStorageRoot(): Promise<{
	root: string;
	storageUriPath: string;
	sessionsDirectory: string;
}> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-session-reader-'));
	const storageUriPath = path.join(root, 'workspaceStorage', 'workspace-1', 'chat-commit');
	const sessionsDirectory = deriveChatSessionsPath(storageUriPath);

	await fs.mkdir(storageUriPath, { recursive: true });
	await fs.mkdir(sessionsDirectory, { recursive: true });

	return { root, storageUriPath, sessionsDirectory };
}

async function copyFixture(fixtureName: string, destinationDirectory: string): Promise<void> {
	const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
	const fixturePath = path.join(repositoryRoot, 'test', 'fixtures', 'session-reader', fixtureName);
	await fs.copyFile(fixturePath, path.join(destinationDirectory, fixtureName));
}

suite('sessionReader', () => {
	test('deriveChatSessionsPath maps workspace storage extension path to chatSessions', () => {
		const result = deriveChatSessionsPath(path.join('tmp', 'workspaceStorage', 'abc', 'chat-commit'));
		assert.equal(result.endsWith(path.join('workspaceStorage', 'abc', 'chatSessions')), true);
	});

	test('reads json/jsonl sessions, sorts by recency, and skips corrupt files', async () => {
		const warnings: string[] = [];
		const infoMessages: string[] = [];
		const errorMessages: string[] = [];
		const setup = await setupWorkspaceStorageRoot();

		try {
			await copyFixture('v1-session.json', setup.sessionsDirectory);
			await copyFixture('v2-session.json', setup.sessionsDirectory);
			await copyFixture('jsonl-session.jsonl', setup.sessionsDirectory);
			await copyFixture('corrupt.json', setup.sessionsDirectory);

			const reader = createSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
				},
				logWarning: (message: string) => {
					warnings.push(message);
				},
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });

			assert.equal(sessions.length, 3);
			assert.equal(sessions[0]?.id, 'session-v2');
			assert.equal(sessions[1]?.id, 'session-jsonl');
			assert.equal(sessions[2]?.id, 'session-v1');
			assert.equal(warnings.some((message) => message.includes('corrupt.json')), true);
			assert.equal(infoMessages.length, 0);
			assert.equal(errorMessages.length, 0);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});

	test('returns empty and shows info message when chatSessions directory does not exist', async () => {
		const infoMessages: string[] = [];
		const setup = await setupWorkspaceStorageRoot();

		try {
			await fs.rm(setup.sessionsDirectory, { recursive: true, force: true });

			const reader = createSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				showErrorMessage: async () => undefined,
				logWarning: () => undefined,
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
			assert.equal(sessions.length, 0);
			assert.equal(
				infoMessages[0],
				'No Copilot chat sessions found in this workspace. Start a Copilot chat first.',
			);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});

	test('returns empty and shows unknown format error', async () => {
		const errorMessages: string[] = [];
		const setup = await setupWorkspaceStorageRoot();

		try {
			await copyFixture('unknown-format.json', setup.sessionsDirectory);

			const reader = createSessionReader({
				showInformationMessage: async () => undefined,
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
				},
				logWarning: () => undefined,
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
			assert.equal(sessions.length, 0);
			assert.equal(
				errorMessages[0],
				'Unrecognized Copilot session format (VS Code 1.115.0). Chat-Commit may need an update.',
			);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});
});
