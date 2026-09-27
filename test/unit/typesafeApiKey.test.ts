import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	CLEAR_TYPESAFE_API_KEY_COMMAND,
	SET_TYPESAFE_API_KEY_COMMAND,
	TYPESAFE_API_KEY_ENV_VAR,
	TYPESAFE_API_KEY_SECRET,
	clearTypeSafeApiKey,
	registerTypeSafeApiKeyCommands,
	resolveTypeSafeApiKey,
	setTypeSafeApiKey,
	type SecretStorageLike,
	type TypeSafeApiKeyDeps,
} from '../../src/typesafe/apiKey';
import { createJudgmentService, noul, type TypeSafeConsentGate } from '../../src/typesafe/judgmentService';

const grantedConsent: TypeSafeConsentGate = {
	hasConsent: () => true,
	ensureConsent: () => Promise.resolve(true),
};

interface PackageManifest {
	contributes?: {
		commands?: Array<{
			command: string;
			title: string;
			category?: string;
		}>;
		menus?: {
			commandPalette?: Array<{
				command: string;
				when?: string;
			}>;
		};
	};
}

async function readPackageManifest(): Promise<PackageManifest> {
	const manifestPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
	const raw = await fs.readFile(manifestPath, 'utf8');
	return JSON.parse(raw) as PackageManifest;
}

function createFakeSecretStorage(initial: Record<string, string> = {}): SecretStorageLike & {
	storeMap: Map<string, string>;
	storeCalls: Array<{ key: string; value: string }>;
	deleteCalls: string[];
} {
	const storeMap = new Map<string, string>(Object.entries(initial));
	const storeCalls: Array<{ key: string; value: string }> = [];
	const deleteCalls: string[] = [];

	return {
		storeMap,
		storeCalls,
		deleteCalls,
		async get(key: string): Promise<string | undefined> {
			return storeMap.get(key);
		},
		async store(key: string, value: string): Promise<void> {
			storeCalls.push({ key, value });
			storeMap.set(key, value);
		},
		async delete(key: string): Promise<void> {
			deleteCalls.push(key);
			storeMap.delete(key);
		},
	};
}

async function withServer(
	handler: http.RequestListener,
	run: (baseURL: string) => Promise<void>,
): Promise<void> {
	const server = http.createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address() as AddressInfo;
		await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

const noRetry = {
	retry: {
		maxRetries: 0,
	},
};

suite('typesafe/apiKey', () => {
	suite('Resolution order: SecretStorage then env var', () => {
		test('returns SecretStorage key when both SecretStorage and env var are set', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'secret-storage-key-123',
			});
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: 'env-var-key-456' };

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, 'secret-storage-key-123');
		});

		test('falls back to env var when SecretStorage is empty', async () => {
			const secrets = createFakeSecretStorage();
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: 'env-var-key-456' };

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, 'env-var-key-456');
		});

		test('falls back to env var when SecretStorage returns whitespace string', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: '   ',
			});
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: 'env-var-key-456' };

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, 'env-var-key-456');
		});

		test('falls back to env var when SecretStorage returns empty string', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: '',
			});
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: 'env-var-key-456' };

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, 'env-var-key-456');
		});

		test('falls back to env var when SecretStorage is undefined', async () => {
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: 'env-var-key-456' };

			const resolved = await resolveTypeSafeApiKey(undefined, env);
			assert.strictEqual(resolved, 'env-var-key-456');
		});

		test('falls back to env var when SecretStorage throws an error', async () => {
			const throwingSecrets: SecretStorageLike = {
				async get(): Promise<string | undefined> {
					throw new Error('SecretStorage locked or unavailable');
				},
				async store(): Promise<void> {},
				async delete(): Promise<void> {},
			};
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: 'env-var-key-456' };

			const resolved = await resolveTypeSafeApiKey(throwingSecrets, env);
			assert.strictEqual(resolved, 'env-var-key-456');
		});

		test('returns undefined when neither SecretStorage nor env var has a key', async () => {
			const secrets = createFakeSecretStorage();
			const env: NodeJS.ProcessEnv = {};

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, undefined);
		});

		test('returns undefined when env var is whitespace only', async () => {
			const secrets = createFakeSecretStorage();
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: '   \t\n ' };

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, undefined);
		});

		test('trims whitespace from SecretStorage key', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: '   secret-with-padding   \n',
			});

			const resolved = await resolveTypeSafeApiKey(secrets, {});
			assert.strictEqual(resolved, 'secret-with-padding');
		});

		test('trims whitespace from env var key', async () => {
			const secrets = createFakeSecretStorage();
			const env = { [TYPESAFE_API_KEY_ENV_VAR]: '   env-with-padding   \n' };

			const resolved = await resolveTypeSafeApiKey(secrets, env);
			assert.strictEqual(resolved, 'env-with-padding');
		});

		test('TypeSafeJudgmentService resolves SecretStorage before env var in network requests', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'secret-storage-winner',
			});
			const originalEnv = process.env[TYPESAFE_API_KEY_ENV_VAR];
			process.env[TYPESAFE_API_KEY_ENV_VAR] = 'env-var-loser';

			let capturedAuthHeader: string | undefined;

			try {
				await withServer(
					(req, res) => {
						capturedAuthHeader = req.headers.authorization;
						res.writeHead(200, { 'content-type': 'application/json' });
						res.end(
							JSON.stringify({
								model: 'jev-latest',
								answers: { ok: { type: 'noul', noul: 1 } },
								usage: { input_tokens: 1, output_tokens: 1 },
							}),
						);
					},
					async (baseURL) => {
						const service = createJudgmentService({
							consent: grantedConsent,
							isEnabled: () => true,
							secrets,
							getBaseURL: () => baseURL,
							...noRetry,
						});

						const result = await service.ask('test state', { ok: noul('test') });
						assert.ok(result);
						assert.strictEqual(capturedAuthHeader, 'Bearer secret-storage-winner');
					},
				);
			} finally {
				if (originalEnv !== undefined) {
					process.env[TYPESAFE_API_KEY_ENV_VAR] = originalEnv;
				} else {
					delete process.env[TYPESAFE_API_KEY_ENV_VAR];
				}
			}
		});

		test('TypeSafeJudgmentService falls back to env var in network requests when secrets empty', async () => {
			const secrets = createFakeSecretStorage();
			const originalEnv = process.env[TYPESAFE_API_KEY_ENV_VAR];
			process.env[TYPESAFE_API_KEY_ENV_VAR] = 'env-var-fallback-winner';

			let capturedAuthHeader: string | undefined;

			try {
				await withServer(
					(req, res) => {
						capturedAuthHeader = req.headers.authorization;
						res.writeHead(200, { 'content-type': 'application/json' });
						res.end(
							JSON.stringify({
								model: 'jev-latest',
								answers: { ok: { type: 'noul', noul: 1 } },
								usage: { input_tokens: 1, output_tokens: 1 },
							}),
						);
					},
					async (baseURL) => {
						const service = createJudgmentService({
							consent: grantedConsent,
							isEnabled: () => true,
							secrets,
							getBaseURL: () => baseURL,
							...noRetry,
						});

						const result = await service.ask('test state', { ok: noul('test') });
						assert.ok(result);
						assert.strictEqual(capturedAuthHeader, 'Bearer env-var-fallback-winner');
					},
				);
			} finally {
				if (originalEnv !== undefined) {
					process.env[TYPESAFE_API_KEY_ENV_VAR] = originalEnv;
				} else {
					delete process.env[TYPESAFE_API_KEY_ENV_VAR];
				}
			}
		});
	});

	suite('Key confidentiality: SecretStorage only, never settings or logs', () => {
		test('setTypeSafeApiKey prompts with password masking and stores trimmed key in SecretStorage', async () => {
			const secrets = createFakeSecretStorage();
			let inputBoxOptions: vscode.InputBoxOptions | undefined;
			let infoMessageShown: string | undefined;

			const enteredKey = 'ts_live_secret_key_abcdef123456';

			const deps: TypeSafeApiKeyDeps = {
				secrets,
				showInputBox: async (options) => {
					inputBoxOptions = options;
					return `  ${enteredKey}  `;
				},
				showInformationMessage: async (msg) => {
					infoMessageShown = msg;
					return undefined;
				},
			};

			const success = await setTypeSafeApiKey(deps);
			assert.strictEqual(success, true);

			// Key is masked during input
			assert.strictEqual(inputBoxOptions?.password, true);
			assert.strictEqual(inputBoxOptions?.ignoreFocusOut, true);

			// Key is stored in SecretStorage under the expected key name
			assert.strictEqual(secrets.storeCalls.length, 1);
			assert.strictEqual(secrets.storeCalls[0]?.key, TYPESAFE_API_KEY_SECRET);
			assert.strictEqual(secrets.storeCalls[0]?.value, enteredKey);

			// Info message does not leak the key
			assert.strictEqual(infoMessageShown, 'TypeSafe API key saved.');
			assert.strictEqual(infoMessageShown.includes(enteredKey), false);
		});

		test('setTypeSafeApiKey does not modify SecretStorage when user cancels', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'existing-key',
			});

			const deps: TypeSafeApiKeyDeps = {
				secrets,
				showInputBox: async () => undefined,
			};

			const success = await setTypeSafeApiKey(deps);
			assert.strictEqual(success, false);
			assert.strictEqual(secrets.storeCalls.length, 0);
			assert.strictEqual(await secrets.get(TYPESAFE_API_KEY_SECRET), 'existing-key');
		});

		test('setTypeSafeApiKey does not modify SecretStorage when user enters empty/whitespace', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'existing-key',
			});
			let warningMessageShown: string | undefined;

			const deps: TypeSafeApiKeyDeps = {
				secrets,
				showInputBox: async () => '   ',
				showWarningMessage: async (msg) => {
					warningMessageShown = msg;
					return undefined;
				},
			};

			const success = await setTypeSafeApiKey(deps);
			assert.strictEqual(success, false);
			assert.strictEqual(secrets.storeCalls.length, 0);
			assert.strictEqual(await secrets.get(TYPESAFE_API_KEY_SECRET), 'existing-key');
			assert.ok(warningMessageShown?.includes('No TypeSafe API key was entered'));
		});

		test('clearTypeSafeApiKey deletes key from SecretStorage after confirmation', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'key-to-delete',
			});
			let warningMsg: string | undefined;
			let infoMsg: string | undefined;

			const deps: TypeSafeApiKeyDeps = {
				secrets,
				showWarningMessage: async (msg, _opts, ...items) => {
					warningMsg = msg;
					assert.ok(items.includes('Clear'));
					return 'Clear';
				},
				showInformationMessage: async (msg) => {
					infoMsg = msg;
					return undefined;
				},
			};

			const success = await clearTypeSafeApiKey(deps);
			assert.strictEqual(success, true);
			assert.ok(warningMsg?.includes('Clear your stored TypeSafe API key?'));
			assert.strictEqual(secrets.deleteCalls.length, 1);
			assert.strictEqual(secrets.deleteCalls[0], TYPESAFE_API_KEY_SECRET);
			assert.strictEqual(await secrets.get(TYPESAFE_API_KEY_SECRET), undefined);
			assert.strictEqual(infoMsg, 'TypeSafe API key cleared.');
		});

		test('clearTypeSafeApiKey aborts deletion if user cancels confirmation modal', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'key-to-keep',
			});

			const deps: TypeSafeApiKeyDeps = {
				secrets,
				showWarningMessage: async () => undefined,
			};

			const success = await clearTypeSafeApiKey(deps);
			assert.strictEqual(success, false);
			assert.strictEqual(secrets.deleteCalls.length, 0);
			assert.strictEqual(await secrets.get(TYPESAFE_API_KEY_SECRET), 'key-to-keep');
		});

		test('clearTypeSafeApiKey supports skipConfirmation option', async () => {
			const secrets = createFakeSecretStorage({
				[TYPESAFE_API_KEY_SECRET]: 'key-to-delete',
			});

			const deps: TypeSafeApiKeyDeps = {
				secrets,
				showInformationMessage: async () => undefined,
			};

			const success = await clearTypeSafeApiKey(deps, { skipConfirmation: true });
			assert.strictEqual(success, true);
			assert.strictEqual(secrets.deleteCalls.length, 1);
			assert.strictEqual(await secrets.get(TYPESAFE_API_KEY_SECRET), undefined);
		});
	});

	suite('Command palette contributions and registration', () => {
		test('both commands are contributed to package.json contributes.commands', async () => {
			const manifest = await readPackageManifest();
			const commands = manifest.contributes?.commands ?? [];

			const setCmd = commands.find((c) => c.command === SET_TYPESAFE_API_KEY_COMMAND);
			assert.ok(setCmd, `Expected ${SET_TYPESAFE_API_KEY_COMMAND} in contributes.commands`);
			assert.strictEqual(setCmd?.title, 'Set TypeSafe API Key');
			assert.strictEqual(setCmd?.category, 'Session Control');

			const clearCmd = commands.find((c) => c.command === CLEAR_TYPESAFE_API_KEY_COMMAND);
			assert.ok(clearCmd, `Expected ${CLEAR_TYPESAFE_API_KEY_COMMAND} in contributes.commands`);
			assert.strictEqual(clearCmd?.title, 'Clear TypeSafe API Key');
			assert.strictEqual(clearCmd?.category, 'Session Control');
		});

		test('both commands appear in the command palette without when: false', async () => {
			const manifest = await readPackageManifest();
			const palette = manifest.contributes?.menus?.commandPalette ?? [];

			const setPalette = palette.find((c) => c.command === SET_TYPESAFE_API_KEY_COMMAND);
			assert.ok(setPalette, `Expected ${SET_TYPESAFE_API_KEY_COMMAND} in menus.commandPalette`);
			assert.notStrictEqual(setPalette?.when, 'false');

			const clearPalette = palette.find((c) => c.command === CLEAR_TYPESAFE_API_KEY_COMMAND);
			assert.ok(clearPalette, `Expected ${CLEAR_TYPESAFE_API_KEY_COMMAND} in menus.commandPalette`);
			assert.notStrictEqual(clearPalette?.when, 'false');
		});

		test('registerTypeSafeApiKeyCommands registers both commands and returns disposables', () => {
			const secrets = createFakeSecretStorage();
			const registeredCommands: Array<{ command: string; handler: () => Promise<void> }> = [];

			const fakeRegisterCommand = ((command: string, handler: () => Promise<void>) => {
				registeredCommands.push({ command, handler });
				return { dispose: () => {} };
			}) as unknown as typeof vscode.commands.registerCommand;

			const fakeContext = { secrets } as unknown as vscode.ExtensionContext;

			const disposables = registerTypeSafeApiKeyCommands(fakeContext, {
				registerCommand: fakeRegisterCommand,
			});

			assert.strictEqual(disposables.length, 2);
			assert.strictEqual(registeredCommands.length, 2);
			assert.strictEqual(registeredCommands[0]?.command, SET_TYPESAFE_API_KEY_COMMAND);
			assert.strictEqual(registeredCommands[1]?.command, CLEAR_TYPESAFE_API_KEY_COMMAND);
		});

		test('both commands are registered in vscode.commands in active extension host', async () => {
			const allCommands = await vscode.commands.getCommands(true);
			assert.ok(
				allCommands.includes(SET_TYPESAFE_API_KEY_COMMAND),
				`Expected ${SET_TYPESAFE_API_KEY_COMMAND} in vscode.commands`,
			);
			assert.ok(
				allCommands.includes(CLEAR_TYPESAFE_API_KEY_COMMAND),
				`Expected ${CLEAR_TYPESAFE_API_KEY_COMMAND} in vscode.commands`,
			);
		});
	});
});
