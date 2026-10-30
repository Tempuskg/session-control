import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NO_ANALYSIS_MODEL_MESSAGE, type WorkspaceSessionMeta } from '../../src/chatParticipant';
import {
	ANALYZE_SESSIONS_TOOL_NAME,
	GET_IMPLEMENTATION_PROMPT_TOOL_NAME,
	LIST_SESSIONS_TOOL_NAME,
	NO_ANALYSIS_REPORT_MESSAGE,
	RESUME_SESSION_TOOL_NAME,
	buildAnalyzeSessionsToolText,
	buildImplementationPromptToolText,
	type ImplementationPromptToolDeps,
	buildListSessionsToolText,
	resolveAnalyzeToolSelection,
	type AnalyzeSessionsToolDeps,
	buildResumeSessionToolText,
	resolveResumeToolSession,
	toSessionToolListEntry,
	type ResumeLimits,
	type SessionToolDeps,
} from '../../src/sessionTools';
import { buildImplementationHandoffPrompt, createNeedsAnalysisSelection } from '../../src/sessionAnalysis';
import type { AnalysisReportReference, ChatSession, SavedTurn } from '../../src/types';

const workspaceFolder = { uri: vscode.Uri.file('e:/workspace'), name: 'workspace', index: 0 } as vscode.WorkspaceFolder;

function createWorkspaceMeta(overrides: Partial<WorkspaceSessionMeta> = {}): WorkspaceSessionMeta {
	const title = overrides.title ?? 'Fix auth bug';
	return {
		id: overrides.id ?? 'session-1',
		title,
		savedAt: overrides.savedAt ?? '2026-04-12T12:00:00.000Z',
		fileName: overrides.fileName ?? '2026-04-12T12-00-fix-auth-bug.json',
		turnCount: overrides.turnCount ?? 2,
		git: overrides.git === undefined ? { branch: 'main', commit: 'abcdef123456', dirty: false } : overrides.git,
		workspaceFolder,
		storageDirectory: 'e:/workspace/.chat',
		displayTitle: `[workspace] ${title}`,
	};
}

function createTurns(count: number): SavedTurn[] {
	return Array.from({ length: count }, (_, index): SavedTurn => (index % 2 === 0
		? { type: 'request', participant: 'copilot', prompt: `Question ${index}`, references: [], timestamp: '2026-04-12T12:00:00.000Z' }
		: { type: 'response', participant: 'copilot', content: `Answer ${index}`, toolCalls: [], timestamp: '2026-04-12T12:00:00.000Z' }));
}

function createSession(turns: SavedTurn[]): ChatSession {
	return {
		version: 1,
		id: 'session-1',
		title: 'Fix auth bug',
		savedAt: '2026-04-12T12:00:00.000Z',
		git: { branch: 'main', commit: 'abcdef123456', dirty: false },
		vscodeVersion: '1.115.0',
		totalTurns: turns.length,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns,
		markdownSummary: '',
	};
}

function createDeps(
	sessions: WorkspaceSessionMeta[],
	session: ChatSession,
	limits: ResumeLimits = { maxTurns: 50, maxContextChars: 80000, overflowStrategy: 'summarize' },
): SessionToolDeps & { loaded: string[] } {
	const loaded: string[] = [];
	return {
		loaded,
		listSessions: async () => sessions,
		loadSession: async (meta) => {
			loaded.push(meta.fileName);
			return { session, rootFileName: meta.fileName, partFiles: [meta.fileName] };
		},
		getResumeLimits: () => limits,
	};
}

suite('sessionTools', () => {
	test('package.json contributes the session tools with prompt references and schemas', async () => {
		const manifestPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
		const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
			engines: { vscode: string };
			contributes: { languageModelTools: Array<{ name: string; canBeReferencedInPrompt?: boolean; toolReferenceName?: string; modelDescription?: string; inputSchema?: { type: string; properties?: Record<string, { type: string; enum?: string[] }> } }> };
		};
		const tools = manifest.contributes.languageModelTools;
		assert.deepStrictEqual(tools.map((tool) => tool.name), [LIST_SESSIONS_TOOL_NAME, RESUME_SESSION_TOOL_NAME, ANALYZE_SESSIONS_TOOL_NAME, GET_IMPLEMENTATION_PROMPT_TOOL_NAME]);
		const implementationSchema = tools.find((tool) => tool.name === GET_IMPLEMENTATION_PROMPT_TOOL_NAME)?.inputSchema;
		assert.strictEqual(implementationSchema?.properties?.report?.type, 'string');
		assert.strictEqual((implementationSchema as { required?: string[] } | undefined)?.required, undefined);
		const analyzeSchema = tools.find((tool) => tool.name === ANALYZE_SESSIONS_TOOL_NAME)?.inputSchema?.properties;
		assert.deepStrictEqual(analyzeSchema?.timeframe?.enum, ['24h', '7d', '30d']);
		assert.strictEqual(analyzeSchema?.onlyUnanalyzed?.type, 'boolean');
		for (const tool of tools) {
			assert.strictEqual(tool.canBeReferencedInPrompt, true);
			assert.ok(tool.toolReferenceName);
			assert.ok(tool.modelDescription);
			assert.strictEqual(tool.inputSchema?.type, 'object');
		}
		assert.match(manifest.engines.vscode, /^\^1\.(9[5-9]|1\d\d)\./);
	});

	test('list entry exposes id, title, date, and branch', () => {
		assert.deepStrictEqual(toSessionToolListEntry(createWorkspaceMeta()), {
			id: 'session-1',
			title: 'Fix auth bug',
			date: '2026-04-12T12:00:00.000Z',
			branch: 'main',
			commit: 'abcdef1',
			turnCount: 2,
			provider: null,
			workspaceFolder: 'workspace',
		});
		const noGit = toSessionToolListEntry(createWorkspaceMeta({ git: null }));
		assert.strictEqual(noGit.branch, null);
		assert.strictEqual(noGit.commit, null);
	});

	test('list text is JSON with total, returned, and sessions', () => {
		const sessions = [createWorkspaceMeta(), createWorkspaceMeta({ id: 'session-2', title: 'Add login form' })];
		const parsed = JSON.parse(buildListSessionsToolText(sessions)) as { total: number; returned: number; sessions: Array<{ id: string }> };
		assert.strictEqual(parsed.total, 2);
		assert.strictEqual(parsed.returned, 2);
		assert.deepStrictEqual(parsed.sessions.map((session) => session.id), ['session-1', 'session-2']);
	});

	test('list filters by query and clamps the limit', () => {
		const sessions = Array.from({ length: 30 }, (_, index) => createWorkspaceMeta({ id: `session-${index}`, title: index === 3 ? 'Login work' : `Other ${index}` }));
		const filtered = JSON.parse(buildListSessionsToolText(sessions, { query: 'login' })) as { sessions: Array<{ id: string }> };
		assert.deepStrictEqual(filtered.sessions.map((session) => session.id), ['session-3']);

		const limited = JSON.parse(buildListSessionsToolText(sessions, { limit: 5 })) as { total: number; returned: number };
		assert.strictEqual(limited.total, 30);
		assert.strictEqual(limited.returned, 5);

		const defaulted = JSON.parse(buildListSessionsToolText(sessions, { limit: -1 })) as { returned: number };
		assert.strictEqual(defaulted.returned, 20);
	});

	test('list reports empty and unmatched results as plain text', () => {
		assert.match(buildListSessionsToolText([]), /No saved sessions found/);
		assert.match(buildListSessionsToolText([createWorkspaceMeta()], { query: 'zzz' }), /No saved sessions match 'zzz'/);
	});

	test('resume resolves an exact id before fuzzy title matching', () => {
		const sessions = [createWorkspaceMeta({ id: 'abc', title: 'Session abc' }), createWorkspaceMeta({ id: 'xyz', title: 'Fix auth bug', fileName: 'other.json' })];
		assert.strictEqual(resolveResumeToolSession('XYZ', sessions).session?.id, 'xyz');
		assert.strictEqual(resolveResumeToolSession('other.json', sessions).session?.id, 'xyz');
		assert.strictEqual(resolveResumeToolSession('fix auth bug', sessions).session?.id, 'xyz');
		assert.deepStrictEqual(resolveResumeToolSession('   ', sessions), {});
	});

	test('resume returns transcript text for the selected session', async () => {
		const deps = createDeps([createWorkspaceMeta()], createSession(createTurns(2)));
		const text = await buildResumeSessionToolText({ session: 'session-1' }, deps);
		assert.deepStrictEqual(deps.loaded, ['2026-04-12T12-00-fix-auth-bug.json']);
		assert.match(text, /Saved session "Fix auth bug" \(id session-1, saved 2026-04-12T12:00:00.000Z, branch main\)/);
		assert.match(text, /Included 2 of 2 turns/);
		assert.match(text, /User: Question 0/);
		assert.match(text, /Answer 1/);
	});

	test('resume respects maxTurns and maxContextChars limits', async () => {
		const deps = createDeps(
			[createWorkspaceMeta()],
			createSession(createTurns(10)),
			{ maxTurns: 4, maxContextChars: 80000, overflowStrategy: 'truncate' },
		);
		const text = await buildResumeSessionToolText({ session: 'session-1' }, deps);
		assert.match(text, /Included 4 of 10 turns/);
		assert.doesNotMatch(text, /Question 0/);
		assert.match(text, /Answer 9/);

		const tight = await buildResumeSessionToolText({ session: 'session-1' }, createDeps(
			[createWorkspaceMeta()],
			createSession(createTurns(10)),
			{ maxTurns: 50, maxContextChars: 20, overflowStrategy: 'truncate' },
		));
		assert.match(tight, /Included 2 of 10 turns/);
		assert.doesNotMatch(tight, /Question 0/);
	});

	test('resume handles missing input, no sessions, and no match without loading', async () => {
		const deps = createDeps([createWorkspaceMeta()], createSession(createTurns(2)));
		assert.match(await buildResumeSessionToolText({}, deps), new RegExp(LIST_SESSIONS_TOOL_NAME));
		assert.match(await buildResumeSessionToolText({ session: 'nothing like it at all' }, deps), /No saved session matches/);
		assert.match(await buildResumeSessionToolText({ session: 'x' }, createDeps([], createSession([]))), /No saved sessions found/);
		assert.deepStrictEqual(deps.loaded, []);
	});

	test('resume lists candidate ids when the title is ambiguous', async () => {
		const sessions = [
			createWorkspaceMeta({ id: 'a', title: 'Auth refactor part one', fileName: 'a.json' }),
			createWorkspaceMeta({ id: 'b', title: 'Auth refactor part two', fileName: 'b.json' }),
		];
		const deps = createDeps(sessions, createSession(createTurns(2)));
		const text = await buildResumeSessionToolText({ session: 'uhrf' }, deps);
		assert.deepStrictEqual(deps.loaded, []);
		assert.match(text, /Multiple saved sessions match 'uhrf'/);
		assert.match(text, /"id": "a"/);
		assert.match(text, /"id": "b"/);
	});

	function createModel(vendor: string, id: string): vscode.LanguageModelChat {
		return { vendor, id, name: id } as vscode.LanguageModelChat;
	}

	function createAnalyzeDeps(overrides: Partial<AnalyzeSessionsToolDeps> = {}): AnalyzeSessionsToolDeps & {
		runs: Array<{ mode: string; onlyUnanalyzed: boolean | undefined; modelId: string }>;
	} {
		const runs: Array<{ mode: string; onlyUnanalyzed: boolean | undefined; modelId: string }> = [];
		return {
			runs,
			listSessions: async () => [createWorkspaceMeta()],
			getWorkspaceFolders: () => [workspaceFolder],
			selectChatModels: async () => [createModel('copilot', 'gpt-5')],
			runAnalysis: async (selection, _folders, _sessions, model, onMarkdown) => {
				runs.push({ mode: selection.mode, onlyUnanalyzed: selection.onlyUnanalyzed, modelId: model.id });
				onMarkdown('\n\nSaved analysis report to **analysis/reports/r.md**.');
				return {
					metadata: {
						resultType: 'analysis-report',
						analysisStatus: 'complete',
						analysisReportPath: 'analysis/reports/r.md',
						analysisStorageDirectory: 'e:/workspace/.chat',
					},
					verification: { total: 5, verified: 3, unsupported: 1, demoted: 1 },
				};
			},
			now: () => new Date('2026-04-12T12:00:00.000Z'),
			...overrides,
		};
	}

	test('analyze selection maps timeframes and defaults to sessions needing analysis', () => {
		const now = new Date('2026-04-12T12:00:00.000Z');
		assert.strictEqual(resolveAnalyzeToolSelection({}, now).mode, 'needsAnalysis');
		assert.strictEqual(resolveAnalyzeToolSelection({ onlyUnanalyzed: false }, now).mode, 'needsAnalysis');
		const week = resolveAnalyzeToolSelection({ timeframe: '7d' }, now);
		assert.strictEqual(week.mode, 'last7Days');
		assert.strictEqual(week.onlyUnanalyzed, false);
		assert.strictEqual(week.range?.end, now.toISOString());
		assert.strictEqual(resolveAnalyzeToolSelection({ timeframe: '24h', onlyUnanalyzed: true }, now).onlyUnanalyzed, true);
		assert.strictEqual(resolveAnalyzeToolSelection({ timeframe: '30d' }, now).mode, 'last30Days');
		assert.strictEqual(resolveAnalyzeToolSelection({ timeframe: 'bogus' as never }, now).mode, 'needsAnalysis');
	});

	test('analyze returns the saved report path and verification summary', async () => {
		const deps = createAnalyzeDeps();
		const parsed = JSON.parse(await buildAnalyzeSessionsToolText({ timeframe: '7d', onlyUnanalyzed: true }, deps)) as {
			status: string;
			reportPath: string;
			reportFilePath: string;
			verification: { verified: number; unsupported: number; demoted: number };
			summary: string;
		};
		assert.deepStrictEqual(deps.runs, [{ mode: 'last7Days', onlyUnanalyzed: true, modelId: 'gpt-5' }]);
		assert.strictEqual(parsed.status, 'complete');
		assert.strictEqual(parsed.reportPath, 'analysis/reports/r.md');
		assert.strictEqual(parsed.reportFilePath, path.join('e:/workspace/.chat', 'analysis/reports/r.md'));
		assert.deepStrictEqual(parsed.verification, { total: 5, verified: 3, unsupported: 1, demoted: 1 });
		assert.match(parsed.summary, /3 of 5 recommendations verified, 1 flagged as unsupported, 1 demoted/);
	});

	test('analyze notes when verification did not run', async () => {
		const deps = createAnalyzeDeps({
			runAnalysis: async () => ({
				metadata: { resultType: 'analysis-report', analysisStatus: 'partial', analysisReportPath: 'r.md', analysisStorageDirectory: 'e:/s' },
			}),
		});
		const parsed = JSON.parse(await buildAnalyzeSessionsToolText({}, deps)) as { status: string; verification: unknown; summary: string };
		assert.strictEqual(parsed.status, 'partial');
		assert.strictEqual(parsed.verification, null);
		assert.match(parsed.summary, /verification did not run/);
	});

	test('analyze skips Copilot CLI agent-host models and fails clearly without a direct-request model', async () => {
		const skipped = createAnalyzeDeps({
			selectChatModels: async () => [createModel('copilotcli', 'auto'), createModel('copilot', 'agent-host-copilotcli:gpt'), createModel('copilot', 'claude')],
		});
		await buildAnalyzeSessionsToolText({}, skipped);
		assert.strictEqual(skipped.runs[0]?.modelId, 'claude');

		const none = createAnalyzeDeps({ selectChatModels: async () => [createModel('copilotcli', 'auto')] });
		assert.strictEqual(await buildAnalyzeSessionsToolText({}, none), NO_ANALYSIS_MODEL_MESSAGE);
		assert.strictEqual(none.runs.length, 0);

		const throwing = createAnalyzeDeps({ selectChatModels: async () => { throw new Error('offline'); } });
		assert.strictEqual(await buildAnalyzeSessionsToolText({}, throwing), NO_ANALYSIS_MODEL_MESSAGE);
	});

	test('analyze reports why no report was saved', async () => {
		const deps = createAnalyzeDeps({
			runAnalysis: async (_selection, _folders, _sessions, _model, onMarkdown) => {
				onMarkdown('No saved sessions currently need analysis.');
				return undefined;
			},
		});
		const text = await buildAnalyzeSessionsToolText({}, deps);
		assert.match(text, /No analysis report was saved for Needs Analysis/);
		assert.match(text, /No saved sessions currently need analysis/);

		const failing = createAnalyzeDeps({ runAnalysis: async () => { throw new Error('model returned no text'); } });
		assert.match(await buildAnalyzeSessionsToolText({}, failing), /The analysis failed using gpt-5 \(copilot\): model returned no text/);
	});

	test('analyze requires a workspace and saved sessions', async () => {
		assert.match(await buildAnalyzeSessionsToolText({}, createAnalyzeDeps({ getWorkspaceFolders: () => undefined })), /Open a workspace folder/);
		assert.match(await buildAnalyzeSessionsToolText({}, createAnalyzeDeps({ listSessions: async () => [] })), /No saved sessions found/);
	});

	function createReportReference(id: string, createdAt: string, reportPath: string): AnalysisReportReference {
		return {
			id,
			createdAt,
			selection: createNeedsAnalysisSelection(),
			promptVersion: 'v1',
			reportPath,
			contributingWorkspaces: ['workspace'],
			analyzedFingerprints: [],
		};
	}

	function createImplementationPromptDeps(
		reports: AnalysisReportReference[],
		overrides: Partial<ImplementationPromptToolDeps> = {},
	): ImplementationPromptToolDeps & { read: string[] } {
		const read: string[] = [];
		return {
			read,
			getWorkspaceFolders: () => [workspaceFolder],
			getStoragePath: () => 'e:/workspace/.chat',
			readIndex: async () => ({ version: 1, updatedAt: '2026-04-12T12:00:00.000Z', reports, analyzedSessions: [] }),
			readReport: async (_storageDirectory, reportPath) => {
				read.push(reportPath);
				return `# Report ${reportPath}`;
			},
			...overrides,
		};
	}

	const implementationReports = [
		createReportReference('old', '2026-04-10T12:00:00.000Z', 'analysis/reports/old.md'),
		createReportReference('new', '2026-04-12T12:00:00.000Z', 'analysis/reports/new.md'),
	];

	test('implementation prompt uses the latest saved report and the handoff prompt text', async () => {
		const deps = createImplementationPromptDeps(implementationReports);
		const text = await buildImplementationPromptToolText({}, deps);
		const reportFilePath = path.join('e:/workspace/.chat', 'analysis/reports/new.md');
		assert.deepStrictEqual(deps.read, ['analysis/reports/new.md']);
		assert.match(text, /You are the implementer/);
		assert.ok(text.includes(buildImplementationHandoffPrompt(reportFilePath, '', '# Report analysis/reports/new.md')));
	});

	test('implementation prompt falls back to the next report when the latest cannot be read', async () => {
		const deps = createImplementationPromptDeps(implementationReports, {
			readReport: async (_storageDirectory, reportPath) => {
				if (reportPath.endsWith('new.md')) {
					throw new Error('missing');
				}
				return 'old content';
			},
		});
		assert.ok((await buildImplementationPromptToolText({}, deps)).includes('old.md'));
	});

	test('implementation prompt loads a report named by path', async () => {
		for (const report of [
			'analysis/reports/old.md',
			'analysis\\reports\\old.md',
			'.chat/analysis/reports/old.md',
			path.join('e:/workspace/.chat', 'analysis/reports/old.md'),
			'old.md',
		]) {
			const deps = createImplementationPromptDeps(implementationReports);
			const text = await buildImplementationPromptToolText({ report }, deps);
			assert.deepStrictEqual(deps.read, ['analysis/reports/old.md'], report);
			assert.ok(text.includes(path.join('e:/workspace/.chat', 'analysis/reports/old.md')), report);
		}

		const unmatched = createImplementationPromptDeps(implementationReports);
		const text = await buildImplementationPromptToolText({ report: 'missing.md' }, unmatched);
		assert.deepStrictEqual(unmatched.read, []);
		assert.match(text, /No saved analysis report matches 'missing.md'/);
		assert.ok(text.indexOf('new.md') < text.indexOf('old.md'));
	});

	test('implementation prompt explains when no analysis report exists', async () => {
		assert.strictEqual(await buildImplementationPromptToolText({}, createImplementationPromptDeps([])), NO_ANALYSIS_REPORT_MESSAGE);
		assert.match(NO_ANALYSIS_REPORT_MESSAGE, new RegExp(ANALYZE_SESSIONS_TOOL_NAME));
		const unreadable = createImplementationPromptDeps([], { readIndex: async () => { throw new Error('bad index'); } });
		assert.match(await buildImplementationPromptToolText({}, unreadable), /workspace: bad index/);
		const noWorkspace = createImplementationPromptDeps(implementationReports, { getWorkspaceFolders: () => undefined });
		assert.match(await buildImplementationPromptToolText({}, noWorkspace), /Open a workspace folder/);
	});
});
