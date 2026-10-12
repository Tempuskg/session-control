import * as vscode from 'vscode';
import type { JudgmentService } from '../typesafe/judgmentService';

export type { JudgmentService };

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

export const PROVIDER_PICKER_CAPABILITY_VERSION = 1 as const;

export type ProviderPickerAgentId = Exclude<SharedHandoffSelectionId, 'chat'>;

/** A caller-supplied picker row; its `id` comes back unchanged when picked. */
export interface ProviderPickerExtraItem<TId extends string = string> {
	readonly id: TId;
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
}

export interface ProviderPickerOptions<TId extends string = string> {
	readonly placeHolder?: string;
	readonly title?: string;
	/** Detail for the in-editor Chat row; defaults to running with the first available Copilot model. */
	readonly chatDetail?: string;
	/** Detail for each agent row; receives the agent's display label. */
	readonly agentDetail?: (label: string) => string;
	/** Hide installed-agent rows, e.g. when the caller cannot hand work off. */
	readonly excludeAgents?: boolean;
	/** Rows appended after Chat and the agents. */
	readonly extraItems?: readonly ProviderPickerExtraItem<TId>[];
}

export type ProviderPickerSelection<TId extends string = string> =
	| { readonly kind: 'chat' }
	| { readonly kind: 'agent'; readonly provider: ProviderPickerAgentId }
	| { readonly kind: 'extra'; readonly id: TId };

/** The `/analyze` provider picker and in-editor model rules, shared with the Pro companion. */
export interface ProviderPickerCapabilityV1 {
	readonly version: typeof PROVIDER_PICKER_CAPABILITY_VERSION;
	/** Shows Chat plus installed agents (no per-model rows); resolves `undefined` when dismissed or empty. */
	readonly pick: <TId extends string = string>(
		options?: ProviderPickerOptions<TId>,
	) => Promise<ProviderPickerSelection<TId> | undefined>;
	/**
	 * Resolves the model in-editor Chat should use: `currentModel` when it answers direct requests,
	 * otherwise the first vendor `copilot` model. Copilot CLI agent-host models are always skipped.
	 */
	readonly resolveChatModel: (
		currentModel?: vscode.LanguageModelChat,
	) => Promise<vscode.LanguageModelChat | undefined>;
}

export interface ProFeatureCapabilities {
	readonly sharedHandoff?: SharedHandoffCapabilityV1;
	readonly providerPicker?: ProviderPickerCapabilityV1;
}

export interface ProServices {
	hasProLicense: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<boolean>;
	showUpgradePrompt: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<void>;
	/** Shared TypeSafe judgment service; `ask` resolves `undefined` when disabled, unconsented, or failing. */
	judgment?: JudgmentService;
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
