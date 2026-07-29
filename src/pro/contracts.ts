import * as vscode from 'vscode';

export const SHARED_HANDOFF_CAPABILITY_VERSION = 1 as const;

export type SharedHandoffSelectionId = 'chat' | 'cursor' | 'codex' | 'claude-code';
export type SharedHandoffTargetId = 'chat' | 'agentSession' | 'codex' | 'claude-code';
export type SharedHandoffDeliveryMethod = 'prefill' | 'paste' | 'clipboard' | 'failed';
export type SharedHandoffFailureTarget = SharedHandoffTargetId | 'clipboard';
export type SharedHandoffFailureStage = 'detect' | 'copy' | 'open' | 'prepare' | 'focus' | 'paste';
export type SharedHandoffProviderCommands = Partial<
	Record<Exclude<SharedHandoffSelectionId, 'chat'>, string>
>;

export interface SharedHandoffDispatchOptions {
	readonly configuredProviderCommands?: SharedHandoffProviderCommands;
	readonly promptLabel?: string;
}

export interface SharedHandoffDispatchFailure {
	readonly target: SharedHandoffFailureTarget;
	readonly stage: SharedHandoffFailureStage;
	readonly message: string;
}

export interface SharedHandoffDispatchResult {
	readonly selectedTarget: SharedHandoffTargetId;
	readonly deliveredTo: SharedHandoffTargetId | 'clipboard' | null;
	readonly method: SharedHandoffDeliveryMethod;
	readonly instruction: string;
	readonly failures: readonly SharedHandoffDispatchFailure[];
}

export interface SharedHandoffCapabilityV1 {
	readonly version: typeof SHARED_HANDOFF_CAPABILITY_VERSION;
	readonly dispatch: (
		prompt: string,
		selectedTarget: SharedHandoffSelectionId,
		options?: SharedHandoffDispatchOptions,
	) => Promise<SharedHandoffDispatchResult>;
}

export interface ProFeatureCapabilities {
	readonly sharedHandoff?: SharedHandoffCapabilityV1;
}

export interface ProServices {
	hasProLicense: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<boolean>;
	showUpgradePrompt: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<void>;
}

export interface ProFeatureRegistrationContext extends ProServices {
	extensionContext: vscode.ExtensionContext;
	capabilities?: ProFeatureCapabilities;
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
