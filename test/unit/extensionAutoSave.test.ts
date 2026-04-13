import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { registerAutoSaveOnCommitListener, registerAutoSaveOnChatResponseListener } from '../../src/extension';

/** Yield to the event loop so that void async IIFEs inside schedule callbacks complete. */
function drainAsyncWork(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeRepository {
	rootUri: vscode.Uri;
	state: {
		HEAD?: { commit?: string };
		onDidChange: (listener: () => void) => vscode.Disposable;
	};
	emit: () => void;
	isDisposed: () => boolean;
}

function createFakeRepository(initialCommit: string): FakeRepository {
	let listener: (() => void) | undefined;
	let disposed = false;

	return {
		rootUri: vscode.Uri.file('e:/session-control'),
		state: {
			HEAD: { commit: initialCommit },
			onDidChange: (nextListener: () => void) => {
				listener = nextListener;
				return {
					dispose: () => {
						disposed = true;
					},
				};
			},
		},
		emit: () => {
			listener?.();
		},
		isDisposed: () => disposed,
	};
}

suite('extension auto-save', () => {
	test('registerAutoSaveOnCommitListener triggers save flow when commit changes', async () => {
		const repository = createFakeRepository('commit-1');
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ storageDirectory: string; workspaceFolder: vscode.WorkspaceFolder }> = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnCommitListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				getGitApi: () => ({ repositories: [repository] }),
				getWorkspaceFolder: (uri: vscode.Uri) => ({ uri, name: 'repo', index: 0 }),
				runSaveSessionFlow: async (_context, workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return 'saved.json';
				},
				showInformationMessage: async () => undefined,
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		repository.state.HEAD = { commit: 'commit-2' };
		repository.emit();
		assert.equal(scheduledCallbacks.length, 1);

		await scheduledCallbacks[0]?.();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'repo');
		assert.equal(saveCalls[0]?.storageDirectory.endsWith('.chat'), true);
	});

	test('registerAutoSaveOnCommitListener disables repo listener after save error', async () => {
		const repository = createFakeRepository('commit-1');
		const scheduledCallbacks: Array<() => void> = [];
		const warnings: string[] = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnCommitListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: (value: string) => outputLines.push(value) } as unknown as vscode.OutputChannel,
			{
				getGitApi: () => ({ repositories: [repository] }),
				getWorkspaceFolder: (uri: vscode.Uri) => ({ uri, name: 'repo', index: 0 }),
				runSaveSessionFlow: async () => {
					throw new Error('save failed');
				},
				showInformationMessage: async () => undefined,
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

		repository.state.HEAD = { commit: 'commit-2' };
		repository.emit();
		await scheduledCallbacks[0]?.();
		assert.equal(repository.isDisposed(), true);
		assert.equal(warnings.some((message) => message.includes('disabled for this session')), true);
		assert.equal(outputLines.some((line) => line.includes('save failed')), true);
	});
});

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
			},
		);

		assert.equal(result, undefined);
		assert.equal(outputLines.some((line) => line.includes('No workspace storage')), true);
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
				readCopilotSessions: async () => [{
					id: 'session-1',
					title: 'My Session',
					lastMessageDate: new Date().toISOString(),
					turns: [
						{ type: 'request', participant: 'user', prompt: 'hello', references: [], timestamp: new Date().toISOString() },
						{ type: 'response', participant: 'copilot', content: 'hi', toolCalls: [], timestamp: new Date().toISOString() },
					],
					sourceFile: 'session-1.jsonl',
				}],
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
				readCopilotSessions: async () => [{
					id: 'session-1',
					title: 'My Session',
					lastMessageDate: new Date().toISOString(),
					turns,
					sourceFile: 'session-1.jsonl',
				}],
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
				readCopilotSessions: async () => [{
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
				readCopilotSessions: async () => {
					throw new Error('read failed');
				},
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
});
