import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	buildParticipantFollowups,
	renderSessionListMarkdown,
	resolveSummarizeNoteWithFallback,
	runAnalyzeSessionsFlow,
	runImplementRecommendationsFlow,
	selectSessionForResume,
	trimTurnsForResume,
} from '../../src/chatParticipant';
import {
	buildImplementationPrompt,
	createNeedsAnalysisSelection,
	createPresetAnalysisSelection,
	type AnalysisCandidateSession,
} from '../../src/sessionAnalysis';
import { AnalysisIndex, AnalysisReportReference, ChatSession, SavedTurn, SessionMeta } from '../../src/types';

function createMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		id: overrides.id ?? '1',
		title: overrides.title ?? 'Fix auth bug',
		savedAt: overrides.savedAt ?? '2026-04-12T12:00:00.000Z',
		fileName: overrides.fileName ?? '2026-04-12T12-00-fix-auth-bug.json',
		turnCount: overrides.turnCount ?? 10,
		git: overrides.git ?? null,
	};
}

function createWorkspaceFolder(name: string, folderPath: string, index: number): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(folderPath),
		name,
		index,
	} as vscode.WorkspaceFolder;
}

function createChatSession(overrides: Partial<ChatSession> = {}): ChatSession {
	const savedAt = overrides.savedAt ?? '2026-05-17T12:00:00.000Z';
	return {
		version: 1,
		id: overrides.id ?? 'session-1',
		title: overrides.title ?? 'Fix auth bug',
		savedAt,
		git: overrides.git ?? { branch: 'main', commit: 'abcdef123456', dirty: false },
		vscodeVersion: overrides.vscodeVersion ?? '1.115.0',
		totalTurns: overrides.totalTurns ?? 2,
		part: overrides.part ?? null,
		totalParts: overrides.totalParts ?? null,
		previousPartFile: overrides.previousPartFile ?? null,
		nextPartFile: overrides.nextPartFile ?? null,
		turns: overrides.turns ?? [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Investigate the issue',
				references: [],
				timestamp: savedAt,
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'I found a likely root cause.',
				toolCalls: [],
				timestamp: savedAt,
			},
		],
		markdownSummary: overrides.markdownSummary ?? '# Chat: Summary',
	};
}

function createAnalysisCandidate(overrides: Partial<AnalysisCandidateSession> = {}): AnalysisCandidateSession {
	const session = overrides.session ?? createChatSession();
	return {
		workspaceName: overrides.workspaceName ?? 'workspace',
		storageDirectory: overrides.storageDirectory ?? 'storage',
		fileName: overrides.fileName ?? 'session.json',
		rootFileName: overrides.rootFileName ?? 'session.json',
		fingerprint: overrides.fingerprint ?? 'fingerprint-1',
		session,
	};
}

function createAnalyzeReportReference(): AnalysisReportReference {
	return {
		id: 'report-1',
		createdAt: '2026-05-17T13:00:00.000Z',
		selection: createNeedsAnalysisSelection(),
		promptVersion: '1',
		reportPath: 'analysis/reports/report-1.md',
		contributingWorkspaces: ['workspace'],
		analyzedFingerprints: ['fingerprint-1'],
	};
}

function createAnalyzeFlowDeps(overrides: Partial<Parameters<typeof runAnalyzeSessionsFlow>[3]> = {}) {
	const workspace = createWorkspaceFolder('workspace', 'e:/workspace', 0);
	const report = createAnalyzeReportReference();
	const defaultIndex: AnalysisIndex = {
		version: 1,
		updatedAt: '2026-05-17T13:00:00.000Z',
		reports: [report],
		analyzedSessions: [],
	};

	return {
		resolveSelection: async () => createNeedsAnalysisSelection(),
		createCandidates: async () => [createAnalysisCandidate()],
		loadAnalyzedFingerprints: async () => new Set<string>(),
		splitIntoBatches: (candidates: AnalysisCandidateSession[]) => [candidates],
		buildPrompt: () => 'analysis prompt',
		buildSynthesisPrompt: () => 'synthesis prompt',
		runModelPrompt: async () => '## Findings\n\nReport content',
		streamMarkdown: (_markdown: string) => undefined,
		pickOwnerWorkspace: () => workspace,
		getStoragePath: () => 'e:/workspace/.chat',
		writeReport: async () => ({
			report,
			reportFilePath: 'e:/workspace/.chat/analysis/reports/report-1.md',
		}),
		recordAnalysis: async () => defaultIndex,
		batchCharBudget: 1000,
		...overrides,
	};
}

function createImplementFlowDeps(overrides: Partial<Parameters<typeof runImplementRecommendationsFlow>[2]> = {}) {
	return {
		findAnalysisReportMeta: () => ({
			analysisReportPath: 'analysis/reports/report-1.md',
			analysisStorageDirectory: 'e:/workspace/.chat',
		}),
		readReport: async () => '# Chat Analysis Report\n\n## Findings\n\n- Tighten session flow',
		buildPrompt: (reportMarkdown: string, userPrompt: string) => buildImplementationPrompt(reportMarkdown, userPrompt),
		runModelPrompt: async () => 'Implementation guidance',
		streamMarkdown: (_markdown: string) => undefined,
		...overrides,
	};
}

suite('chatParticipant selection', () => {
	test('auto-selects a single strong match', () => {
		const sessions = [
			createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json' }),
			createMeta({ id: '2', title: 'Update docs', fileName: 'update-docs.json' }),
		];

		const selection = selectSessionForResume('fix auth', sessions);
		assert.equal(selection.session?.id, '1');
		assert.equal(selection.candidates, undefined);
	});

	test('returns candidates when only weak fuzzy matches exist', () => {
		const sessions = [
			createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json' }),
			createMeta({ id: '2', title: 'Feature branch cleanup', fileName: 'feature-branch-cleanup.json' }),
		];

		const selection = selectSessionForResume('fab', sessions);
		assert.equal(selection.session, undefined);
		assert.equal((selection.candidates ?? []).length >= 1, true);
		assert.equal(selection.candidates?.[0]?.id, '1');
	});

	test('returns empty selection when no query or no matches', () => {
		const sessions = [createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json' })];

		const noQuery = selectSessionForResume('', sessions);
		const noMatches = selectSessionForResume('deploy', sessions);

		assert.equal(noQuery.session, undefined);
		assert.equal(noQuery.candidates, undefined);
		assert.equal(noMatches.session, undefined);
		assert.equal(noMatches.candidates, undefined);
	});

	test('trimTurnsForResume honors max turn and char budgets', () => {
		const turns: SavedTurn[] = [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'one',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'two two',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'three',
				references: [],
				timestamp: '2026-04-12T12:02:00.000Z',
			},
		];

		const trimmed = trimTurnsForResume(turns, 2, 9);
		assert.equal(trimmed.length, 1);
		assert.equal(trimmed[0]?.type, 'request');
	});

	test('renderSessionListMarkdown returns a friendly empty message', () => {
		const markdown = renderSessionListMarkdown([]);
		assert.equal(markdown.includes('No saved sessions found.'), true);
	});

	test('resolveSummarizeNoteWithFallback returns model summary when available', async () => {
		const omittedTurns: SavedTurn[] = [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Investigate auth bug history',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'Auth bug started after token refresh refactor',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
		];

		const note = await resolveSummarizeNoteWithFallback(
			omittedTurns,
			async () => '- Root cause around refresh token lifecycle',
		);

		assert.equal(note?.includes('Summary of omitted context:'), true);
	});

	test('resolveSummarizeNoteWithFallback falls back when summarizer fails', async () => {
		const omittedTurns: SavedTurn[] = [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Investigate auth bug history',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
		];

		const note = await resolveSummarizeNoteWithFallback(
			omittedTurns,
			async () => {
				throw new Error('model unavailable');
			},
		);

		assert.equal(note, 'Summary generation failed - showing most recent turns only.');
	});
});

suite('chatParticipant analyze flow', () => {
	test('shows guidance when no saved sessions exist', async () => {
		const messages: string[] = [];
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[],
			createAnalyzeFlowDeps({
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(result, undefined);
		assert.deepEqual(messages, ['No saved sessions found. Save chat sessions before running analysis.']);
	});

	test('filters analyzed sessions in needs-analysis mode and persists only remaining sessions', async () => {
		const recorded: Array<{ storageDirectory: string; fingerprints: string[] }> = [];
		const reportWrites: string[][] = [];
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'already-analyzed',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Already analyzed' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'needs-analysis',
						storageDirectory: 'e:/workspace/.chat',
						rootFileName: 'needs-analysis.json',
						session: createChatSession({ id: 'b', title: 'Needs analysis' }),
					}),
				],
				loadAnalyzedFingerprints: async () => new Set<string>(['already-analyzed']),
				resolveSelection: async () => createNeedsAnalysisSelection(),
				writeReport: async (_storageDirectory, input) => {
					reportWrites.push(input.analyzedFingerprints);
					return {
						report: createAnalyzeReportReference(),
						reportFilePath: 'e:/workspace/.chat/analysis/reports/report-1.md',
					};
				},
				recordAnalysis: async (storageDirectory, _report, sessions) => {
					recorded.push({
						storageDirectory,
						fingerprints: sessions.map((session) => session.fingerprint),
					});
					return {
						version: 1,
						updatedAt: '2026-05-17T13:00:00.000Z',
						reports: [createAnalyzeReportReference()],
						analyzedSessions: [],
					};
				},
			}),
		);

		assert.equal(reportWrites.length, 1);
		assert.deepEqual(reportWrites[0], ['needs-analysis']);
		assert.deepEqual(recorded, [{ storageDirectory: 'e:/workspace/.chat', fingerprints: ['needs-analysis'] }]);
		assert.equal(result?.metadata.analysisReportPath, 'analysis/reports/report-1.md');
	});

	test('uses batch summaries then a synthesis pass when analysis input is split', async () => {
		const prompts: Array<{ prompt: string; streamOutput: boolean }> = [];
		const messages: string[] = [];
		await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({ fingerprint: 'fingerprint-a', session: createChatSession({ id: 'a', title: 'Session A' }) }),
					createAnalysisCandidate({ fingerprint: 'fingerprint-b', session: createChatSession({ id: 'b', title: 'Session B' }) }),
				],
				splitIntoBatches: (candidates: AnalysisCandidateSession[]) => candidates.map((candidate) => [candidate]),
				buildPrompt: (_selection, candidates) => `batch:${candidates[0]?.fingerprint}`,
				buildSynthesisPrompt: (_selection, batchSummaries) => `synthesis:${batchSummaries.join('|')}`,
				runModelPrompt: async (prompt: string, streamOutput: boolean) => {
					prompts.push({ prompt, streamOutput });
					if (prompt.startsWith('batch:')) {
						return `summary:${prompt}`;
					}

					return '## Findings\n\nSynthesized report';
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(prompts.length, 3);
		assert.equal(prompts[0]?.streamOutput, false);
		assert.equal(prompts[0]?.prompt.startsWith('batch:fingerprint-a'), true);
		assert.equal(prompts[1]?.streamOutput, false);
		assert.equal(prompts[1]?.prompt.startsWith('batch:fingerprint-b'), true);
		assert.equal(prompts[2]?.streamOutput, true);
		assert.equal(prompts[2]?.prompt.includes('synthesis:summary:batch:fingerprint-a'), true);
		assert.equal(prompts[2]?.prompt.includes('summary:batch:fingerprint-b'), true);
		assert.equal(messages.some((message) => message.includes('Analyzing 2 saved sessions across 2 batches')), true);
		assert.equal(messages.some((message) => message.includes('_Synthesizing final report..._')), true);
	});
});

suite('chatParticipant implementation followups', () => {
	test('suggests an implementation followup after an analysis result', () => {
		const followups = buildParticipantFollowups({
			metadata: {
				resultType: 'analysis-report',
				analysisReportPath: 'analysis/reports/report-1.md',
				analysisStorageDirectory: 'e:/workspace/.chat',
			},
		} as vscode.ChatResult);

		assert.equal(followups.length, 1);
		assert.equal(followups[0]?.label, 'Implement Recommendations');
		assert.equal(followups[0]?.command, 'implement');
	});

	test('does not suggest implementation followups for unrelated results', () => {
		const followups = buildParticipantFollowups({ metadata: { resultType: 'analysis-implementation' } } as vscode.ChatResult);
		assert.equal(followups.length, 0);
	});

	test('shows guidance when implementing without a prior analysis result', async () => {
		const messages: string[] = [];
		const result = await runImplementRecommendationsFlow(
			'Implement the recommendations.',
			[],
			createImplementFlowDeps({
				findAnalysisReportMeta: () => null,
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(result, undefined);
		assert.deepEqual(messages, ['Use @session-control /analyze first, then ask me to implement the recommendations.']);
	});

	test('loads the saved analysis report and returns implementation metadata', async () => {
		const prompts: Array<{ prompt: string; streamOutput: boolean }> = [];
		const messages: string[] = [];
		const result = await runImplementRecommendationsFlow(
			'Implement the highest-priority recommendation.',
			[],
			createImplementFlowDeps({
				runModelPrompt: async (prompt: string, streamOutput: boolean) => {
					prompts.push({ prompt, streamOutput });
					return 'Implementation guidance';
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(prompts.length, 1);
		assert.equal(prompts[0]?.streamOutput, true);
		assert.equal(prompts[0]?.prompt.includes('# Chat Analysis Report'), true);
		assert.equal(prompts[0]?.prompt.includes('User request: Implement the highest-priority recommendation.'), true);
		assert.equal(messages[0]?.includes('Using analysis report **analysis/reports/report-1.md** as implementation context.'), true);
		assert.equal(result?.metadata.resultType, 'analysis-implementation');
		assert.equal(result?.metadata.analysisReportPath, 'analysis/reports/report-1.md');
	});
});
