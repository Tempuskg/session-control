import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createProLicenseManager } from '../../src/pro/licenseManager';

const PRODUCTION_POLAR_ORGANIZATION_ID = '9a3f3f03-1384-425b-8a7a-54866b7d634a';

function makeFakeContext(): import('vscode').ExtensionContext {
	const store = new Map<string, unknown>();
	const secrets = new Map<string, string>();
	return {
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
		secrets: {
			get: async (key: string) => secrets.get(key),
			store: async (key: string, value: string) => {
				secrets.set(key, value);
			},
			delete: async (key: string) => {
				secrets.delete(key);
			},
			onDidChange: { event: () => ({ dispose: () => { /* no-op */ } }) } as never,
		},
	} as unknown as import('vscode').ExtensionContext;
}

suite('pro license manager', () => {
	test('hasProLicense returns false when no key is stored', async () => {
		const manager = createProLicenseManager({
			context: makeFakeContext(),
			getConfiguration: () => ({
				get<T>(_key: string, defaultValue?: T): T {
					return defaultValue as T;
				},
			}) as import('vscode').WorkspaceConfiguration,
		});

		assert.equal(await manager.hasProLicense(), false);
	});

	test('hasProLicense returns false when organization id is intentionally cleared', async () => {
		const context = makeFakeContext();
		await context.secrets.store('session-control.pro.licenseKey', 'KEY-123');
		const manager = createProLicenseManager({
			context,
			fetch: async () => ({
				ok: true,
				json: async () => ({ status: 'granted' }),
			}) as Response,
			getConfiguration: () => ({
				get<T>(key: string, defaultValue?: T): T {
					if (key === 'pro.polar.organizationId') {
						return '' as T;
					}
					return defaultValue as T;
				},
				inspect<T>(key: string) {
					if (key === 'pro.polar.organizationId') {
						return {
							key: 'session-control.pro.polar.organizationId',
							defaultValue: PRODUCTION_POLAR_ORGANIZATION_ID as T,
							globalValue: '' as T,
						};
					}
					return undefined;
				},
			}) as import('vscode').WorkspaceConfiguration,
		});

		assert.equal(await manager.hasProLicense(), false);
	});

	test('ships the production Polar organization ID as the default', () => {
		const packageJson = JSON.parse(
			fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
		) as {
			contributes?: {
				configuration?: {
					properties?: Record<string, { default?: unknown }>;
				};
			};
		};
		assert.equal(
			packageJson.contributes?.configuration?.properties?.['session-control.pro.polar.organizationId']?.default,
			PRODUCTION_POLAR_ORGANIZATION_ID,
		);

		const inspected = vscode.workspace
			.getConfiguration('session-control')
			.inspect<string>('pro.polar.organizationId');

		assert.ok(inspected, 'pro.polar.organizationId is not a contributed setting');
		// Cursor hosts have been observed to omit contributed defaultValue in inspect()
		// even when package.json ships the production UUID; assert it when present.
		if (inspected.defaultValue !== undefined) {
			assert.equal(inspected.defaultValue, PRODUCTION_POLAR_ORGANIZATION_ID);
		}
	});

	test('uses the production Polar organization ID when configuration is absent', async () => {
		const context = makeFakeContext();
		await context.secrets.store('session-control.pro.licenseKey', 'KEY-123');

		let requestBody = '';
		const manager = createProLicenseManager({
			context,
			fetch: async (_input, init) => {
				requestBody = typeof init?.body === 'string' ? init.body : '';
				return {
					ok: true,
					json: async () => ({ status: 'granted' }),
				} as Response;
			},
			getConfiguration: () => ({
				get<T>(_key: string, defaultValue?: T): T {
					return defaultValue as T;
				},
			}) as vscode.WorkspaceConfiguration,
		});

		assert.equal(await manager.hasProLicense(), true);
		assert.equal(JSON.parse(requestBody).organization_id, PRODUCTION_POLAR_ORGANIZATION_ID);
	});

	test('uses the production Polar organization ID when effective value is empty without an override', async () => {
		const context = makeFakeContext();
		await context.secrets.store('session-control.pro.licenseKey', 'KEY-123');

		let requestBody = '';
		const manager = createProLicenseManager({
			context,
			fetch: async (_input, init) => {
				requestBody = typeof init?.body === 'string' ? init.body : '';
				return {
					ok: true,
					json: async () => ({ status: 'granted' }),
				} as Response;
			},
			getConfiguration: () => ({
				get<T>(key: string, defaultValue?: T): T {
					// Simulates stale default:"" or Cursor returning an empty effective
					// application-scoped value when no user override exists.
					if (key === 'pro.polar.organizationId') {
						return '' as T;
					}
					return defaultValue as T;
				},
				inspect<T>(key: string) {
					if (key === 'pro.polar.organizationId') {
						return {
							key: 'session-control.pro.polar.organizationId',
							defaultValue: '' as T,
						};
					}
					return undefined;
				},
			}) as vscode.WorkspaceConfiguration,
		});

		assert.equal(await manager.hasProLicense(), true);
		assert.equal(JSON.parse(requestBody).organization_id, PRODUCTION_POLAR_ORGANIZATION_ID);
	});

	test('promptEnterKey does not report missing organization when the production default applies', async () => {
		const context = makeFakeContext();
		const errorMessages: string[] = [];
		const originalShowInputBox = vscode.window.showInputBox;
		const originalShowErrorMessage = vscode.window.showErrorMessage;
		const originalShowInformationMessage = vscode.window.showInformationMessage;

		(vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = async () => 'KEY-123';
		(vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
			async (message: string) => {
				errorMessages.push(message);
				return undefined;
			};
		(vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
			async () => undefined;

		try {
			const manager = createProLicenseManager({
				context,
				fetch: async () => ({
					ok: false,
					json: async () => ({}),
				}) as Response,
				getConfiguration: () => ({
					get<T>(key: string, defaultValue?: T): T {
						if (key === 'pro.polar.organizationId') {
							return '' as T;
						}
						return defaultValue as T;
					},
					inspect<T>(key: string) {
						if (key === 'pro.polar.organizationId') {
							return {
								key: 'session-control.pro.polar.organizationId',
								defaultValue: PRODUCTION_POLAR_ORGANIZATION_ID as T,
							};
						}
						return undefined;
					},
				}) as vscode.WorkspaceConfiguration,
			});

			assert.equal(await manager.promptEnterKey(), false);
			assert.equal(
				errorMessages.some((message) => message.includes('licensing is not configured')),
				false,
			);
			assert.equal(
				errorMessages.some((message) => message.includes('License key not recognized')),
				true,
			);
		} finally {
			(vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = originalShowInputBox;
			(vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
				originalShowErrorMessage;
			(vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
				originalShowInformationMessage;
		}
	});

	test('promptEnterKey reports missing organization when it is intentionally cleared', async () => {
		const context = makeFakeContext();
		const errorMessages: string[] = [];
		const originalShowInputBox = vscode.window.showInputBox;
		const originalShowErrorMessage = vscode.window.showErrorMessage;

		(vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = async () => 'KEY-123';
		(vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
			async (message: string) => {
				errorMessages.push(message);
				return undefined;
			};

		try {
			const manager = createProLicenseManager({
				context,
				fetch: async () => ({
					ok: true,
					json: async () => ({ status: 'granted' }),
				}) as Response,
				getConfiguration: () => ({
					get<T>(key: string, defaultValue?: T): T {
						if (key === 'pro.polar.organizationId') {
							return '' as T;
						}
						return defaultValue as T;
					},
					inspect<T>(key: string) {
						if (key === 'pro.polar.organizationId') {
							return {
								key: 'session-control.pro.polar.organizationId',
								defaultValue: PRODUCTION_POLAR_ORGANIZATION_ID as T,
								globalValue: '' as T,
							};
						}
						return undefined;
					},
				}) as vscode.WorkspaceConfiguration,
			});

			assert.equal(await manager.promptEnterKey(), false);
			assert.equal(
				errorMessages.some((message) =>
					message.includes('Set session-control.pro.polar.organizationId first')),
				true,
			);
		} finally {
			(vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = originalShowInputBox;
			(vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
				originalShowErrorMessage;
		}
	});

	test('hasProLicense validates against the configured Polar sandbox endpoint', async () => {
		const context = makeFakeContext();
		await context.secrets.store('session-control.pro.licenseKey', 'KEY-123');

		let requestedUrl = '';
		let requestBody = '';
		const manager = createProLicenseManager({
			context,
			fetch: async (input, init) => {
				requestedUrl = typeof input === 'string' ? input : input.toString();
				requestBody = typeof init?.body === 'string' ? init.body : '';
				return {
					ok: true,
					json: async () => ({ status: 'granted' }),
				} as Response;
			},
			getConfiguration: () => ({
				get<T>(key: string, defaultValue?: T): T {
					if (key === 'pro.polar.organizationId') {
						return 'org_123' as T;
					}
					if (key === 'pro.polar.apiBaseUrl') {
						return 'https://sandbox-api.polar.sh/' as T;
					}
					return defaultValue as T;
				},
			}) as import('vscode').WorkspaceConfiguration,
		});

		assert.equal(await manager.hasProLicense(), true);
		assert.equal(requestedUrl, 'https://sandbox-api.polar.sh/v1/customer-portal/license-keys/validate');
		assert.deepEqual(JSON.parse(requestBody), {
			key: 'KEY-123',
			organization_id: 'org_123',
		});
	});

	test('clearKey removes the stored key and cached validity', async () => {
		const context = makeFakeContext();
		await context.secrets.store('session-control.pro.licenseKey', 'KEY-123');
		const manager = createProLicenseManager({
			context,
			getConfiguration: () => ({
				get<T>(_key: string, defaultValue?: T): T {
					return defaultValue as T;
				},
			}) as import('vscode').WorkspaceConfiguration,
		});

		await context.globalState.update('session-control.pro.licenseCache', {
			valid: true,
			expiresAt: Date.now() + 1000,
		});
		await manager.clearKey();

		assert.equal(await context.secrets.get('session-control.pro.licenseKey'), undefined);
		assert.equal(context.globalState.get('session-control.pro.licenseCache'), undefined);
	});
});
