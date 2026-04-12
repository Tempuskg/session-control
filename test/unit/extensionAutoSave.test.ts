import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { registerAutoSaveOnCommitListener } from '../../src/extension';

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
