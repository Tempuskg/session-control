import * as vscode from 'vscode';

export interface ProServices {
	hasProLicense: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<boolean>;
	showUpgradePrompt: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<void>;
}

export interface ProFeatureRegistrationContext extends ProServices {
	extensionContext: vscode.ExtensionContext;
	log: (message: string) => void;
	registerDisposable: (disposable: vscode.Disposable) => void;
}

export type ProFeatureRegistrationResult =
	| vscode.Disposable
	| readonly vscode.Disposable[]
	| undefined
	| Promise<vscode.Disposable | readonly vscode.Disposable[] | undefined>;

export type ProFeatureRegistrar = (
	context: ProFeatureRegistrationContext,
) => ProFeatureRegistrationResult;

export interface ProFeatureRegistrarModule {
	registerProFeatures: ProFeatureRegistrar;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isProFeatureRegistrarModule(value: unknown): value is ProFeatureRegistrarModule {
	return isRecord(value) && typeof value.registerProFeatures === 'function';
}
