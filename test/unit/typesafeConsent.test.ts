import * as assert from 'node:assert';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	GlobalStateConsentGate,
	TYPESAFE_CONSENT_ACCEPT,
	TYPESAFE_CONSENT_DECLINE,
	TYPESAFE_CONSENT_STATE_KEY,
	stripToolOutputFromState,
	type MementoLike,
} from '../../src/typesafe/consent';
import { createJudgmentService, noul } from '../../src/typesafe/judgmentService';

class MemoryMemento implements MementoLike {
	public readonly values = new Map<string, unknown>();

	public get<T>(key: string): T | undefined {
		return this.values.get(key) as T | undefined;
	}

	public update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}
		return Promise.resolve();
	}
}

interface CapturedRequest {
	count: number;
	lastBody: { state?: unknown } | undefined;
}

async function withServer(run: (baseURL: string, captured: CapturedRequest) => Promise<void>): Promise<void> {
	const captured: CapturedRequest = { count: 0, lastBody: undefined };
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk: Buffer) => (body += chunk.toString()));
		req.on('end', () => {
			captured.count += 1;
			captured.lastBody = JSON.parse(body) as { state?: unknown };
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({
				model: 'jev-latest',
				answers: { ok: { type: 'noul', noul: 1 } },
				usage: { input_tokens: 1, output_tokens: 1 },
			}));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address() as AddressInfo;
		await run(`http://127.0.0.1:${address.port}`, captured);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

const sessionState = {
	title: 'Fix login',
	turns: [
		{ type: 'request', text: 'please fix login' },
		{
			type: 'response',
			text: 'done',
			toolCalls: [
				{ name: 'readFile', arguments: '{"path":"a.ts"}', output: 'secret file contents' },
				{ name: 'noOutput' },
			],
		},
	],
};

suite('typesafe/consent', () => {
	suite('GlobalStateConsentGate', () => {
		test('records acceptance in globalState and does not prompt again', async () => {
			const globalState = new MemoryMemento();
			let prompts = 0;
			const gate = new GlobalStateConsentGate({
				globalState,
				showConsentPrompt: () => {
					prompts += 1;
					return Promise.resolve(TYPESAFE_CONSENT_ACCEPT);
				},
				now: () => Date.UTC(2026, 8, 25),
			});

			assert.strictEqual(gate.hasConsent(), false);
			assert.strictEqual(await gate.ensureConsent(), true);
			assert.strictEqual(await gate.ensureConsent(), true);
			assert.strictEqual(prompts, 1);
			assert.deepStrictEqual(globalState.get(TYPESAFE_CONSENT_STATE_KEY), {
				version: 1,
				acceptedAt: '2026-09-25T00:00:00.000Z',
			});

			const reloaded = new GlobalStateConsentGate({ globalState, showConsentPrompt: () => Promise.resolve(undefined) });
			assert.strictEqual(reloaded.hasConsent(), true);
		});

		test('declining or dismissing records nothing and suppresses re-prompts this session', async () => {
			for (const answer of [TYPESAFE_CONSENT_DECLINE, undefined]) {
				const globalState = new MemoryMemento();
				let prompts = 0;
				const gate = new GlobalStateConsentGate({
					globalState,
					showConsentPrompt: () => {
						prompts += 1;
						return Promise.resolve(answer);
					},
				});

				assert.strictEqual(await gate.ensureConsent(), false);
				assert.strictEqual(await gate.ensureConsent(), false);
				assert.strictEqual(prompts, 1);
				assert.strictEqual(globalState.values.has(TYPESAFE_CONSENT_STATE_KEY), false);
			}
		});

		test('concurrent callers share a single prompt', async () => {
			let prompts = 0;
			let resolvePrompt: (value: string) => void = () => {};
			const gate = new GlobalStateConsentGate({
				globalState: new MemoryMemento(),
				showConsentPrompt: () => {
					prompts += 1;
					return new Promise<string>((resolve) => {
						resolvePrompt = resolve;
					});
				},
			});

			const first = gate.ensureConsent();
			const second = gate.ensureConsent();
			resolvePrompt(TYPESAFE_CONSENT_ACCEPT);
			assert.deepStrictEqual(await Promise.all([first, second]), [true, true]);
			assert.strictEqual(prompts, 1);
		});

		test('the prompt explains that content is sent to api.typesafe.ai', async () => {
			let shownDetail = '';
			const gate = new GlobalStateConsentGate({
				globalState: new MemoryMemento(),
				showConsentPrompt: (_message, detail) => {
					shownDetail = detail;
					return Promise.resolve(undefined);
				},
			});
			await gate.ensureConsent();
			assert.match(shownDetail, /api\.typesafe\.ai/);
			assert.match(shownDetail, /stripToolOutput/);
		});
	});

	suite('TypeSafeJudgmentService consent gating', () => {
		test('sends no request when no consent gate is supplied', async () => {
			await withServer(async (baseURL, captured) => {
				const service = createJudgmentService({
					isEnabled: () => true,
					getApiKey: () => 'test-key',
					getBaseURL: () => baseURL,
				});
				assert.strictEqual(await service.ask('state', { ok: noul('q') }), undefined);
				assert.strictEqual(captured.count, 0);
			});
		});

		test('sends no request when the user declines, then succeeds after acceptance is recorded', async () => {
			await withServer(async (baseURL, captured) => {
				const globalState = new MemoryMemento();
				let answer: string | undefined = TYPESAFE_CONSENT_DECLINE;
				const makeService = () => createJudgmentService({
					isEnabled: () => true,
					getApiKey: () => 'test-key',
					getBaseURL: () => baseURL,
					consent: new GlobalStateConsentGate({ globalState, showConsentPrompt: () => Promise.resolve(answer) }),
				});

				const declined = makeService();
				assert.strictEqual(await declined.ask('state', { ok: noul('q') }, undefined, 'routing'), undefined);
				assert.strictEqual(captured.count, 0);

				answer = TYPESAFE_CONSENT_ACCEPT;
				const accepted = makeService();
				const result = await accepted.ask('state', { ok: noul('q') }, undefined, 'routing');
				assert.strictEqual(result?.ok.noul, 1);
				assert.strictEqual(captured.count, 1);
			});
		});

		test('does not prompt for consent when TypeSafe is disabled or no API key is set', async () => {
			let prompts = 0;
			const consent = new GlobalStateConsentGate({
				globalState: new MemoryMemento(),
				showConsentPrompt: () => {
					prompts += 1;
					return Promise.resolve(TYPESAFE_CONSENT_ACCEPT);
				},
			});
			await createJudgmentService({ isEnabled: () => false, getApiKey: () => 'k', consent }).ask('s', { ok: noul('q') });
			await createJudgmentService({ isEnabled: () => true, getApiKey: () => undefined, consent }).ask('s', { ok: noul('q') });
			assert.strictEqual(prompts, 0);
		});
	});

	suite('stripToolOutput privacy path', () => {
		test('stripToolOutputFromState replaces tool output with the save-path marker', () => {
			const stripped = stripToolOutputFromState(sessionState) as typeof sessionState;
			const toolCalls = stripped.turns[1]?.toolCalls ?? [];
			assert.deepStrictEqual(toolCalls[0], {
				name: 'readFile',
				arguments: '{"path":"a.ts"}',
				output: '[output stripped - 20 chars]',
			});
			assert.deepStrictEqual(toolCalls[1], { name: 'noOutput' });
			assert.strictEqual(stripped.turns[0]?.text, 'please fix login');
			assert.strictEqual(sessionState.turns[1]?.toolCalls?.[0]?.output, 'secret file contents');
		});

		test('payload tool output is stripped only when save.stripToolOutput is enabled', async () => {
			for (const strip of [true, false]) {
				await withServer(async (baseURL, captured) => {
					const service = createJudgmentService({
						isEnabled: () => true,
						getApiKey: () => 'test-key',
						getBaseURL: () => baseURL,
						consent: { hasConsent: () => true, ensureConsent: () => Promise.resolve(true) },
						getConfiguration: () => ({
							get: <T>(section: string, defaultValue?: T): T =>
								(section === 'save.stripToolOutput' ? strip : defaultValue) as T,
						}),
					});
					await service.ask(sessionState, { ok: noul('q') });
					const body = JSON.stringify(captured.lastBody?.state);
					assert.strictEqual(body.includes('secret file contents'), !strip);
					assert.strictEqual(body.includes('[output stripped - 20 chars]'), strip);
				});
			}
		});
	});
});
