import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	type AutoSaveToggleCommandDeps,
	ENABLE_AUTO_SAVE_WITH_GITIGNORE,
	ENABLE_AUTO_SAVE_WITHOUT_GITIGNORE,
	runToggleAutoSaveCommand,
} from '../../src/extension';

interface ConfigurationUpdate {
	section: string;
	target: vscode.ConfigurationTarget;
	value: unknown;
}

interface AutoSavePrivacyHarness {
	deps: AutoSaveToggleCommandDeps;
	errors: string[];
	gitignoreCalls: Array<{
		storageDirectory: string;
		workspaceFolder: vscode.WorkspaceFolder;
	}>;
	informationMessages: string[];
	notifications: () => number;
	updates: ConfigurationUpdate[];
	warning: {
		choices: string[];
		message: string;
		options: vscode.MessageOptions;
	};
}

function createWorkspaceFolder(rootPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name: 'privacy-repo',
		index: 0,
	};
}

function createAutoSavePrivacyHarness(options: {
	enabled?: boolean;
	gitignoreAdded?: boolean;
	warningChoice?: string;
} = {}): AutoSavePrivacyHarness {
	const workspaceFolder = createWorkspaceFolder('E:/privacy-repo');
	const storageDirectory = path.join(workspaceFolder.uri.fsPath, '.chat');
	const updates: ConfigurationUpdate[] = [];
	const gitignoreCalls: AutoSavePrivacyHarness['gitignoreCalls'] = [];
	const informationMessages: string[] = [];
	const errors: string[] = [];
	let enabled = options.enabled ?? false;
	let notificationCount = 0;
	const warning = {
		choices: [] as string[],
		message: '',
		options: {} as vscode.MessageOptions,
	};

	return {
		deps: {
			resolveWorkspaceFolder: async () => workspaceFolder,
			getConfiguration: () => ({
				get: <T>(section: string, defaultValue: T): T => {
					if (section === 'autoSaveOnChatResponse') {
						return enabled as T;
					}
					return defaultValue;
				},
				update: async (section, value, target) => {
					updates.push({ section, value, target });
					if (section === 'autoSaveOnChatResponse') {
						enabled = value as boolean;
					}
				},
			}),
			getStoragePath: () => storageDirectory,
			ensureStoragePathInGitignore: async (receivedWorkspace, receivedStorage) => {
				gitignoreCalls.push({
					workspaceFolder: receivedWorkspace,
					storageDirectory: receivedStorage,
				});
				return options.gitignoreAdded ?? true;
			},
			showInformationMessage: async (message) => {
				informationMessages.push(message);
			},
			showWarningMessage: async (message, messageOptions, ...items) => {
				warning.message = message;
				warning.options = messageOptions;
				warning.choices = items;
				return options.warningChoice;
			},
			showErrorMessage: async (message) => {
				errors.push(message);
			},
			onDidChange: () => {
				notificationCount += 1;
			},
		},
		errors,
		gitignoreCalls,
		informationMessages,
		notifications: () => notificationCount,
		updates,
		warning,
	};
}

suite('extension auto-save privacy choices', () => {
	test('keeps the first-run manifest default disabled', async () => {
		const manifestPath = path.resolve(
			__dirname,
			'..',
			'..',
			'..',
			'package.json',
		);
		const manifest = JSON.parse(
			await fs.readFile(manifestPath, 'utf8'),
		) as {
			contributes?: {
				configuration?: {
					properties?: Record<string, { default?: unknown }>;
				};
			};
		};

		assert.equal(
			manifest.contributes?.configuration?.properties
				?.['session-control.autoSaveOnChatResponse']?.default,
			false,
		);
	});

	test('explains sensitive storage and leaves auto-save off when enabling is cancelled', async () => {
		const harness = createAutoSavePrivacyHarness();

		await runToggleAutoSaveCommand(harness.deps);

		assert.equal(harness.warning.options.modal, true);
		assert.match(harness.warning.message, /Saved prompts/);
		assert.match(harness.warning.message, /workspace paths/);
		assert.match(harness.warning.message, /file content/);
		assert.match(harness.warning.message, /tool output/);
		assert.match(harness.warning.message, /\.chat\//);
		assert.deepEqual(harness.warning.choices, [
			ENABLE_AUTO_SAVE_WITH_GITIGNORE,
			ENABLE_AUTO_SAVE_WITHOUT_GITIGNORE,
		]);
		assert.deepEqual(harness.updates, []);
		assert.deepEqual(harness.gitignoreCalls, []);
		assert.equal(harness.notifications(), 0);
	});

	test('adds the configured storage folder to gitignore before enabling when chosen', async () => {
		const harness = createAutoSavePrivacyHarness({
			warningChoice: ENABLE_AUTO_SAVE_WITH_GITIGNORE,
		});

		await runToggleAutoSaveCommand(harness.deps);

		assert.equal(harness.gitignoreCalls.length, 1);
		assert.match(
			harness.gitignoreCalls[0]?.storageDirectory ?? '',
			/[\\/]\.chat$/,
		);
		assert.deepEqual(harness.updates, [
			{
				section: 'includeInGitignore',
				value: true,
				target: vscode.ConfigurationTarget.WorkspaceFolder,
			},
			{
				section: 'autoSaveOnChatResponse',
				value: true,
				target: vscode.ConfigurationTarget.WorkspaceFolder,
			},
		]);
		assert.equal(harness.notifications(), 1);
		assert.equal(harness.errors.length, 0);
		assert.match(harness.informationMessages[0] ?? '', /was added to .gitignore/);
	});

	test('keeps the configured storage folder trackable when chosen', async () => {
		const harness = createAutoSavePrivacyHarness({
			warningChoice: ENABLE_AUTO_SAVE_WITHOUT_GITIGNORE,
		});

		await runToggleAutoSaveCommand(harness.deps);

		assert.deepEqual(harness.gitignoreCalls, []);
		assert.deepEqual(harness.updates, [
			{
				section: 'includeInGitignore',
				value: false,
				target: vscode.ConfigurationTarget.WorkspaceFolder,
			},
			{
				section: 'autoSaveOnChatResponse',
				value: true,
				target: vscode.ConfigurationTarget.WorkspaceFolder,
			},
		]);
		assert.equal(harness.notifications(), 1);
		assert.equal(harness.errors.length, 0);
		assert.match(harness.informationMessages[0] ?? '', /may be tracked by git/);
	});

	test('disables an enabled workspace without showing the enable warning', async () => {
		const harness = createAutoSavePrivacyHarness({
			enabled: true,
		});

		await runToggleAutoSaveCommand(harness.deps);

		assert.equal(harness.warning.message, '');
		assert.deepEqual(harness.updates, [{
			section: 'autoSaveOnChatResponse',
			value: false,
			target: vscode.ConfigurationTarget.WorkspaceFolder,
		}]);
		assert.equal(harness.notifications(), 1);
	});
});
