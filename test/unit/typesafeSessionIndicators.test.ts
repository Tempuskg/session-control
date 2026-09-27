import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	APIConnectionError,
	APITimeoutError,
	AuthenticationError,
	RateLimitError,
	type SystemOneRequest,
	type Questions,
} from '@typesafe-ai/sdk';

import type { ChatSession } from '../../src/types';
import type { TypeSafeConsentGate } from '../../src/typesafe/consent';
import {
	createFakeJudgmentService,
	createJudgmentService,
	type TypeSafeClientLike,
} from '../../src/typesafe/judgmentService';
import {
	DEFAULT_SESSION_INDICATOR_THRESHOLD,
	SESSION_INDICATOR_QUESTIONS,
	SessionIndicatorDecorationProvider,
	buildSessionIndicatorState,
	createPassiveConsentGate,
	createSessionIndicatorService,
	describeSessionIndicator,
	resolveSessionIndicatorState,
	resolveSessionIndicatorThresholds,
	toSessionIndicatorJudgment,
	type SessionIndicatorAnswers,
} from '../../src/typesafe/sessionIndicators';

const THRESHOLDS = { knowledgeHarvest: 0.7, aiSkill: 0.6 };

function answers(knowledge: number, skill: number): SessionIndicatorAnswers {
	return {
		knowledgeHarvest: { type: 'noul', noul: knowledge },
		aiSkill: { type: 'noul', noul: skill },
	};
}

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		version: 1,
		id: 'session-1',
		title: 'Fix release flow',
		savedAt: '2026-09-26T10:00:00.000Z',
		git: null,
		vscodeVersion: '1.100.0',
		totalTurns: 2,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns: [
			{ type: 'request', participant: 'user', prompt: 'How do we release?', references: [], timestamp: '2026-09-26T10:00:00.000Z' },
			{
				type: 'response',
				participant: 'copilot',
				content: 'Run npm run version:build.',
				toolCalls: [{ name: 'runInTerminal', arguments: '{"cmd":"npm test"}', output: 'SECRET TOOL OUTPUT' }],
				timestamp: '2026-09-26T10:00:01.000Z',
			},
		],
		markdownSummary: '',
		...overrides,
	};
}

const GRANTED: TypeSafeConsentGate = { hasConsent: () => true, ensureConsent: () => Promise.resolve(true) };
const DENIED: TypeSafeConsentGate = { hasConsent: () => false, ensureConsent: () => Promise.resolve(false) };

function fileReader(files: Map<string, string>): (fsPath: string) => Promise<string> {
	return (fsPath) => {
		const content = files.get(fsPath);
		return content === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(content);
	};
}

interface RecordingClient extends TypeSafeClientLike {
	readonly requests: SystemOneRequest<Questions>[];
}

function recordingClient(respond: () => SessionIndicatorAnswers | Error): RecordingClient {
	const requests: SystemOneRequest<Questions>[] = [];
	return {
		requests,
		systemOne: (request) => {
			requests.push(request as SystemOneRequest<Questions>);
			const result = respond();
			if (result instanceof Error) {
				return Promise.reject(result);
			}
			return Promise.resolve({
				answers: result,
				model: 'jev-latest',
				usage: { input_tokens: 1, output_tokens: 1 },
			} as never);
		},
	};
}

function realService(client: RecordingClient, options: { consent?: TypeSafeConsentGate; apiKey?: string } = {}) {
	const warnings: string[] = [];
	const judgment = createJudgmentService({
		isEnabled: () => true,
		getApiKey: () => ('apiKey' in options ? options.apiKey : 'ts_test_key'),
		consent: createPassiveConsentGate(options.consent ?? GRANTED),
		getStripToolOutput: () => true,
		createClient: () => client,
		onUnauthorized: () => undefined,
		showWarningMessage: (message) => {
			warnings.push(message);
			return Promise.resolve(undefined);
		},
		log: () => undefined,
	});
	const files = new Map([['/store/a.json', JSON.stringify(createSession())]]);
	const service = createSessionIndicatorService({
		judgment,
		isIndicatorsEnabled: () => true,
		getThresholds: () => THRESHOLDS,
		readFile: fileReader(files),
	});
	return { service, warnings };
}

suite('typesafe/sessionIndicators', () => {
	suite('threshold mapping', () => {
		test('maps scores to all four indicator states', () => {
			const state = (k: number, s: number) =>
				resolveSessionIndicatorState(toSessionIndicatorJudgment(answers(k, s), THRESHOLDS));
			assert.strictEqual(state(0.1, 0.1), 'none');
			assert.strictEqual(state(0.9, 0.1), 'knowledge');
			assert.strictEqual(state(0.1, 0.9), 'skill');
			assert.strictEqual(state(0.9, 0.9), 'both');
			assert.strictEqual(resolveSessionIndicatorState(undefined), 'none');
		});

		test('returns two independent typed signals with their thresholds', () => {
			const judgment = toSessionIndicatorJudgment(answers(0.7, 0.59), THRESHOLDS);
			assert.deepStrictEqual(judgment.knowledgeHarvest, { score: 0.7, threshold: 0.7, flagged: true });
			assert.deepStrictEqual(judgment.aiSkill, { score: 0.59, threshold: 0.6, flagged: false });
		});

		test('clamps configured thresholds and falls back to the default', () => {
			assert.deepStrictEqual(resolveSessionIndicatorThresholds({ knowledgeHarvest: 2, aiSkill: 'x' }), {
				knowledgeHarvest: 1,
				aiSkill: DEFAULT_SESSION_INDICATOR_THRESHOLD,
			});
		});

		test('each flagged state has one distinct badge and a descriptive tooltip', () => {
			assert.strictEqual(describeSessionIndicator(toSessionIndicatorJudgment(answers(0.1, 0.1), THRESHOLDS)), undefined);
			const knowledge = describeSessionIndicator(toSessionIndicatorJudgment(answers(0.9, 0.1), THRESHOLDS));
			const skill = describeSessionIndicator(toSessionIndicatorJudgment(answers(0.1, 0.9), THRESHOLDS));
			const both = describeSessionIndicator(toSessionIndicatorJudgment(answers(0.9, 0.9), THRESHOLDS));
			assert.ok(knowledge && skill && both);
			const badges = new Set([knowledge.badge, skill.badge, both.badge]);
			assert.strictEqual(badges.size, 3);
			for (const badge of badges) {
				assert.strictEqual(badge.length, 1, 'combined state must be a single glyph, not two badges');
			}
			assert.match(knowledge.tooltip, /knowledge/);
			assert.doesNotMatch(knowledge.tooltip, /AI skill/);
			assert.match(skill.tooltip, /AI skill/);
			assert.match(both.tooltip, /knowledge[\s\S]*AI skill/);
			assert.match(both.tooltip, /score 0\.90/);
		});
	});

	test('state sent to Jev contains tool names but never tool output', () => {
		const serialized = JSON.stringify(buildSessionIndicatorState(createSession()));
		assert.ok(serialized.includes('runInTerminal'));
		assert.ok(!serialized.includes('SECRET TOOL OUTPUT'));
	});

	test('passive consent gate never prompts', async () => {
		let prompted = false;
		const gate = createPassiveConsentGate({
			hasConsent: () => false,
			ensureConsent: () => {
				prompted = true;
				return Promise.resolve(true);
			},
		});
		assert.strictEqual(await gate.ensureConsent(), false);
		assert.strictEqual(prompted, false);
	});

	test('sends no request when consent is denied', async () => {
		const client = recordingClient(() => answers(0.9, 0.9));
		const { service } = realService(client, { consent: DENIED });
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		assert.strictEqual(client.requests.length, 0);
	});

	test('sends no request without a resolved API key', async () => {
		const client = recordingClient(() => answers(0.9, 0.9));
		const { service } = realService(client, { apiKey: '' });
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		assert.strictEqual(client.requests.length, 0);
	});

	test('strips tool output from the payload actually sent', async () => {
		const client = recordingClient(() => answers(0.9, 0.1));
		const { service } = realService(client);
		const judgment = await service.getJudgment('/store/a.json');
		assert.strictEqual(resolveSessionIndicatorState(judgment), 'knowledge');
		assert.strictEqual(client.requests.length, 1);
		assert.ok(!JSON.stringify(client.requests[0]?.state).includes('SECRET TOOL OUTPUT'));
	});

	for (const [label, error] of [
		['auth', new AuthenticationError(401, {}, new Headers())],
		['rate limit', new RateLimitError(429, {}, new Headers())],
		['timeout', new APITimeoutError(50)],
		['connection', new APIConnectionError('failed')],
	] as const) {
		test(`${label} errors leave no indicator and show no popup`, async () => {
			const client = recordingClient(() => error);
			const { service, warnings } = realService(client);
			const judgment = await service.getJudgment('/store/a.json');
			assert.strictEqual(judgment, undefined);
			assert.strictEqual(describeSessionIndicator(judgment), undefined);
			assert.deepStrictEqual(warnings, []);
		});
	}

	test('a throwing judgment service or unreadable file never throws', async () => {
		const judgment = createFakeJudgmentService({
			handler: () => Promise.reject(new Error('boom')),
		});
		const service = createSessionIndicatorService({
			judgment,
			isIndicatorsEnabled: () => true,
			getThresholds: () => THRESHOLDS,
			readFile: fileReader(new Map([['/store/a.json', JSON.stringify(createSession())]])),
		});
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		assert.strictEqual(await service.getJudgment('/store/missing.json'), undefined);
	});

	test('caches per session id + content hash', async () => {
		const judgment = createFakeJudgmentService({ answers: answers(0.9, 0.9) });
		const files = new Map([['/store/a.json', JSON.stringify(createSession())]]);
		const service = createSessionIndicatorService({
			judgment,
			isIndicatorsEnabled: () => true,
			getThresholds: () => THRESHOLDS,
			readFile: fileReader(files),
		});

		assert.strictEqual(resolveSessionIndicatorState(await service.getJudgment('/store/a.json')), 'both');
		assert.strictEqual(resolveSessionIndicatorState(await service.getJudgment('/store/a.json')), 'both');
		assert.strictEqual(judgment.calls.length, 1, 'unchanged session is a cache hit');

		files.set('/store/a.json', JSON.stringify(createSession({ title: 'Fix release flow (updated)' })));
		await service.getJudgment('/store/a.json');
		assert.strictEqual(judgment.calls.length, 2, 'changed content is a cache miss');
		assert.deepStrictEqual(judgment.calls[0]?.questions, SESSION_INDICATOR_QUESTIONS);
	});

	test('failed judgments are not retried until failures are forgotten', async () => {
		const judgment = createFakeJudgmentService({ answers: answers(0.9, 0.9) });
		judgment.setEnabled(true);
		let fail = true;
		judgment.setHandler(() => (fail ? undefined : answers(0.9, 0.1) as never));
		const service = createSessionIndicatorService({
			judgment,
			isIndicatorsEnabled: () => true,
			getThresholds: () => THRESHOLDS,
			readFile: fileReader(new Map([['/store/a.json', JSON.stringify(createSession())]])),
		});
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		assert.strictEqual(judgment.calls.length, 1);
		fail = false;
		service.forgetFailures();
		assert.strictEqual(resolveSessionIndicatorState(await service.getJudgment('/store/a.json')), 'knowledge');
		assert.strictEqual(judgment.calls.length, 2);
	});

	test('indicators setting or disabled TypeSafe skip judgments entirely', async () => {
		const judgment = createFakeJudgmentService({ answers: answers(0.9, 0.9) });
		let indicatorsOn = false;
		const service = createSessionIndicatorService({
			judgment,
			isIndicatorsEnabled: () => indicatorsOn,
			getThresholds: () => THRESHOLDS,
			readFile: fileReader(new Map([['/store/a.json', JSON.stringify(createSession())]])),
		});
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		indicatorsOn = true;
		judgment.setEnabled(false);
		assert.strictEqual(await service.getJudgment('/store/a.json'), undefined);
		assert.strictEqual(service.isEnabled(), false);
		assert.strictEqual(judgment.calls.length, 0);
	});

	test('decoration provider only badges tracked session URIs with one decoration', async () => {
		const uri = vscode.Uri.file('/store/a.json');
		const judgment = createFakeJudgmentService({ answers: answers(0.9, 0.9) });
		const service = createSessionIndicatorService({
			judgment,
			isIndicatorsEnabled: () => true,
			getThresholds: () => THRESHOLDS,
			readFile: fileReader(new Map([[uri.fsPath, JSON.stringify(createSession())]])),
		});
		const provider = new SessionIndicatorDecorationProvider(service);
		const token = new vscode.CancellationTokenSource().token;
		try {
			assert.strictEqual(await provider.provideFileDecoration(uri, token), undefined);
			provider.track([uri]);
			const decoration = await provider.provideFileDecoration(uri, token);
			assert.strictEqual(decoration?.badge, describeSessionIndicator(
				toSessionIndicatorJudgment(answers(0.9, 0.9), THRESHOLDS),
			)?.badge);
			assert.match(decoration?.tooltip ?? '', /knowledge[\s\S]*AI skill/);
			assert.strictEqual(decoration?.propagate, false);
		} finally {
			provider.dispose();
		}
	});
});
