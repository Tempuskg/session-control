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

	test('returns undefined when no command is available', () => {
		const target = resolveResumeTarget('cursor', ['workbench.action.chat.open']);

		assert.equal(target, undefined);
	});

	test('resolves the first available Codex focus command', () => {
		const focusCommand = resolveProviderFocusCommand('codex', [
			'chatgpt.openSidebar',
			'workbench.view.extension.codexViewContainer',
			'chatgpt.sidebarView.focus',
		]);

		assert.equal(focusCommand, 'chatgpt.openSidebar');
	});

	test('falls back to the view container focus command when the view focus is unavailable', () => {
		const focusCommand = resolveProviderFocusCommand('codex', [
			'workbench.view.extension.codexSecondaryViewContainer',
		]);

		assert.equal(focusCommand, 'workbench.view.extension.codexSecondaryViewContainer');
	});

	test('returns undefined when no focus command is available', () => {
		assert.equal(resolveProviderFocusCommand('codex', ['chatgpt.newCodexPanel']), undefined);
		assert.equal(resolveProviderFocusCommand('claude-code', ['claude-vscode.sidebar.open']), undefined);
	});
});
