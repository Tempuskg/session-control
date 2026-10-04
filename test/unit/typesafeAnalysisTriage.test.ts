import * as assert from 'node:assert';

import type { AnalysisCandidateSession } from '../../src/sessionAnalysis';
import type { ChatSession, SavedTurn } from '../../src/types';
import {
	ANALYSIS_TRIAGE_QUESTIONS,
	ANALYSIS_TRIAGE_QUESTION_SET_VERSION,
	buildAnalysisTriageState,
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
