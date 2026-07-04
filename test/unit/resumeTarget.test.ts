import * as assert from 'node:assert';
import { resolveProviderFocusCommand, resolveResumeTarget } from '../../src/resumeTarget';

suite('resumeTarget', () => {
	test('resolves Copilot chat with query support', () => {
		const target = resolveResumeTarget('copilot', ['workbench.action.chat.open']);

		assert.deepEqual(target, {
			provider: 'copilot',
			commandId: 'workbench.action.chat.open',
			supportsQuery: true,
		});
	});

	test('uses the first available Codex candidate', () => {
		const target = resolveResumeTarget('codex', ['chatgpt.openSidebar', 'chatgpt.newCodexPanel']);

		assert.equal(target?.commandId, 'chatgpt.openSidebar');
		assert.equal(target?.supportsQuery, false);
	});

	test('lets configured provider commands override built-in candidates', () => {
		const target = resolveResumeTarget('claude-code', ['custom.claude.open', 'claude-vscode.newConversation'], {
			'claude-code': 'custom.claude.open',
		});

		assert.equal(target?.commandId, 'custom.claude.open');
	});

	test('uses the first available Claude Code candidate', () => {
		const target = resolveResumeTarget('claude-code', ['claude-vscode.sidebar.open', 'claude-vscode.newConversation']);

		assert.equal(target?.commandId, 'claude-vscode.sidebar.open');
		assert.equal(target?.supportsQuery, false);
	});

	test('returns undefined when no command is available', () => {
		const target = resolveResumeTarget('cursor', ['workbench.action.chat.open']);

		assert.equal(target, undefined);
	});

	test('prefers a fresh Cursor agent chat over reusing the open composer', () => {
		const target = resolveResumeTarget('cursor', ['aichat.newchataction', 'composer.newAgentChat']);

		assert.equal(target?.commandId, 'composer.newAgentChat');
	});

	test('falls back to aichat.newchataction on Cursor builds without composer.newAgentChat', () => {
		const target = resolveResumeTarget('cursor', ['aichat.newchataction']);

		assert.equal(target?.commandId, 'aichat.newchataction');
	});

	test('resolves the first available Codex focus command', () => {
		const focusCommand = resolveProviderFocusCommand('codex', [
			'chatgpt.sidebarSecondaryView.focus',
			'chatgpt.sidebarView.focus',
		]);

		assert.equal(focusCommand, 'chatgpt.sidebarSecondaryView.focus');
	});

	test('falls back to the view container focus command when the view focus is unavailable', () => {
		const focusCommand = resolveProviderFocusCommand('codex', [
			'workbench.view.extension.codexSecondaryViewContainer',
		]);

		assert.equal(focusCommand, 'workbench.view.extension.codexSecondaryViewContainer');
	});

	test('resolves the first available Claude Code focus command', () => {
		const focusCommand = resolveProviderFocusCommand('claude-code', [
			'claude-vscode.focus',
			'claudeVSCodeSidebar.focus',
			'workbench.view.extension.claude-sidebar',
		]);

		assert.equal(focusCommand, 'claude-vscode.focus');
	});

	test('resolves the first available Cursor focus command', () => {
		const focusCommand = resolveProviderFocusCommand('cursor', [
			'composer.focusComposer',
			'workbench.panel.aichat.view.focus',
		]);

		assert.equal(focusCommand, 'composer.focusComposer');
	});

	test('falls back to the aichat panel focus command when the Cursor composer focus is unavailable', () => {
		const focusCommand = resolveProviderFocusCommand('cursor', [
			'workbench.panel.aichat.view.focus',
		]);

		assert.equal(focusCommand, 'workbench.panel.aichat.view.focus');
	});

	test('returns undefined when no focus command is available', () => {
		assert.equal(resolveProviderFocusCommand('codex', ['chatgpt.newCodexPanel']), undefined);
		assert.equal(resolveProviderFocusCommand('claude-code', ['claude-vscode.sidebar.open']), undefined);
		assert.equal(resolveProviderFocusCommand('cursor', ['aichat.newchataction']), undefined);
	});
});
