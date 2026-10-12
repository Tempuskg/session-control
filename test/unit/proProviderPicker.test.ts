import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { createAnalysisProviderPickItems } from '../../src/chatParticipant';
import {
	activateProFeatures,
	createProviderPickerCapability,
	createProviderPickerItems,
	PROVIDER_PICKER_CAPABILITY_VERSION,
	PROVIDER_PICKER_DEFAULT_CHAT_DETAIL,
	type ProFeatureRegistrationContext,
	type ProviderPickerCapabilityDeps,
} from '../../src/pro';

const CHAT_COMMAND = 'workbench.action.chat.open';
const CODEX_COMMAND = 'chatgpt.openSidebar';
const CLAUDE_CODE_COMMAND = 'claude-vscode.sidebar.open';

function fakeModel(vendor: string, id: string): vscode.LanguageModelChat {
	return { vendor, id, name: id, family: id } as unknown as vscode.LanguageModelChat;
}

interface CapturedPick {
	items: readonly vscode.QuickPickItem[];
	options: vscode.QuickPickOptions;
}

function createDeps(
	commands: readonly string[],
	models: readonly vscode.LanguageModelChat[],
	choose: (items: readonly vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined,
	captured: CapturedPick[] = [],
): ProviderPickerCapabilityDeps {
	return {
		getCommands: async () => commands,
		selectChatModels: async () => models,
		showQuickPick: async <T extends vscode.QuickPickItem>(items: readonly T[], options: vscode.QuickPickOptions) => {
			captured.push({ items, options });
			return choose(items) as T | undefined;
		},
	};
}

suite('pro provider picker capability', () => {
	test('items match the /analyze Chat and agent rows with no per-model rows', () => {
		const items = createProviderPickerItems(
			{ chatDetail: 'Harvest with Chat' },
			{ chatAvailable: true, agentProviders: ['codex', 'claude-code'] },
		);
		const analyzeItems = createAnalysisProviderPickItems({
			purpose: 'analysis',
			chatDetail: 'Harvest with Chat',
			agentProviders: ['codex', 'claude-code'],
		});

		assert.deepEqual(
			items.map(({ label, description }) => ({ label, description })),
			analyzeItems.map(({ label, description }) => ({ label, description })),
		);
		assert.deepEqual(items.map((item) => item.label), ['Chat', 'Codex', 'Claude Code']);
		assert.deepEqual(items.slice(1).map((item) => item.description), ['Agent', 'Agent']);
		assert.deepEqual(items.map((item) => item.selection), [
			{ kind: 'chat' },
			{ kind: 'agent', provider: 'codex' },
			{ kind: 'agent', provider: 'claude-code' },
		]);
	});

	test('items show only Chat when no agents are installed', () => {
		const items = createProviderPickerItems({}, { chatAvailable: true, agentProviders: [] });

		assert.deepEqual(items.map((item) => item.label), ['Chat']);
		assert.equal(items[0]?.detail, PROVIDER_PICKER_DEFAULT_CHAT_DETAIL);
	});

	test('items show only agents when in-editor chat is unavailable', () => {
		const items = createProviderPickerItems(
			{ agentDetail: (label) => `Hands the harvest prompt to ${label}` },
			{ chatAvailable: false, agentProviders: ['codex'] },
		);

		assert.deepEqual(items.map((item) => item.label), ['Codex']);
		assert.equal(items[0]?.detail, 'Hands the harvest prompt to Codex');
	});

	test('excludeAgents hides agent rows and extra items are appended after them', () => {
		const items = createProviderPickerItems(
			{
				excludeAgents: true,
				extraItems: [
					{ id: 'cli', label: 'CLI', description: 'Terminal' },
					{ id: 'back', label: 'Back' },
				],
			},
			{ chatAvailable: true, agentProviders: ['codex', 'claude-code'] },
		);

		assert.deepEqual(items.map((item) => item.label), ['Chat', 'CLI', 'Back']);
		assert.deepEqual(items[2]?.selection, { kind: 'extra', id: 'back' });
		assert.equal(items[1]?.description, 'Terminal');
		assert.equal('description' in (items[2] ?? {}), false);
		assert.equal('detail' in (items[2] ?? {}), false);
	});

	test('pick detects agents, forwards placeholder and title, and returns an extra item id', async () => {
		const captured: CapturedPick[] = [];
		const capability = createProviderPickerCapability(createDeps(
			[CHAT_COMMAND, CODEX_COMMAND, CLAUDE_CODE_COMMAND],
			[],
			(items) => items.find((item) => item.label === 'CLI'),
			captured,
		));

		const selection = await capability.pick({
			placeHolder: 'Harvest with which chat or agent?',
			title: 'Harvest',
			extraItems: [{ id: 'cli', label: 'CLI' }],
		});

		assert.deepEqual(selection, { kind: 'extra', id: 'cli' });
		assert.deepEqual(captured[0]?.items.map((item) => item.label), ['Chat', 'Codex', 'Claude Code', 'CLI']);
		assert.deepEqual(captured[0]?.options, {
			placeHolder: 'Harvest with which chat or agent?',
			title: 'Harvest',
		});
	});

	test('pick returns the agent selection and omits an unset title', async () => {
		const captured: CapturedPick[] = [];
		const capability = createProviderPickerCapability(createDeps(
			[CODEX_COMMAND],
			[],
			(items) => items[0],
			captured,
		));

		assert.deepEqual(await capability.pick(), { kind: 'agent', provider: 'codex' });
		assert.equal('title' in (captured[0]?.options ?? {}), false);
	});

	test('pick returns undefined when dismissed or when nothing is available', async () => {
		const dismissed = createProviderPickerCapability(createDeps([CHAT_COMMAND], [], () => undefined));
		assert.equal(await dismissed.pick(), undefined);

		const captured: CapturedPick[] = [];
		const empty = createProviderPickerCapability(createDeps([CODEX_COMMAND], [], (items) => items[0], captured));
		assert.equal(await empty.pick({ excludeAgents: true }), undefined);
		assert.equal(captured.length, 0);
	});

	test('resolveChatModel skips copilotcli agent-host models', async () => {
		const cliModel = fakeModel('copilotcli', 'auto');
		const copilotModel = fakeModel('copilot', 'gpt-5');
		const capability = createProviderPickerCapability(
			createDeps([], [cliModel, fakeModel('copilot', 'agent-host-copilotcli:auto'), copilotModel], () => undefined),
		);

		assert.equal(await capability.resolveChatModel(cliModel), copilotModel);
		assert.equal(await capability.resolveChatModel(), copilotModel);
		const current = fakeModel('anthropic', 'claude');
		assert.equal(await capability.resolveChatModel(current), current);
	});

	test('resolveChatModel returns undefined when no direct-request model exists', async () => {
		const capability = createProviderPickerCapability(
			createDeps([], [fakeModel('copilotcli', 'auto'), fakeModel('openai', 'gpt')], () => undefined),
		);
		assert.equal(await capability.resolveChatModel(), undefined);
		assert.equal(await capability.resolveChatModel(fakeModel('copilotcli', 'auto')), undefined);

		const failing = createProviderPickerCapability({
			selectChatModels: async () => {
				throw new Error('lm unavailable');
			},
		});
		assert.equal(await failing.resolveChatModel(), undefined);
	});

	test('activateProFeatures advertises the provider picker next to sharedHandoff', async () => {
		let registrarContext: ProFeatureRegistrationContext | undefined;
		const picker = createProviderPickerCapability(createDeps([], [], () => undefined));

		const result = await activateProFeatures(
			{
				extensionContext: {} as vscode.ExtensionContext,
				hasProLicense: async () => false,
				showUpgradePrompt: async () => undefined,
				log: () => undefined,
				registerDisposable: () => undefined,
			},
			{
				moduleSpecifier: 'session-control-pro-test',
				resolveModule: () => 'C:/temp/pro/index.js',
				requireModule: () => ({
					registerProFeatures: async (context: ProFeatureRegistrationContext) => {
						registrarContext = context;
					},
				}),
				createHandoffDispatcher: () => ({
					dispatchSelection: async () => {
						throw new Error('not used');
					},
				}),
				createProviderPicker: () => picker,
				setContext: async () => undefined,
			},
		);

		assert.equal(result.kind, 'available');
		assert.ok(registrarContext?.capabilities?.sharedHandoff);
		assert.equal(registrarContext?.capabilities?.providerPicker, picker);
		assert.equal(registrarContext?.capabilities?.providerPicker?.version, PROVIDER_PICKER_CAPABILITY_VERSION);
	});
});
