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
	PRO_UPGRADE_NOTICE_MESSAGE,
	PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY,
	PRO_UPGRADE_NOTICE_SAVE_THRESHOLD,
	PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY,
	recordProUpgradeNoticeSave,
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
		...overrides,
	};
	return { deps, recorder };
}

const earned = { [PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY]: PRO_UPGRADE_NOTICE_SAVE_THRESHOLD };

suite('pro upgrade notice', () => {
	test('stays quiet on a fresh install, as on any startup with no saves', async () => {
		const { context, store } = makeFakeContext();
		let licenseChecks = 0;
		const { deps, recorder } = makeDeps({
			hasProLicense: async () => {
				licenseChecks += 1;
				return false;
			},
		});

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'below-threshold');
		assert.deepEqual(recorder.messages, []);
		assert.equal(licenseChecks, 0);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), undefined);
	});

	test('records each save toward the threshold', async () => {
		const { context, store } = makeFakeContext();

		assert.equal(await recordProUpgradeNoticeSave(context), 1);
		assert.equal(await recordProUpgradeNoticeSave(context), 2);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY), 2);
	});

	test('stays quiet until the save threshold is reached, then shows once', async () => {
		const { context, store } = makeFakeContext();
		const { deps, recorder } = makeDeps();

		for (let save = 1; save < PRO_UPGRADE_NOTICE_SAVE_THRESHOLD; save += 1) {
			await recordProUpgradeNoticeSave(context);
			assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'below-threshold');
		}
		assert.deepEqual(recorder.messages, []);

		await recordProUpgradeNoticeSave(context);
		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'shown');
		assert.deepEqual(recorder.messages, [PRO_UPGRADE_NOTICE_MESSAGE]);
		assert.deepEqual(recorder.items, [[PRO_UPGRADE_PROMPT_LABEL, PRO_ACTIVATE_PROMPT_LABEL]]);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), true);
	});

	test('honours a custom threshold', async () => {
		const { context } = makeFakeContext({ [PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY]: 9 });
		const { deps } = makeDeps({ saveThreshold: 10 });

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'below-threshold');
		await recordProUpgradeNoticeSave(context);
		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'shown');
	});

	test('dismissing the notice retires it for good', async () => {
		const { context, store } = makeFakeContext(earned);
		// showInformationMessage resolves undefined, which is what VS Code reports when
		// the user closes the notification or lets it slide away untouched.
		const { deps, recorder } = makeDeps();

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'shown');
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), true);
		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'already-shown');
		assert.equal(recorder.messages.length, 1);
	});

	test('the latch persists across a reload sharing the same global state', async () => {
		const { context, store } = makeFakeContext(earned);
		const first = makeDeps();
		await maybeShowProUpgradeNotice(context, undefined, first.deps);

		// A new window or extension host reads the same persisted globalState.
		const { context: reloaded } = makeFakeContext(Object.fromEntries(store));
		const second = makeDeps();
		assert.equal(await maybeShowProUpgradeNotice(reloaded, undefined, second.deps), 'already-shown');
		assert.deepEqual(second.recorder.messages, []);
	});

	test('never repeats no matter how many more saves follow, in any workspace', async () => {
		const { context, store } = makeFakeContext(earned);
		const { deps, recorder } = makeDeps();
		const folders = ['a', 'b', 'c'].map((name, index) => ({
			uri: vscode.Uri.file(`/work/${name}`),
			name,
			index,
		}) as vscode.WorkspaceFolder);

		assert.equal(await maybeShowProUpgradeNotice(context, folders[0], deps), 'shown');
		const countAfterShown = store.get(PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY);
		for (let save = 0; save < 20; save += 1) {
			await recordProUpgradeNoticeSave(context);
			const folder = folders[save % folders.length];
			assert.equal(await maybeShowProUpgradeNotice(context, folder, deps), 'already-shown');
		}

		assert.equal(recorder.messages.length, 1);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY), countAfterShown);
	});

	test('a licensed user never sees the notice, and it is retired immediately', async () => {
		const { context, store } = makeFakeContext(earned);
		const { deps, recorder } = makeDeps({ hasProLicense: async () => true });

		const outcome = await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.equal(outcome, 'suppressed-licensed');
		assert.deepEqual(recorder.messages, []);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY), true);
	});

	test('does not re-check the license once the notice is spent', async () => {
		const { context } = makeFakeContext({
			...earned,
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
		const { context } = makeFakeContext(earned);
		const { deps, recorder } = makeDeps({
			showInformationMessage: async () => PRO_UPGRADE_PROMPT_LABEL,
		});

		await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.deepEqual(recorder.openedUrls, [PRO_PURCHASE_URL]);
		assert.deepEqual(recorder.commands, []);
	});

	test('choosing Enter License Key runs the activation command', async () => {
		const { context } = makeFakeContext(earned);
		const { deps, recorder } = makeDeps({
			showInformationMessage: async () => PRO_ACTIVATE_PROMPT_LABEL,
		});

		await maybeShowProUpgradeNotice(context, undefined, deps);

		assert.deepEqual(recorder.commands, [ENTER_PRO_LICENSE_KEY_COMMAND]);
		assert.deepEqual(recorder.openedUrls, []);
	});

	test('a corrupt stored count restarts from zero', async () => {
		const { context, store } = makeFakeContext({
			[PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY]: 'not-a-count',
		});
		const { deps } = makeDeps();

		assert.equal(await maybeShowProUpgradeNotice(context, undefined, deps), 'below-threshold');
		assert.equal(await recordProUpgradeNoticeSave(context), 1);
		assert.equal(store.get(PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY), 1);
	});
});
