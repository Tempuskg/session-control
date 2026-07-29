import * as assert from 'node:assert';
import {
	createHandoffDispatcher,
	detectHandoffAgentProviders,
	detectHandoffTargets,
	type HandoffDispatcherDeps,
} from '../../src/handoffDispatcher';

interface CommandCall {
	commandId: string;
	args?: unknown;
}

function createDeps(overrides: Partial<HandoffDispatcherDeps> = {}): HandoffDispatcherDeps {
	return {
		getCommands: async () => [],
		executeCommand: async () => undefined,
		writeClipboard: async () => undefined,
		...overrides,
	};
}

suite('handoffDispatcher', () => {
	test('detects Chat, Agent Session, Codex, and Claude Code targets', () => {
		const targets = detectHandoffTargets([
			'workbench.action.chat.open',
			'workbench.action.chat.openAgents',
			'workbench.action.chat.focusInput',
			'chatgpt.openSidebar',
			'chatgpt.sidebarView.focus',
			'claude-vscode.sidebar.open',
			'claude-vscode.newConversation',
			'claude-vscode.focus',
		]);

		assert.deepEqual(
			targets.map((target) => ({
				id: target.id,
				commandId: target.commandId,
				supportsQuery: target.supportsQuery,
			})),
			[
				{
					id: 'chat',
					commandId: 'workbench.action.chat.open',
					supportsQuery: true,
				},
				{
					id: 'agentSession',
					commandId: 'workbench.action.chat.openAgents',
					supportsQuery: false,
				},
				{
					id: 'codex',
					commandId: 'chatgpt.openSidebar',
					supportsQuery: false,
				},
				{
					id: 'claude-code',
					commandId: 'claude-vscode.sidebar.open',
					supportsQuery: false,
				},
			],
		);
	});

	test('detects analysis agent providers without treating generic Agent Session as Cursor', () => {
		assert.deepEqual(
			detectHandoffAgentProviders([
				'workbench.action.chat.openAgents',
				'chatgpt.openSidebar',
				'claude-vscode.sidebar.open',
			]),
			['codex', 'claude-code'],
		);
		assert.deepEqual(
			detectHandoffAgentProviders([
				'composer.newAgentChat',
				'chatgpt.openSidebar',
			]),
			['cursor', 'codex'],
		);
	});

	test('passes query-capable targets the prompt without submitting it', async () => {
		const commands: CommandCall[] = [];
		let clipboardWrites = 0;
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => ['workbench.action.chat.open'],
			executeCommand: async (commandId: string, args?: unknown) => {
				commands.push(args === undefined ? { commandId } : { commandId, args });
			},
			writeClipboard: async () => {
				clipboardWrites += 1;
			},
		}));

		const result = await dispatcher.dispatch('Implement the report.', 'chat', {
			promptLabel: 'implementation prompt',
		});

		assert.deepEqual(commands, [{
			commandId: 'workbench.action.chat.open',
			args: { query: 'Implement the report.' },
		}]);
		assert.equal(clipboardWrites, 0);
		assert.equal(result.method, 'prefill');
		assert.equal(result.deliveredTo, 'chat');
		assert.match(result.instruction, /Review it and send it when ready\.$/);
	});

	test('copies, opens, focuses, and pastes into Agent Session without submitting', async () => {
		const events: string[] = [];
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'workbench.action.chat.openAgents',
				'workbench.action.chat.focusInput',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string) => {
				events.push(`command:${commandId}`);
			},
			writeClipboard: async (text: string) => {
				events.push(`copy:${text}`);
			},
			sleep: async () => undefined,
		}));

		const result = await dispatcher.dispatch('Agent work.', 'agentSession');

		assert.deepEqual(events, [
			'copy:Agent work.',
			'command:workbench.action.chat.openAgents',
			'command:workbench.action.chat.focusInput',
			'command:editor.action.clipboardPasteAction',
		]);
		assert.equal(result.method, 'paste');
		assert.equal(result.deliveredTo, 'agentSession');
		assert.equal(events.some((event) => /submit|accept|send/i.test(event)), false);
	});

	test('dispatches Cursor selections through the provider-specific Agent Session target', async () => {
		const events: string[] = [];
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'workbench.action.chat.openAgents',
				'composer.newAgentChat',
				'composer.focusComposer',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string) => {
				events.push(`command:${commandId}`);
			},
			writeClipboard: async (text: string) => {
				events.push(`copy:${text}`);
			},
			sleep: async () => undefined,
		}));

		const result = await dispatcher.dispatchSelection(
			'Cursor work.',
			'cursor',
			{ promptLabel: 'analysis handoff prompt' },
		);

		assert.deepEqual(events, [
			'copy:Cursor work.',
			'command:composer.newAgentChat',
			'command:composer.focusComposer',
			'command:editor.action.clipboardPasteAction',
		]);
		assert.equal(result.deliveredTo, 'agentSession');
		assert.match(result.instruction, /^Opened Cursor and pasted the analysis handoff prompt\./);
	});

	test('uses the existing Codex paste settle and retry behavior', async () => {
		const waits: number[] = [];
		let pasteAttempts = 0;
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'chatgpt.openSidebar',
				'chatgpt.sidebarView.focus',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string) => {
				if (commandId === 'editor.action.clipboardPasteAction') {
					pasteAttempts += 1;
					if (pasteAttempts < 3) {
						throw new Error('Codex composer not ready');
					}
				}
			},
			sleep: async (ms: number) => {
				waits.push(ms);
			},
		}));

		const result = await dispatcher.dispatch('Codex work.', 'codex');

		assert.equal(result.method, 'paste');
		assert.equal(result.deliveredTo, 'codex');
		assert.equal(pasteAttempts, 3);
		assert.deepEqual(waits, [250, 150, 150]);
	});

	test('honors configured provider commands for selection dispatch', async () => {
		const commands: string[] = [];
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'custom.codex.open',
				'chatgpt.sidebarView.focus',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string) => {
				commands.push(commandId);
			},
			sleep: async () => undefined,
		}));

		const result = await dispatcher.dispatchSelection(
			'Configured Codex work.',
			'codex',
			{
				configuredProviderCommands: {
					codex: 'custom.codex.open',
				},
				promptLabel: 'implementation prompt',
			},
		);

		assert.deepEqual(commands, [
			'custom.codex.open',
			'chatgpt.sidebarView.focus',
			'editor.action.clipboardPasteAction',
		]);
		assert.equal(result.deliveredTo, 'codex');
	});

	test('prepares and refocuses Claude Code before pasting', async () => {
		const commands: string[] = [];
		const waits: number[] = [];
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'claude-vscode.sidebar.open',
				'claude-vscode.newConversation',
				'claude-vscode.focus',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string) => {
				commands.push(commandId);
			},
			sleep: async (ms: number) => {
				waits.push(ms);
			},
		}));

		const result = await dispatcher.dispatch('Claude work.', 'claude-code');

		assert.equal(result.method, 'paste');
		assert.equal(result.deliveredTo, 'claude-code');
		assert.deepEqual(commands, [
			'claude-vscode.sidebar.open',
			'claude-vscode.newConversation',
			'claude-vscode.focus',
			'claude-vscode.focus',
			'editor.action.clipboardPasteAction',
		]);
		assert.deepEqual(waits, [250, 250, 250, 75]);
	});

	test('falls back from the selected provider to generic Chat', async () => {
		const events: string[] = [];
		const chatCalls: CommandCall[] = [];
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'chatgpt.openSidebar',
				'chatgpt.sidebarView.focus',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string, args?: unknown) => {
				events.push(`command:${commandId}`);
				if (commandId === 'chatgpt.openSidebar') {
					throw new Error('Codex failed to open');
				}
				if (commandId === 'workbench.action.chat.open') {
					chatCalls.push(args === undefined ? { commandId } : { commandId, args });
				}
			},
			writeClipboard: async (text: string) => {
				events.push(`copy:${text}`);
			},
		}));

		const result = await dispatcher.dispatch('Fallback work.', 'codex');

		assert.deepEqual(events, [
			'copy:Fallback work.',
			'command:chatgpt.openSidebar',
			'command:workbench.action.chat.open',
		]);
		assert.deepEqual(chatCalls, [{
			commandId: 'workbench.action.chat.open',
			args: { query: 'Fallback work.' },
		}]);
		assert.equal(result.method, 'prefill');
		assert.equal(result.deliveredTo, 'chat');
		assert.deepEqual(result.failures.map((failure) => failure.target), ['codex']);
	});

	test('falls back from the selected provider and Chat to clipboard-only instructions', async () => {
		const commands: string[] = [];
		let copiedText: string | undefined;
		const dispatcher = createHandoffDispatcher(createDeps({
			getCommands: async () => [
				'chatgpt.openSidebar',
				'chatgpt.sidebarView.focus',
				'workbench.action.chat.open',
			],
			executeCommand: async (commandId: string) => {
				commands.push(commandId);
				if (commandId === 'chatgpt.openSidebar') {
					throw new Error('Codex failed to open');
				}
				if (commandId === 'workbench.action.chat.open') {
					throw new Error('Chat failed to open');
				}
			},
			writeClipboard: async (text: string) => {
				copiedText = text;
			},
		}));

		const result = await dispatcher.dispatch('Clipboard work.', 'codex', {
			promptLabel: 'handoff prompt',
		});

		assert.deepEqual(commands, [
			'chatgpt.openSidebar',
			'workbench.action.chat.open',
		]);
		assert.equal(copiedText, 'Clipboard work.');
		assert.equal(result.method, 'clipboard');
		assert.equal(result.deliveredTo, 'clipboard');
		assert.deepEqual(result.failures.map((failure) => failure.target), ['codex', 'chat']);
		assert.equal(
			result.instruction,
			'Could not open Codex or Chat. The handoff prompt is on the clipboard. Open a full-workspace agent, paste it, and send it when ready.',
		);
	});
});
