import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { loadSessionsForProvider } from '../../src/extension';
import { type SessionProviderId, type SourceChatSession } from '../../src/types';

const WORKSPACE_PATH = 'E:\\chat-commit';
const SESSION_TIMESTAMP = '2026-07-30T12:00:00.000Z';

function createSourceSession<TProvider extends SessionProviderId>(
	provider: TProvider,
	id: string,
	cwd?: string,
): SourceChatSession & { provider: TProvider; sourceRevision: string } {
	return {
		provider,
		id,
		title: `${provider} ${id}`,
		lastMessageDate: SESSION_TIMESTAMP,
		turns: [{
			type: 'request',
			participant: 'user',
			prompt: `Import ${id}`,
			references: [],
			timestamp: SESSION_TIMESTAMP,
		}],
		sourceFile: `${id}.jsonl`,
		sourceRevision: `sha256:${id}`,
		...(cwd ? { cwd } : {}),
	};
}

function createWorkspaceFolder(): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(WORKSPACE_PATH),
		name: 'chat-commit',
		index: 0,
	};
}

suite('extension manual provider imports', () => {
	test('keeps Copilot workspace sessions available for interactive selection', async () => {
		const context = {} as vscode.ExtensionContext;
		const workspaceFolder = createWorkspaceFolder();
		const copilotSession = createSourceSession('copilot', 'copilot-session');
		let receivedContext: vscode.ExtensionContext | undefined;

		const sessions = await loadSessionsForProvider(
			context,
			workspaceFolder,
			'copilot',
			{
				readCopilotSessions: async (actualContext) => {
					receivedContext = actualContext;
					return [copilotSession];
				},
			},
		);

		assert.equal(receivedContext, context);
		assert.deepEqual(sessions, [copilotSession]);
	});

	test('keeps ambiguous Codex sessions available for interactive selection', async () => {
		const workspaceFolder = createWorkspaceFolder();
		const codexHomePath = 'C:\\Users\\test\\.codex';
		const codexSessions = [
			createSourceSession('codex', 'codex-session-1'),
			createSourceSession('codex', 'codex-session-2'),
		];
		let receivedHomePath: string | undefined;

		const sessions = await loadSessionsForProvider(
			{} as vscode.ExtensionContext,
			workspaceFolder,
			'codex',
			{
				getCodexHomePath: () => codexHomePath,
				readCodexSessions: async (actualHomePath) => {
					receivedHomePath = actualHomePath;
					return codexSessions;
				},
			},
		);

		assert.equal(receivedHomePath, codexHomePath);
		assert.deepEqual(sessions, codexSessions);
	});

	test('keeps ambiguous Claude Code sessions available for interactive selection', async () => {
		const workspaceFolder = createWorkspaceFolder();
		const claudeCodeHomePath = 'C:\\Users\\test\\.claude';
		const claudeCodeSessions = [
			createSourceSession('claude-code', 'claude-session-1'),
			createSourceSession('claude-code', 'claude-session-2'),
		];
		let receivedHomePath: string | undefined;
		let receivedWorkspacePath: string | undefined;

		const sessions = await loadSessionsForProvider(
			{} as vscode.ExtensionContext,
			workspaceFolder,
			'claude-code',
			{
				getClaudeCodeHomePath: () => claudeCodeHomePath,
				readClaudeCodeSessions: async (actualHomePath, actualWorkspacePath) => {
					receivedHomePath = actualHomePath;
					receivedWorkspacePath = actualWorkspacePath;
					return claudeCodeSessions;
				},
			},
		);

		assert.equal(receivedHomePath, claudeCodeHomePath);
		assert.equal(receivedWorkspacePath, workspaceFolder.uri.fsPath);
		assert.deepEqual(sessions, claudeCodeSessions);
	});

	test('keeps Cursor CLI and IDE legacy sessions available for interactive selection', async () => {
		const context = {} as vscode.ExtensionContext;
		const workspaceFolder = createWorkspaceFolder();
		const cursorUserDataPath = 'C:\\Users\\test\\AppData\\Roaming\\Cursor\\User';
		const cursorProjectsPath = 'C:\\Users\\test\\.cursor\\projects';
		const cursorSessions = [
			createSourceSession('cursor', 'cursor-cli-session', WORKSPACE_PATH),
			createSourceSession('cursor', 'cursor-ide-legacy-session'),
		];
		let receivedWorkspaceFolder: vscode.WorkspaceFolder | undefined;
		let receivedUserDataPath: string | undefined;
		let receivedContext: vscode.ExtensionContext | undefined;
		let receivedProjectsPath: string | undefined;

		const sessions = await loadSessionsForProvider(
			context,
			workspaceFolder,
			'cursor',
			{
				getCursorUserDataPath: () => cursorUserDataPath,
				getCursorProjectsPath: () => cursorProjectsPath,
				readCursorSessions: async (
					actualWorkspaceFolder,
					actualUserDataPath,
					actualContext,
					actualProjectsPath,
				) => {
					receivedWorkspaceFolder = actualWorkspaceFolder;
					receivedUserDataPath = actualUserDataPath;
					receivedContext = actualContext;
					receivedProjectsPath = actualProjectsPath;
					return cursorSessions;
				},
			},
		);

		assert.equal(receivedWorkspaceFolder, workspaceFolder);
		assert.equal(receivedUserDataPath, cursorUserDataPath);
		assert.equal(receivedContext, context);
		assert.equal(receivedProjectsPath, cursorProjectsPath);
		assert.deepEqual(sessions, cursorSessions);
	});
});
