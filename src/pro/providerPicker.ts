import * as vscode from 'vscode';
import {
	createAnalysisProviderPickItems,
	findAvailableAnalysisAgentProviders,
	isInEditorChatAvailable,
	resolveChatAnalysisModel,
	selectDefaultAnalysisModel,
	type AnalysisAgentProviderId,
} from '../chatParticipant';
import {
	PROVIDER_PICKER_CAPABILITY_VERSION,
	type ProviderPickerCapabilityV1,
	type ProviderPickerOptions,
	type ProviderPickerSelection,
} from './contracts';

export const PROVIDER_PICKER_DEFAULT_CHAT_DETAIL =
	'Session Control runs it with the first available Copilot model';
export const PROVIDER_PICKER_DEFAULT_PLACEHOLDER = 'Run this with which chat or agent?';

export interface ProviderPickerEnvironment {
	readonly chatAvailable: boolean;
	readonly agentProviders: readonly AnalysisAgentProviderId[];
}

export interface ProviderPickerItem<TId extends string = string> extends vscode.QuickPickItem {
	readonly selection: ProviderPickerSelection<TId>;
}

export interface ProviderPickerCapabilityDeps {
	readonly getCommands: () => Promise<readonly string[]>;
	readonly selectChatModels: () => Promise<readonly vscode.LanguageModelChat[]>;
	readonly showQuickPick: <T extends vscode.QuickPickItem>(
		items: readonly T[],
		options: vscode.QuickPickOptions,
	) => Promise<T | undefined>;
}

/** Builds the `/analyze` Chat and agent rows, then appends the caller's extra rows. */
export function createProviderPickerItems<TId extends string = string>(
	options: ProviderPickerOptions<TId>,
	environment: ProviderPickerEnvironment,
): ProviderPickerItem<TId>[] {
	const providerItems = createAnalysisProviderPickItems({
		purpose: 'analysis',
		...(environment.chatAvailable
			? { chatDetail: options.chatDetail ?? PROVIDER_PICKER_DEFAULT_CHAT_DETAIL }
			: {}),
		agentProviders: options.excludeAgents ? [] : environment.agentProviders,
		...(options.agentDetail ? { agentDetail: options.agentDetail } : {}),
	});

	const items: ProviderPickerItem<TId>[] = providerItems.map(({ selection, ...item }) => ({
		...item,
		selection: selection.kind === 'chat'
			? { kind: 'chat' }
			: { kind: 'agent', provider: selection.provider },
	}));

	for (const extra of options.extraItems ?? []) {
		items.push({
			label: extra.label,
			...(extra.description !== undefined ? { description: extra.description } : {}),
			...(extra.detail !== undefined ? { detail: extra.detail } : {}),
			selection: { kind: 'extra', id: extra.id },
		});
	}

	return items;
}

async function safely<T>(load: () => Promise<readonly T[]>): Promise<readonly T[]> {
	try {
		return await load();
	} catch {
		return [];
	}
}

export function createProviderPickerCapability(
	deps: Partial<ProviderPickerCapabilityDeps> = {},
): ProviderPickerCapabilityV1 {
	const getCommands = deps.getCommands ?? (async () => vscode.commands.getCommands(true));
	const selectChatModels = deps.selectChatModels ?? (async () => vscode.lm.selectChatModels());
	const showQuickPick = deps.showQuickPick
		?? (<T extends vscode.QuickPickItem>(items: readonly T[], options: vscode.QuickPickOptions) =>
			Promise.resolve(vscode.window.showQuickPick<T>(items, options)));

	return {
		version: PROVIDER_PICKER_CAPABILITY_VERSION,
		pick: async <TId extends string = string>(options: ProviderPickerOptions<TId> = {}) => {
			const [commands, models] = await Promise.all([
				safely(getCommands),
				safely(selectChatModels),
			]);
			const items = createProviderPickerItems(options, {
				chatAvailable: isInEditorChatAvailable(models, commands),
				agentProviders: findAvailableAnalysisAgentProviders(commands),
			});
			if (items.length === 0) {
				return undefined;
			}

			const pick = await showQuickPick(items, {
				placeHolder: options.placeHolder ?? PROVIDER_PICKER_DEFAULT_PLACEHOLDER,
				...(options.title !== undefined ? { title: options.title } : {}),
			});
			return pick?.selection;
		},
		resolveChatModel: async (currentModel) => {
			if (currentModel) {
				return resolveChatAnalysisModel(currentModel, selectChatModels);
			}

			return selectDefaultAnalysisModel(await safely(selectChatModels));
		},
	};
}
