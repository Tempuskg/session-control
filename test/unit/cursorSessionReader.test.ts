import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	createCursorSessionReader,
	deriveCursorChatSessionsPath,
	deriveCursorWorkspaceStorageRoot,
	resolveCursorWorkspaceStoragePath,
} from '../../src/cursorSessionReader';
import { deriveCursorAgentTranscriptsPath, deriveCursorProjectSlug } from '../../src/cursorAgentTranscriptReader';

async function setupCursorWorkspace(repoPath: string): Promise<{
	root: string;
	cursorUserDataPath: string;
	workspaceStoragePath: string;
	chatSessionsDirectory: string;
}> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-reader-'));
	const cursorUserDataPath = path.join(root, 'Cursor', 'User');
	const workspaceHash = 'workspace-hash-1';
	const workspaceStoragePath = path.join(cursorUserDataPath, 'workspaceStorage', workspaceHash);
	const chatSessionsDirectory = deriveCursorChatSessionsPath(workspaceStoragePath);

	await fs.mkdir(chatSessionsDirectory, { recursive: true });
	await fs.writeFile(
		path.join(workspaceStoragePath, 'workspace.json'),
		JSON.stringify({ folder: vscode.Uri.file(repoPath).toString() }),
		'utf8',
	);

	return {
		root,
		cursorUserDataPath,
		workspaceStoragePath,
		chatSessionsDirectory,
	};
}

async function copyFixture(fixtureName: string, destinationDirectory: string): Promise<void> {
	const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
	const fixturePath = path.join(repositoryRoot, 'test', 'fixtures', 'session-reader', fixtureName);
	await fs.copyFile(fixturePath, path.join(destinationDirectory, fixtureName));
}

function createWorkspaceFolder(repoPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(repoPath),
		name: path.basename(repoPath),
		index: 0,
	};
}

async function copyAgentFixture(fixtureName: string, destinationPath: string): Promise<void> {
	const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
	const fixturePath = path.join(repositoryRoot, 'test', 'fixtures', 'cursor-agent-transcript', fixtureName);
	await fs.copyFile(fixturePath, destinationPath);
}

function createReaderOptions(setup: { root: string; cursorUserDataPath: string }): {
	cursorUserDataPath: string;
	cursorProjectsPath: string;
} {
	return {
		cursorUserDataPath: setup.cursorUserDataPath,
		cursorProjectsPath: path.join(setup.root, '.cursor', 'projects'),
	};
}

function emptyAgentTranscriptMessage(repoName: string): string {
	return `No Cursor agent transcripts found for ${repoName}. Open this project in Cursor and start an Agent chat first.`;
}

suite('cursorSessionReader', () => {
	test('deriveCursorWorkspaceStorageRoot and deriveCursorChatSessionsPath build expected paths', () => {
		const userDataPath = path.join('tmp', 'Cursor', 'User');
		const workspaceStorageRoot = deriveCursorWorkspaceStorageRoot(userDataPath);
		const chatSessionsPath = deriveCursorChatSessionsPath(path.join(workspaceStorageRoot, 'hash-1'));

		assert.equal(workspaceStorageRoot.endsWith(path.join('Cursor', 'User', 'workspaceStorage')), true);
		assert.equal(chatSessionsPath.endsWith(path.join('workspaceStorage', 'hash-1', 'chatSessions')), true);
	});

	test('resolveCursorWorkspaceStoragePath matches workspace.json folder URI', async () => {
		const repoPath = path.join(os.tmpdir(), `session-control-cursor-match-${Date.now()}`);
		await fs.mkdir(repoPath, { recursive: true });
		const setup = await setupCursorWorkspace(repoPath);

		try {
			const resolved = await resolveCursorWorkspaceStoragePath(repoPath, setup.cursorUserDataPath, {
				readDir: async (directoryPath: string) => {
					const entries = await fs.readdir(directoryPath, { withFileTypes: true });
					return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
				},
				readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
			});

			assert.equal(resolved, setup.workspaceStoragePath);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
			await fs.rm(repoPath, { recursive: true, force: true });
		}
	});

	test('reads Cursor JSONL sessions, sorts by recency, and skips corrupt files', async () => {
		const warnings: string[] = [];
		const infoMessages: string[] = [];
		const repoPath = path.join(os.tmpdir(), `session-control-cursor-read-${Date.now()}`);
		await fs.mkdir(repoPath, { recursive: true });
		const setup = await setupCursorWorkspace(repoPath);

		try {
			await copyFixture('snapshot-session.jsonl', setup.chatSessionsDirectory);
			await copyFixture('v1-session.json', setup.chatSessionsDirectory);
			await fs.writeFile(path.join(setup.chatSessionsDirectory, 'corrupt-session.jsonl'), '{not-json', 'utf8');

			const reader = createCursorSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				logWarning: (message: string) => {
					warnings.push(message);
				},
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCursorSessions(
				createWorkspaceFolder(repoPath),
				createReaderOptions(setup),
			);

			assert.equal(sessions.length, 2);
			assert.equal(sessions[0]?.provider, 'cursor');
			assert.equal(sessions[0]?.id, 'session-snapshot');
			assert.equal(sessions[0]?.title, 'Snapshot patch session');
			assert.equal(sessions[0]?.turns.length, 2);
			assert.equal(sessions[1]?.provider, 'cursor');
			assert.equal(warnings.some((message) => message.includes('corrupt-session.jsonl')), true);
			assert.equal(infoMessages.length, 0);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
			await fs.rm(repoPath, { recursive: true, force: true });
		}
	});

	test('skips empty snapshot sessions without treating them as unknown format', async () => {
		const warnings: string[] = [];
		const infoMessages: string[] = [];
		const repoPath = path.join(os.tmpdir(), `session-control-cursor-empty-${Date.now()}`);
		await fs.mkdir(repoPath, { recursive: true });
		const setup = await setupCursorWorkspace(repoPath);

		try {
			await copyFixture('empty-snapshot-session.jsonl', setup.chatSessionsDirectory);

			const reader = createCursorSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				logWarning: (message: string) => {
					warnings.push(message);
				},
				vscodeVersion: '1.117.0',
			});

			const sessions = await reader.readCursorSessions(
				createWorkspaceFolder(repoPath),
				createReaderOptions(setup),
			);

			assert.equal(sessions.length, 0);
			assert.ok(warnings.some((message) => message.includes('empty-snapshot-session.jsonl')));
			assert.equal(infoMessages[0], emptyAgentTranscriptMessage(path.basename(repoPath)));
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
			await fs.rm(repoPath, { recursive: true, force: true });
		}
	});

	test('reads Cursor Agent transcript sessions from the matching projects slug', async () => {
		const repoPath = path.join(os.tmpdir(), `session-control-cursor-agent-${Date.now()}`);
		await fs.mkdir(repoPath, { recursive: true });
		const setup = await setupCursorWorkspace(repoPath);
		const sessionId = 'agent-session-primary';
		const projectSlug = deriveCursorProjectSlug(repoPath);
		const transcriptDirectory = path.join(
			deriveCursorAgentTranscriptsPath(path.join(setup.root, '.cursor', 'projects'), projectSlug),
			sessionId,
		);

		try {
			await fs.mkdir(transcriptDirectory, { recursive: true });
			await copyAgentFixture('sample-agent-session.jsonl', path.join(transcriptDirectory, `${sessionId}.jsonl`));

			const reader = createCursorSessionReader({
				showInformationMessage: async () => undefined,
				logWarning: () => undefined,
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCursorSessions(
				createWorkspaceFolder(repoPath),
				createReaderOptions(setup),
			);

			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.id, sessionId);
			assert.equal(sessions[0]?.title, 'Add Cursor session import support');
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
			await fs.rm(repoPath, { recursive: true, force: true });
		}
	});

	test('returns empty and shows an info message when no Cursor sessions are available', async () => {
		const infoMessages: string[] = [];
		const repoPath = path.join(os.tmpdir(), `session-control-cursor-missing-${Date.now()}`);
		await fs.mkdir(repoPath, { recursive: true });
		const otherRepoPath = path.join(os.tmpdir(), `session-control-cursor-other-${Date.now()}`);
		await fs.mkdir(otherRepoPath, { recursive: true });
		const setup = await setupCursorWorkspace(otherRepoPath);

		try {
			const reader = createCursorSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				logWarning: () => undefined,
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCursorSessions(
				createWorkspaceFolder(repoPath),
				createReaderOptions(setup),
			);

			assert.equal(sessions.length, 0);
			assert.equal(infoMessages[0], emptyAgentTranscriptMessage(path.basename(repoPath)));
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
			await fs.rm(repoPath, { recursive: true, force: true });
		}
	});

	test('returns empty when neither agent transcripts nor workspace chatSessions are available', async () => {
		const infoMessages: string[] = [];
		const repoPath = path.join(os.tmpdir(), `session-control-cursor-no-sessions-${Date.now()}`);
		await fs.mkdir(repoPath, { recursive: true });
		const setup = await setupCursorWorkspace(repoPath);

		try {
			await fs.rm(setup.chatSessionsDirectory, { recursive: true, force: true });

			const reader = createCursorSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				logWarning: () => undefined,
				vscodeVersion: '1.115.0',
			});

			const sessions = await reader.readCursorSessions(
				createWorkspaceFolder(repoPath),
				createReaderOptions(setup),
			);

			assert.equal(sessions.length, 0);
			assert.equal(infoMessages[0], emptyAgentTranscriptMessage(path.basename(repoPath)));
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
			await fs.rm(repoPath, { recursive: true, force: true });
		}
	});
});
