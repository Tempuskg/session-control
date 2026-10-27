import * as assert from 'node:assert';
import type { SavedTurn } from '../../src/types';
import { createFakeJudgmentService } from '../../src/typesafe/judgmentService';
import {
	MAX_RELEVANCE_SCORED_TURNS,
	scoreResumeTurnRelevance,
} from '../../src/typesafe/resumeRelevance';

function request(prompt: string): SavedTurn {
	return { type: 'request', participant: 'copilot', prompt, references: [], timestamp: '2026-04-12T12:00:00.000Z' };
}

suite('typesafe resume relevance', () => {
	const omittedTurns = [request('auth bug'), request('css tweak'), request('auth fix')];

	test('scores every omitted turn in one fan-out request', async () => {
		const judgment = createFakeJudgmentService({
			answers: { turn_0: { score: 3 }, turn_1: { score: 0 }, turn_2: { score: 1.5 } },
		});
		const scores = await scoreResumeTurnRelevance({ omittedTurns, prompt: 'auth', judgment });
		assert.deepEqual(scores, [1, 0, 0.5]);
		assert.equal(judgment.calls.length, 1);
		assert.equal(judgment.calls[0]?.options, 'resumeSelection');
		assert.deepEqual(Object.keys(judgment.calls[0]?.questions ?? {}), ['turn_0', 'turn_1', 'turn_2']);
	});

	test('returns undefined when TypeSafe or resumeSelection is off', async () => {
		const disabled = createFakeJudgmentService({ enabled: false, answers: { turn_0: { score: 3 } } });
		assert.equal(await scoreResumeTurnRelevance({ omittedTurns, prompt: 'auth', judgment: disabled }), undefined);

		const featureOff = createFakeJudgmentService({ features: { resumeSelection: false }, answers: { turn_0: { score: 3 } } });
		assert.equal(await scoreResumeTurnRelevance({ omittedTurns, prompt: 'auth', judgment: featureOff }), undefined);
		assert.equal(featureOff.calls.length, 0);

		assert.equal(await scoreResumeTurnRelevance({ omittedTurns, prompt: 'auth', judgment: undefined }), undefined);
	});

	test('returns undefined when the request fails or answers nothing', async () => {
		const failing = createFakeJudgmentService({ error: new Error('offline') });
		assert.equal(await scoreResumeTurnRelevance({ omittedTurns, prompt: 'auth', judgment: failing }), undefined);

		const empty = createFakeJudgmentService({ answers: {} });
		assert.equal(await scoreResumeTurnRelevance({ omittedTurns, prompt: 'auth', judgment: empty }), undefined);
	});

	test('sends only the most recent omitted turns and scores older ones zero', async () => {
		const many = Array.from({ length: MAX_RELEVANCE_SCORED_TURNS + 2 }, (_value, index) => request(`turn ${index}`));
		const judgment = createFakeJudgmentService({
			handler: (_state, questions) => Object.fromEntries(Object.keys(questions).map((key) => [key, { score: 3 }])) as never,
		});
		const scores = await scoreResumeTurnRelevance({ omittedTurns: many, prompt: 'turn', judgment });
		assert.equal(Object.keys(judgment.calls[0]?.questions ?? {}).length, MAX_RELEVANCE_SCORED_TURNS);
		assert.deepEqual(scores?.slice(0, 3), [0, 0, 1]);
	});
});
