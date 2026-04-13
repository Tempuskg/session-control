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
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-reader-'));
	const storageUriPath = path.join(root, 'workspaceStorage', 'workspace-1', 'session-control');
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
		const result = deriveChatSessionsPath(path.join('tmp', 'workspaceStorage', 'abc', 'session-control'));
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
			await copyFixture('v3-session.json', setup.sessionsDirectory);
			await copyFixture('jsonl-session.jsonl', setup.sessionsDirectory);
			await copyFixture('snapshot-session.jsonl', setup.sessionsDirectory);
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

			assert.equal(sessions.length, 5);
			assert.equal(sessions[0]?.id, 'session-snapshot');
			assert.equal(sessions[0]?.title, 'Snapshot patch session');
			assert.equal(sessions[0]?.turns.length, 2);
			assert.equal(sessions[0]?.turns[0]?.type, 'request');
			assert.equal((sessions[0]?.turns[0] as { prompt: string }).prompt, 'How do I fix the login bug?');
			assert.equal(sessions[0]?.turns[1]?.type, 'response');
			const responseTurn = sessions[0]?.turns[1] as { content: string; toolCalls: unknown[] };
			assert.ok(responseTurn.content.includes('null check'));
			assert.ok(responseTurn.content.includes('validated before use'));
			assert.equal(responseTurn.toolCalls.length, 1);
			assert.equal(sessions[1]?.id, 'session-v3');
			assert.equal(sessions[2]?.id, 'session-v2');
			assert.equal(sessions[3]?.id, 'session-jsonl');
			assert.equal(sessions[4]?.id, 'session-v1');
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
				'Unrecognized Copilot session format (VS Code 1.115.0). Session Control may need an update.',
			);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});

	test('skips unknown format files when other valid sessions exist', async () => {
		const errorMessages: string[] = [];
		const warnings: string[] = [];
		const setup = await setupWorkspaceStorageRoot();

		try {
			await copyFixture('v1-session.json', setup.sessionsDirectory);
			await copyFixture('unknown-format.json', setup.sessionsDirectory);

			const reader = createSessionReader({
				showInformationMessage: async () => undefined,
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
				},
				logWarning: (message: string) => {
					warnings.push(message);
				},
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
			// Valid session should still be returned; unknown-format file should be skipped
			assert.equal(sessions.length, 1);
			// No error popup shown because at least one session loaded OK
			assert.equal(errorMessages.length, 0);
			// Warning logged for the skipped file
			assert.ok(warnings.some((w) => w.includes('unknown-format.json')));
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});

	test('applies kind:1 scalar patches to resolve customTitle', async () => {
		const setup = await setupWorkspaceStorageRoot();

		try {
			// Simulate a session where customTitle starts null and is later patched via kind:1
			const snapshotRecord = {
				kind: 0,
				v: {
					version: 3,
					creationDate: 1776060000000,
					customTitle: null,
					sessionId: 'session-patch-title',
					initialLocation: 'panel',
					responderUsername: 'GitHub Copilot',
					requests: [
						{
							requestId: 'req-1',
							timestamp: 1776060001000,
							agent: { name: 'copilot' },
							modelId: 'copilot/auto',
							responseId: 'resp-1',
							contentReferences: [],
							message: { text: 'Hello', parts: [{ text: 'Hello', kind: 'text' }] },
							response: [{ value: 'Hi there.', supportThemeIcons: false, supportHtml: false }],
						},
					],
				},
			};
			const patchRecord = { kind: 1, k: ['customTitle'], v: 'My Patched Title' };
			const jsonl = [JSON.stringify(snapshotRecord), JSON.stringify(patchRecord)].join('\n');
			await fs.writeFile(
				path.join(setup.sessionsDirectory, 'patch-title-session.jsonl'),
				jsonl,
				'utf8',
			);

			const reader = createSessionReader({
				showInformationMessage: async () => undefined,
				showErrorMessage: async () => undefined,
				logWarning: () => undefined,
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.title, 'My Patched Title');
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});
});
