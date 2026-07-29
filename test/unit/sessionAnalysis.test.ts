import * as assert from 'node:assert';
import {
	buildAnalysisPrompt,
	buildAnalysisSynthesisPrompt,
	buildImplementationHandoffPrompt,
	createCustomRangeSelection,
	createNeedsAnalysisSelection,
	createPresetAnalysisSelection,
	createSingleSessionSelection,
	filterCandidatesForAnalysis,
	parseAnalysisSelectionAlias,
	splitCandidatesIntoAnalysisBatches,
	type AnalysisCandidateSession,
} from '../../src/sessionAnalysis';
import { ChatSession, isAnalysisSelection } from '../../src/types';

function createSession(id: string, savedAt: string, title: string, content: string, requestPrompt = `Prompt for ${title}`): ChatSession {
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
				prompt: requestPrompt,
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

function createCandidate(id: string, savedAt: string, title: string, content: string, requestPrompt?: string): AnalysisCandidateSession {
	return {
		workspaceName: 'workspace',
		storageDirectory: 'storage',
		fileName: `${id}.json`,
		rootFileName: `${id}.json`,
		fingerprint: `fingerprint-${id}`,
		session: createSession(id, savedAt, title, content, requestPrompt),
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

	test('filterCandidatesForAnalysis skips saved session-control analyze chats', () => {
		const normal = createCandidate('normal', '2026-05-17T11:00:00.000Z', 'Fix auth bug', 'Normal content');
		const analyze = createCandidate(
			'analyze',
			'2026-05-17T10:00:00.000Z',
			'@session-control /analyze',
			'Analyze content',
			'@session-control /analyze',
		);
		const analyzeTypo = createCandidate(
			'analyze-typo',
			'2026-05-17T09:00:00.000Z',
			'@session-control /analze',
			'Analyze typo content',
			'@session-control /analze',
		);

		const filtered = filterCandidatesForAnalysis(
			[normal, analyze, analyzeTypo],
			createNeedsAnalysisSelection(),
			new Set<string>(),
		);

		assert.equal(filtered.length, 1);
		assert.equal(filtered[0]?.session.id, 'normal');
	});

	test('createSingleSessionSelection labels the session and pins its id', () => {
		const selection = createSingleSessionSelection({ id: 'session-1', title: 'Fix auth bug' });

		assert.equal(selection.mode, 'singleSession');
		assert.equal(selection.label, 'Session: Fix auth bug');
		assert.equal(selection.sessionId, 'session-1');
		assert.equal(selection.range, null);
	});

	test('filterCandidatesForAnalysis with a single-session selection matches only that session', () => {
		const target = createCandidate('target', '2026-05-17T11:00:00.000Z', 'Target session', 'Target content');
		const other = createCandidate('other', '2026-05-01T11:00:00.000Z', 'Other session', 'Other content');
		const selection = createSingleSessionSelection({ id: 'target', title: 'Target session' });

		const filtered = filterCandidatesForAnalysis([other, target], selection, new Set<string>());
		assert.equal(filtered.length, 1);
		assert.equal(filtered[0]?.session.id, 'target');

		// An explicit single-session pick re-analyzes even an already-analyzed session.
		const alreadyAnalyzed = filterCandidatesForAnalysis(
			[other, target],
			selection,
			new Set<string>(['fingerprint-target']),
		);
		assert.equal(alreadyAnalyzed.length, 1);
		assert.equal(alreadyAnalyzed[0]?.session.id, 'target');
	});

	test('isAnalysisSelection accepts every persisted selection mode including singleSession', () => {
		const persistedSelections = [
			createPresetAnalysisSelection('last24Hours', new Date('2026-05-17T12:00:00.000Z')),
			createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
			createPresetAnalysisSelection('last30Days', new Date('2026-05-17T12:00:00.000Z')),
			createCustomRangeSelection('2026-05-01T00:00:00.000Z', '2026-05-17T00:00:00.000Z'),
			createNeedsAnalysisSelection(),
			createSingleSessionSelection({ id: 'session-1', title: 'Fix auth bug' }),
		];

		for (const selection of persistedSelections) {
			assert.equal(isAnalysisSelection(JSON.parse(JSON.stringify(selection))), true, selection.mode);
		}

		assert.equal(isAnalysisSelection({ mode: 'singleSession', label: 'Session: X', range: null, sessionId: 42 }), false);
		assert.equal(isAnalysisSelection({ mode: 'unknownMode', label: 'X', range: null }), false);
	});

	test('splitCandidatesIntoAnalysisBatches splits large candidate sets by evidence size', () => {
		const first = createCandidate('a', '2026-05-17T11:00:00.000Z', 'Alpha', 'x'.repeat(200));
		const second = createCandidate('b', '2026-05-17T10:00:00.000Z', 'Beta', 'y'.repeat(200));
		const batches = splitCandidatesIntoAnalysisBatches([first, second], 250);
		assert.equal(batches.length, 2);
		assert.equal(batches[0]?.length, 1);
		assert.equal(batches[1]?.length, 1);
	});

	test('buildAnalysisPrompt condenses oversized evidence for compact detail levels', () => {
		const selection = createNeedsAnalysisSelection();
		const oversizedText = `${'alpha '.repeat(900)}middle marker${'omega '.repeat(900)}`;
		const candidate = createCandidate('oversized', '2026-05-17T11:00:00.000Z', 'Oversized', oversizedText, oversizedText);

		const full = buildAnalysisPrompt(selection, [candidate]);
		const compact = buildAnalysisPrompt(selection, [candidate], '', 'compact');
		const summaryOnly = buildAnalysisPrompt(selection, [candidate], '', 'summaryOnly');

		assert.equal(compact.length < full.length, true);
		assert.equal(summaryOnly.length < compact.length, true);
		assert.equal(compact.includes('Transcript (condensed due to size)'), true);
		assert.equal(summaryOnly.includes('summary-only evidence'), true);
	});

	test('buildAnalysisPrompt includes timeframe label and required sections', () => {
		const selection = createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z'));
		const prompt = buildAnalysisPrompt(selection, [
			createCandidate('a', '2026-05-17T11:00:00.000Z', 'Alpha', 'Alpha content'),
		], '### Workspace: workspace\n\n#### AGENTS.md\n\n```md\nExisting instruction\n```');

		assert.equal(prompt.includes('Review my last interactions with AI from Last 7 Days.'), true);
		assert.equal(prompt.includes('Restrict all recommendations to AI-specific control files in the repository.'), true);
		assert.equal(prompt.includes('Only list gaps that are not already covered there.'), true);
		assert.equal(prompt.includes('If an instruction or skill already exists, omit it'), true);
		assert.equal(prompt.includes('AGENTS.md and .github/copilot-instructions.md'), true);
		assert.equal(prompt.includes('repeated workflows or recurring instructions'), true);
		assert.equal(prompt.includes('Recommended AI Skills to Create'), true);
		assert.equal(prompt.includes('Existing AI Instructions and Skills:'), true);
		assert.equal(prompt.includes('Existing instruction'), true);
		assert.equal(prompt.includes('Do not recommend application source-code changes'), true);
		assert.equal(prompt.includes('Repository-Specific Findings'), true);
		assert.equal(prompt.includes('Coding Agent Preload Insights'), true);
	});

	test('buildAnalysisSynthesisPrompt includes batch findings for final synthesis', () => {
		const selection = createNeedsAnalysisSelection();
		const prompt = buildAnalysisSynthesisPrompt(
			selection,
			['Finding one', 'Finding two'],
			'### Workspace: workspace\n\n#### SKILL.md\n\n```md\nExisting skill\n```',
		);

		assert.equal(prompt.includes('Needs Analysis'), true);
		assert.equal(prompt.includes('CLAUDE.md'), true);
		assert.equal(prompt.includes('Only list gaps that are not already covered there.'), true);
		assert.equal(prompt.includes('recommend creating a specific skill file'), true);
		assert.equal(prompt.includes('Recommended AI Skills to Create'), true);
		assert.equal(prompt.includes('Existing skill'), true);
		assert.equal(prompt.includes('say so instead of proposing general repository changes'), true);
		assert.equal(prompt.includes('## Batch 1'), true);
		assert.equal(prompt.includes('## Batch 2'), true);
	});

	test('buildImplementationHandoffPrompt points the coding agent at the saved report file', () => {
		const prompt = buildImplementationHandoffPrompt(
			'e:/workspace/.chat/analysis/reports/report-1.md',
			'Implement the highest-priority recommendation.',
		);

		assert.equal(prompt.includes('full workspace access'), true);
		assert.equal(prompt.includes('AGENTS.md'), true);
		assert.equal(prompt.includes('.github/copilot-instructions.md'), true);
		assert.equal(prompt.includes('CLAUDE.md when present'), true);
		assert.equal(prompt.includes('create the repository-local skill file'), true);
		assert.equal(prompt.includes('SKILL.md, *.instructions.md, *.prompt.md, or *.agent.md'), true);
		assert.equal(prompt.includes('Do not expand into application source files'), true);
		assert.equal(prompt.includes('Inspect the current working tree first'), true);
		assert.equal(prompt.includes('e:/workspace/.chat/analysis/reports/report-1.md'), true);
		assert.equal(prompt.includes('User request: Implement the highest-priority recommendation.'), true);
	});
});
