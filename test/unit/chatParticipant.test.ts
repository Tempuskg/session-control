import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	ANALYSIS_CHAT_DETAIL_CURRENT_MODEL,
	applyResumeOverflowStrategy,
	RELEVANT_FALLBACK_STRATEGY,
	resolveResumeOverflow,
	buildEmptyModelResponseMessage,
	buildParticipantFollowups,
	createAnalysisProviderPickItems,
	findAvailableAnalysisAgentProviders,
	getModelPromptLimit,
	IMPLEMENTATION_CHAT_DETAIL,
	isDirectRequestModel,
	isInEditorChatAvailable,
	resolveAnalysisSelection,
	resolveChatAnalysisModel,
	selectDefaultAnalysisModel,
	type AnalysisProviderChoices,
	renderSessionListMarkdown,
	resolveSummarizeNoteWithFallback,
	runAnalyzeSessionsFlow,
	runImplementationHandoffFlow,
	selectSessionForResume,
	trimTurnsForResume,
} from '../../src/chatParticipant';
import {
	buildImplementationHandoffPrompt,
	createNeedsAnalysisSelection,
	createPresetAnalysisSelection,
	parseAnalysisSelectionAlias,
	type AnalysisCandidateSession,
} from '../../src/sessionAnalysis';
import {
	INTENT_ROUTING_HIGH_CONFIDENCE,
	INTENT_ROUTING_MAX_SESSION_CANDIDATES,
	INTENT_ROUTING_MEDIUM_CONFIDENCE,
	buildIntentRoutingQuestions,
	judgeAnalysisTimeframe,
	routeSlashlessPrompt,
	selectSessionRefCandidates,
	toIntentRoutingSuggestionMetadata,
} from '../../src/typesafe/intentRouting';
import { createFakeJudgmentService } from '../../src/typesafe/judgmentService';
import {
	type HandoffDispatchResult,
	type HandoffSelectionId,
} from '../../src/handoffDispatcher';
import { AnalysisIndex, AnalysisReportReference, AnalysisTriageIndexEntry, ChatSession, SavedTurn, SessionMeta } from '../../src/types';

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

function createAnalyzeReportReference(overrides: Partial<AnalysisReportReference> = {}): AnalysisReportReference {
	return {
		id: overrides.id ?? 'report-1',
		createdAt: overrides.createdAt ?? '2026-05-17T13:00:00.000Z',
		selection: overrides.selection ?? createNeedsAnalysisSelection(),
		promptVersion: overrides.promptVersion ?? '1',
		reportPath: overrides.reportPath ?? 'analysis/reports/report-1.md',
		contributingWorkspaces: overrides.contributingWorkspaces ?? ['workspace'],
		analyzedFingerprints: overrides.analyzedFingerprints ?? ['fingerprint-1'],
		...(overrides.sessionCount === undefined ? {} : { sessionCount: overrides.sessionCount }),
		...(overrides.ownerWorkspaceName === undefined ? {} : { ownerWorkspaceName: overrides.ownerWorkspaceName }),
		...(overrides.repositories === undefined ? {} : { repositories: overrides.repositories }),
		...(overrides.sourceSessions === undefined ? {} : { sourceSessions: overrides.sourceSessions }),
		...(overrides.status === undefined ? {} : { status: overrides.status }),
		...(overrides.warnings === undefined ? {} : { warnings: overrides.warnings }),
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
		loadRecommendationBaseline: async () => '',
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

function createModel(name: string, vendor: string, id: string): vscode.LanguageModelChat {
	return { name, vendor, family: id, id } as vscode.LanguageModelChat;
}

function createHandoffFlowDeps(overrides: Partial<Parameters<typeof runImplementationHandoffFlow>[2]> = {}) {
	return {
		findAnalysisReportMeta: () => ({
			analysisReportPath: 'analysis/reports/report-1.md',
			analysisStorageDirectory: 'e:/workspace/.chat',
		}),
		buildPrompt: (reportFilePath: string, userPrompt: string) => buildImplementationHandoffPrompt(reportFilePath, userPrompt),
		getCommands: async () => [],
		pickProvider: async (): Promise<{ kind: 'chat' }> => ({ kind: 'chat' }),
		dispatchHandoff: async (_prompt: string, target: HandoffSelectionId): Promise<HandoffDispatchResult> => ({
			selectedTarget: target === 'cursor' ? 'agentSession' : target,
			deliveredTo: target === 'cursor' ? 'agentSession' : target,
			method: 'prefill',
			instruction: 'Opened Chat with the implementation prompt prefilled. Review it and send it when ready.',
			failures: [],
		}),
		streamMarkdown: (_markdown: string) => undefined,
		...overrides,
	};
}

suite('chatParticipant selection', () => {
	test('lists only the in-editor chat and installed agents, each with what will happen', () => {
		const items = createAnalysisProviderPickItems({
			purpose: 'analysis',
			chatDetail: ANALYSIS_CHAT_DETAIL_CURRENT_MODEL,
			agentProviders: ['cursor', 'codex', 'claude-code'],
		});

		assert.deepEqual(
			items.map((item) => ({ label: item.label, description: item.description, detail: item.detail, selection: item.selection })),
			[
				{ label: 'Chat', description: 'In-editor chat', detail: ANALYSIS_CHAT_DETAIL_CURRENT_MODEL, selection: { kind: 'chat' } },
				{
					label: 'Cursor',
					description: 'Agent',
					detail: 'Hands the analysis prompt to Cursor, which analyzes the saved chats with its own model',
					selection: { kind: 'agent', provider: 'cursor' },
				},
				{
					label: 'Codex',
					description: 'Agent',
					detail: 'Hands the analysis prompt to Codex, which analyzes the saved chats with its own model',
					selection: { kind: 'agent', provider: 'codex' },
				},
				{
					label: 'Claude Code',
					description: 'Agent',
					detail: 'Hands the analysis prompt to Claude Code, which analyzes the saved chats with its own model',
					selection: { kind: 'agent', provider: 'claude-code' },
				},
			],
		);
	});

	test('offers no model rows for implementation and omits an unavailable in-editor chat', () => {
		const implementationItems = createAnalysisProviderPickItems({
			purpose: 'implementation',
			chatDetail: IMPLEMENTATION_CHAT_DETAIL,
			agentProviders: ['codex'],
		});
		assert.deepEqual(implementationItems.map((item) => item.selection.kind), ['chat', 'agent']);
		assert.equal(implementationItems[0]?.detail, IMPLEMENTATION_CHAT_DETAIL);
		assert.equal(
			implementationItems[1]?.detail,
			'Hands the implementation prompt to Codex, which applies the recommendations with its own model',
		);

		const agentsOnly = createAnalysisProviderPickItems({ purpose: 'analysis', agentProviders: ['claude-code'] });
		assert.deepEqual(agentsOnly.map((item) => item.label), ['Claude Code']);
		assert.deepEqual(createAnalysisProviderPickItems({ purpose: 'analysis', agentProviders: [] }), []);
	});

	test('treats the in-editor chat as available when it has models or an open-chat command', () => {
		const model = createModel('GPT-4.1', 'copilot', 'copilot-gpt-4.1');
		assert.equal(isInEditorChatAvailable([model], []), true);
		assert.equal(isInEditorChatAvailable([], ['workbench.action.chat.open']), true);
		assert.equal(isInEditorChatAvailable([], ['chatgpt.openSidebar']), false);
	});

	test('defaults command analysis to the first Copilot model that answers direct requests', () => {
		const cliModel = createModel('Auto', 'copilotcli', 'auto');
		const agentHostModel = createModel('Hydra', 'copilot', 'agent-host-copilotcli:hydrafusion');
		const otherVendorModel = createModel('Local', 'ollama', 'llama');
		const first = createModel('GPT-4.1', 'copilot', 'copilot-gpt-4.1');
		const second = createModel('Claude', 'copilot', 'copilot-claude');

		assert.equal(selectDefaultAnalysisModel([cliModel, agentHostModel, otherVendorModel, first, second]), first);
		assert.equal(selectDefaultAnalysisModel([cliModel, otherVendorModel]), undefined);
		assert.equal(selectDefaultAnalysisModel([]), undefined);
	});

	test('uses the chat\'s current model for /analyze and never asks for a model', async () => {
		const current = createModel('Claude Sonnet', 'copilot', 'claude-sonnet');
		let modelsListed = false;

		const resolved = await resolveChatAnalysisModel(current, async () => {
			modelsListed = true;
			return [];
		});

		assert.equal(resolved, current);
		assert.equal(modelsListed, false);
	});

	test('falls back to the default Copilot model when the chat\'s current model is a Copilot CLI model', async () => {
		const current = createModel('Auto', 'copilotcli', 'auto');
		const fallback = createModel('GPT-4.1', 'copilot', 'copilot-gpt-4.1');

		assert.equal(await resolveChatAnalysisModel(current, async () => [current, fallback]), fallback);
		assert.equal(await resolveChatAnalysisModel(current, async () => [current]), undefined);
		assert.equal(
			await resolveChatAnalysisModel(current, async () => {
				throw new Error('model discovery failed');
			}),
			undefined,
		);
	});

	test('excludes Copilot CLI agent-host models from direct-request pickers', () => {
		assert.equal(isDirectRequestModel({ vendor: 'copilot', id: 'copilot-gpt-4.1' }), true);
		assert.equal(isDirectRequestModel({ vendor: 'copilotcli', id: 'auto' }), false);
		assert.equal(isDirectRequestModel({ vendor: '', id: 'agent-host-copilotcli:hydrafusion' }), false);
	});

	test('names the model when it returns no text', () => {
		const model = { name: 'Auto', vendor: 'copilotcli', id: 'auto' };

		assert.equal(
			buildEmptyModelResponseMessage(model, 0),
			'The selected model "Auto" (copilotcli) returned no text. Choose a different model for analysis.',
		);
		assert.equal(
			buildEmptyModelResponseMessage(model, 2),
			'The selected model "Auto" (copilotcli) returned no text (received 2 non-text response parts). Choose a different model for analysis.',
		);
	});

	test('detects installed analysis agents from their contributed commands', () => {
		assert.deepEqual(
			findAvailableAnalysisAgentProviders([
				'chatgpt.openSidebar',
				'claude-vscode.sidebar.open',
			]),
			['codex', 'claude-code'],
		);
	});

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

suite('chatParticipant applyResumeOverflowStrategy', () => {
	function request(prompt: string): SavedTurn {
		return { type: 'request', participant: 'copilot', prompt, references: [], timestamp: '2026-04-12T12:00:00.000Z' };
	}

	function textOf(turn: SavedTurn): string {
		return turn.type === 'request' ? turn.prompt : turn.content;
	}

	// t0..t5, 10 chars each; the last two are the recent window.
	const turns: SavedTurn[] = ['t0-auth---', 't1-css----', 't2-auth---', 't3-deploy-', 't4-recent-', 't5-recent-'].map(request);

	// Fake scorer: relevant when the turn text mentions the follow-up keyword.
	function keywordScorer(calls: SavedTurn[][]): (omitted: SavedTurn[], prompt: string) => Promise<number[]> {
		return async (omitted, prompt) => {
			calls.push(omitted);
			return omitted.map((turn) => (textOf(turn).includes(prompt) ? 1 : 0.1));
		};
	}

	test('truncate keeps the last turns within the budget', () => {
		const result = applyResumeOverflowStrategy(turns, 2, 1000, 'truncate');
		assert.deepEqual(result.turns.map(textOf), ['t4-recent-', 't5-recent-']);
		assert.equal(result.note, undefined);
	});

	test('relevant fills the char budget with the highest-scored omitted turns in turn order', () => {
		const result = applyResumeOverflowStrategy(turns, 2, 40, 'relevant', [0.9, 0.2, 0.8, 0]);
		assert.deepEqual(result.turns.map(textOf), ['t0-auth---', 't2-auth---', 't4-recent-', 't5-recent-']);
		assert.equal(result.note?.includes('2 of 4 earlier turns'), true);
	});

	test('relevant always keeps the last maxTurns even when the budget is spent', () => {
		const result = applyResumeOverflowStrategy(turns, 2, 20, 'relevant', [1, 1, 1, 1]);
		assert.deepEqual(result.turns.map(textOf), ['t4-recent-', 't5-recent-']);
	});

	test('relevant without scores falls back to summarize', () => {
		const relevant = applyResumeOverflowStrategy(turns, 2, 1000, 'relevant');
		const summarize = applyResumeOverflowStrategy(turns, 2, 1000, RELEVANT_FALLBACK_STRATEGY);
		assert.equal(RELEVANT_FALLBACK_STRATEGY, 'summarize');
		assert.deepEqual(relevant, summarize);
	});

	test('resolveResumeOverflow scores only omitted turns with the fake scorer', async () => {
		const calls: SavedTurn[][] = [];
		const result = await resolveResumeOverflow(turns, 'auth', 2, 1000, 'relevant', keywordScorer(calls));
		assert.equal(result.strategy, 'relevant');
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.map(textOf), ['t0-auth---', 't1-css----', 't2-auth---', 't3-deploy-']);
		// Budget fits everything, so every scored turn is included in turn order.
		assert.deepEqual(result.turns.map(textOf), turns.map(textOf));
	});

	test('resolveResumeOverflow prefers relevant turns when the budget is tight', async () => {
		const result = await resolveResumeOverflow(turns, 'auth', 2, 40, 'relevant', keywordScorer([]));
		assert.deepEqual(result.turns.map(textOf), ['t0-auth---', 't2-auth---', 't4-recent-', 't5-recent-']);
	});

	test('resolveResumeOverflow falls back to summarize when TypeSafe is unavailable', async () => {
		const unavailable = await resolveResumeOverflow(turns, 'auth', 2, 1000, 'relevant', async () => undefined);
		assert.equal(unavailable.strategy, 'summarize');
		assert.equal(unavailable.note?.includes('Summary of omitted context:'), true);

		const failing = await resolveResumeOverflow(turns, 'auth', 2, 1000, 'relevant', async () => {
			throw new Error('offline');
		});
		assert.equal(failing.strategy, 'summarize');

		const noScorer = await resolveResumeOverflow(turns, 'auth', 2, 1000, 'relevant');
		assert.equal(noScorer.strategy, 'summarize');
		assert.deepEqual(noScorer.turns.map(textOf), ['t4-recent-', 't5-recent-']);
	});

	test('resolveResumeOverflow leaves other strategies untouched and skips the scorer', async () => {
		const calls: SavedTurn[][] = [];
		const result = await resolveResumeOverflow(turns, 'auth', 2, 1000, 'truncate', keywordScorer(calls));
		assert.equal(result.strategy, 'truncate');
		assert.equal(calls.length, 0);
		assert.deepEqual(result.turns.map(textOf), ['t4-recent-', 't5-recent-']);
	});
});

suite('chatParticipant analyze flow', () => {
	function createFlowMeta() {
		return [{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }];
	}

	test('runs triage over filtered candidates before batching and returns the answers', async () => {
		const order: string[] = [];
		const triaged: string[][] = [];
		const answers = new Map([['fingerprint-1', { trivial: { type: 'noul', noul: 0.1 } }]]);
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps({
				triageCandidates: async (candidates) => {
					order.push('triage');
					triaged.push(candidates.map((candidate) => candidate.fingerprint));
					return answers as never;
				},
				splitIntoBatches: (candidates) => {
					order.push('batch');
					return [candidates];
				},
			}),
		);

		assert.deepEqual(order, ['triage', 'batch']);
		assert.deepEqual(triaged, [['fingerprint-1']]);
		assert.equal(result?.triage, answers);
	});

	test('saves the verified report content and reports the verification summary', async () => {
		const written: string[] = [];
		const streamed: string[] = [];
		const verifiedWith: string[][] = [];
		await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps({
				streamMarkdown: (markdown: string) => streamed.push(markdown),
				verifyReport: async (report, candidates) => {
					verifiedWith.push(candidates.map((candidate) => candidate.fingerprint));
					return { content: `${report}\n\nverified`, summary: { total: 3, verified: 1, unsupported: 1, demoted: 1 } };
				},
				writeReport: async (_storageDirectory, input) => {
					written.push(input.content);
					return { report: createAnalyzeReportReference(), reportFilePath: 'e:/workspace/.chat/analysis/reports/report-1.md' };
				},
			}),
		);

		assert.deepEqual(verifiedWith, [['fingerprint-1']]);
		assert.deepEqual(written, ['## Findings\n\nReport content\n\nverified']);
		assert.ok(streamed.some((markdown) => markdown.includes('1 of 3 recommendations verified, 1 flagged as unsupported, 1 demoted')));
	});

	test('saves the unverified report when verification throws', async () => {
		const written: string[] = [];
		await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps({
				verifyReport: async () => {
					throw new Error('judgment down');
				},
				writeReport: async (_storageDirectory, input) => {
					written.push(input.content);
					return { report: createAnalyzeReportReference(), reportFilePath: 'e:/workspace/.chat/analysis/reports/report-1.md' };
				},
			}),
		);

		assert.deepEqual(written, ['## Findings\n\nReport content']);
	});

	test('the triage policy excludes trivial sessions and passes rank-based detail levels', async () => {
		const candidates = ['fingerprint-1', 'fingerprint-2', 'fingerprint-3']
			.map((fingerprint) => createAnalysisCandidate({ fingerprint }));
		const triage = new Map([
			['fingerprint-1', { trivial: { type: 'noul', noul: 0.9 } }],
			['fingerprint-2', { friction: { type: 'score', score: 1 } }],
			['fingerprint-3', { friction: { type: 'score', score: 3 } }],
		]);
		const batched: string[][] = [];
		const prompted: { fingerprints: string[]; levels: (string | undefined)[] }[] = [];
		const streamed: string[] = [];
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps({
				createCandidates: async () => candidates,
				batchCharBudget: 1_000_000,
				triageCandidates: async () => triage as never,
				splitIntoBatches: (batchInput, _maxChars, detailLevels) => {
					assert.ok(detailLevels);
					batched.push(batchInput.map((candidate) => candidate.fingerprint));
					return [batchInput];
				},
				buildPrompt: (_selection, promptInput, _baseline, _detailLevel, detailLevels) => {
					prompted.push({
						fingerprints: promptInput.map((candidate) => candidate.fingerprint),
						levels: promptInput.map((candidate) => detailLevels?.get(candidate.fingerprint)),
					});
					return 'analysis prompt';
				},
				streamMarkdown: (markdown: string) => {
					streamed.push(markdown);
				},
			}),
		);

		assert.deepEqual(batched, [['fingerprint-3', 'fingerprint-2']]);
		assert.deepEqual(prompted, [{ fingerprints: ['fingerprint-3', 'fingerprint-2'], levels: ['full', 'full'] }]);
		assert.ok(streamed.some((markdown) => markdown.includes('Skipping 1 of 3 sessions')));
		assert.equal(result?.metadata.analysisStatus, 'complete');
	});

	test('triage counts reach the report input and signals are recorded per storage directory', async () => {
		const candidates = ['fingerprint-1', 'fingerprint-2', 'fingerprint-3']
			.map((fingerprint) => createAnalysisCandidate({ fingerprint, storageDirectory: 'e:/workspace/.chat' }));
		const triage = new Map([
			['fingerprint-1', { trivial: { type: 'noul', noul: 0.9 } }],
			['fingerprint-2', { friction: { type: 'score', score: 3 }, instructionViolation: { type: 'noul', noul: 0.5 } }],
		]);
		const reportTriage: unknown[] = [];
		const recordedTriage: { storageDirectory: string; entries: AnalysisTriageIndexEntry[] }[] = [];
		await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps({
				createCandidates: async () => candidates,
				batchCharBudget: 1_000_000,
				triageCandidates: async () => triage as never,
				recordTriage: async (storageDirectory, entries) => {
					recordedTriage.push({ storageDirectory, entries });
				},
				writeReport: async (_storageDirectory, input) => {
					reportTriage.push(input.triage);
					return {
						report: createAnalyzeReportReference(),
						reportFilePath: 'e:/workspace/.chat/analysis/reports/report-1.md',
					};
				},
			}),
		);

		assert.deepEqual(reportTriage, [{ triaged: 2, analyzed: 2, skipped: 1 }]);
		assert.equal(recordedTriage.length, 1);
		assert.equal(recordedTriage[0]?.storageDirectory, 'e:/workspace/.chat');
		const entries = recordedTriage[0]?.entries ?? [];
		assert.deepEqual(entries.map((entry) => [entry.fingerprint, entry.skipped]), [['fingerprint-1', true], ['fingerprint-2', false]]);
		assert.deepEqual(entries[1]?.signals, { friction: 3, instructionViolation: 0.5 });
		assert.equal(entries[0]?.priority, undefined);
		assert.equal(typeof entries[1]?.priority, 'number');
	});

	test('the flow stops before the LLM when triage marks every session trivial', async () => {
		const prompts: string[] = [];
		const streamed: string[] = [];
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps({
				triageCandidates: async () => new Map([['fingerprint-1', { trivial: { type: 'noul', noul: 0.99 } }]]) as never,
				runModelPrompt: async (prompt: string) => {
					prompts.push(prompt);
					return 'report';
				},
				streamMarkdown: (markdown: string) => {
					streamed.push(markdown);
				},
			}),
		);

		assert.equal(result, undefined);
		assert.equal(prompts.length, 0);
		assert.ok(streamed.some((markdown) => markdown.includes('skipped as low-signal')));
	});

	test('without triage the flow result is unchanged', async () => {
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			createFlowMeta(),
			createAnalyzeFlowDeps(),
		);

		assert.ok(result);
		assert.equal('triage' in result, false);
	});

	test('a failing or empty triage keeps the analysis running', async () => {
		for (const triageCandidates of [
			async () => {
				throw new Error('typesafe offline');
			},
			async () => new Map(),
		]) {
			const prompts: string[] = [];
			const result = await runAnalyzeSessionsFlow(
				'needs analysis',
				[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
				createFlowMeta(),
				createAnalyzeFlowDeps({
					triageCandidates,
					runModelPrompt: async (prompt: string) => {
						prompts.push(prompt);
						return '## Findings\n\nReport content';
					},
				}),
			);

			assert.equal(result?.metadata.analysisStatus, 'complete');
			assert.equal(prompts.length, 1);
			assert.equal(result !== undefined && 'triage' in result, false);
		}
	});

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

	test('shows guidance when no usable saved sessions remain after candidate loading', async () => {
		const messages: string[] = [];
		const result = await runAnalyzeSessionsFlow(
			'needs analysis',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				createCandidates: async () => [],
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(result, undefined);
		assert.deepEqual(messages, ['No usable saved sessions found. Some saved sessions could not be read.']);
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
		const recommendationBaselines: string[] = [];
		await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				loadRecommendationBaseline: async () => 'existing-ai-baseline',
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Session A' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-b',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'b', title: 'Session B' }),
					}),
				],
				splitIntoBatches: (candidates: AnalysisCandidateSession[]) => candidates.map((candidate) => [candidate]),
				buildPrompt: (_selection, candidates, recommendationBaseline) => {
					recommendationBaselines.push(recommendationBaseline);
					return `batch:${candidates[0]?.fingerprint}`;
				},
				buildSynthesisPrompt: (_selection, batchSummaries, recommendationBaseline) => {
					recommendationBaselines.push(recommendationBaseline);
					return `synthesis:${batchSummaries.join('|')}`;
				},
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
		assert.deepEqual(recommendationBaselines, ['existing-ai-baseline', 'existing-ai-baseline', 'existing-ai-baseline']);
		assert.equal(messages.some((message) => message.includes('Analyzing 2 saved sessions across 2 batches')), true);
		assert.equal(messages.some((message) => message.includes('_Synthesizing final report..._')), true);
	});

	test('persists a partial report when a later analysis batch fails', async () => {
		const messages: string[] = [];
		const reportWrites: Array<{ status: string | undefined; warnings: readonly string[] | undefined; fingerprints: string[]; content: string }> = [];
		const recorded: Array<{ storageDirectory: string; fingerprints: string[] }> = [];

		const result = await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Session A' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-b',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'b', title: 'Session B' }),
					}),
				],
				splitIntoBatches: (candidates: AnalysisCandidateSession[]) => candidates.map((candidate) => [candidate]),
				buildPrompt: (_selection, candidates) => `batch:${candidates[0]?.fingerprint}`,
				buildSynthesisPrompt: (_selection, batchSummaries) => `synthesis:${batchSummaries.join('|')}`,
				runModelPrompt: async (prompt: string) => {
					if (prompt.startsWith('batch:fingerprint-a')) {
						return 'summary:batch-a';
					}

					if (prompt.startsWith('batch:fingerprint-b')) {
						throw new Error('model unavailable');
					}

					return '## Findings\n\nSynthesized partial report';
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
				writeReport: async (_storageDirectory, input) => {
					reportWrites.push({
						status: input.status,
						warnings: input.warnings,
						fingerprints: input.analyzedFingerprints,
						content: input.content,
					});

					return {
						report: createAnalyzeReportReference({
							analyzedFingerprints: [...input.analyzedFingerprints],
							status: input.status,
							...(input.warnings === undefined ? {} : { warnings: input.warnings }),
						}),
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

		assert.equal(result?.metadata.resultType, 'analysis-report');
		assert.equal(result?.metadata.analysisStatus, 'partial');
		assert.deepEqual(reportWrites, [{
			status: 'partial',
			warnings: ['Batch 2 failed: model unavailable'],
			fingerprints: ['fingerprint-a'],
			content: '## Findings\n\nSynthesized partial report',
		}]);
		assert.deepEqual(recorded, [{ storageDirectory: 'e:/workspace/.chat', fingerprints: ['fingerprint-a'] }]);
		assert.equal(messages.some((message) => message.includes('Saved partial analysis report')), true);
	});

	test('retries smaller batches when the initial analysis prompt exceeds the token limit', async () => {
		const prompts: Array<{ prompt: string; streamOutput: boolean }> = [];
		const messages: string[] = [];
		const reportWrites: Array<{ status: string | undefined; warnings: readonly string[] | undefined; fingerprints: string[] }> = [];

		const result = await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Session A' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-b',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'b', title: 'Session B' }),
					}),
				],
				splitIntoBatches: (candidates: AnalysisCandidateSession[]) => [candidates],
				buildPrompt: (_selection, candidates) => `batch:${candidates.map((candidate) => candidate.fingerprint).join('|')}`,
				buildSynthesisPrompt: (_selection, batchSummaries) => `synthesis:${batchSummaries.join('|')}`,
				runModelPrompt: async (prompt: string, streamOutput: boolean) => {
					prompts.push({ prompt, streamOutput });
					if (prompt === 'batch:fingerprint-a|fingerprint-b') {
						throw new Error('Message exceeds token limit.');
					}

					if (prompt.startsWith('batch:fingerprint-a')) {
						return 'summary:a';
					}

					if (prompt.startsWith('batch:fingerprint-b')) {
						return 'summary:b';
					}

					return '## Findings\n\nRecovered report';
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
				writeReport: async (_storageDirectory, input) => {
					reportWrites.push({
						status: input.status,
						warnings: input.warnings,
						fingerprints: [...input.analyzedFingerprints],
					});

					return {
						report: createAnalyzeReportReference({
							analyzedFingerprints: [...input.analyzedFingerprints],
							status: input.status,
							...(input.warnings === undefined ? {} : { warnings: input.warnings }),
						}),
						reportFilePath: 'e:/workspace/.chat/analysis/reports/report-1.md',
					};
				},
			}),
		);

		assert.equal(result?.metadata.analysisStatus, 'complete');
		assert.equal(prompts[0]?.prompt, 'batch:fingerprint-a|fingerprint-b');
		assert.equal(prompts[0]?.streamOutput, true);
		assert.equal(prompts.some((entry) => entry.prompt.startsWith('batch:fingerprint-a\n\nThis is batch 1')), true);
		assert.equal(prompts.some((entry) => entry.prompt.startsWith('batch:fingerprint-b\n\nThis is batch 2')), true);
		assert.equal(prompts.some((entry) => entry.prompt === 'synthesis:summary:a|summary:b' && entry.streamOutput), true);
		assert.deepEqual(reportWrites, [{
			status: 'complete',
			warnings: undefined,
			fingerprints: ['fingerprint-a', 'fingerprint-b'],
		}]);
		assert.equal(messages.some((message) => message.includes('Retrying in smaller batches')), true);
	});

	test('retries a single oversized session with condensed evidence levels', async () => {
		const prompts: Array<{ prompt: string; streamOutput: boolean }> = [];
		const messages: string[] = [];

		const result = await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Oversized Session' }),
					}),
				],
				buildPrompt: (_selection, _candidates, _baseline, detailLevel) => `detail:${detailLevel ?? 'full'}`,
				runModelPrompt: async (prompt: string, streamOutput: boolean) => {
					prompts.push({ prompt, streamOutput });
					if (prompt === 'detail:full' || prompt === 'detail:compact') {
						throw new Error('Message exceeds token limit.');
					}

					return '## Findings\n\nRecovered report';
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(result?.metadata.analysisStatus, 'complete');
		assert.deepEqual(prompts, [
			{ prompt: 'detail:full', streamOutput: true },
			{ prompt: 'detail:compact', streamOutput: true },
			{ prompt: 'detail:summaryOnly', streamOutput: true },
		]);
		assert.equal(messages.some((message) => message.includes('condensed session evidence')), true);
		assert.equal(messages.some((message) => message.includes('summary-only evidence')), true);
	});

	test('skips full evidence without a model call when the prompt exceeds the model input limit', async () => {
		const promptLengths: number[] = [];
		const messages: string[] = [];
		const detailSizes = { full: 300, compact: 200, summaryOnly: 100 };

		const result = await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Oversized Session' }),
					}),
				],
				buildPrompt: (_selection, _candidates, _baseline, detailLevel) => 'x'.repeat(detailSizes[detailLevel ?? 'full']),
				runModelPrompt: async (prompt: string) => {
					promptLengths.push(prompt.length);
					return '## Findings\n\nReport';
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
				maxPromptChars: 250,
			}),
		);

		assert.equal(result?.metadata.analysisStatus, 'complete');
		assert.deepEqual(promptLengths, [200]);
		assert.equal(messages.some((message) => message.includes("too large for the model's input limit. Using condensed session evidence")), true);
		assert.equal(messages.some((message) => message.includes('exceeded the model token limit')), false);
	});

	test('splits a multi-session batch without a model call when the prompt exceeds the model input limit', async () => {
		const promptLengths: number[] = [];

		const result = await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Session A' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-b',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'b', title: 'Session B' }),
					}),
				],
				splitIntoBatches: (candidates: AnalysisCandidateSession[]) => [candidates],
				buildPrompt: (_selection, candidates) => 'x'.repeat(candidates.length * 200),
				buildSynthesisPrompt: () => 'synthesis',
				runModelPrompt: async (prompt: string) => {
					promptLengths.push(prompt.length);
					return prompt === 'synthesis' ? '## Findings\n\nReport' : 'summary';
				},
				streamMarkdown: () => undefined,
				maxPromptChars: 350,
			}),
		);

		assert.equal(result?.metadata.analysisStatus, 'complete');
		assert.equal(promptLengths.some((length) => length >= 400), false);
		assert.equal(promptLengths.length, 3);
	});

	test('checks prompts against the model input limit with exact token counts', async () => {
		const logs: string[] = [];
		const model = {
			name: 'GPT-4.1',
			vendor: 'copilot',
			maxInputTokens: 1000,
			countTokens: async (text: string | vscode.LanguageModelChatMessage) => (typeof text === 'string' ? text.length : 0),
		};
		const limit = getModelPromptLimit(model, undefined, (message) => logs.push(message));

		assert.equal(limit.maxPromptChars, 3000);
		assert.equal(await limit.promptExceedsModelInput?.('x'.repeat(1000)), false);
		assert.equal(await limit.promptExceedsModelInput?.('x'.repeat(1001)), true);
		assert.equal(logs[1], 'analyze: GPT-4.1 (copilot) prompt 1001 chars = 1001 tokens, limit 1000; using smaller evidence');
		assert.deepEqual(getModelPromptLimit({ ...model, maxInputTokens: 0 }, undefined, (message) => logs.push(message)), {});
		assert.equal(logs.at(-1), 'analyze: GPT-4.1 (copilot) reports no input token limit (0); prompt size pre-check disabled');

		const failingCount = getModelPromptLimit({ ...model, countTokens: async () => { throw new Error('unsupported'); } }, undefined, (message) => logs.push(message));
		assert.equal(await failingCount.promptExceedsModelInput?.('x'.repeat(3001)), true);
		assert.equal(logs.at(-1), 'analyze: GPT-4.1 (copilot) could not count tokens (unsupported); estimated 3001 chars against 3000; using smaller evidence');
	});

	test('retries synthesis in smaller groups when combined batch summaries exceed the token limit', async () => {
		const prompts: Array<{ prompt: string; streamOutput: boolean }> = [];
		const messages: string[] = [];

		const result = await runAnalyzeSessionsFlow(
			'7d',
			[createWorkspaceFolder('workspace', 'e:/workspace', 0)],
			[{ ...createMeta(), workspaceFolder: createWorkspaceFolder('workspace', 'e:/workspace', 0), storageDirectory: 'e:/workspace/.chat', displayTitle: '[workspace] Fix auth bug' }],
			createAnalyzeFlowDeps({
				resolveSelection: async () => createPresetAnalysisSelection('last7Days', new Date('2026-05-17T12:00:00.000Z')),
				createCandidates: async () => [
					createAnalysisCandidate({
						fingerprint: 'fingerprint-a',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'a', title: 'Session A' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-b',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'b', title: 'Session B' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-c',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'c', title: 'Session C' }),
					}),
					createAnalysisCandidate({
						fingerprint: 'fingerprint-d',
						storageDirectory: 'e:/workspace/.chat',
						session: createChatSession({ id: 'd', title: 'Session D' }),
					}),
				],
				splitIntoBatches: (candidates: AnalysisCandidateSession[]) => candidates.map((candidate) => [candidate]),
				buildPrompt: (_selection, candidates) => `batch:${candidates[0]?.fingerprint}`,
				buildSynthesisPrompt: (_selection, batchSummaries) => `synthesis:${batchSummaries.join('|')}`,
				runModelPrompt: async (prompt: string, streamOutput: boolean) => {
					prompts.push({ prompt, streamOutput });
					if (prompt.startsWith('batch:')) {
						return `summary:${prompt.split('\n', 1)[0]}`;
					}

					if (prompt === 'synthesis:summary:batch:fingerprint-a|summary:batch:fingerprint-b|summary:batch:fingerprint-c|summary:batch:fingerprint-d') {
						throw new Error('Message exceeds token limit.');
					}

					if (prompt === 'synthesis:summary:batch:fingerprint-a|summary:batch:fingerprint-b') {
						return 'group:left';
					}

					if (prompt === 'synthesis:summary:batch:fingerprint-c|summary:batch:fingerprint-d') {
						return 'group:right';
					}

					if (prompt === 'synthesis:group:left|group:right') {
						return '## Findings\n\nSynthesized report';
					}

					throw new Error(`Unexpected prompt: ${prompt}`);
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(result?.metadata.analysisStatus, 'complete');
		assert.equal(prompts.some((entry) => entry.prompt === 'synthesis:summary:batch:fingerprint-a|summary:batch:fingerprint-b|summary:batch:fingerprint-c|summary:batch:fingerprint-d' && entry.streamOutput), true);
		assert.equal(prompts.some((entry) => entry.prompt === 'synthesis:summary:batch:fingerprint-a|summary:batch:fingerprint-b' && !entry.streamOutput), true);
		assert.equal(prompts.some((entry) => entry.prompt === 'synthesis:summary:batch:fingerprint-c|summary:batch:fingerprint-d' && !entry.streamOutput), true);
		assert.equal(prompts.some((entry) => entry.prompt === 'synthesis:group:left|group:right' && entry.streamOutput), true);
		assert.equal(messages.some((message) => message.includes('Final synthesis exceeded the model token limit')), true);
	});
});

suite('chatParticipant implementation followups', () => {
	test('suggests an implement followup after an analysis result', () => {
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
		const followups = buildParticipantFollowups({ metadata: {} } as vscode.ChatResult);
		assert.equal(followups.length, 0);
	});

	test('shows guidance when implementing without a prior analysis result', async () => {
		const messages: string[] = [];

		await runImplementationHandoffFlow(
			'Open a coding agent handoff.',
			[],
			createHandoffFlowDeps({
				findAnalysisReportMeta: () => null,
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.deepEqual(messages, ['Use @session-control /analyze first, then ask me to implement the recommendations.']);
	});

	test('opens the in-editor chat with the implementation prompt when Chat is picked', async () => {
		let dispatchedPrompt: string | undefined;
		let dispatchedTarget: HandoffSelectionId | undefined;
		let offered: AnalysisProviderChoices | undefined;
		const messages: string[] = [];

		await runImplementationHandoffFlow(
			'Implement the highest-priority recommendation.',
			[],
			createHandoffFlowDeps({
				getCommands: async () => ['workbench.action.chat.open', 'chatgpt.openSidebar'],
				pickProvider: async (choices) => {
					offered = choices;
					return { kind: 'chat' };
				},
				dispatchHandoff: async (prompt, target) => {
					dispatchedPrompt = prompt;
					dispatchedTarget = target;
					return {
						selectedTarget: 'chat',
						deliveredTo: 'chat',
						method: 'prefill',
						instruction: 'Opened Chat with the implementation prompt prefilled. Review it and send it when ready.',
						failures: [],
					};
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		const expectedReportPath = path.join('e:/workspace/.chat', 'analysis/reports/report-1.md');
		assert.deepEqual(offered, {
			purpose: 'implementation',
			chatDetail: IMPLEMENTATION_CHAT_DETAIL,
			agentProviders: ['codex'],
		});
		assert.equal(dispatchedTarget, 'chat');
		assert.equal(dispatchedPrompt?.includes(expectedReportPath), true);
		assert.equal(dispatchedPrompt?.includes('User request: Implement the highest-priority recommendation.'), true);
		assert.deepEqual(messages, [
			'Opened Chat with the implementation prompt prefilled. Review it and send it when ready.',
		]);
	});

	test('runs nothing when the implementation picker is cancelled', async () => {
		const messages: string[] = [];
		let dispatched = false;

		await runImplementationHandoffFlow(
			'Implement the highest-priority recommendation.',
			[],
			createHandoffFlowDeps({
				getCommands: async () => ['chatgpt.openSidebar'],
				pickProvider: async () => undefined,
				dispatchHandoff: async () => {
					dispatched = true;
					throw new Error('dispatchHandoff should not be called after cancelling.');
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(dispatched, false);
		assert.deepEqual(messages, []);
	});

	test('routes the selected agent provider through the shared dispatcher', async () => {
		let dispatchedTarget: HandoffSelectionId | undefined;
		let dispatchedPrompt: string | undefined;
		const messages: string[] = [];

		await runImplementationHandoffFlow(
			'Implement the highest-priority recommendation.',
			[],
			createHandoffFlowDeps({
				getCommands: async () => ['github.copilot.cli.newSession'],
				pickProvider: async (): Promise<{ kind: 'agent'; provider: 'codex' }> => ({ kind: 'agent', provider: 'codex' }),
				dispatchHandoff: async (prompt, target) => {
					dispatchedTarget = target;
					dispatchedPrompt = prompt;
					return {
						selectedTarget: 'codex',
						deliveredTo: 'codex',
						method: 'paste',
						instruction: 'Opened Codex and pasted the implementation prompt. Review it and send it when ready.',
						failures: [],
					};
				},
				streamMarkdown: (markdown: string) => {
					messages.push(markdown);
				},
			}),
		);

		assert.equal(dispatchedTarget, 'codex');
		assert.equal(dispatchedPrompt?.includes('AGENTS.md'), true);
		assert.deepEqual(messages, [
			'Opened Codex and pasted the implementation prompt. Review it and send it when ready.',
		]);
	});
});

suite('chatParticipant slash-less intent routing', () => {
	function createRoutingSessions(count: number): SessionMeta[] {
		return Array.from({ length: count }, (_, index) => createMeta({
			id: String(index + 1),
			title: `Session ${index + 1}`,
			savedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
			fileName: `session-${index + 1}.json`,
		}));
	}

	function choiceAnswer(choice: string, confidence: number): { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> } {
		return { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
	}

	function createCancelledToken(): vscode.CancellationToken {
		return {
			isCancellationRequested: true,
			onCancellationRequested: () => ({ dispose: () => undefined }),
		} as unknown as vscode.CancellationToken;
	}

	test('falls back without a TypeSafe call when TypeSafe is disabled', async () => {
		const judgment = createFakeJudgmentService({ enabled: false, answers: { intent: choiceAnswer('list', 0.99) } });
		const decision = await routeSlashlessPrompt({ prompt: 'show my chats', sessions: [], judgment });

		assert.deepEqual(decision, { kind: 'fallback' });
		assert.equal(judgment.calls.length, 0);
	});

	test('falls back without a TypeSafe call when the routing feature is off', async () => {
		const judgment = createFakeJudgmentService({ features: { routing: false }, answers: { intent: choiceAnswer('list', 0.99) } });
		const decision = await routeSlashlessPrompt({ prompt: 'show my chats', sessions: [], judgment });

		assert.deepEqual(decision, { kind: 'fallback' });
		assert.equal(judgment.calls.length, 0);
	});

	test('falls back when no judgment service is wired or the prompt is empty', async () => {
		const judgment = createFakeJudgmentService({ answers: { intent: choiceAnswer('list', 0.99) } });

		assert.deepEqual(await routeSlashlessPrompt({ prompt: 'show my chats', sessions: [] }), { kind: 'fallback' });
		assert.deepEqual(await routeSlashlessPrompt({ prompt: '   ', sessions: [], judgment }), { kind: 'fallback' });
		assert.equal(judgment.calls.length, 0);
	});

	test('falls back when TypeSafe fails or the request is cancelled', async () => {
		const failing = createFakeJudgmentService({ error: new Error('offline') });
		assert.deepEqual(await routeSlashlessPrompt({ prompt: 'show my chats', sessions: [], judgment: failing }), { kind: 'fallback' });

		const answering = createFakeJudgmentService({ answers: { intent: choiceAnswer('list', 0.99) } });
		const cancelled = await routeSlashlessPrompt({
			prompt: 'show my chats',
			sessions: [],
			judgment: answering,
			token: createCancelledToken(),
		});
		assert.deepEqual(cancelled, { kind: 'fallback' });
	});

	test('keeps existing behavior for a none intent even at high confidence', async () => {
		const judgment = createFakeJudgmentService({ answers: { intent: choiceAnswer('none', 0.97) } });
		const decision = await routeSlashlessPrompt({
			prompt: 'what did we decide about the token refresh?',
			sessions: createRoutingSessions(2),
			judgment,
			threadContext: 'resumed-session',
		});

		assert.deepEqual(decision, { kind: 'fallback' });
		assert.deepEqual(judgment.calls[0]?.state, { prompt: 'what did we decide about the token refresh?', thread: 'resumed-session' });
	});

	test('keeps existing behavior for a low-confidence intent', async () => {
		const judgment = createFakeJudgmentService({
			answers: { intent: choiceAnswer('analyze', INTENT_ROUTING_MEDIUM_CONFIDENCE - 0.01) },
		});
		const decision = await routeSlashlessPrompt({ prompt: 'hmm', sessions: [], judgment });

		assert.deepEqual(decision, { kind: 'fallback' });
	});

	test('ignores malformed or unknown intent answers', async () => {
		const judgment = createFakeJudgmentService({ answers: { intent: { choice: 'delete', confidence: 0.99 } } });
		assert.deepEqual(await routeSlashlessPrompt({ prompt: 'delete everything', sessions: [], judgment }), { kind: 'fallback' });

		judgment.setAnswers({ intent: { choice: 'list' } });
		assert.deepEqual(await routeSlashlessPrompt({ prompt: 'show my chats', sessions: [], judgment }), { kind: 'fallback' });
	});

	test('runs /analyze with the speculative timeframe at high confidence', async () => {
		const judgment = createFakeJudgmentService({
			answers: {
				intent: choiceAnswer('analyze', 0.92),
				timeframe: choiceAnswer('last7Days', 0.88),
			},
		});
		const decision = await routeSlashlessPrompt({ prompt: 'review what went wrong in my chats this week', sessions: [], judgment });

		assert.ok(decision.kind === 'run');
		assert.equal(decision.intent.command, 'analyze');
		assert.equal(decision.intent.prompt, 'last 7 days');
		assert.equal(decision.intent.interpretation, '/analyze last 7 days');
		assert.equal(parseAnalysisSelectionAlias(decision.intent.prompt)?.mode, 'last7Days');
		assert.equal(judgment.calls[0]?.options, 'routing');
	});

	test('maps every timeframe to an alias the analysis parser accepts', async () => {
		for (const timeframe of ['last24Hours', 'last7Days', 'last30Days', 'needsAnalysis']) {
			const judgment = createFakeJudgmentService({
				answers: { intent: choiceAnswer('analyze', 0.95), timeframe: choiceAnswer(timeframe, 0.95) },
			});
			const decision = await routeSlashlessPrompt({ prompt: 'analyze my chats', sessions: [], judgment });
			assert.ok(decision.kind === 'run');
			assert.equal(parseAnalysisSelectionAlias(decision.intent.prompt)?.mode, timeframe);
		}
	});

	test('leaves the analysis scope to the picker when the timeframe is unspecified or unsure', async () => {
		for (const timeframe of [choiceAnswer('unspecified', 0.9), choiceAnswer('last30Days', 0.2)]) {
			const judgment = createFakeJudgmentService({ answers: { intent: choiceAnswer('analyze', 0.9), timeframe } });
			const decision = await routeSlashlessPrompt({ prompt: 'analyze my chats', sessions: [], judgment });

			assert.ok(decision.kind === 'run');
			assert.equal(decision.intent.prompt, '');
			assert.equal(decision.intent.interpretation, '/analyze');
		}
	});

	test('runs /resume with the session picked by the sessionRef judgment', async () => {
		const sessions = createRoutingSessions(3);
		const judgment = createFakeJudgmentService({
			answers: {
				intent: choiceAnswer('resume', 0.9),
				sessionRef: choiceAnswer('session-2', 0.85),
			},
		});
		const decision = await routeSlashlessPrompt({ prompt: 'pick up where I left off', sessions, judgment });

		assert.ok(decision.kind === 'run');
		const questions = judgment.calls[0]?.questions as Record<string, { criteria: Record<string, string> }>;
		const candidateCount = Object.keys(questions.sessionRef?.criteria ?? {}).length - 1;
		const expected = selectSessionRefCandidates('pick up where I left off', sessions)[1];
		assert.equal(candidateCount, 3);
		assert.equal(decision.intent.command, 'resume');
		assert.equal(decision.intent.session, expected);
		assert.equal(decision.intent.prompt, expected?.title);
		assert.equal(decision.intent.interpretation, `/resume ${expected?.title ?? ''}`);
	});

	test('runs /resume with fuzzy matching on the prompt when sessionRef is none', async () => {
		const judgment = createFakeJudgmentService({
			answers: { intent: choiceAnswer('resume', 0.9), sessionRef: choiceAnswer('none', 0.9) },
		});
		const decision = await routeSlashlessPrompt({ prompt: 'resume auth', sessions: createRoutingSessions(2), judgment });

		assert.ok(decision.kind === 'run');
		assert.equal(decision.intent.session, undefined);
		assert.equal(decision.intent.prompt, 'resume auth');
	});

	test('asks one fan-out request with at most 20 session candidates plus none', async () => {
		const judgment = createFakeJudgmentService({ answers: { intent: choiceAnswer('none', 0.9) } });
		await routeSlashlessPrompt({ prompt: 'continue the latest one', sessions: createRoutingSessions(30), judgment });

		assert.equal(judgment.calls.length, 1);
		const questions = judgment.calls[0]?.questions as Record<string, { type: string; criteria: Record<string, string> }>;
		assert.deepEqual(Object.keys(questions), ['intent', 'timeframe', 'sessionRef']);
		assert.deepEqual(Object.keys(questions.intent?.criteria ?? {}), ['resume', 'list', 'analyze', 'implement', 'none']);
		const sessionLabels = Object.keys(questions.sessionRef?.criteria ?? {});
		assert.equal(sessionLabels.length, INTENT_ROUTING_MAX_SESSION_CANDIDATES + 1);
		assert.equal(sessionLabels.at(-1), 'none');
		// No fuzzy match for a free-form prompt: the most recent sessions are offered.
		assert.match(questions.sessionRef?.criteria['session-1'] ?? '', /"Session 30"/);
	});

	test('prefers fuzzy matches for sessionRef candidates and omits sessionRef without sessions', () => {
		const sessions = [
			createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json', savedAt: '2026-09-01T00:00:00.000Z' }),
			createMeta({ id: '2', title: 'Write release notes', fileName: 'release-notes.json', savedAt: '2026-09-02T00:00:00.000Z' }),
		];
		assert.deepEqual(selectSessionRefCandidates('auth', sessions).map((session) => session.title), ['Fix auth bug']);
		assert.deepEqual(Object.keys(buildIntentRoutingQuestions([])), ['intent', 'timeframe']);
	});

	test('offers a followup instead of running at medium confidence', async () => {
		const judgment = createFakeJudgmentService({ answers: { intent: choiceAnswer('list', 0.6) } });
		const decision = await routeSlashlessPrompt({ prompt: 'which chats do I have?', sessions: [], judgment });

		assert.ok(decision.kind === 'suggest');
		const followups = buildParticipantFollowups({
			metadata: { routingSuggestion: toIntentRoutingSuggestionMetadata(decision.intent) },
		} as vscode.ChatResult);
		assert.deepEqual(followups, [{
			label: 'Run /list',
			prompt: '',
			participant: 'session-control.resume',
			command: 'list',
		}]);
	});

	test('routes at the high-confidence boundary and suggests just below it', async () => {
		const judgment = createFakeJudgmentService({ answers: { intent: choiceAnswer('implement', INTENT_ROUTING_HIGH_CONFIDENCE) } });
		const atBoundary = await routeSlashlessPrompt({ prompt: 'apply the recommendations', sessions: [], judgment });
		assert.ok(atBoundary.kind === 'run');
		assert.equal(atBoundary.intent.prompt, 'apply the recommendations');
		assert.equal(atBoundary.intent.interpretation, '/implement');

		judgment.setAnswers({ intent: choiceAnswer('implement', INTENT_ROUTING_HIGH_CONFIDENCE - 0.01) });
		const below = await routeSlashlessPrompt({ prompt: 'apply the recommendations', sessions: [], judgment });
		assert.equal(below.kind, 'suggest');
	});
});

suite('chatParticipant analysis timeframe fallback', () => {
	function choiceAnswer(choice: string, confidence: number): { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> } {
		return { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
	}

	test('resolves existing aliases without a TypeSafe call', async () => {
		const judgment = createFakeJudgmentService({ answers: { timeframe: choiceAnswer('last30Days', 0.99) } });
		for (const [alias, mode] of [['24h', 'last24Hours'], ['7d', 'last7Days'], ['last 30 days', 'last30Days'], ['needs analysis', 'needsAnalysis']] as const) {
			const selection = await resolveAnalysisSelection(alias, { judgment });
			assert.equal(selection?.mode, mode);
		}
		assert.equal(judgment.calls.length, 0);
	});

	test('resolves a free-form timeframe to a preset selection through the timeframe Choice', async () => {
		const judgment = createFakeJudgmentService({ answers: { timeframe: choiceAnswer('last7Days', 0.93) } });
		const logs: string[] = [];
		const selection = await resolveAnalysisSelection('past week', { judgment, log: (message) => logs.push(message) });

		assert.equal(selection?.mode, 'last7Days');
		assert.equal(selection?.onlyUnanalyzed, false);
		assert.equal(judgment.calls.length, 1);
		assert.equal(judgment.calls[0]?.options, 'routing');
		assert.deepEqual(Object.keys(judgment.calls[0]?.questions ?? {}), ['timeframe']);
		assert.match(logs[0] ?? '', /timeframe=last7Days confidence=0\.93 alias=last 7 days/);
	});

	test('maps the needs-analysis timeframe to the needs-analysis selection', async () => {
		const judgment = createFakeJudgmentService({ answers: { timeframe: choiceAnswer('needsAnalysis', 0.9) } });
		const selection = await resolveAnalysisSelection('chats I have not reviewed', { judgment });
		assert.equal(selection?.mode, 'needsAnalysis');
	});

	test('keeps the scope picker when the timeframe is unspecified, unsure, or TypeSafe is off', async () => {
		const unspecified = createFakeJudgmentService({ answers: { timeframe: choiceAnswer('unspecified', 0.99) } });
		assert.equal(await judgeAnalysisTimeframe('my chats', unspecified), undefined);

		const unsure = createFakeJudgmentService({ answers: { timeframe: choiceAnswer('last7Days', INTENT_ROUTING_MEDIUM_CONFIDENCE - 0.01) } });
		assert.equal(await judgeAnalysisTimeframe('recently', unsure), undefined);

		const disabled = createFakeJudgmentService({ features: { routing: false }, answers: { timeframe: choiceAnswer('last7Days', 0.99) } });
		assert.equal(await judgeAnalysisTimeframe('past week', disabled), undefined);
		assert.equal(disabled.calls.length, 0);

		assert.equal(await judgeAnalysisTimeframe('past week', undefined), undefined);
		assert.equal(await judgeAnalysisTimeframe('   ', unspecified), undefined);
		assert.equal(unspecified.calls.length, 1);
	});
});
