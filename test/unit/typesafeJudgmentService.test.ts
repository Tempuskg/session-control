import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import {
	createAnalysisStore,
} from '../../src/analysisStore';
import {
	APIConnectionError,
	APIError,
	APITimeoutError,
	APIUserAbortError,
	AuthenticationError,
	InternalServerError,
	RateLimitError,
} from '@typesafe-ai/sdk';
import {
	CLEAR_TYPESAFE_API_KEY_COMMAND,
	DEFAULT_TYPESAFE_FEATURES,
	DEFAULT_TYPESAFE_MODEL,
	FakeJudgmentService,
	SET_TYPESAFE_API_KEY_COMMAND,
	TYPESAFE_FEATURES,
	TypeSafeJudgmentService,
	choice,
	createFakeJudgmentService,
	createJudgmentService,
	isTypeSafeFeature,
	mapJudgmentError,
	noul,
	resolveTypeSafeFeatures,
	score,
	type JudgmentAskOptions,
	type JudgmentService,
	type TypeSafeConsentGate,
	type TypeSafeFeature,
} from '../../src/typesafe/judgmentService';

const grantedConsent: TypeSafeConsentGate = {
	hasConsent: () => true,
	ensureConsent: () => Promise.resolve(true),
};

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

class SimpleCancellationTokenSource {
	private _isCancelled = false;
	private _listeners: (() => void)[] = [];

	public get token(): vscode.CancellationToken {
		return {
			isCancellationRequested: this._isCancelled,
			onCancellationRequested: (listener: (e: unknown) => unknown): vscode.Disposable => {
				this._listeners.push(() => listener(undefined));
				return { dispose: () => {} };
			},
		};
	}

	public cancel(): void {
		this._isCancelled = true;
		for (const listener of this._listeners) {
			listener();
		}
	}

	public dispose(): void {
		this._listeners.length = 0;
	}
}

const fastRetry = {
	retry: {
		maxRetries: 2,
		backoffInitialMs: 5,
		backoffMaxMs: 20,
		backoffJitter: 0,
	},
};

const noRetry = {
	retry: {
		maxRetries: 0,
	},
};

suite('typesafe/judgmentService', () => {
	suite('Constants and error mapping', () => {
		test('exports the set and clear API key command identifiers', () => {
			assert.strictEqual(SET_TYPESAFE_API_KEY_COMMAND, 'session-control.setTypeSafeApiKey');
			assert.strictEqual(CLEAR_TYPESAFE_API_KEY_COMMAND, 'session-control.clearTypeSafeApiKey');
		});

		test('maps SDK error classes to JudgmentErrorKind', () => {
			assert.strictEqual(mapJudgmentError(new APIUserAbortError()), 'aborted');
			assert.strictEqual(mapJudgmentError(new AuthenticationError(401, {}, new Headers())), 'unauthorized');
			assert.strictEqual(mapJudgmentError(new RateLimitError(429, {}, new Headers())), 'rate-limited');
			assert.strictEqual(mapJudgmentError(new InternalServerError(500, {}, new Headers())), 'overloaded');
			assert.strictEqual(mapJudgmentError(new APITimeoutError(50)), 'timeout');
			assert.strictEqual(mapJudgmentError(new APIConnectionError('failed')), 'connection');
			assert.strictEqual(mapJudgmentError(new Error('boom')), 'other');
		});

		test('maps APIError with status codes to JudgmentErrorKind', () => {
			const e401 = APIError.fromResponse(401, { error: 'unauthorized' }, new Headers());
			const e429 = APIError.fromResponse(429, { error: 'rate limit' }, new Headers());
			const e529 = APIError.fromResponse(529, { error: 'overloaded' }, new Headers());
			const e503 = APIError.fromResponse(503, { error: 'unavailable' }, new Headers());

			assert.strictEqual(mapJudgmentError(e401), 'unauthorized');
			assert.strictEqual(mapJudgmentError(e429), 'rate-limited');
			assert.strictEqual(mapJudgmentError(e529), 'overloaded');
			assert.strictEqual(mapJudgmentError(e503), 'overloaded');
		});

		test('maps AbortError to aborted', () => {
			const abortErr = new Error('The operation was aborted');
			abortErr.name = 'AbortError';
			assert.strictEqual(mapJudgmentError(abortErr), 'aborted');
		});
	});

	suite('Disabled path & missing configuration', () => {
		test('returns undefined when isEnabled() is false and makes no network calls', async () => {
			let networkCalled = false;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					networkCalled = true;
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end('{}');
				},
				async (baseURL) => {
					const service: JudgmentService = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => false,
						getApiKey: () => 'valid-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
					});

					assert.strictEqual(service.isEnabled?.(), false);
					const result = await service.ask(
						'Some state',
						{ check: noul('Is this enabled?') },
					);

					assert.strictEqual(result, undefined);
					assert.strictEqual(networkCalled, false);
				},
			);
		});

		test('returns undefined when getApiKey() returns undefined', async () => {
			let networkCalled = false;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					networkCalled = true;
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end('{}');
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => undefined,
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
					});

					const result = await service.ask(
						'Some state',
						{ check: noul('Is there a key?') },
					);

					assert.strictEqual(result, undefined);
					assert.strictEqual(networkCalled, false);
				},
			);
		});

		test('returns undefined and logs when getApiKey() rejects', async () => {
			const logs: string[] = [];
			const service = createJudgmentService({
				consent: grantedConsent,
				isEnabled: () => true,
				getApiKey: () => Promise.reject(new Error('secrets unavailable')),
				log: (msg) => logs.push(msg),
			});

			const result = await service.ask('state', { check: noul('test') });
			assert.strictEqual(result, undefined);
			assert.ok(logs.some((l) => l.includes('error resolving API key') && l.includes('secrets unavailable')));
		});

		test('returns undefined when createClient throws', async () => {
			const logs: string[] = [];
			const service = createJudgmentService({
				consent: grantedConsent,
				isEnabled: () => true,
				getApiKey: () => 'some-key',
				createClient: () => {
					throw new Error('failed to create client');
				},
				log: (msg) => logs.push(msg),
			});

			const result = await service.ask('state', { check: noul('test') });
			assert.strictEqual(result, undefined);
			assert.ok(logs.some((l) => l.includes('error creating client')));
		});
	});

	suite('Cancellation', () => {
		test('returns undefined immediately when token is already cancelled', async () => {
			let serverCalled = false;
			await withServer(
				(_req, res) => {
					serverCalled = true;
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end('{}');
				},
				async (baseURL) => {
					const cts = new SimpleCancellationTokenSource();
					cts.cancel();

					const service = createJudgmentService({

						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						...noRetry,
					});

					const result = await service.ask('state', { check: noul('test') }, cts.token);
					assert.strictEqual(result, undefined);
					assert.strictEqual(serverCalled, false);
				},
			);
		});

		test('aborts in-flight request on token cancellation, logs aborted error, and returns undefined', async () => {
			const logs: string[] = [];
			let serverSawAbort = false;

			await withServer(
				(req, _res) => {
					req.on('aborted', () => {
						serverSawAbort = true;
					});
					req.on('close', () => {
						serverSawAbort = true;
					});
					// Never send response; will be cancelled
				},
				async (baseURL) => {
					const cts = new SimpleCancellationTokenSource();
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						...noRetry,
					});

					const pending = service.ask('state', { check: noul('test') }, cts.token);
					setTimeout(() => cts.cancel(), 20);

					const result = await pending;
					assert.strictEqual(result, undefined);
					assert.ok(logs.some((l) => l.includes('error kind=aborted')));

					// Wait for server abort event
					for (let i = 0; i < 20 && !serverSawAbort; i++) {
						await new Promise((resolve) => setTimeout(resolve, 25));
					}
					assert.strictEqual(serverSawAbort, true);
				},
			);
		});
	});

	suite('Successful call & logging', () => {
		test('logs latency and token usage to output channel on success and returns typed answers', async () => {
			const logs: string[] = [];

			await withServer(
				(req, res) => {
					let body = '';
					req.on('data', (c: Buffer) => (body += c.toString()));
					req.on('end', () => {
						const parsed = JSON.parse(body) as { state: string; questions: Record<string, unknown> };
						assert.strictEqual(parsed.state, 'Session context text');
						assert.ok(parsed.questions['intent']);
						assert.ok(parsed.questions['scoreVal']);

						res.writeHead(200, { 'content-type': 'application/json' });
						res.end(
							JSON.stringify({
								model: 'jev-latest',
								answers: {
									intent: {
										type: 'choice',
										choice: 'resume',
										confidence: 0.95,
										probabilities: { resume: 0.95, analyze: 0.05 },
									},
									scoreVal: {
										type: 'score',
										score: 2.1,
										confidence: 0.8,
										legend: { '0': 'none', '1': 'low', '2': 'medium', '3': 'high' },
										probabilities: { '0': 0.05, '1': 0.1, '2': 0.65, '3': 0.2 },
									},
								},
								usage: { input_tokens: 120, output_tokens: 15 },
							}),
						);
					});
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'valid-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						...noRetry,
					});

					const answers = await service.ask('Session context text', {
						intent: choice('What is the user intent?', {
							resume: 'Resume session',
							analyze: 'Analyze sessions',
						}),
						scoreVal: score('How complex is it?', ['none', 'low', 'medium', 'high'] as const),
					});

					assert.ok(answers);
					assert.strictEqual(answers.intent.type, 'choice');
					assert.strictEqual(answers.intent.choice, 'resume');
					assert.strictEqual(answers.scoreVal.type, 'score');
					assert.strictEqual(answers.scoreVal.score, 2.1);

					const successLog = logs.find((l) => l.startsWith('[typesafe] success'));
					assert.ok(successLog, 'expected a [typesafe] success log entry');
					assert.ok(successLog.includes('model=jev-latest'));
					assert.ok(successLog.includes('inputTokens=120'));
					assert.ok(successLog.includes('outputTokens=15'));
					assert.ok(/latency=\d+ms/.test(successLog), 'expected latency in ms');
				},
			);
		});

		test('supports outputChannel dependency with appendLine', async () => {
			const lines: string[] = [];
			await withServer(
				(_req, res) => {
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-test',
							answers: { isTrivial: { type: 'noul', noul: 0.1 } },
							usage: { input_tokens: 10, output_tokens: 2 },
						}),
					);
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'valid-key',
						getBaseURL: () => baseURL,
						outputChannel: { appendLine: (line) => lines.push(line) },
						...noRetry,
					});

					const answers = await service.ask('short text', {
						isTrivial: noul('Is this trivial?'),
					});

					assert.ok(answers);
					assert.strictEqual(answers.isTrivial.noul, 0.1);
					assert.ok(lines.some((l) => l.includes('[typesafe] success')));
				},
			);
		});

		test('reuses cached client when configuration is identical', async () => {
			let clientsCreated = 0;
			await withServer(
				(_req, res) => {
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-test',
							answers: { ready: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } } },
							usage: { input_tokens: 1, output_tokens: 1 },
						}),
					);
				},
				async (baseURL) => {
					const service = new TypeSafeJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'stable-key',
						getBaseURL: () => baseURL,
						getModel: () => 'model-a',
						createClient: (config) => {
							clientsCreated++;
							return new (require('@typesafe-ai/sdk').TypeSafeClient)(config);
						},
						...noRetry,
					});

					await service.ask('test 1', { ready: choice('q', { yes: 'y' }) });
					await service.ask('test 2', { ready: choice('q', { yes: 'y' }) });

					assert.strictEqual(clientsCreated, 1, 'expected client to be cached and reused');
				},
			);
		});
	});

	suite('429 and 529 retry with backoff', () => {
		test('retries on 429 and succeeds when second attempt returns 200', async () => {
			let attempts = 0;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					attempts++;
					if (attempts === 1) {
						res.writeHead(429, { 'content-type': 'application/json', 'retry-after-ms': '5' });
						res.end(JSON.stringify({ error: 'rate limited' }));
						return;
					}

					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: { done: { type: 'noul', noul: 0.99 } },
							usage: { input_tokens: 5, output_tokens: 1 },
						}),
					);
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						...fastRetry,
					});

					const answers = await service.ask('state', { done: noul('Is it done?') });
					assert.strictEqual(attempts, 2, 'expected exactly 2 attempts due to retry');
					assert.ok(answers);
					assert.strictEqual(answers.done.noul, 0.99);
					assert.ok(logs.some((l) => l.includes('[typesafe] success')));
				},
			);
		});

		test('retries on 529 and succeeds when second attempt returns 200', async () => {
			let attempts = 0;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					attempts++;
					if (attempts === 1) {
						res.writeHead(529, { 'content-type': 'application/json', 'retry-after-ms': '5' });
						res.end(JSON.stringify({ error: 'service overloaded' }));
						return;
					}

					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: { done: { type: 'noul', noul: 0.88 } },
							usage: { input_tokens: 8, output_tokens: 2 },
						}),
					);
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						...fastRetry,
					});

					const answers = await service.ask('state', { done: noul('Is it done?') });
					assert.strictEqual(attempts, 2, 'expected exactly 2 attempts due to retry');
					assert.ok(answers);
					assert.strictEqual(answers.done.noul, 0.88);
					assert.ok(logs.some((l) => l.includes('[typesafe] success')));
				},
			);
		});

		test('exhausting retries on 429 logs rate-limited error and returns undefined', async () => {
			let attempts = 0;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					attempts++;
					res.writeHead(429, { 'content-type': 'application/json', 'retry-after-ms': '2' });
					res.end(JSON.stringify({ error: 'persistent rate limit' }));
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						retry: { maxRetries: 1, backoffInitialMs: 2, backoffMaxMs: 5, backoffJitter: 0 },
					});

					const answers = await service.ask('state', { done: noul('q') });
					assert.strictEqual(attempts, 2, 'expected 1 initial + 1 retry');
					assert.strictEqual(answers, undefined, 'caller gets undefined on failure');
					assert.ok(logs.some((l) => l.includes('error kind=rate-limited')));
				},
			);
		});

		test('exhausting retries on 529 logs overloaded error and returns undefined', async () => {
			let attempts = 0;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					attempts++;
					res.writeHead(529, { 'content-type': 'application/json', 'retry-after-ms': '2' });
					res.end(JSON.stringify({ error: 'persistent overload' }));
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						retry: { maxRetries: 1, backoffInitialMs: 2, backoffMaxMs: 5, backoffJitter: 0 },
					});

					const answers = await service.ask('state', { done: noul('q') });
					assert.strictEqual(attempts, 2, 'expected 1 initial + 1 retry');
					assert.strictEqual(answers, undefined, 'caller gets undefined on failure');
					assert.ok(logs.some((l) => l.includes('error kind=overloaded')));
				},
			);
		});
	});

	suite('401 unauthorized & key re-prompt path', () => {
		test('does not retry 401, returns undefined, logs unauthorized, and calls onUnauthorized callback', async () => {
			let attempts = 0;
			let rePromptTriggered = false;
			const logs: string[] = [];

			await withServer(
				(_req, res) => {
					attempts++;
					res.writeHead(401, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'invalid api key' }));
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'bad-key',
						getBaseURL: () => baseURL,
						log: (msg) => logs.push(msg),
						onUnauthorized: () => {
							rePromptTriggered = true;
						},
						...fastRetry,
					});

					const result = await service.ask('state', { check: noul('test') });
					assert.strictEqual(result, undefined, 'failing call returns undefined');
					assert.strictEqual(attempts, 1, '401 must never be retried');
					assert.strictEqual(rePromptTriggered, true, 'expected onUnauthorized callback to be invoked');
					assert.ok(logs.some((l) => l.includes('error kind=unauthorized')));
				},
			);
		});

		test('default re-prompt path shows warning and executes setTypeSafeApiKey command when Update API Key is clicked', async () => {
			const warningsShown: string[] = [];
			const commandsExecuted: string[] = [];

			await withServer(
				(_req, res) => {
					res.writeHead(401, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'unauthorized' }));
				},
				async (baseURL) => {
					const service = new TypeSafeJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'bad-key',
						getBaseURL: () => baseURL,
						showWarningMessage: async (msg, ...items) => {
							warningsShown.push(msg);
							assert.ok(items.includes('Update API Key'));
							return 'Update API Key';
						},
						executeCommand: async (cmd) => {
							commandsExecuted.push(cmd);
							return undefined;
						},
						...noRetry,
					});

					const result = await service.ask('state', { check: noul('test') });
					assert.strictEqual(result, undefined);

					// Await the re-prompt task if active
					await service.activeRePrompt;

					assert.strictEqual(warningsShown.length, 1);
					assert.ok(warningsShown[0]?.includes('TypeSafe API key is invalid'));
					assert.deepStrictEqual(commandsExecuted, [SET_TYPESAFE_API_KEY_COMMAND]);
				},
			);
		});

		test('default re-prompt path does not execute command when warning dialog is dismissed', async () => {
			const commandsExecuted: string[] = [];

			await withServer(
				(_req, res) => {
					res.writeHead(401, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'unauthorized' }));
				},
				async (baseURL) => {
					const service = new TypeSafeJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'bad-key',
						getBaseURL: () => baseURL,
						showWarningMessage: async () => undefined,
						executeCommand: async (cmd) => {
							commandsExecuted.push(cmd);
							return undefined;
						},
						...noRetry,
					});

					const result = await service.ask('state', { check: noul('test') });
					assert.strictEqual(result, undefined);

					await service.activeRePrompt;
					assert.strictEqual(commandsExecuted.length, 0);
				},
			);
		});

		test('deduplicates concurrent 401 re-prompts', async () => {
			let promptCalls = 0;

			await withServer(
				(_req, res) => {
					res.writeHead(401, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'unauthorized' }));
				},
				async (baseURL) => {
					const service = new TypeSafeJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'bad-key',
						getBaseURL: () => baseURL,
						onUnauthorized: async () => {
							promptCalls++;
							await new Promise((resolve) => setTimeout(resolve, 30));
						},
						...noRetry,
					});

					// Fire two asks concurrently
					const [res1, res2] = await Promise.all([
						service.ask('state 1', { check: noul('test 1') }),
						service.ask('state 2', { check: noul('test 2') }),
					]);

					assert.strictEqual(res1, undefined);
					assert.strictEqual(res2, undefined);

					await service.activeRePrompt;
					assert.strictEqual(promptCalls, 1, 'expected re-prompt to be deduplicated');
				},
			);
		});
	});

	suite('FakeJudgmentService', () => {
		test('returns preset answers when enabled and records calls', async () => {
			const fake = createFakeJudgmentService({
				answers: {
					intent: { type: 'choice', choice: 'resume', confidence: 0.9, probabilities: { resume: 0.9, analyze: 0.1 } },
				},
			});

			assert.strictEqual(fake.isEnabled(), true);
			const questions = { intent: choice('q', { resume: 'r', analyze: 'a' }) };
			const result = await fake.ask('session-title-here', questions);

			assert.ok(result);
			assert.strictEqual(result.intent.choice, 'resume');
			assert.strictEqual(fake.calls.length, 1);
			assert.strictEqual(fake.calls[0]?.state, 'session-title-here');
			assert.strictEqual(fake.calls[0]?.questions, questions);
		});

		test('returns undefined when disabled via option or setEnabled(false)', async () => {
			const fake = new FakeJudgmentService({
				enabled: false,
				answers: { val: { type: 'noul', noul: 1 } },
			});

			assert.strictEqual(fake.isEnabled(), false);
			let result = await fake.ask('state', { val: noul('q') });
			assert.strictEqual(result, undefined);
			assert.strictEqual(fake.calls.length, 1);

			fake.setEnabled(true);
			assert.strictEqual(fake.isEnabled(), true);
			result = await fake.ask('state', { val: noul('q') });
			assert.ok(result);
			assert.strictEqual(result.val.noul, 1);
			assert.strictEqual(fake.calls.length, 2);
		});

		test('returns undefined when token is cancelled', async () => {
			const fake = createFakeJudgmentService({
				answers: { val: { type: 'noul', noul: 1 } },
			});

			const cts = new SimpleCancellationTokenSource();
			cts.cancel();

			const result = await fake.ask('state', { val: noul('q') }, cts.token);
			assert.strictEqual(result, undefined);
			assert.strictEqual(fake.calls.length, 1);
		});

		test('returns undefined when error is set', async () => {
			const fake = createFakeJudgmentService({
				answers: { val: { type: 'noul', noul: 1 } },
				error: new Error('service down'),
			});

			let result = await fake.ask('state', { val: noul('q') });
			assert.strictEqual(result, undefined);

			fake.setError(undefined);
			result = await fake.ask('state', { val: noul('q') });
			assert.ok(result);
		});

		test('delegates to custom handler when provided', async () => {
			const fake = createFakeJudgmentService();
			fake.setHandler(async (state, _questions) => {
				if (state === 'special') {
					return {
						intent: { type: 'choice', choice: 'analyze', confidence: 0.99, probabilities: { analyze: 0.99 } },
					} as any;
				}
				return undefined;
			});

			const r1 = await fake.ask('special', { intent: choice('q', { analyze: 'a' }) });
			assert.ok(r1);
			assert.strictEqual(r1.intent.choice, 'analyze');

			const r2 = await fake.ask('other', { intent: choice('q', { analyze: 'a' }) });
			assert.strictEqual(r2, undefined);

			assert.strictEqual(fake.calls.length, 2);
			fake.clearCalls();
			assert.strictEqual(fake.calls.length, 0);
		});
	});

	suite('Settings in package.json (manifest)', () => {
		let manifestProperties: Record<string, any>;

		suiteSetup(async () => {
			const packageJsonPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
			const manifest = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
				contributes?: {
					configuration?: {
						properties?: Record<string, any>;
					};
				};
			};
			manifestProperties = manifest.contributes?.configuration?.properties ?? {};
		});

		test('contributes session-control.typesafe.enabled with boolean type, default false, and description', () => {
			const setting = manifestProperties['session-control.typesafe.enabled'];
			assert.ok(setting, 'expected session-control.typesafe.enabled in package.json');
			assert.strictEqual(setting.type, 'boolean');
			assert.strictEqual(setting.default, false);
			assert.strictEqual(setting.scope, 'resource');
			assert.ok(typeof setting.description === 'string' && setting.description.length > 0);
			assert.match(setting.description, /typesafe/i);
		});

		test('contributes session-control.typesafe.model with string type, default jev-latest, and description', () => {
			const setting = manifestProperties['session-control.typesafe.model'];
			assert.ok(setting, 'expected session-control.typesafe.model in package.json');
			assert.strictEqual(setting.type, 'string');
			assert.strictEqual(setting.default, 'jev-latest');
			assert.strictEqual(setting.scope, 'resource');
			assert.ok(typeof setting.description === 'string' && setting.description.length > 0);
		});

		test('contributes session-control.typesafe.features with object type, resource scope, and all 4 toggles', () => {
			const setting = manifestProperties['session-control.typesafe.features'];
			assert.ok(setting, 'expected session-control.typesafe.features in package.json');
			assert.strictEqual(setting.type, 'object');
			assert.strictEqual(setting.scope, 'resource');
			assert.ok(typeof setting.description === 'string' && setting.description.length > 0);
			assert.deepStrictEqual(setting.default, {
				routing: true,
				triage: true,
				resumeSelection: true,
				reportVerification: true,
			});

			const props = setting.properties;
			assert.ok(props, 'expected properties under session-control.typesafe.features');

			for (const feature of ['routing', 'triage', 'resumeSelection', 'reportVerification']) {
				const featProp = props[feature];
				assert.ok(featProp, `expected property for ${feature}`);
				assert.strictEqual(featProp.type, 'boolean');
				assert.strictEqual(featProp.default, true);
				assert.ok(typeof featProp.description === 'string' && featProp.description.length > 0);
			}
		});
	});

	suite('Feature toggle resolution helpers', () => {
		test('TYPESAFE_FEATURES enumerates the four expected features', () => {
			assert.deepStrictEqual(TYPESAFE_FEATURES, [
				'routing',
				'triage',
				'resumeSelection',
				'reportVerification',
			]);
		});

		test('DEFAULT_TYPESAFE_FEATURES enables all four features by default', () => {
			assert.deepStrictEqual(DEFAULT_TYPESAFE_FEATURES, {
				routing: true,
				triage: true,
				resumeSelection: true,
				reportVerification: true,
			});
		});

		test('DEFAULT_TYPESAFE_MODEL is jev-latest', () => {
			assert.strictEqual(DEFAULT_TYPESAFE_MODEL, 'jev-latest');
		});

		test('isTypeSafeFeature validates known feature names', () => {
			assert.strictEqual(isTypeSafeFeature('routing'), true);
			assert.strictEqual(isTypeSafeFeature('triage'), true);
			assert.strictEqual(isTypeSafeFeature('resumeSelection'), true);
			assert.strictEqual(isTypeSafeFeature('reportVerification'), true);
			assert.strictEqual(isTypeSafeFeature('unknown'), false);
			assert.strictEqual(isTypeSafeFeature(''), false);
			assert.strictEqual(isTypeSafeFeature(123), false);
			assert.strictEqual(isTypeSafeFeature(null), false);
			assert.strictEqual(isTypeSafeFeature(undefined), false);
		});

		test('resolveTypeSafeFeatures merges partial configuration with defaults', () => {
			assert.deepStrictEqual(resolveTypeSafeFeatures(undefined), {
				routing: true,
				triage: true,
				resumeSelection: true,
				reportVerification: true,
			});
			assert.deepStrictEqual(resolveTypeSafeFeatures(null), {
				routing: true,
				triage: true,
				resumeSelection: true,
				reportVerification: true,
			});
			assert.deepStrictEqual(resolveTypeSafeFeatures({}), {
				routing: true,
				triage: true,
				resumeSelection: true,
				reportVerification: true,
			});
			assert.deepStrictEqual(resolveTypeSafeFeatures({ routing: false }), {
				routing: false,
				triage: true,
				resumeSelection: true,
				reportVerification: true,
			});
			assert.deepStrictEqual(
				resolveTypeSafeFeatures({ routing: false, triage: false, resumeSelection: true, reportVerification: false }),
				{ routing: false, triage: false, resumeSelection: true, reportVerification: false },
			);
			assert.deepStrictEqual(
				resolveTypeSafeFeatures({ routing: 'invalid' as any, extra: true as any }),
				{ routing: true, triage: true, resumeSelection: true, reportVerification: true },
			);
		});
	});

	suite('TypeSafeJudgmentService feature toggle resolution', () => {
		test('when master isEnabled is false, all feature checks return false and ask returns undefined', async () => {
			let serverCalled = false;
			await withServer(
				(_req, res) => {
					serverCalled = true;
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end('{}');
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => false,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						getFeatures: () => ({ routing: true, triage: true }),
						...noRetry,
					});

					assert.strictEqual(service.isEnabled(), false);
					for (const feature of TYPESAFE_FEATURES) {
						assert.strictEqual(service.isEnabled(feature), false, `expected isEnabled(${feature}) to be false`);
						assert.strictEqual(service.isFeatureEnabled(feature), false, `expected isFeatureEnabled(${feature}) to be false`);

						const resString = await service.ask('state', { q: noul('test') }, undefined, feature);
						assert.strictEqual(resString, undefined);

						const resObj = await service.ask('state', { q: noul('test') }, undefined, { feature });
						assert.strictEqual(resObj, undefined);
					}
					assert.strictEqual(serverCalled, false);
				},
			);
		});

		test('when master isEnabled is true and features are default, all features are enabled and ask proceeds', async () => {
			let requestsReceived = 0;
			await withServer(
				(req, res) => {
					requestsReceived++;
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: { q: { type: 'noul', noul: 1 } },
							usage: { input_tokens: 1, output_tokens: 1 },
						}),
					);
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						...noRetry,
					});

					assert.strictEqual(service.isEnabled(), true);
					for (const feature of TYPESAFE_FEATURES) {
						assert.strictEqual(service.isEnabled(feature), true);
						assert.strictEqual(service.isFeatureEnabled(feature), true);
					}

					// Test ask with feature string
					const resString = await service.ask('state', { q: noul('test') }, undefined, 'routing');
					assert.ok(resString);
					assert.strictEqual(resString.q.noul, 1);

					// Test ask with options object
					const resObj = await service.ask('state', { q: noul('test') }, undefined, { feature: 'triage' });
					assert.ok(resObj);
					assert.strictEqual(resObj.q.noul, 1);

					assert.strictEqual(requestsReceived, 2);
				},
			);
		});

		test('when individual feature is disabled via getFeatures, that feature is blocked while others proceed', async () => {
			let requestsReceived = 0;
			await withServer(
				(req, res) => {
					requestsReceived++;
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: { q: { type: 'noul', noul: 1 } },
							usage: { input_tokens: 1, output_tokens: 1 },
						}),
					);
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						getFeatures: () => ({
							routing: false,
							triage: true,
							resumeSelection: false,
							reportVerification: true,
						}),
						...noRetry,
					});

					assert.strictEqual(service.isEnabled(), true);
					assert.strictEqual(service.isFeatureEnabled('routing'), false);
					assert.strictEqual(service.isEnabled('routing'), false);
					assert.strictEqual(service.isFeatureEnabled('resumeSelection'), false);
					assert.strictEqual(service.isEnabled('resumeSelection'), false);

					assert.strictEqual(service.isFeatureEnabled('triage'), true);
					assert.strictEqual(service.isEnabled('triage'), true);
					assert.strictEqual(service.isFeatureEnabled('reportVerification'), true);
					assert.strictEqual(service.isEnabled('reportVerification'), true);

					// Disabled features return undefined without making network call
					const rDisabled1 = await service.ask('state', { q: noul('test') }, undefined, 'routing');
					assert.strictEqual(rDisabled1, undefined);

					const rDisabled2 = await service.ask('state', { q: noul('test') }, undefined, { feature: 'resumeSelection' });
					assert.strictEqual(rDisabled2, undefined);

					assert.strictEqual(requestsReceived, 0, 'no network calls should be made for disabled features');

					// Enabled features succeed
					const rEnabled1 = await service.ask('state', { q: noul('test') }, undefined, 'triage');
					assert.ok(rEnabled1);

					const rEnabled2 = await service.ask('state', { q: noul('test') }, undefined, { feature: 'reportVerification' });
					assert.ok(rEnabled2);

					assert.strictEqual(requestsReceived, 2);
				},
			);
		});

		test('resolves features from configuration via getConfiguration dependency', async () => {
			const mockConfig: Record<string, unknown> = {
				'typesafe.enabled': true,
				'typesafe.features': {
					routing: false,
					triage: true,
				},
			};

			const service = createJudgmentService({

				consent: grantedConsent,
				getConfiguration: () => ({
					get: <T>(section: string, defaultValue?: T): T => {
						if (section in mockConfig) {
							return mockConfig[section] as T;
						}
						return defaultValue as T;
					},
				}),
				getApiKey: () => 'test-key',
			});

			assert.strictEqual(service.isEnabled(), true);
			assert.strictEqual(service.isFeatureEnabled('routing'), false);
			assert.strictEqual(service.isFeatureEnabled('triage'), true);
			assert.strictEqual(service.isFeatureEnabled('resumeSelection'), true, 'unspecified features default to true');
			assert.strictEqual(service.isFeatureEnabled('reportVerification'), true, 'unspecified features default to true');
		});

		test('delegates to custom isFeatureEnabled when provided', () => {
			const service = createJudgmentService({
				consent: grantedConsent,
				isEnabled: () => true,
				isFeatureEnabled: (feat) => feat === 'reportVerification',
				getApiKey: () => 'test-key',
			});

			assert.strictEqual(service.isFeatureEnabled('routing'), false);
			assert.strictEqual(service.isFeatureEnabled('reportVerification'), true);
		});

		test('returns false for unknown feature names', () => {
			const service = createJudgmentService({
				consent: grantedConsent,
				isEnabled: () => true,
				getApiKey: () => 'test-key',
			});

			assert.strictEqual(service.isFeatureEnabled('unknown' as any), false);
			assert.strictEqual(service.isEnabled('unknown' as any), false);
		});
	});

	suite('Model resolution', () => {
		test('defaults to jev-latest when model is not configured', async () => {
			let capturedModel: string | undefined;

			await withServer(
				(req, res) => {
					let body = '';
					req.on('data', (c: Buffer) => (body += c.toString()));
					req.on('end', () => {
						const parsed = JSON.parse(body) as { model?: string };
						capturedModel = parsed.model;
						res.writeHead(200, { 'content-type': 'application/json' });
						res.end(
							JSON.stringify({
								model: 'jev-latest',
								answers: { ok: { type: 'noul', noul: 1 } },
								usage: { input_tokens: 1, output_tokens: 1 },
							}),
						);
					});
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						...noRetry,
					});

					await service.ask('state', { ok: noul('test') });
					assert.strictEqual(capturedModel, 'jev-latest');
				},
			);
		});

		test('reads model from getConfiguration when provided', async () => {
			let capturedModel: string | undefined;

			await withServer(
				(req, res) => {
					let body = '';
					req.on('data', (c: Buffer) => (body += c.toString()));
					req.on('end', () => {
						const parsed = JSON.parse(body) as { model?: string };
						capturedModel = parsed.model;
						res.writeHead(200, { 'content-type': 'application/json' });
						res.end(
							JSON.stringify({
								model: 'jev-custom',
								answers: { ok: { type: 'noul', noul: 1 } },
								usage: { input_tokens: 1, output_tokens: 1 },
							}),
						);
					});
				},
				async (baseURL) => {
					const service = createJudgmentService({
						consent: grantedConsent,
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						getConfiguration: () => ({
							get: <T>(section: string, defaultValue?: T): T => {
								if (section === 'typesafe.model') {
									return 'jev-custom' as T;
								}
								return defaultValue as T;
							},
						}),
						...noRetry,
					});

					await service.ask('state', { ok: noul('test') });
					assert.strictEqual(capturedModel, 'jev-custom');
				},
			);
		});
	});

	suite('FakeJudgmentService feature toggles', () => {
		test('honors constructor features option and defaults', () => {
			const fake = createFakeJudgmentService({
				features: {
					routing: false,
				},
			});

			assert.strictEqual(fake.isEnabled(), true);
			assert.strictEqual(fake.isFeatureEnabled('routing'), false);
			assert.strictEqual(fake.isEnabled('routing'), false);
			assert.strictEqual(fake.isFeatureEnabled('triage'), true);
			assert.strictEqual(fake.isEnabled('triage'), true);
			assert.strictEqual(fake.isFeatureEnabled('resumeSelection'), true);
			assert.strictEqual(fake.isFeatureEnabled('reportVerification'), true);
		});

		test('returns false for all features when setEnabled(false)', () => {
			const fake = createFakeJudgmentService({
				enabled: false,
				features: { routing: true, triage: true },
			});

			assert.strictEqual(fake.isEnabled(), false);
			assert.strictEqual(fake.isFeatureEnabled('routing'), false);
			assert.strictEqual(fake.isFeatureEnabled('triage'), false);

			fake.setEnabled(true);
			assert.strictEqual(fake.isEnabled(), true);
			assert.strictEqual(fake.isFeatureEnabled('routing'), true);
		});

		test('setFeatureEnabled updates individual feature toggle', () => {
			const fake = createFakeJudgmentService();
			assert.strictEqual(fake.isFeatureEnabled('routing'), true);

			fake.setFeatureEnabled('routing', false);
			assert.strictEqual(fake.isFeatureEnabled('routing'), false);
			assert.strictEqual(fake.isFeatureEnabled('triage'), true);

			fake.setFeatureEnabled('routing', true);
			assert.strictEqual(fake.isFeatureEnabled('routing'), true);
		});

		test('setFeatures updates all features via partial config', () => {
			const fake = createFakeJudgmentService();
			fake.setFeatures({ triage: false, reportVerification: false });

			assert.strictEqual(fake.isFeatureEnabled('routing'), true);
			assert.strictEqual(fake.isFeatureEnabled('triage'), false);
			assert.strictEqual(fake.isFeatureEnabled('resumeSelection'), true);
			assert.strictEqual(fake.isFeatureEnabled('reportVerification'), false);
		});

		test('ask returns undefined when requested feature is disabled and answers when enabled', async () => {
			const fake = createFakeJudgmentService({
				features: { routing: false, triage: true },
				answers: { val: { type: 'noul', noul: 1 } },
			});

			// Disabled feature returns undefined
			const r1 = await fake.ask('state 1', { val: noul('q') }, undefined, 'routing');
			assert.strictEqual(r1, undefined);

			const r2 = await fake.ask('state 2', { val: noul('q') }, undefined, { feature: 'routing' });
			assert.strictEqual(r2, undefined);

			// Enabled feature returns answers
			const r3 = await fake.ask('state 3', { val: noul('q') }, undefined, 'triage');
			assert.ok(r3);
			assert.strictEqual(r3.val.noul, 1);

			// No feature specified uses master enabled
			const r4 = await fake.ask('state 4', { val: noul('q') });
			assert.ok(r4);

			// Check call recording
			assert.strictEqual(fake.calls.length, 4);
			assert.strictEqual(fake.calls[0]?.options, 'routing');
			assert.deepStrictEqual(fake.calls[1]?.options, { feature: 'routing' });
			assert.strictEqual(fake.calls[2]?.options, 'triage');
			assert.strictEqual(fake.calls[3]?.options, undefined);
		});

		test('caches judgments via options.cache and avoids re-executing fake handler on cache hit', async () => {
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'typesafe-fake-cache-'));
			const storageDirectory = path.join(tempRoot, '.chat');
			const store = createAnalysisStore();

			try {
				let handlerExecutionCount = 0;
				const fake = createFakeJudgmentService({
					handler: <Q extends import('@typesafe-ai/sdk').Questions>() => {
						handlerExecutionCount++;
						return { answer: { type: 'score', score: 0.75, confidence: 0.9 } } as unknown as import('../../src/typesafe/judgmentService').JudgmentAnswers<Q>;
					},
				});

				const cacheTarget = {
					store,
					storageDirectory,
					sessionFingerprint: 'sess-abc-123',
					questionSetVersion: 'triage-1',
				};

				const scoreQuestion = { answer: score('is this friction?', ['none', 'high'] as const) };

				// First call: cache miss -> handler executes and saves to cache
				const r1 = await fake.ask('state 1', scoreQuestion, undefined, {
					feature: 'triage',
					cache: cacheTarget,
				});
				assert.ok(r1);
				assert.strictEqual(r1.answer.score, 0.75);
				assert.strictEqual(handlerExecutionCount, 1);

				// Second call: cache hit -> returns cached answers without invoking handler
				const r2 = await fake.ask('state 1', scoreQuestion, undefined, {
					feature: 'triage',
					cache: cacheTarget,
				});
				assert.ok(r2);
				assert.strictEqual(r2.answer.score, 0.75);
				assert.strictEqual(handlerExecutionCount, 1, 'handler must not be re-executed on cache hit');

				// Call with bumped questionSetVersion: cache miss -> invokes handler
				const r3 = await fake.ask('state 1', scoreQuestion, undefined, {
					feature: 'triage',
					cache: {
						...cacheTarget,
						questionSetVersion: 'triage-2',
					},
				});
				assert.ok(r3);
				assert.strictEqual(handlerExecutionCount, 2, 'handler must be executed when question set version bumps');
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});

		test('TypeSafeJudgmentService reuses cached judgment without making network requests', async () => {
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'typesafe-service-cache-'));
			const storageDirectory = path.join(tempRoot, '.chat');
			const store = createAnalysisStore();

			try {
				let serverRequestCount = 0;
				await withServer((req, res) => {
					serverRequestCount++;
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: {
								friction: { type: 'score', score: 0.6, confidence: 0.88 },
							},
							usage: { input_tokens: 50, output_tokens: 15 },
						}),
					);
				}, async (baseURL) => {
					const service = createJudgmentService({
						isEnabled: () => true,
						getApiKey: () => 'valid-test-key',
						getBaseURL: () => baseURL,
						consent: grantedConsent,
						...noRetry,
					});

					const cacheTarget = {
						store,
						storageDirectory,
						sessionFingerprint: 'sess-live-999',
						questionSetVersion: 'v1',
					};

					const frictionQuestion = { friction: score('friction', ['none', 'high'] as const) };

					// First call: cache miss -> sends HTTP request and saves to store
					const firstResult = await service.ask('session state', frictionQuestion, undefined, {
						feature: 'triage',
						cache: cacheTarget,
					});
					assert.ok(firstResult);
					assert.strictEqual(firstResult.friction.score, 0.6);
					assert.strictEqual(serverRequestCount, 1, 'expected 1 server request on miss');

					// Verify persisted in store
					const stored = await store.getJudgment(storageDirectory, 'sess-live-999', 'v1');
					assert.ok(stored);

					// Second call: cache hit -> returns cached result, no server request
					const secondResult = await service.ask('session state', frictionQuestion, undefined, {
						feature: 'triage',
						cache: cacheTarget,
					});
					assert.ok(secondResult);
					assert.strictEqual(secondResult.friction.score, 0.6);
					assert.strictEqual(serverRequestCount, 1, 'expected 0 additional server requests on hit');

					// Policy change / evaluation does not trigger new requests
					const weight1 = 1.0;
					const priority1 = secondResult.friction.score * weight1;
					assert.strictEqual(priority1, 0.6);

					const weight2 = 2.5;
					const priority2 = secondResult.friction.score * weight2;
					assert.strictEqual(priority2, 1.5);
					assert.strictEqual(serverRequestCount, 1, 'policy changes must not trigger requests');

					// Version bump invalidates cache -> sends new HTTP request
					const thirdResult = await service.ask('session state', frictionQuestion, undefined, {
						feature: 'triage',
						cache: {
							...cacheTarget,
							questionSetVersion: 'v2',
						},
					});
					assert.ok(thirdResult);
					assert.strictEqual(serverRequestCount, 2, 'version bump must trigger new server request');
				});
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});
	});
});
