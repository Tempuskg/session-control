import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { registerAutoSaveOnChatResponseListener } from '../../src/extension';

/** Yield to the event loop so that void async IIFEs inside schedule callbacks complete. */
function drainAsyncWork(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeWatcher {
	onDidChange: (listener: () => void) => vscode.Disposable;
	onDidCreate: (listener: () => void) => vscode.Disposable;
	dispose: () => void;
	emitChange: () => void;
	emitCreate: () => void;
}

function createFakeWatcher(): FakeWatcher {
	let changeListener: (() => void) | undefined;
	let createListener: (() => void) | undefined;

	return {
		onDidChange: (listener: () => void) => {
			changeListener = listener;
			return { dispose: () => { changeListener = undefined; } };
		},
		onDidCreate: (listener: () => void) => {
			createListener = listener;
			return { dispose: () => { createListener = undefined; } };
		},
		dispose: () => {
			changeListener = undefined;
			createListener = undefined;
		},
		emitChange: () => changeListener?.(),
		emitCreate: () => createListener?.(),
	};
}

suite('extension auto-save on chat response', () => {
	test('returns undefined when no storage URI is available', () => {
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		const result = registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => undefined,
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getSaveProvider: () => 'copilot',
				getAutoSaveProviders: () => ['copilot'],
			},
		);

		assert.equal(result, undefined);
		assert.equal(outputLines.some((line) => line.includes('No watch targets available for providers copilot.')), true);
	});

	test('triggers save when chatSessions file changes and turn count increases', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ workspaceFolder: vscode.WorkspaceFolder; storageDirectory: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: () => watcher,
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getSaveProvider: () => 'copilot',
				getAutoSaveProviders: () => ['copilot'],
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [{
					provider: 'copilot',
					id: 'session-1',
					title: 'My Session',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'hello', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'copilot', content: 'hi', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'session-1.jsonl',
				}],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return 'saved-session.json';
				},
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'session-control');
		assert.equal(outputLines.some((line) => line.includes('My Session')), true);
	});

	test('skips save when turn count has not increased', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ workspaceFolder: vscode.WorkspaceFolder; storageDirectory: string }> = [];
		const subscriptions: vscode.Disposable[] = [];
		const turns = [
			{ type: 'request' as const, participant: 'user', prompt: 'hello', references: [] as string[], timestamp: new Date().toISOString() },
			{ type: 'response' as const, participant: 'copilot', content: 'hi', toolCalls: [] as Array<{ name: string }>, timestamp: new Date().toISOString() },
		];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: () => watcher,
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getSaveProvider: () => 'copilot',
				getAutoSaveProviders: () => ['copilot'],
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [{
					provider: 'copilot',
					id: 'session-1',
					title: 'My Session',
					lastMessageDate: new Date().toISOString(),
					turns,
					sourceFile: 'session-1.jsonl',
				}],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return 'saved-session.json';
				},
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		// First change: should save (new session)
		watcher.emitChange();
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);

		// Second change with same turn count: should skip
		watcher.emitChange();
		scheduledCallbacks[1]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1, 'Should not save again when turn count is unchanged');
	});

	test('deletes previous auto-save file when saving new version', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const deletedFiles: Array<{ storageDirectory: string; fileName: string }> = [];
		let saveCounter = 0;
		let turnCount = 2;
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: () => watcher,
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getSaveProvider: () => 'copilot',
				getAutoSaveProviders: () => ['copilot'],
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [{
					provider: 'copilot',
					id: 'session-1',
					title: 'My Session',
					lastMessageDate: new Date().toISOString(),
					turns: Array.from({ length: turnCount }, (_, i) => ({
						type: (i % 2 === 0 ? 'request' : 'response') as 'request' | 'response',
						participant: i % 2 === 0 ? 'user' : 'copilot',
						prompt: i % 2 === 0 ? 'hello' : undefined,
						content: i % 2 === 1 ? 'hi' : undefined,
						references: [] as string[],
						toolCalls: [] as Array<{ name: string }>,
						timestamp: new Date().toISOString(),
					})) as never[],
					sourceFile: 'session-1.jsonl',
				}],
				readCursorSessions: async () => [],
				saveSessionSilently: async () => {
					saveCounter++;
					return `saved-v${saveCounter}.json`;
				},
				deleteOldAutoSave: async (storageDirectory, fileName) => {
					deletedFiles.push({ storageDirectory, fileName });
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		// First save
		watcher.emitChange();
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCounter, 1);
		assert.equal(deletedFiles.length, 0, 'No previous file to delete on first save');

		// Second save with more turns
		turnCount = 4;
		watcher.emitChange();
		scheduledCallbacks[1]?.();
		await drainAsyncWork();
		assert.equal(saveCounter, 2);
		assert.equal(deletedFiles.length, 1);
		assert.equal(deletedFiles[0]?.fileName, 'saved-v1.json');
	});

	test('disables listener after save error', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const warnings: string[] = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: () => watcher,
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getSaveProvider: () => 'copilot',
				getAutoSaveProviders: () => ['copilot'],
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => {
					throw new Error('read failed');
				},
				readCursorSessions: async () => [],
				saveSessionSilently: async () => 'saved.json',
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async (message: string) => {
					warnings.push(message);
					return undefined;
				},
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		// First change triggers error
		watcher.emitChange();
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(warnings.some((msg) => msg.includes('disabled for this session')), true);
		assert.equal(outputLines.some((line) => line.includes('read failed')), true);

		// Second change should be ignored (disabled)
		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1, 'No new callback scheduled after disable');
	});

	test('triggers save when Cursor agent transcript changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ workspaceFolder: vscode.WorkspaceFolder; storageDirectory: string }> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					return watcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getSaveProvider: () => 'cursor',
				getAutoSaveProviders: () => ['cursor'],
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [],
				readCursorSessions: async () => [{
					provider: 'cursor',
					id: 'cursor-session-1',
					title: 'Implement Cursor auto-save',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'implement autosave', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'cursor', content: 'working on it', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'cursor-session-1',
				}],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return 'cursor-auto-save.json';
				},
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 1);
		assert.equal(watchedTargets[0]?.directory.replace(/\\/g, '/'), 'C:/Users/test/.cursor/projects/e-chat-commit');
		assert.equal(watchedTargets[0]?.glob, 'agent-transcripts/**/*.jsonl');

		watcher.emitCreate();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'chat-commit');
		assert.equal(outputLines.some((line) => line.includes('Implement Cursor auto-save')), true);
	});

	test('triggers save when Codex session transcript changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ workspaceFolder: vscode.WorkspaceFolder; storageDirectory: string }> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					return watcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getSaveProvider: () => 'codex',
				getAutoSaveProviders: () => ['codex'],
				getCodexHomePath: () => 'C:/Users/test/.codex',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [],
				readCodexSessions: async () => [{
					provider: 'codex',
					id: 'codex-session-1',
					title: 'Implement Codex auto-save',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'implement codex autosave', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'codex', content: 'working on it', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'codex-session-1',
					cwd: 'E:/chat-commit',
				}],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return 'codex-auto-save.json';
				},
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 1);
		assert.equal(watchedTargets[0]?.directory.replace(/\\/g, '/'), 'C:/Users/test/.codex');
		assert.equal(watchedTargets[0]?.glob, 'sessions/**/*.{json,jsonl}');

		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'chat-commit');
		assert.equal(outputLines.some((line) => line.includes('Implement Codex auto-save')), true);
	});

	test('triggers save when Claude Code session transcript changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ workspaceFolder: vscode.WorkspaceFolder; storageDirectory: string }> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					return watcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getSaveProvider: () => 'claude-code',
				getAutoSaveProviders: () => ['claude-code'],
				getCodexHomePath: () => 'C:/Users/test/.codex',
				getClaudeCodeHomePath: () => 'C:/Users/test/.claude',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [],
				readCodexSessions: async () => [],
				readClaudeCodeSessions: async () => [{
					provider: 'claude-code',
					id: 'claude-session-1',
					title: 'Implement Claude Code auto-save',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'implement claude autosave', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'claude-code', content: 'working on it', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'claude-session-1',
					cwd: 'E:/chat-commit',
				}],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return 'claude-auto-save.json';
				},
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 1);
		assert.equal(watchedTargets[0]?.directory.replace(/\\/g, '/'), 'C:/Users/test/.claude/projects/e--chat-commit');
		assert.equal(watchedTargets[0]?.glob, '*.jsonl');

		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'chat-commit');
		assert.equal(outputLines.some((line) => line.includes('Implement Claude Code auto-save')), true);
	});

	test('watches Copilot, Codex, and Claude Code when no provider override is set', async () => {
		const copilotWatcher = createFakeWatcher();
		const codexWatcher = createFakeWatcher();
		const claudeWatcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ provider: string; title: string }> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => ({ fsPath: 'e:/storage/workspace-id' }),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					if (glob === '*.{json,jsonl}') {
						return copilotWatcher;
					}
					return glob === '*.jsonl' ? claudeWatcher : codexWatcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getSaveProvider: () => 'copilot',
				getAutoSaveProviders: () => ['copilot', 'codex', 'claude-code'],
				getCodexHomePath: () => 'C:/Users/test/.codex',
				getClaudeCodeHomePath: () => 'C:/Users/test/.claude',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [{
					provider: 'copilot',
					id: 'copilot-session-1',
					title: 'Copilot session',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'copilot prompt', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'copilot', content: 'copilot response', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'copilot-session-1.jsonl',
				}],
				readCodexSessions: async () => [{
					provider: 'codex',
					id: 'codex-session-1',
					title: 'Codex session',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'codex prompt', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'codex', content: 'codex response', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'codex-session-1',
					cwd: 'E:/chat-commit',
				}],
				readClaudeCodeSessions: async () => [{
					provider: 'claude-code',
					id: 'claude-session-1',
					title: 'Claude Code session',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'claude prompt', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'claude-code', content: 'claude response', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'claude-session-1',
					cwd: 'E:/chat-commit',
				}],
				readCursorSessions: async () => [],
				saveSessionSilently: async (_workspaceFolder, _storageDirectory, provider, sessions) => {
					saveCalls.push({ provider, title: sessions[0]?.title ?? '' });
					return `${provider}-auto-save.json`;
				},
				deleteOldAutoSave: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 3);
		assert.equal(watchedTargets[0]?.glob, '*.{json,jsonl}');
		assert.equal(watchedTargets[1]?.glob, 'sessions/**/*.{json,jsonl}');
		assert.equal(watchedTargets[2]?.glob, '*.jsonl');

		copilotWatcher.emitChange();
		codexWatcher.emitChange();
		claudeWatcher.emitChange();
		assert.equal(scheduledCallbacks.length, 3);

		scheduledCallbacks[0]?.();
		scheduledCallbacks[1]?.();
		scheduledCallbacks[2]?.();
		await drainAsyncWork();

		assert.deepEqual(saveCalls, [
			{ provider: 'copilot', title: 'Copilot session' },
			{ provider: 'codex', title: 'Codex session' },
			{ provider: 'claude-code', title: 'Claude Code session' },
		]);
	});
});
