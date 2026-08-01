import * as vscode from 'vscode';
import {
	isSessionProviderId,
	type SessionProviderId,
} from './types';

export const LEGACY_AUTO_SAVE_PROVIDER_MIGRATION_STATE_KEY =
	'autoSaveProviders.legacySaveProviderMigration.v1';

interface ConfigurationInspection<T> {
	globalValue?: T;
	workspaceValue?: T;
	workspaceFolderValue?: T;
}

export interface AutoSaveConfigurationMigrationConfiguration {
	get<T>(section: string, defaultValue: T): T;
	inspect<T>(section: string): ConfigurationInspection<T> | undefined;
	update(
		section: string,
		value: unknown,
		target: vscode.ConfigurationTarget,
	): PromiseLike<void>;
}

export interface AutoSaveConfigurationMigrationState {
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: unknown): PromiseLike<void>;
}

export interface AutoSaveConfigurationMigrationDeps {
	workspaceFolders: readonly vscode.WorkspaceFolder[];
	workspaceKey: string;
	getConfiguration: (
		workspaceFolder: vscode.WorkspaceFolder,
	) => AutoSaveConfigurationMigrationConfiguration;
	state: AutoSaveConfigurationMigrationState;
}

export interface LegacyAutoSaveProviderMigration {
	provider: SessionProviderId;
	scope: 'global' | 'workspace' | 'workspace-folder';
	workspaceFolder: string;
}

interface LegacyProviderSetting {
	provider: SessionProviderId;
	scope: LegacyAutoSaveProviderMigration['scope'];
	scopeKey: string;
	target: vscode.ConfigurationTarget;
}

function hasExplicitAutoSaveProvidersAtOrBelowScope(
	configuration: AutoSaveConfigurationMigrationConfiguration,
	scope: LegacyAutoSaveProviderMigration['scope'],
): boolean {
	const inspected = configuration.inspect<unknown>('autoSave.providers');
	if (!inspected) {
		return false;
	}

	if (inspected.globalValue !== undefined) {
		return true;
	}
	if (
		scope !== 'global'
		&& inspected.workspaceValue !== undefined
	) {
		return true;
	}
	return scope === 'workspace-folder'
		&& inspected.workspaceFolderValue !== undefined;
}

function resolveLegacyProviderSetting(
	configuration: AutoSaveConfigurationMigrationConfiguration,
	workspaceFolder: vscode.WorkspaceFolder,
	workspaceKey: string,
): LegacyProviderSetting | undefined {
	const inspected = configuration.inspect<unknown>('save.provider');
	if (!inspected) {
		return undefined;
	}

	const explicitSettings: readonly {
		value: unknown;
		scope: LegacyAutoSaveProviderMigration['scope'];
		scopeKey: string;
		target: vscode.ConfigurationTarget;
	}[] = [
		{
			value: inspected.workspaceFolderValue,
			scope: 'workspace-folder',
			scopeKey: `workspace-folder:${workspaceFolder.uri.toString()}`,
			target: vscode.ConfigurationTarget.WorkspaceFolder,
		},
		{
			value: inspected.workspaceValue,
			scope: 'workspace',
			scopeKey: `workspace:${workspaceKey}`,
			target: vscode.ConfigurationTarget.Workspace,
		},
		{
			value: inspected.globalValue,
			scope: 'global',
			scopeKey: 'global',
			target: vscode.ConfigurationTarget.Global,
		},
	];

	for (const explicitSetting of explicitSettings) {
		if (explicitSetting.value === undefined) {
			continue;
		}

		if (!isSessionProviderId(explicitSetting.value)) {
			return undefined;
		}

		return {
			provider: explicitSetting.value,
			scope: explicitSetting.scope,
			scopeKey: explicitSetting.scopeKey,
			target: explicitSetting.target,
		};
	}

	return undefined;
}

export async function migrateLegacyAutoSaveProviderSettings(
	deps: AutoSaveConfigurationMigrationDeps,
): Promise<LegacyAutoSaveProviderMigration[]> {
	const migratedScopeKeys = new Set(
		deps.state.get<string[]>(
			LEGACY_AUTO_SAVE_PROVIDER_MIGRATION_STATE_KEY,
			[],
		),
	);
	const migrations: LegacyAutoSaveProviderMigration[] = [];

	const markScopeHandled = async (scopeKey: string): Promise<void> => {
		if (migratedScopeKeys.has(scopeKey)) {
			return;
		}

		migratedScopeKeys.add(scopeKey);
		await deps.state.update(
			LEGACY_AUTO_SAVE_PROVIDER_MIGRATION_STATE_KEY,
			[...migratedScopeKeys].sort(),
		);
	};

	for (const workspaceFolder of deps.workspaceFolders) {
		const configuration = deps.getConfiguration(workspaceFolder);
		if (!configuration.get<boolean>('autoSaveOnChatResponse', false)) {
			continue;
		}

		const legacySetting = resolveLegacyProviderSetting(
			configuration,
			workspaceFolder,
			deps.workspaceKey,
		);
		if (
			!legacySetting
			|| migratedScopeKeys.has(legacySetting.scopeKey)
		) {
			continue;
		}

		if (
			hasExplicitAutoSaveProvidersAtOrBelowScope(
				configuration,
				legacySetting.scope,
			)
		) {
			await markScopeHandled(legacySetting.scopeKey);
			continue;
		}

		await configuration.update(
			'autoSave.providers',
			[legacySetting.provider],
			legacySetting.target,
		);
		await markScopeHandled(legacySetting.scopeKey);
		migrations.push({
			provider: legacySetting.provider,
			scope: legacySetting.scope,
			workspaceFolder: workspaceFolder.uri.toString(),
		});
	}

	return migrations;
}
