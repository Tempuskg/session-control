"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProviderFocusCommand = resolveProviderFocusCommand;
exports.resolveResumeTarget = resolveResumeTarget;
const COMMANDS_SUPPORTING_QUERY = new Set([
    'workbench.action.chat.open',
]);
// Verified locally from openai.chatgpt package.json: chatgpt.openSidebar,
// chatgpt.newChat, chatgpt.newCodexPanel.
// Verified locally from anthropic.claude-code package.json:
// claude-vscode.sidebar.open, claude-vscode.newConversation,
// views claudeVSCodeSidebar / claudeVSCodeSidebarSecondary in containers
// claude-sidebar / claude-sidebar-secondary.
// Cursor's agent UI is host-provided in current installs, so these candidates
// are intentionally conservative and can be overridden with resume.providerCommands.
const RESUME_TARGET_CANDIDATES = {
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
// codexSecondaryViewContainer. The Codex manifest also uses the
// chatgpt.sidebarView.visible context key for enablement, but VS Code does not
// expose a stable public API for reading that runtime state from another
// extension, so resume uses the most specific focus command available and lets
// paste wait/retry briefly on cold starts. Verified locally from
// anthropic.claude-code package.json/extension.js: claude-vscode.focus is the
// dedicated command that pushes focus into Claude's chat experience after the
// sidebar is revealed.
const FOCUS_COMMAND_CANDIDATES = {
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
};
function commandSupportsQuery(commandId) {
    return COMMANDS_SUPPORTING_QUERY.has(commandId);
}
function resolveProviderFocusCommand(provider, availableCommands) {
    const available = new Set(availableCommands);
    const candidates = FOCUS_COMMAND_CANDIDATES[provider];
    if (!candidates) {
        return undefined;
    }
    return candidates.find((commandId) => available.has(commandId));
}
function resolveResumeTarget(provider, availableCommands, configuredCommands = {}) {
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
//# sourceMappingURL=resumeTarget.js.map