import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	activateProFeatures,
	hasProLicense,
	loadProFeatureRegistrar,
	openProPurchasePage,
	PRO_FEATURES_LOADED_CONTEXT_KEY,
	PRO_PURCHASE_URL,
	PRO_UPGRADE_PROMPT_LABEL,
	SHARED_HANDOFF_CAPABILITY_VERSION,
	showUpgradePrompt,
	type ProFeatureRegistrationContext,
	type ProServices,
} from '../../src/pro';
import { createFakeJudgmentService } from '../../src/typesafe/judgmentService';

function createModuleNotFoundError(specifier: string): NodeJS.ErrnoException {
	const error = new Error(`Cannot find module '${specifier}'`) as NodeJS.ErrnoException;
	error.code = 'MODULE_NOT_FOUND';
	return error;
}

function createRegistrationContext(logs: string[], registrations: vscode.Disposable[]): ProFeatureRegistrationContext {
	return {
		extensionContext: {} as vscode.ExtensionContext,
		hasProLicense: async () => false,
		showUpgradePrompt: async () => undefined,
		log: (message) => {
			logs.push(message);
		},
		registerDisposable: (disposable) => {
			registrations.push(disposable);
		},
	};
}

suite('pro boundary', () => {
	test('loadProFeatureRegistrar returns unavailable when the private package is absent', () => {
		const result = loadProFeatureRegistrar({
			moduleSpecifier: '@tempuskg/session-control-pro',
			resolveModule: () => {
				throw createModuleNotFoundError('@tempuskg/session-control-pro');
			},
		});

		assert.equal(result.kind, 'unavailable');
		if (result.kind === 'unavailable') {
			assert.equal(result.reason, 'not-found');
			assert.match(result.detail, /continuing with free features only/i);
		}
	});

	test('loadProFeatureRegistrar accepts a default export wrapper', () => {
		const registrar = async () => undefined;
		const result = loadProFeatureRegistrar({
			moduleSpecifier: 'session-control-pro-test',
			resolveModule: () => 'C:/temp/pro/index.js',
			requireModule: () => ({
				default: {
					registerProFeatures: registrar,
				},
			}),
		});

		assert.equal(result.kind, 'available');
		if (result.kind === 'available') {
			assert.equal(result.registrar, registrar);
			assert.equal(result.resolvedPath, 'C:/temp/pro/index.js');
		}
	});

	test('activateProFeatures registers disposables from the private registrar', async () => {
		const logs: string[] = [];
		const registrations: vscode.Disposable[] = [];
		let invoked = false;

		const result = await activateProFeatures(
			createRegistrationContext(logs, registrations),
			{
				moduleSpecifier: 'session-control-pro-test',
				resolveModule: () => 'C:/temp/pro/index.js',
				requireModule: () => ({
					registerProFeatures: async () => {
						invoked = true;
						return [{
							dispose: () => undefined,
						} satisfies vscode.Disposable];
					},
				}),
			},
		);

		assert.equal(result.kind, 'available');
		assert.equal(invoked, true);
		assert.equal(registrations.length, 1);
		assert.ok(logs.some((message) => message.includes('Loaded Pro features')));
	});

	test('activateProFeatures sets the proFeaturesLoaded context key after the registrar loads', async () => {
		const contextCalls: Array<[string, unknown]> = [];
		let registered = false;

		const result = await activateProFeatures(
			createRegistrationContext([], []),
			{
				moduleSpecifier: 'session-control-pro-test',
				resolveModule: () => 'C:/temp/pro/index.js',
				requireModule: () => ({
					registerProFeatures: async () => {
						registered = true;
					},
				}),
				setContext: async (key, value) => {
					assert.equal(registered, true, 'context key must be set after registration');
					contextCalls.push([key, value]);
				},
			},
		);

		assert.equal(result.kind, 'available');
		assert.deepEqual(contextCalls, [[PRO_FEATURES_LOADED_CONTEXT_KEY, true]]);
		assert.equal(PRO_FEATURES_LOADED_CONTEXT_KEY, 'session-control.proFeaturesLoaded');
	});

	test('activateProFeatures leaves proFeaturesLoaded unset when the companion package is not installed', async () => {
		const contextCalls: Array<[string, unknown]> = [];

		const result = await activateProFeatures(
			createRegistrationContext([], []),
			{
				moduleSpecifier: '@tempuskg/session-control-pro',
				resolveModule: () => {
					throw createModuleNotFoundError('@tempuskg/session-control-pro');
				},
				setContext: async (key, value) => {
					contextCalls.push([key, value]);
				},
			},
		);

		assert.equal(result.kind, 'unavailable');
		assert.deepEqual(contextCalls, []);
	});

	test('activateProFeatures leaves proFeaturesLoaded unset when registration fails', async () => {
		const contextCalls: Array<[string, unknown]> = [];

		const result = await activateProFeatures(
			createRegistrationContext([], []),
			{
				moduleSpecifier: 'session-control-pro-test',
				resolveModule: () => 'C:/temp/pro/index.js',
				requireModule: () => ({
					registerProFeatures: async () => {
						throw new Error('boom');
					},
				}),
				setContext: async (key, value) => {
					contextCalls.push([key, value]);
				},
			},
		);

		assert.equal(result.kind, 'unavailable');
		assert.deepEqual(contextCalls, []);
	});

	test('package.json gates Pro view menu entries on proFeaturesLoaded', async () => {
		const manifestPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
		const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
			contributes: { menus: Record<string, Array<{ command: string; when?: string }>> };
		};
		const proViewEntries = [
			...manifest.contributes.menus['view/title'] ?? [],
			...manifest.contributes.menus['view/item/context'] ?? [],
		].filter((entry) => entry.command.startsWith('session-control-pro.'));

		assert.deepEqual(
			proViewEntries.map((entry) => entry.command).sort(),
			[
				'session-control-pro.exportSessionToControlFile',
				'session-control-pro.gitSyncPull',
				'session-control-pro.gitSyncPush',
				'session-control-pro.harvestSessionFromExplorer',
				'session-control-pro.searchSessions',
			],
		);
		for (const entry of proViewEntries) {
			assert.match(entry.when ?? '', /&& session-control\.proFeaturesLoaded$/, entry.command);
		}
	});

	test('activateProFeatures advertises the versioned shared handoff capability', async () => {
		const logs: string[] = [];
		const registrations: vscode.Disposable[] = [];
		let registrarContext: ProFeatureRegistrationContext | undefined;

		const result = await activateProFeatures(
			createRegistrationContext(logs, registrations),
			{
				moduleSpecifier: 'session-control-pro-test',
				resolveModule: () => 'C:/temp/pro/index.js',
				requireModule: () => ({
					registerProFeatures: async (context: ProFeatureRegistrationContext) => {
						registrarContext = context;
					},
				}),
				createHandoffDispatcher: () => ({
					dispatchSelection: async (prompt, selectedTarget, options) => {
						assert.equal(prompt, 'Harvest this workspace');
						assert.equal(selectedTarget, 'codex');
						assert.deepEqual(options, { promptLabel: 'harvest prompt' });
						return {
							selectedTarget: 'codex',
							deliveredTo: 'codex',
							method: 'paste',
							instruction: 'Review it and send it when ready.',
							failures: [],
						};
					},
				}),
			},
		);

		assert.equal(result.kind, 'available');
		const sharedHandoff = registrarContext?.capabilities?.sharedHandoff;
		assert.ok(sharedHandoff);
		assert.equal(sharedHandoff.version, SHARED_HANDOFF_CAPABILITY_VERSION);
		const dispatchResult = await sharedHandoff.dispatch(
			'Harvest this workspace',
			'codex',
			{ promptLabel: 'harvest prompt' },
		);
		assert.equal(dispatchResult.method, 'paste');
	});

	test('activateProFeatures passes the judgment service through ProServices', async () => {
		const logs: string[] = [];
		const registrations: vscode.Disposable[] = [];
		const judgment = createFakeJudgmentService();
		let registrarContext: ProFeatureRegistrationContext | undefined;

		const result = await activateProFeatures(
			{ ...createRegistrationContext(logs, registrations), judgment },
			{
				moduleSpecifier: 'session-control-pro-test',
				resolveModule: () => 'C:/temp/pro/index.js',
				requireModule: () => ({
					registerProFeatures: async (context: ProFeatureRegistrationContext) => {
						registrarContext = context;
					},
				}),
			},
		);

		assert.equal(result.kind, 'available');
		const services: ProServices | undefined = registrarContext;
		assert.equal(services?.judgment, judgment);
	});

	test('hasProLicense defaults to false until billing is wired', async () => {
		assert.equal(await hasProLicense(), false);
	});

	test('showUpgradePrompt opens the purchase URL only when requested', async () => {
		const opened: string[] = [];

		await showUpgradePrompt(undefined, {
			showInformationMessage: async () => PRO_UPGRADE_PROMPT_LABEL,
			openExternal: async (target) => {
				opened.push(target.toString());
				return true;
			},
			parseUri: (value) => vscode.Uri.parse(value),
			upgradeUrl: PRO_PURCHASE_URL,
		});

		assert.deepEqual(opened, [PRO_PURCHASE_URL]);
	});

	test('showUpgradePrompt opens nothing when the prompt is dismissed', async () => {
		const opened: string[] = [];

		await showUpgradePrompt(undefined, {
			showInformationMessage: async () => undefined,
			openExternal: async (target) => {
				opened.push(target.toString());
				return true;
			},
			parseUri: (value) => vscode.Uri.parse(value),
			upgradeUrl: PRO_PURCHASE_URL,
		});

		assert.deepEqual(opened, []);
	});

	test('the purchase URL points at the landing page Pro section that carries checkout', () => {
		assert.equal(PRO_PURCHASE_URL, 'https://sessioncontrol.dev/#pro');
	});

	test('openProPurchasePage opens the purchase URL directly', async () => {
		const opened: string[] = [];

		await openProPurchasePage({
			openExternal: async (target) => {
				opened.push(target.toString());
				return true;
			},
			parseUri: (value) => vscode.Uri.parse(value),
		});

		assert.deepEqual(opened, [PRO_PURCHASE_URL]);
	});
});
