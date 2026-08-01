import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	type AutoSaveConfigurationMigrationConfiguration,
	type AutoSaveConfigurationMigrationState,
	LEGACY_AUTO_SAVE_PROVIDER_MIGRATION_STATE_KEY,
	migrateLegacyAutoSaveProviderSettings,
} from '../../src/autoSaveConfigurationMigration';

interface ConfigurationInspection<T> {
	globalValue?: T;
	workspaceValue?: T;
	workspaceFolderValue?: T;
}

interface ConfigurationUpdate {
	section: string;
	target: vscode.ConfigurationTarget;
	value: unknown;
}

function createWorkspaceFolder(rootPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name: 'workspace',
		index: 0,
	};
}

function createMigrationHarness(options: {
	enabled: boolean;
	legacy: ConfigurationInspection<unknown>;
	providers?: ConfigurationInspection<unknown>;
}) {
	let providers = options.providers;
	const updates: ConfigurationUpdate[] = [];
	let storedState: string[] | undefined;
	const configuration: AutoSaveConfigurationMigrationConfiguration = {
		get: <T>(section: string, defaultValue: T): T => {
			if (section === 'autoSaveOnChatResponse') {
				return options.enabled as T;
			}
			return defaultValue;
		},
		inspect: <T>(section: string): ConfigurationInspection<T> | undefined => {
			if (section === 'save.provider') {
				return options.legacy as ConfigurationInspection<T>;
			}
			if (section === 'autoSave.providers') {
				return providers as ConfigurationInspection<T> | undefined;
			}
			return undefined;
		},
		update: async (section, value, target) => {
			updates.push({ section, value, target });
			if (section !== 'autoSave.providers') {
				return;
			}

			if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
				providers = { workspaceFolderValue: value };
			} else if (target === vscode.ConfigurationTarget.Workspace) {
				providers = { workspaceValue: value };
			} else {
				providers = { globalValue: value };
			}
		},
	};
	const state: AutoSaveConfigurationMigrationState = {
		get: <T>(_key: string, defaultValue: T): T =>
			(storedState ?? defaultValue) as T,
		update: async (key, value) => {
			assert.equal(key, LEGACY_AUTO_SAVE_PROVIDER_MIGRATION_STATE_KEY);
			storedState = value as string[];
		},
	};

	return {
		configuration,
		state,
		updates,
		clearProviders: () => {
			providers = undefined;
		},
	};
}

suite('legacy auto-save provider configuration migration', () => {
	test('migrates an enabled workspace-folder override at most once', async () => {
		const workspaceFolder = createWorkspaceFolder('E:/repo');
		const harness = createMigrationHarness({
			enabled: true,
			legacy: { workspaceFolderValue: 'codex' },
		});
		const deps = {
			workspaceFolders: [workspaceFolder],
			workspaceKey: workspaceFolder.uri.toString(),
			getConfiguration: () => harness.configuration,
			state: harness.state,
		};

		const first = await migrateLegacyAutoSaveProviderSettings(deps);
		harness.clearProviders();
		const second = await migrateLegacyAutoSaveProviderSettings(deps);

		assert.deepEqual(first, [{
			provider: 'codex',
			scope: 'workspace-folder',
			workspaceFolder: workspaceFolder.uri.toString(),
		}]);
		assert.deepEqual(second, []);
		assert.deepEqual(harness.updates, [{
			section: 'autoSave.providers',
			value: ['codex'],
			target: vscode.ConfigurationTarget.WorkspaceFolder,
		}]);
	});

	test('does not overwrite an explicit provider array or revive the legacy source later', async () => {
		const workspaceFolder = createWorkspaceFolder('E:/repo');
		const harness = createMigrationHarness({
			enabled: true,
			legacy: { workspaceFolderValue: 'cursor' },
			providers: { globalValue: ['copilot', 'claude-code'] },
		});
		const deps = {
			workspaceFolders: [workspaceFolder],
			workspaceKey: workspaceFolder.uri.toString(),
			getConfiguration: () => harness.configuration,
			state: harness.state,
		};

		assert.deepEqual(await migrateLegacyAutoSaveProviderSettings(deps), []);
		harness.clearProviders();
		assert.deepEqual(await migrateLegacyAutoSaveProviderSettings(deps), []);
		assert.deepEqual(harness.updates, []);
	});

	test('does not migrate or enable a workspace whose auto-save switch is off', async () => {
		const workspaceFolder = createWorkspaceFolder('E:/repo');
		const harness = createMigrationHarness({
			enabled: false,
			legacy: { globalValue: 'claude-code' },
		});

		assert.deepEqual(
			await migrateLegacyAutoSaveProviderSettings({
				workspaceFolders: [workspaceFolder],
				workspaceKey: workspaceFolder.uri.toString(),
				getConfiguration: () => harness.configuration,
				state: harness.state,
			}),
			[],
		);
		assert.deepEqual(harness.updates, []);
	});
});
