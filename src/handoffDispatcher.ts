import * as vscode from 'vscode';

export const HANDOFF_TARGET_IDS = ['chat', 'agentSession', 'codex', 'claude-code'] as const;
export const HANDOFF_AGENT_PROVIDER_IDS = ['cursor', 'codex', 'claude-code'] as const;

export type HandoffTargetId = (typeof HANDOFF_TARGET_IDS)[number];
export type HandoffAgentProviderId = (typeof HANDOFF_AGENT_PROVIDER_IDS)[number];
export type HandoffSelectionId = 'chat' | HandoffAgentProviderId;
export type HandoffDeliveryMethod = 'prefill' | 'paste' | 'clipboard' | 'failed';
export type HandoffFailureTarget = HandoffTargetId | 'clipboard';
export type HandoffFailureStage = 'detect' | 'copy' | 'open' | 'prepare' | 'focus' | 'paste';

export interface HandoffTarget {
	readonly id: HandoffTargetId;
	readonly label: string;
	readonly commandId: string;
	readonly supportsQuery: boolean;
	readonly focusCommandId?: string;
	readonly prepareCommandId?: string;
}

export type HandoffTargetCommands = Partial<Record<HandoffTargetId, string>>;
export type HandoffAgentProviderCommands = Partial<Record<HandoffAgentProviderId, string>>;

export interface HandoffDispatchFailure {
	readonly target: HandoffFailureTarget;
	readonly stage: HandoffFailureStage;
	readonly message: string;
}

export interface HandoffDispatchResult {
	readonly selectedTarget: HandoffTargetId;
	readonly deliveredTo: HandoffTargetId | 'clipboard' | null;
	readonly method: HandoffDeliveryMethod;
	readonly instruction: string;
	readonly failures: readonly HandoffDispatchFailure[];
}

export interface HandoffDispatchOptions {
	readonly configuredCommands?: HandoffTargetCommands;
	readonly promptLabel?: string;
}

export interface HandoffSelectionDispatchOptions {
	readonly configuredProviderCommands?: HandoffAgentProviderCommands;
	readonly promptLabel?: string;
}

export interface HandoffDispatcherDeps {
	readonly getCommands: () => Promise<readonly string[]>;
	readonly executeCommand: (commandId: string, args?: unknown) => Promise<void>;
	readonly writeClipboard: (text: string) => Promise<void>;
	readonly sleep?: (ms: number) => Promise<void>;
}

export interface HandoffDispatcher {
	detectTargets(configuredCommands?: HandoffTargetCommands): Promise<readonly HandoffTarget[]>;
	dispatch(
		prompt: string,
		selectedTarget: HandoffTargetId,
		options?: HandoffDispatchOptions,
	): Promise<HandoffDispatchResult>;
	dispatchSelection(
		prompt: string,
		selectedTarget: HandoffSelectionId,
		options?: HandoffSelectionDispatchOptions,
	): Promise<HandoffDispatchResult>;
}

interface HandoffTargetDefinition {
	readonly id: HandoffTargetId;
	readonly label: string;
	readonly commandIds: readonly string[];
	readonly focusCommandIds?: readonly string[];
	readonly prepareCommandIds?: readonly string[];
}

interface HandoffAgentProviderDefinition {
	readonly id: HandoffAgentProviderId;
	readonly targetId: Exclude<HandoffTargetId, 'chat'>;
	readonly label: string;
	readonly commandIds: readonly string[];
}

interface PasteRetryProfile {
	readonly settleMs: number;
	readonly retryDelayMs: number;
	readonly maxAttempts: number;
	readonly refocusAfterMountMs?: number;
}

interface DeliveryState {
	clipboardReady: boolean;
}

const COMMANDS_SUPPORTING_QUERY = new Set([
	'workbench.action.chat.open',
]);

const CURSOR_COMMAND_IDS = [
	'composer.newAgentChat',
	'aichat.newchataction',
	'cursor.chat.open',
	'cursorai.action.openChat',
] as const;

const CODEX_COMMAND_IDS = [
	'chatgpt.openSidebar',
	'chatgpt.newChat',
	'chatgpt.newCodexPanel',
] as const;

const CLAUDE_CODE_COMMAND_IDS = [
	'claude-vscode.sidebar.open',
	'claude-vscode.newConversation',
	'claude-vscode.editor.open',
	'claude-vscode.editor.openLast',
] as const;

const TARGET_DEFINITIONS: readonly HandoffTargetDefinition[] = [
	{
		id: 'chat',
		label: 'Chat',
		commandIds: ['workbench.action.chat.open'],
	},
	{
		id: 'agentSession',
		label: 'Agent Session',
		commandIds: [
			'workbench.action.chat.openSessions',
			'workbench.action.chat.openSessionsInNewWindow',
			'workbench.action.chat.openAgentsWindow',
			'workbench.action.chat.openAgents',
			'github.copilot.cli.newSession',
			...CURSOR_COMMAND_IDS,
		],
		focusCommandIds: [
			'workbench.action.chat.focusInput',
			'composer.focusComposer',
			'workbench.panel.aichat.view.focus',
		],
	},
	{
		id: 'codex',
		label: 'Codex',
		commandIds: CODEX_COMMAND_IDS,
		focusCommandIds: [
			'chatgpt.sidebarSecondaryView.focus',
			'chatgpt.sidebarView.focus',
			'workbench.view.extension.codexSecondaryViewContainer',
			'workbench.view.extension.codexViewContainer',
			'chatgpt.openSidebar',
		],
	},
	{
		id: 'claude-code',
		label: 'Claude Code',
		commandIds: CLAUDE_CODE_COMMAND_IDS,
		focusCommandIds: [
			'claude-vscode.focus',
			'claudeVSCodeSidebarSecondary.focus',
			'claudeVSCodeSidebar.focus',
			'workbench.view.extension.claude-sidebar',
			'workbench.view.extension.claude-sidebar-secondary',
		],
		prepareCommandIds: ['claude-vscode.newConversation'],
	},
];

const AGENT_PROVIDER_DEFINITIONS: readonly HandoffAgentProviderDefinition[] = [
	{
		id: 'cursor',
		targetId: 'agentSession',
		label: 'Cursor',
		commandIds: CURSOR_COMMAND_IDS,
	},
	{
		id: 'codex',
		targetId: 'codex',
		label: 'Codex',
		commandIds: CODEX_COMMAND_IDS,
	},
	{
		id: 'claude-code',
		targetId: 'claude-code',
		label: 'Claude Code',
		commandIds: CLAUDE_CODE_COMMAND_IDS,
	},
];

const TARGET_LABELS: Record<HandoffTargetId, string> = {
	chat: 'Chat',
	agentSession: 'Agent Session',
	codex: 'Codex',
	'claude-code': 'Claude Code',
};

const DEFAULT_PASTE_RETRY_PROFILE: PasteRetryProfile = {
	settleMs: 0,
	retryDelayMs: 0,
	maxAttempts: 1,
};

const AGENT_SESSION_PASTE_RETRY_PROFILE: PasteRetryProfile = {
	settleMs: 250,
	retryDelayMs: 150,
	maxAttempts: 6,
};

const CODEX_PASTE_RETRY_PROFILE: PasteRetryProfile = {
	settleMs: 250,
	retryDelayMs: 150,
	maxAttempts: 6,
};

const CLAUDE_CODE_PASTE_RETRY_PROFILE: PasteRetryProfile = {
	settleMs: 75,
	retryDelayMs: 150,
	maxAttempts: 6,
	refocusAfterMountMs: 250,
};

const CLAUDE_CODE_NEW_CONVERSATION_SETTLE_MS = 250;

class HandoffDeliveryError extends Error {
	public constructor(
		public readonly stage: HandoffFailureStage,
		message: string,
	) {
		super(message);
		this.name = 'HandoffDeliveryError';
	}
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function findFirstAvailable(
	commandIds: readonly string[] | undefined,
	availableCommands: ReadonlySet<string>,
): string | undefined {
	return commandIds?.find((commandId) => availableCommands.has(commandId));
}

export function detectHandoffTargets(
	availableCommands: readonly string[],
	configuredCommands: HandoffTargetCommands = {},
): HandoffTarget[] {
	const available = new Set(availableCommands);
	const targets: HandoffTarget[] = [];

	for (const definition of TARGET_DEFINITIONS) {
		const configuredCommand = configuredCommands[definition.id]?.trim();
		const commandId = findFirstAvailable(
			configuredCommand ? [configuredCommand] : definition.commandIds,
			available,
		);
		if (!commandId) {
			continue;
		}

		const focusCommandId = findFirstAvailable(definition.focusCommandIds, available);
		const prepareCommandId = findFirstAvailable(
			definition.prepareCommandIds?.filter((candidate) => candidate !== commandId),
			available,
		);
		targets.push({
			id: definition.id,
			label: definition.label,
			commandId,
			supportsQuery: COMMANDS_SUPPORTING_QUERY.has(commandId),
			...(focusCommandId ? { focusCommandId } : {}),
			...(prepareCommandId ? { prepareCommandId } : {}),
		});
	}

	return targets;
}

export function detectHandoffAgentProviders(
	availableCommands: readonly string[],
	configuredCommands: HandoffAgentProviderCommands = {},
): HandoffAgentProviderId[] {
	const available = new Set(availableCommands);
	return AGENT_PROVIDER_DEFINITIONS
		.filter((definition) => {
			const configuredCommand = configuredCommands[definition.id]?.trim();
			return findFirstAvailable(
				configuredCommand ? [configuredCommand] : definition.commandIds,
				available,
			) !== undefined;
		})
		.map((definition) => definition.id);
}

async function sleepFor(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runStage<T>(
	stage: HandoffFailureStage,
	action: () => Promise<T>,
): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof HandoffDeliveryError) {
			throw error;
		}

		throw new HandoffDeliveryError(stage, toErrorMessage(error));
	}
}

function getPasteRetryProfile(target: HandoffTarget): PasteRetryProfile {
	if (target.id === 'agentSession') {
		return AGENT_SESSION_PASTE_RETRY_PROFILE;
	}
	if (target.id === 'codex') {
		return CODEX_PASTE_RETRY_PROFILE;
	}
	if (target.id === 'claude-code' && target.focusCommandId === 'claude-vscode.focus') {
		return CLAUDE_CODE_PASTE_RETRY_PROFILE;
	}

	return DEFAULT_PASTE_RETRY_PROFILE;
}

async function pasteWithRetry(
	target: HandoffTarget,
	deps: HandoffDispatcherDeps,
	sleep: (ms: number) => Promise<void>,
): Promise<void> {
	const focusCommandId = target.focusCommandId;
	if (!focusCommandId) {
		throw new HandoffDeliveryError('focus', `No focus command is available for ${target.label}.`);
	}

	const profile = getPasteRetryProfile(target);
	if (profile.refocusAfterMountMs !== undefined) {
		await runStage('focus', async () => {
			await sleep(profile.refocusAfterMountMs ?? 0);
			await deps.executeCommand(focusCommandId);
		});
	}
	if (profile.settleMs > 0) {
		await sleep(profile.settleMs);
	}

	let lastError: unknown;
	for (let attempt = 1; attempt <= profile.maxAttempts; attempt += 1) {
		try {
			await deps.executeCommand('editor.action.clipboardPasteAction');
			return;
		} catch (error) {
			lastError = error;
			if (attempt >= profile.maxAttempts) {
				break;
			}
			await sleep(profile.retryDelayMs);
		}
	}

	throw new HandoffDeliveryError(
		'paste',
		lastError === undefined ? 'Automatic paste failed.' : toErrorMessage(lastError),
	);
}

async function deliverToTarget(
	target: HandoffTarget,
	prompt: string,
	deps: HandoffDispatcherDeps,
	sleep: (ms: number) => Promise<void>,
	state: DeliveryState,
): Promise<'prefill' | 'paste'> {
	if (target.supportsQuery) {
		await runStage('open', async () => {
			await deps.executeCommand(target.commandId, { query: prompt });
		});
		return 'prefill';
	}

	await runStage('copy', async () => {
		await deps.writeClipboard(prompt);
		state.clipboardReady = true;
	});
	await runStage('open', async () => {
		await deps.executeCommand(target.commandId);
	});

	if (target.prepareCommandId) {
		await runStage('prepare', async () => {
			await sleep(CLAUDE_CODE_NEW_CONVERSATION_SETTLE_MS);
			await deps.executeCommand(target.prepareCommandId as string);
			await sleep(CLAUDE_CODE_NEW_CONVERSATION_SETTLE_MS);
		});
	}

	if (!target.focusCommandId) {
		throw new HandoffDeliveryError('focus', `No focus command is available for ${target.label}.`);
	}
	await runStage('focus', async () => {
		await deps.executeCommand(target.focusCommandId as string);
	});
	await pasteWithRetry(target, deps, sleep);
	return 'paste';
}

function buildDeliveryInstruction(
	selectedTarget: HandoffTargetId,
	deliveredTarget: HandoffTargetId,
	method: 'prefill' | 'paste',
	promptLabel: string,
	selectedTargetLabel: string,
): string {
	const deliveredLabel = deliveredTarget === selectedTarget
		? selectedTargetLabel
		: TARGET_LABELS[deliveredTarget];
	const reviewInstruction = 'Review it and send it when ready.';

	if (deliveredTarget !== selectedTarget) {
		return `Could not deliver the ${promptLabel} to ${selectedTargetLabel}. Opened ${deliveredLabel} with it prefilled instead. ${reviewInstruction}`;
	}
	if (method === 'prefill') {
		return `Opened ${deliveredLabel} with the ${promptLabel} prefilled. ${reviewInstruction}`;
	}

	return `Opened ${deliveredLabel} and pasted the ${promptLabel}. ${reviewInstruction}`;
}

function buildClipboardInstruction(selectedTargetLabel: string, promptLabel: string): string {
	return `Could not open ${selectedTargetLabel} or Chat. The ${promptLabel} is on the clipboard. Open a full-workspace agent, paste it, and send it when ready.`;
}

async function dispatchToDetectedTargets(
	prompt: string,
	selectedTarget: HandoffTargetId,
	selectedTargetLabel: string,
	promptLabel: string,
	targets: readonly HandoffTarget[],
	detectionError: string | undefined,
	deps: HandoffDispatcherDeps,
	sleep: (ms: number) => Promise<void>,
): Promise<HandoffDispatchResult> {
	const failures: HandoffDispatchFailure[] = [];
	const state: DeliveryState = { clipboardReady: false };
	const targetsById = new Map(targets.map((target) => [target.id, target]));
	const attemptOrder: HandoffTargetId[] = selectedTarget === 'chat'
		? ['chat']
		: [selectedTarget, 'chat'];

	for (const targetId of attemptOrder) {
		const target = targetsById.get(targetId);
		if (!target) {
			failures.push({
				target: targetId,
				stage: 'detect',
				message: detectionError ?? `No available ${TARGET_LABELS[targetId]} command was found.`,
			});
			continue;
		}

		try {
			const method = await deliverToTarget(target, prompt, deps, sleep, state);
			return {
				selectedTarget,
				deliveredTo: targetId,
				method,
				instruction: buildDeliveryInstruction(
					selectedTarget,
					targetId,
					method,
					promptLabel,
					selectedTargetLabel,
				),
				failures: [...failures],
			};
		} catch (error) {
			const deliveryError = error instanceof HandoffDeliveryError
				? error
				: new HandoffDeliveryError('open', toErrorMessage(error));
			failures.push({
				target: targetId,
				stage: deliveryError.stage,
				message: deliveryError.message,
			});
		}
	}

	if (!state.clipboardReady) {
		try {
			await deps.writeClipboard(prompt);
			state.clipboardReady = true;
		} catch (error) {
			failures.push({
				target: 'clipboard',
				stage: 'copy',
				message: toErrorMessage(error),
			});
		}
	}

	if (state.clipboardReady) {
		return {
			selectedTarget,
			deliveredTo: 'clipboard',
			method: 'clipboard',
			instruction: buildClipboardInstruction(selectedTargetLabel, promptLabel),
			failures: [...failures],
		};
	}

	return {
		selectedTarget,
		deliveredTo: null,
		method: 'failed',
		instruction: `Could not open ${selectedTargetLabel} or Chat, and the ${promptLabel} could not be copied to the clipboard.`,
		failures: [...failures],
	};
}

export function createHandoffDispatcher(deps: HandoffDispatcherDeps): HandoffDispatcher {
	const sleep = deps.sleep ?? sleepFor;
	const dispatch = async (
		prompt: string,
		selectedTarget: HandoffTargetId,
		options: HandoffDispatchOptions = {},
	): Promise<HandoffDispatchResult> => {
		const promptLabel = options.promptLabel?.trim() || 'prompt';
		let targets: readonly HandoffTarget[] = [];
		let detectionError: string | undefined;

		try {
			const availableCommands = await deps.getCommands();
			targets = detectHandoffTargets(availableCommands, options.configuredCommands);
		} catch (error) {
			detectionError = toErrorMessage(error);
		}

		return dispatchToDetectedTargets(
			prompt,
			selectedTarget,
			TARGET_LABELS[selectedTarget],
			promptLabel,
			targets,
			detectionError,
			deps,
			sleep,
		);
	};

	return {
		detectTargets: async (configuredCommands: HandoffTargetCommands = {}) => {
			const availableCommands = await deps.getCommands();
			return detectHandoffTargets(availableCommands, configuredCommands);
		},
		dispatch,
		dispatchSelection: async (
			prompt: string,
			selectedTarget: HandoffSelectionId,
			options: HandoffSelectionDispatchOptions = {},
		): Promise<HandoffDispatchResult> => {
			const promptLabel = options.promptLabel?.trim() || 'prompt';
			if (selectedTarget === 'chat') {
				return dispatch(prompt, selectedTarget, { promptLabel });
			}

			const providerDefinition = AGENT_PROVIDER_DEFINITIONS.find(
				(definition) => definition.id === selectedTarget,
			);
			if (!providerDefinition) {
				throw new Error(`Unsupported handoff provider: ${selectedTarget}`);
			}

			let targets: readonly HandoffTarget[] = [];
			let detectionError: string | undefined;

			try {
				const availableCommands = await deps.getCommands();
				const available = new Set(availableCommands);
				const configuredCommand = options.configuredProviderCommands?.[selectedTarget]?.trim();
				const providerCommand = findFirstAvailable(
					configuredCommand ? [configuredCommand] : providerDefinition.commandIds,
					available,
				);
				const configuredTargetCommands: HandoffTargetCommands = {};
				configuredTargetCommands[providerDefinition.targetId] = providerCommand
					?? '__session-control-unavailable-handoff-target__';
				targets = detectHandoffTargets(availableCommands, configuredTargetCommands);
			} catch (error) {
				detectionError = toErrorMessage(error);
			}

			return dispatchToDetectedTargets(
				prompt,
				providerDefinition.targetId,
				providerDefinition.label,
				promptLabel,
				targets,
				detectionError,
				deps,
				sleep,
			);
		},
	};
}

export function createVSCodeHandoffDispatcher(): HandoffDispatcher {
	return createHandoffDispatcher({
		getCommands: async () => vscode.commands.getCommands(true),
		executeCommand: async (commandId: string, args?: unknown) => {
			if (args === undefined) {
				await vscode.commands.executeCommand(commandId);
				return;
			}
			await vscode.commands.executeCommand(commandId, args);
		},
		writeClipboard: async (text: string) => vscode.env.clipboard.writeText(text),
	});
}
