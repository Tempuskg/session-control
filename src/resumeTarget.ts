import { SessionProviderId } from './types';

export interface ResumeTarget {
	provider: SessionProviderId;
	commandId: string;
	supportsQuery: boolean;
}

export type ResumeProviderCommands = Partial<Record<SessionProviderId, string>>;

const COMMANDS_SUPPORTING_QUERY = new Set([
	'workbench.action.chat.open',
]);

// Verified locally from openai.chatgpt package.json: chatgpt.openSidebar,
// chatgpt.newChat, chatgpt.newCodexPanel.
// Verified locally from anthropic.claude-code package.json:
// claude-vscode.newConversation, claude-vscode.sidebar.open.
// Cursor's agent UI is host-provided in current installs, so these candidates
// are intentionally conservative and can be overridden with resume.providerCommands.
const RESUME_TARGET_CANDIDATES: Record<SessionProviderId, readonly string[]> = {
	copilot: ['workbench.action.chat.open'],
	codex: [
		'chatgpt.openSidebar',
		'chatgpt.newChat',
		'chatgpt.newCodexPanel',
	],
	'claude-code': [
		'claude-vscode.newConversation',
		'claude-vscode.sidebar.open',
		'claude-vscode.editor.open',
		'claude-vscode.editor.openLast',
	],
	cursor: [
		'aichat.newchataction',
		'composer.newAgentChat',
		'cursor.chat.open',
		'cursorai.action.openChat',
	],
};

// Commands that reveal and focus a provider's chat view. VS Code auto-registers
// `<viewId>.focus` for every contributed view and
// `workbench.view.extension.<containerId>` for every view container, so these
// appear in getCommands(true) when the provider extension is installed.
// Verified locally from openai.chatgpt package.json: views chatgpt.sidebarView /
// chatgpt.sidebarSecondaryView in containers codexViewContainer /
// codexSecondaryViewContainer.
const FOCUS_COMMAND_CANDIDATES: Partial<Record<SessionProviderId, readonly string[]>> = {
	codex: [
		'chatgpt.openSidebar',
		'chatgpt.sidebarView.focus',
		'chatgpt.sidebarSecondaryView.focus',
		'workbench.view.extension.codexViewContainer',
		'workbench.view.extension.codexSecondaryViewContainer',
	],
};

function commandSupportsQuery(commandId: string): boolean {
	return COMMANDS_SUPPORTING_QUERY.has(commandId);
}

export function resolveProviderFocusCommand(
	provider: SessionProviderId,
	availableCommands: readonly string[],
): string | undefined {
	const available = new Set(availableCommands);
	const candidates = FOCUS_COMMAND_CANDIDATES[provider];
	if (!candidates) {
		return undefined;
	}

	return candidates.find((commandId) => available.has(commandId));
}

export function resolveResumeTarget(
	provider: SessionProviderId,
	availableCommands: readonly string[],
	configuredCommands: ResumeProviderCommands = {},
): ResumeTarget | undefined {
	const available = new Set(availableCommands);
	const configuredCommand = configuredCommands[provider]?.trim();
	const candidates = configuredCommand
		? [configuredCommand]
		: RESUME_TARGET_CANDIDATES[provider];

	for (const commandId of candidates) {
		if (available.has(commandId)) {
			return {
				provider,
				commandId,
				supportsQuery: commandSupportsQuery(commandId),
			};
		}
	}

	return undefined;
}
