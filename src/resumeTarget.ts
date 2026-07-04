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
// claude-vscode.sidebar.open, claude-vscode.newConversation,
// views claudeVSCodeSidebar / claudeVSCodeSidebarSecondary in containers
// claude-sidebar / claude-sidebar-secondary.
// Cursor's agent UI is host-provided; verified against Cursor 3.9.16:
// composer.newAgentChat starts a fresh agent chat tab, so the resume prompt is
// pasted into a clean conversation instead of whatever chat/draft is already
// open. aichat.newchataction is kept as a fallback for older builds, but it
// reuses the currently open composer. cursor.chat.open and
// cursorai.action.openChat are unverified legacy guesses kept last; all of
// this can be overridden with resume.providerCommands.
const RESUME_TARGET_CANDIDATES: Record<SessionProviderId, readonly string[]> = {
	copilot: ['workbench.action.chat.open'],
	codex: [
		'chatgpt.openSidebar',
		'chatgpt.newChat',
		'chatgpt.newCodexPanel',
	],
	'claude-code': [
		'claude-vscode.sidebar.open',
		'claude-vscode.newConversation',
		'claude-vscode.editor.open',
		'claude-vscode.editor.openLast',
	],
	cursor: [
		'composer.newAgentChat',
		'aichat.newchataction',
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
// codexSecondaryViewContainer. The Codex manifest also uses the
// chatgpt.sidebarView.visible context key for enablement, but VS Code does not
// expose a stable public API for reading that runtime state from another
// extension, so resume uses the most specific focus command available and lets
// paste wait/retry briefly on cold starts. Verified locally from
// anthropic.claude-code package.json/extension.js: claude-vscode.focus is the
// dedicated command that pushes focus into Claude's chat experience after the
// sidebar is revealed. Verified locally against Cursor 3.9.16's workbench
// bundle: composer.focusComposer is Cursor's registered "Focus Agent" action
// (Cursor's own workbench code executes it to push focus into the composer
// input), and workbench.panel.aichat.view is the chat panel view id, so VS
// Code core auto-registers workbench.panel.aichat.view.focus as a fallback
// that at least reveals the panel.
const FOCUS_COMMAND_CANDIDATES: Partial<Record<SessionProviderId, readonly string[]>> = {
	codex: [
		'chatgpt.sidebarSecondaryView.focus',
		'chatgpt.sidebarView.focus',
		'workbench.view.extension.codexSecondaryViewContainer',
		'workbench.view.extension.codexViewContainer',
		'chatgpt.openSidebar',
	],
	'claude-code': [
		'claude-vscode.focus',
		'claudeVSCodeSidebarSecondary.focus',
		'claudeVSCodeSidebar.focus',
		'workbench.view.extension.claude-sidebar',
		'workbench.view.extension.claude-sidebar-secondary',
	],
	cursor: [
		'composer.focusComposer',
		'workbench.panel.aichat.view.focus',
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
