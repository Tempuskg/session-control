import * as assert from 'node:assert';

import { buildSessionEvidence, type AnalysisCandidateSession } from '../../src/sessionAnalysis';
import type { ChatSession, SavedTurn } from '../../src/types';
import {
	ANALYSIS_TRIAGE_QUESTIONS,
	ANALYSIS_TRIAGE_PRIORITY_WEIGHTS,
	ANALYSIS_TRIAGE_QUESTION_SET_VERSION,
	ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD,
	UNTRIAGED_ANALYSIS_PRIORITY,
	buildAnalysisTriageState,
	computeAnalysisPriority,
	isTrivialAnalysisCandidate,
	planAnalysisFromTriage,
	triageAnalysisCandidates,
	type AnalysisTriageAnswers,
} from '../../src/typesafe/analysisTriage';
import { createFakeJudgmentService, type JudgmentCacheTarget } from '../../src/typesafe/judgmentService';

const SAVED_AT = '2026-09-24T12:00:00.000Z';

function createTurns(count: number): SavedTurn[] {
	return Array.from({ length: count }, (_, index): SavedTurn => (index % 2 === 0
		? { type: 'request', participant: 'copilot', prompt: `prompt ${index}`, references: [], timestamp: SAVED_AT }
		: {
				type: 'response',
				participant: 'copilot',
				content: `response ${index}`,
				toolCalls: [{ name: 'runTests', output: 'secret output' }],
				timestamp: SAVED_AT,
		  }));
}

function createCandidate(fingerprint: string, turns: SavedTurn[] = createTurns(6)): AnalysisCandidateSession {
	const session: ChatSession = {
		version: 1,
		id: `session-${fingerprint}`,
		title: `Session ${fingerprint}`,
		savedAt: SAVED_AT,
		git: null,
		vscodeVersion: '1.115.0',
		totalTurns: turns.length,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns,
		markdownSummary: '# Chat: Summary',
	};
	return {
		workspaceName: 'workspace',
		storageDirectory: 'storage',
		fileName: `${fingerprint}.json`,
		rootFileName: `${fingerprint}.json`,
		fingerprint,
		session,
	};
}

function triageAnswers(trivial: number): AnalysisTriageAnswers {
	return { trivial: { type: 'noul', noul: trivial } } as unknown as AnalysisTriageAnswers;
}

function createMemoryCacheStore(): JudgmentCacheTarget['store'] & { readonly entries: Map<string, unknown> } {
	const entries = new Map<string, unknown>();
	return {
		entries,
		getJudgment: async <T>(storageDirectory: string, fingerprint: string, version: string | number) => {
			const answers = entries.get(`${storageDirectory}|${fingerprint}|${version}`);
			return answers === undefined ? undefined : { answers: answers as T };
		},
		saveJudgment: async (storageDirectory, input) => {
			entries.set(`${storageDirectory}|${input.sessionFingerprint}|${input.questionSetVersion}`, input.answers);
			return undefined;
		},
	};
}

suite('typesafe analysis triage', () => {
	test('asks the five triage questions', () => {
		assert.deepEqual(Object.keys(ANALYSIS_TRIAGE_QUESTIONS), [
			'friction',
			'toolFailureLoops',
			'instructionViolation',
			'controlFileLesson',
			'trivial',
		]);
		assert.equal(ANALYSIS_TRIAGE_QUESTIONS.friction.type, 'score');
		assert.equal(ANALYSIS_TRIAGE_QUESTIONS.toolFailureLoops.type, 'score');
		assert.equal(ANALYSIS_TRIAGE_QUESTIONS.trivial.type, 'noul');
	});

	test('state uses summaryOnly evidence plus the first and last turns', () => {
		const state = buildAnalysisTriageState(createCandidate('fp-1')) as Record<string, unknown>;
		assert.equal(state.turnCount, 6);
		assert.match(String(state.evidence), /condensed due to size/);
		assert.deepEqual(state.firstTurn, { role: 'user', text: 'prompt 0' });
		assert.deepEqual(state.lastTurn, { role: 'assistant', text: 'response 5', tools: ['runTests'] });
		assert.equal(JSON.stringify(state.lastTurn).includes('secret output'), false);
	});

	test('single-turn sessions send only a first turn', () => {
		const state = buildAnalysisTriageState(createCandidate('fp-1', createTurns(1))) as Record<string, unknown>;
		assert.ok(state.firstTurn);
		assert.equal('lastTurn' in state, false);
	});

	test('disabled TypeSafe sends nothing and returns no results', async () => {
		const judgment = createFakeJudgmentService({ enabled: false, answers: triageAnswers(0.1) });
		const results = await triageAnalysisCandidates([createCandidate('fp-1')], { judgment });
		assert.equal(results.size, 0);
		assert.equal(judgment.calls.length, 0);
	});

	test('disabled triage feature sends nothing', async () => {
		const judgment = createFakeJudgmentService({ features: { triage: false }, answers: triageAnswers(0.1) });
		const results = await triageAnalysisCandidates([createCandidate('fp-1')], { judgment });
		assert.equal(results.size, 0);
		assert.equal(judgment.calls.length, 0);
	});

	test('sends one triage request per candidate and keys results by fingerprint', async () => {
		const judgment = createFakeJudgmentService({
			handler: async (state) => triageAnswers((state as { title: string }).title === 'Session fp-2' ? 0.9 : 0.1) as never,
		});
		const candidates = [createCandidate('fp-1'), createCandidate('fp-2'), createCandidate('fp-3')];
		const results = await triageAnalysisCandidates(candidates, { judgment });

		assert.equal(judgment.calls.length, 3);
		for (const call of judgment.calls) {
			assert.equal(call.questions, ANALYSIS_TRIAGE_QUESTIONS);
			assert.equal(call.options, 'triage');
		}
		assert.deepEqual([...results.keys()].sort(), ['fp-1', 'fp-2', 'fp-3']);
		assert.equal(results.get('fp-2')?.trivial.noul, 0.9);
	});

	test('caches answers via the judgment cache so re-runs do not re-query', async () => {
		let inferences = 0;
		const judgment = createFakeJudgmentService({
			handler: async () => {
				inferences += 1;
				return triageAnswers(0.2) as never;
			},
		});
		const store = createMemoryCacheStore();
		const deps = {
			judgment,
			getCacheTarget: (candidate: AnalysisCandidateSession): JudgmentCacheTarget => ({
				store,
				storageDirectory: candidate.storageDirectory,
				sessionFingerprint: candidate.fingerprint,
				questionSetVersion: ANALYSIS_TRIAGE_QUESTION_SET_VERSION,
			}),
		};
		const candidates = [createCandidate('fp-1'), createCandidate('fp-2')];

		await triageAnalysisCandidates(candidates, deps);
		const second = await triageAnalysisCandidates(candidates, deps);

		assert.equal(inferences, 2);
		assert.equal(store.entries.size, 2);
		assert.ok(store.entries.has(`storage|fp-1|${ANALYSIS_TRIAGE_QUESTION_SET_VERSION}`));
		assert.equal(second.get('fp-1')?.trivial.noul, 0.2);
		const options = judgment.calls[0]?.options as { feature: string; cache: JudgmentCacheTarget };
		assert.equal(options.feature, 'triage');
		assert.equal(options.cache.questionSetVersion, ANALYSIS_TRIAGE_QUESTION_SET_VERSION);
	});

	test('a failing judgment drops only that candidate', async () => {
		const judgment = createFakeJudgmentService({
			handler: async (state) => {
				if ((state as { title: string }).title === 'Session fp-1') {
					throw new Error('boom');
				}
				return triageAnswers(0.3) as never;
			},
		});
		const logs: string[] = [];
		const results = await triageAnalysisCandidates(
			[createCandidate('fp-1'), createCandidate('fp-2')],
			{ judgment, log: (message) => logs.push(message) },
		);
		assert.deepEqual([...results.keys()], ['fp-2']);
		assert.ok(logs.some((message) => message.includes('boom')));
	});
});


interface PolicySignals {
	readonly friction?: number;
	readonly toolFailureLoops?: number;
	readonly instructionViolation?: number;
	readonly controlFileLesson?: number;
	readonly trivial?: number;
}

function policyAnswers(signals: PolicySignals): AnalysisTriageAnswers {
	return {
		friction: { type: 'score', score: signals.friction ?? 0, confidence: 0.9 },
		toolFailureLoops: { type: 'score', score: signals.toolFailureLoops ?? 0, confidence: 0.9 },
		instructionViolation: { type: 'noul', noul: signals.instructionViolation ?? 0 },
		controlFileLesson: { type: 'noul', noul: signals.controlFileLesson ?? 0 },
		trivial: { type: 'noul', noul: signals.trivial ?? 0 },
	} as unknown as AnalysisTriageAnswers;
}

/** Runs triage through the fake judgment service, answering per candidate title. */
async function triageWithFake(
	candidates: AnalysisCandidateSession[],
	signalsByFingerprint: Readonly<Record<string, PolicySignals>>,
) {
	const judgment = createFakeJudgmentService({
		handler: async (state) => {
			const fingerprint = (state as { title: string }).title.replace('Session ', '');
			return policyAnswers(signalsByFingerprint[fingerprint] ?? {}) as never;
		},
	});
	return triageAnalysisCandidates(candidates, { judgment });
}

suite('typesafe analysis triage policy', () => {
	test('weights and thresholds are code constants, not part of the questions', () => {
		const weights = Object.values(ANALYSIS_TRIAGE_PRIORITY_WEIGHTS);
		assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9);
		assert.ok(ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD > 0 && ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD < 1);
		const questionText = JSON.stringify(ANALYSIS_TRIAGE_QUESTIONS);
		assert.equal(/weight|threshold|priority/i.test(questionText), false);
	});

	test('priority is the weighted sum of normalized signals', () => {
		assert.equal(computeAnalysisPriority(policyAnswers({})), 0);
		assert.ok(Math.abs(computeAnalysisPriority(policyAnswers({
			friction: 3,
			toolFailureLoops: 3,
			instructionViolation: 1,
			controlFileLesson: 1,
		})) - 1) < 1e-9);
		assert.ok(Math.abs(computeAnalysisPriority(policyAnswers({ friction: 1.5 }))
			- ANALYSIS_TRIAGE_PRIORITY_WEIGHTS.friction / 2) < 1e-9);
		assert.ok(Math.abs(computeAnalysisPriority(policyAnswers({ controlFileLesson: 0.5 }))
			- ANALYSIS_TRIAGE_PRIORITY_WEIGHTS.controlFileLesson / 2) < 1e-9);
	});

	test('trivial passes at the threshold', () => {
		assert.equal(isTrivialAnalysisCandidate(policyAnswers({ trivial: ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD })), true);
		assert.equal(isTrivialAnalysisCandidate(policyAnswers({ trivial: ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD - 0.01 })), false);
	});

	test('trivial sessions are skipped and the rest are ranked by priority', async () => {
		const candidates = ['fp-1', 'fp-2', 'fp-3', 'fp-4'].map((fingerprint) => createCandidate(fingerprint));
		const triage = await triageWithFake(candidates, {
			'fp-1': { friction: 1 },
			'fp-2': { trivial: 0.95, friction: 3 },
			'fp-3': { friction: 3, instructionViolation: 0.9 },
			'fp-4': { toolFailureLoops: 2 },
		});
		const plan = planAnalysisFromTriage(candidates, triage, 1_000_000);

		assert.deepEqual(plan.skipped.map((candidate) => candidate.fingerprint), ['fp-2']);
		assert.deepEqual(plan.analyzable.map((candidate) => candidate.fingerprint), ['fp-3', 'fp-4', 'fp-1']);
		assert.equal(plan.priorities.has('fp-2'), false);
		for (const candidate of plan.analyzable) {
			assert.equal(plan.detailLevels.get(candidate.fingerprint), 'full');
		}
	});

	test('candidates without triage answers are kept at a neutral priority', async () => {
		const candidates = [createCandidate('fp-1'), createCandidate('fp-2'), createCandidate('fp-3')];
		const triage = new Map(await triageWithFake(candidates, {
			'fp-1': {},
			'fp-3': { friction: 3, toolFailureLoops: 3, instructionViolation: 1, controlFileLesson: 1 },
		}));
		triage.delete('fp-2');
		const plan = planAnalysisFromTriage(candidates, triage, 1_000_000);

		assert.deepEqual(plan.analyzable.map((candidate) => candidate.fingerprint), ['fp-3', 'fp-2', 'fp-1']);
		assert.equal(plan.priorities.get('fp-2'), UNTRIAGED_ANALYSIS_PRIORITY);
	});

	test('evidence detail follows priority rank within the batch budget', async () => {
		const candidates = ['fp-1', 'fp-2', 'fp-3'].map((fingerprint) => createCandidate(fingerprint, createTurns(40)));
		const triage = await triageWithFake(candidates, {
			'fp-1': { friction: 1 },
			'fp-2': { friction: 3 },
			'fp-3': { friction: 2 },
		});
		const [high, middle] = [candidates[1], candidates[2]] as [AnalysisCandidateSession, AnalysisCandidateSession];
		const budget = buildSessionEvidence(high, 'full').length + 6 + buildSessionEvidence(middle, 'compact').length;
		const plan = planAnalysisFromTriage(candidates, triage, budget);

		assert.deepEqual(plan.analyzable.map((candidate) => candidate.fingerprint), ['fp-2', 'fp-3', 'fp-1']);
		assert.equal(plan.detailLevels.get('fp-2'), 'full');
		assert.equal(plan.detailLevels.get('fp-3'), 'compact');
		assert.equal(plan.detailLevels.get('fp-1'), 'summaryOnly');
	});

	test('detail never increases as rank decreases', async () => {
		const large = createCandidate('fp-1', createTurns(60));
		const small = createCandidate('fp-2', createTurns(2));
		const triage = await triageWithFake([large, small], { 'fp-1': { friction: 3 }, 'fp-2': { friction: 1 } });
		const budget = buildSessionEvidence(large, 'compact').length + 6
			+ Math.max(buildSessionEvidence(small, 'full').length, buildSessionEvidence(small, 'compact').length);
		assert.ok(buildSessionEvidence(large, 'full').length > budget);
		const plan = planAnalysisFromTriage([large, small], triage, budget);

		assert.equal(plan.detailLevels.get('fp-1'), 'compact');
		assert.equal(plan.detailLevels.get('fp-2'), 'compact');
	});
});
