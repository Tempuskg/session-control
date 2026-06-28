import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	activateProFeatures,
	DEFAULT_PRO_UPGRADE_URL,
	hasProLicense,
	loadProFeatureRegistrar,
	PRO_UPGRADE_PROMPT_LABEL,
	showUpgradePrompt,
	type ProFeatureRegistrationContext,
} from '../../src/pro';

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

	test('hasProLicense defaults to false until billing is wired', async () => {
		assert.equal(await hasProLicense(), false);
	});

	test('showUpgradePrompt opens the upgrade URL only when requested', async () => {
		const opened: string[] = [];

		await showUpgradePrompt(undefined, {
			showInformationMessage: async () => PRO_UPGRADE_PROMPT_LABEL,
			openExternal: async (target) => {
				opened.push(target.toString());
				return true;
			},
			parseUri: (value) => vscode.Uri.parse(value),
			upgradeUrl: DEFAULT_PRO_UPGRADE_URL,
		});

		assert.deepEqual(opened, [DEFAULT_PRO_UPGRADE_URL]);
	});
});
