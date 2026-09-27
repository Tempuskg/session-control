import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	ENTER_PRO_LICENSE_KEY_COMMAND,
	PRO_ACTIVATE_PROMPT_LABEL,
	PRO_PURCHASE_URL,
	PRO_UPGRADE_PROMPT_LABEL,
} from '../../src/pro/upgrade';
import {
	maybeShowProUpgradeNotice,
	PRO_UPGRADE_NOTICE_DELAY_MS,
	PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY,
	PRO_UPGRADE_NOTICE_MESSAGE,
	PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY,
	type ShowProUpgradeNoticeDeps,
} from '../../src/pro/upgradeNotice';

function makeFakeContext(seed: Record<string, unknown> = {}): {
	context: vscode.ExtensionContext;
	store: Map<string, unknown>;
} {
	const store = new Map<string, unknown>(Object.entries(seed));
	const context = {
		globalState: {
			get: (key: string) => store.get(key),
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					store.delete(key);
					return;
				}
				store.set(key, value);
			},
			keys: () => [...store.keys()],
			setKeysForSync: () => { /* no-op */ },
		},
	} as unknown as vscode.ExtensionContext;
	return { context, store };
}

interface Recorder {
	messages: string[];
	items: string[][];
	openedUrls: string[];
	commands: string[];
}

function makeDeps(
	overrides: Partial<ShowProUpgradeNoticeDeps> = {},
): { deps: Partial<ShowProUpgradeNoticeDeps>; recorder: Recorder } {
	const recorder: Recorder = { messages: [], items: [], openedUrls: [], commands: [] };
	const deps: Partial<ShowProUpgradeNoticeDeps> = {
		hasProLicense: async () => false,
		showInformationMessage: async (message: string, ...items: string[]) => {
			recorder.messages.push(message);
			recorder.items.push(items);
			// Default: the user dismisses the notification without picking an action.
			return undefined;
		},
		openExternal: async (target: vscode.Uri) => {
			recorder.openedUrls.push(target.toString());
			return true;
		},
		parseUri: (value: string) => vscode.Uri.parse(value),
		executeCommand: async (command: string) => {
			recorder.commands.push(command);
			return undefined;
		},
		now: () => 1_000_000,
		...overrides,
	};
	return { deps, recorder };
}

suite('pro upgrade notice', () => {
	test('defers on a fresh install and records when the wait started', async () => {
		const { context, store } = makeFakeContext();
		const { deps, recorder } = makeDeps({ now: () => 5_000 });

		const outcome = await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.equal(outcome, 'deferred');
		assert.deepEqual(recorder.messages, []);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY), 5_000);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), undefined);
	});

	test('stays quiet while the wait has not elapsed', async () => {
		const { context } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 1_000,
		});
		const { deps, recorder } = makeDeps({ now: () => 1_000 + PRO_UPGRADE_NOTICE_DELAY_MS - 1 });

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'deferred');
		assert.deepEqual(recorder.messages, []);
	});

	test('shows the upgrade notice copy once the wait has elapsed', async () => {
		const { context, store } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 1_000,
		});
		const { deps, recorder } = makeDeps({ now: () => 1_000 + PRO_UPGRADE_NOTICE_DELAY_MS });

		const outcome = await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.equal(outcome, 'shown');
		assert.deepEqual(recorder.messages, [PRO_UPGRADE_NOTICE_MESSAGE]);
		assert.deepEqual(recorder.items, [[PRO_UPGRADE_PROMPT_LABEL, PRO_ACTIVATE_PROMPT_LABEL]]);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), true);
	});

	test('dismissing the notice retires it for good', async () => {
		const { context } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 1_000,
		});
		// showInformationMessage resolves undefined, which is what VS Code reports when
		// the user closes the notification or lets it slide away untouched.
		const { deps, recorder } = makeDeps({ now: () => 1_000 + PRO_UPGRADE_NOTICE_DELAY_MS });

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'shown');
		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'already-shown');
		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'already-shown');
		assert.equal(recorder.messages.length, 1);
	});

	test('never re-nags across later activations no matter how much time passes', async () => {
		const { context } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 1_000,
		});
		let clock = 1_000 + PRO_UPGRADE_NOTICE_DELAY_MS;
		const { deps, recorder } = makeDeps({ now: () => clock });

		await maybeShowProUpgradeNotice(context, undefined, deps);
		for (let activation = 0; activation < 10; activation += 1) {
			clock += PRO_UPGRADE_NOTICE_DELAY_MS * 30;
			assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'already-shown');
		}

		assert.equal(recorder.messages.length, 1);
	});

	test('a licensed user never sees the notice, and it is retired immediately', async () => {
		const { context, store } = makeFakeContext();
		const { deps, recorder } = makeDeps({ hasProLicense: async () => true });

		const outcome = await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.equal(outcome, 'suppressed-licensed');
		assert.deepEqual(recorder.messages, []);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), true);
	});

	test('does not re-check the license once the notice is spent', async () => {
		const { context } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY]: true,
		});
		let licenseChecks = 0;
		const { deps, recorder } = makeDeps({
			hasProLicense: async () => {
				licenseChecks += 1;
				return false;
			},
		});

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'already-shown');
		assert.equal(licenseChecks, 0);
		assert.deepEqual(recorder.messages, []);
	});

	test('choosing Get Pro opens the purchase page', async () => {
		const { context } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 1_000,
		});
		const { deps, recorder } = makeDeps({
			now: () => 1_000 + PRO_UPGRADE_NOTICE_DELAY_MS,
			showInformationMessage: async () => PRO_UPGRADE_PROMPT_LABEL,
		});

		await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.deepEqual(recorder.openedUrls, [PRO_PURCHASE_URL]);
		assert.deepEqual(recorder.commands, []);
	});

	test('choosing Enter License Key runs the activation command', async () => {
		const { context } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 1_000,
		});
		const { deps, recorder } = makeDeps({
			now: () => 1_000 + PRO_UPGRADE_NOTICE_DELAY_MS,
			showInformationMessage: async () => PRO_ACTIVATE_PROMPT_LABEL,
		});

		await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.deepEqual(recorder.commands, [ENTER_PRO_LICENSE_KEY_COMMAND]);
		assert.deepEqual(recorder.openedUrls, []);
	});

	test('a backwards clock restarts the wait instead of deferring forever', async () => {
		const { context, store } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 9_000_000_000,
		});
		const { deps, recorder } = makeDeps({ now: () => 1_000 });

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'deferred');
		assert.equal(store.get(PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY), 1_000);
		assert.deepEqual(recorder.messages, []);
	});

	test('a corrupt stored timestamp restarts the wait', async () => {
		const { context, store } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY]: 'not-a-timestamp',
		});
		const { deps } = makeDeps({ now: () => 4_242 });

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'deferred');
		assert.equal(store.get(PRO_UPGRADE_NOTICE_FIRST_SEEN_STATE_KEY), 4_242);
	});
});
