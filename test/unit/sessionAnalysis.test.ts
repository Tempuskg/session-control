import * as assert from 'node:assert';
import {
	buildAnalysisPrompt,
	buildAnalysisSynthesisPrompt,
	buildImplementationPrompt,
	createCustomRangeSelection,
	createNeedsAnalysisSelection,
	createPresetAnalysisSelection,
	filterCandidatesForAnalysis,
	parseAnalysisSelectionAlias,
	splitCandidatesIntoAnalysisBatches,
	type AnalysisCandidateSession,
} from '../../src/sessionAnalysis';
import { ChatSession } from '../../src/types';

function createSession(id: string, savedAt: string, title: string, content: string): ChatSession {
	return {
		version: 1,
		id,
		title,
		savedAt,
		git: { branch: 'main', commit: 'abcdef123456', dirty: false },
		vscodeVersion: '1.115.0',
		totalTurns: 2,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns: [
			{
				type: 'request',
				participant: 'copilot',
				prompt: `Prompt for ${title}`,
				references: [],
				timestamp: savedAt,
			},
			{
				type: 'response',
				participant: 'copilot',
				content,
				toolCalls: [],
				timestamp: savedAt,
			},
		],
		markdownSummary: `# Chat: ${title}`,
	};
}

function createCandidate(id: string, savedAt: string, title: string, content: string): AnalysisCandidateSession {
	return {
		workspaceName: 'workspace',
		storageDirectory: 'storage',
		fileName: `${id}.json`,
		rootFileName: `${id}.json`,
		fingerprint: `fingerprint-${id}`,
		session: createSession(id, savedAt, title, content),
	};
}

suite('sessionAnalysis', () => {
	test('parseAnalysisSelectionAlias recognizes presets and needs-analysis aliases', () => {
		const now = new Date('2026-05-17T12:00:00.000Z');
		assert.equal(parseAnalysisSelectionAlias('24h', now)?.mode, 'last24Hours');
		assert.equal(parseAnalysisSelectionAlias('7d', now)?.mode, 'last7Days');
		assert.equal(parseAnalysisSelectionAlias('30d', now)?.mode, 'last30Days');
		assert.equal(parseAnalysisSelectionAlias('needs analysis', now)?.mode, 'needsAnalysis');
	});

	test('createCustomRangeSelection rejects inverted ranges', () => {
		assert.throws(
			() => createCustomRangeSelection('2026-05-20T00:00:00.000Z', '2026-05-10T00:00:00.000Z'),
			/start must be before the end/i,
		);
	});

	test('filterCandidatesForAnalysis filters by timeframe and unanalyzed state', () => {
		const now = new Date('2026-05-17T12:00:00.000Z');
		const recent = createCandidate('recent', '2026-05-17T11:00:00.000Z', 'Recent', 'Recent content');
		const older = createCandidate('older', '2026-05-01T11:00:00.000Z', 'Older', 'Older content');
		const last24 = createPresetAnalysisSelection('last24Hours', now);

		const byTime = filterCandidatesForAnalysis([recent, older], last24, new Set<string>());
		assert.equal(byTime.length, 1);
		assert.equal(byTime[0]?.session.id, 'recent');

		const needsAnalysis = createNeedsAnalysisSelection();
		const unanalyzed = filterCandidatesForAnalysis([recent, older], needsAnalysis, new Set<string>(['fingerprint-recent']));
		assert.equal(unanalyzed.length, 1);
		assert.equal(unanalyzed[0]?.session.id, 'older');

		const last24UnanalyzedOnly = createPresetAnalysisSelection('last24Hours', now, true);
		const withinRangeUnanalyzedOnly = filterCandidatesForAnalysis(
			[recent, older],
			last24UnanalyzedOnly,
			new Set<string>(['fingerprint-recent']),
		);
		assert.equal(withinRangeUnanalyzedOnly.length, 0);

		const customRangeUnanalyzedOnly = createCustomRangeSelection(
			'2026-05-01T00:00:00.000Z',
			'2026-05-18T00:00:00.000Z',
			true,
		);
		const mixedRange = filterCandidatesForAnalysis(
			[recent, older],
			customRangeUnanalyzedOnly,
			new Set<string>(['fingerprint-recent']),
		);
		assert.equal(mixedRange.length, 1);
		assert.equal(mixedRange[0]?.session.id, 'older');
	});

	test('splitCandidatesIntoAnalysisBatches splits large candidate sets by evidence size', () => {
		const first = createCandidate('a', '2026-05-17T11:00:00.000Z', 'Alpha', 'x'.repeat(200));
		const second = createCandidate('b', '2026-05-17T10:00:00.000Z', 'Beta', 'y'.repeat(200));
		const batches = splitCandidatesIntoAnalysisBatches([first, second], 250);
		assert.equal(batches.length, 2);
		assert.equal(batches[0]?.length, 1);
		assert.equal(batches[1]?.length, 1);
	});

	test('buildAnalysisPrompt includes timeframe label and required sections', () => {
		const selection = createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z'));
		const prompt = buildAnalysisPrompt(selection, [
			createCandidate('a', '2026-05-17T11:00:00.000Z', 'Alpha', 'Alpha content'),
		]);

		assert.equal(prompt.includes('Review my last interactions with AI from Last 7 Days.'), true);
		assert.equal(prompt.includes('Repository-Specific Findings'), true);
		assert.equal(prompt.includes('Coding Agent Preload Insights'), true);
	});

	test('buildAnalysisSynthesisPrompt includes batch findings for final synthesis', () => {
		const selection = createNeedsAnalysisSelection();
		const prompt = buildAnalysisSynthesisPrompt(selection, ['Finding one', 'Finding two']);

		assert.equal(prompt.includes('Needs Analysis'), true);
		assert.equal(prompt.includes('## Batch 1'), true);
		assert.equal(prompt.includes('## Batch 2'), true);
	});

	test('buildImplementationPrompt includes the saved analysis report and user request', () => {
		const prompt = buildImplementationPrompt(
			'# Chat Analysis Report\n\n## Findings\n\n- Tighten the save flow',
			'Implement the highest-priority recommendation.',
		);

		assert.equal(prompt.includes('The user previously ran an analysis over saved chat sessions'), true);
		assert.equal(prompt.includes('# Chat Analysis Report'), true);
		assert.equal(prompt.includes('User request: Implement the highest-priority recommendation.'), true);
	});
});