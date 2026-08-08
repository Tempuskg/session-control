import * as assert from 'node:assert';
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

	test('hasProLicense returns false when organization id is not configured', async () => {
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
			}) as import('vscode').WorkspaceConfiguration,
		});

		assert.equal(await manager.hasProLicense(), false);
	});

	test('ships the production Polar organization ID as the default', () => {
		const inspected = vscode.workspace
			.getConfiguration('session-control')
			.inspect<string>('pro.polar.organizationId');

		assert.ok(inspected, 'pro.polar.organizationId is not a contributed setting');
		assert.equal(inspected.defaultValue, PRODUCTION_POLAR_ORGANIZATION_ID);
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
