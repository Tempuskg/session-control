import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildAnalysisPersistenceContract, createAnalysisStore } from '../../src/analysisStore';
import { runImplementLatestAnalysisCommand } from '../../src/extension';
import {
	ANALYSIS_PROMPT_VERSION,
	createCustomRangeSelection,
	createNeedsAnalysisSelection,
	createPresetAnalysisSelection,
	createSingleSessionSelection,
} from '../../src/sessionAnalysis';
import {
	AnalysisIndex,
	AnalysisSelection,
	describeAnalysisIndexProblem,
	describeAnalysisSelectionProblem,
	isAnalysisIndex,
	isAnalysisSelection,
} from '../../src/types';

function extractJsonBlocks(contract: string): unknown[] {
	return [...contract.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1] ?? '') as unknown);
}

function extractIndexExample(contract: string): AnalysisIndex {
	const index = extractJsonBlocks(contract).find(
		(block) => typeof block === 'object' && block !== null && 'analyzedSessions' in block,
	);
	assert.ok(isAnalysisIndex(index), describeAnalysisIndexProblem(index));
	return index;
}

function createWorkspaceFolder(rootPath: string): vscode.WorkspaceFolder {
	return { uri: vscode.Uri.file(rootPath), name: 'repo', index: 0 } as vscode.WorkspaceFolder;
}

async function persistExample(storageDirectory: string, index: unknown, reportPath: string): Promise<string> {
	const indexPath = path.join(storageDirectory, 'analysis', 'index.json');
	const reportFilePath = path.join(storageDirectory, reportPath);
	await fs.mkdir(path.dirname(reportFilePath), { recursive: true });
	await fs.writeFile(reportFilePath, '# Chat Analysis Report\n');
	const content = JSON.stringify(index, null, 2);
	await fs.writeFile(indexPath, content);
	return indexPath;
}

async function runImplementLatest(rootPath: string): Promise<{ builtFor: string[]; warnings: string[] }> {
	const store = createAnalysisStore();
	const builtFor: string[] = [];
	const warnings: string[] = [];
	await runImplementLatestAnalysisCommand({
		getWorkspaceFolders: () => [createWorkspaceFolder(rootPath)],
		getStoragePath: () => path.join(rootPath, '.chat'),
		readIndex: async (storageDirectory) => store.readIndex(storageDirectory),
		readReport: async (storageDirectory, reportPath) => store.readReport(storageDirectory, reportPath),
		buildPrompt: (reportFilePath) => {
			builtFor.push(reportFilePath);
			return `IMPLEMENT ${reportFilePath}`;
		},
		selectChatModels: async () => [],
		getCommands: async () => [],
		pickProvider: async () => undefined,
		dispatchHandoff: async () => {
			throw new Error('dispatch is not expected in this test');
		},
		showInformationMessage: async () => undefined,
		showWarningMessage: async (message) => {
			warnings.push(message);
			return undefined;
		},
	});
	return { builtFor, warnings };
}

suite('analysis handoff persistence contract', () => {
	const singleSession = createSingleSessionSelection({ id: 'session-123', title: 'Fix the login flow' });

	test('single-session contract shows the actual selection with range null and sessionId', () => {
		const contract = buildAnalysisPersistenceContract(ANALYSIS_PROMPT_VERSION, singleSession);
		const index = extractIndexExample(contract);
		const selection = index.reports[0]?.selection;

		assert.deepStrictEqual(selection, { mode: 'singleSession', label: 'Session: Fix the login flow', range: null, sessionId: 'session-123' });
		assert.deepStrictEqual(extractJsonBlocks(contract)[0], singleSession);
		assert.ok(contract.includes('- Selection Mode: singleSession'));
		assert.ok(contract.includes('Never write `"range": {"start": null, "end": null}`'));
		assert.ok(!contract.includes('Last 7 Days'));
	});

	test('date-filtered and other supported modes keep valid selections in the example', () => {
		const now = new Date('2026-10-07T12:00:00.000Z');
		const selections: AnalysisSelection[] = [
			createPresetAnalysisSelection('last24Hours', now),
			createPresetAnalysisSelection('last7Days', now, true),
			createPresetAnalysisSelection('last30Days', now),
			createCustomRangeSelection('2026-10-01T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
			createNeedsAnalysisSelection(),
			singleSession,
		];

		for (const selection of selections) {
			const contract = buildAnalysisPersistenceContract(ANALYSIS_PROMPT_VERSION, selection);
			const persisted = extractIndexExample(contract).reports[0]?.selection;
			assert.deepStrictEqual(persisted, selection, selection.mode);
			assert.ok(isAnalysisSelection(persisted), selection.mode);
			if (selection.range) {
				assert.ok(contract.includes('This is a date-filtered selection'), selection.mode);
			} else {
				assert.equal(persisted?.range, null, selection.mode);
			}
		}
	});

	test('a persisted single-session example is discovered by Implement Latest Analysis', async () => {
		const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-handoff-contract-'));
		try {
			const index = extractIndexExample(buildAnalysisPersistenceContract(ANALYSIS_PROMPT_VERSION, singleSession));
			const reportPath = index.reports[0]?.reportPath ?? '';
			await persistExample(path.join(rootPath, '.chat'), index, reportPath);

			const result = await runImplementLatest(rootPath);

			assert.deepStrictEqual(result.builtFor, [path.join(rootPath, '.chat', reportPath)]);
		} finally {
			await fs.rm(rootPath, { recursive: true, force: true });
		}
	});

	test('a null-endpoint range is rejected with an actionable diagnostic and the index is left untouched', async () => {
		const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-handoff-contract-'));
		try {
			const index = extractIndexExample(buildAnalysisPersistenceContract(ANALYSIS_PROMPT_VERSION, singleSession));
			const report = index.reports[0];
			assert.ok(report);
			const unrelatedReport = { ...report, id: 'report-unrelated', reportPath: 'analysis/reports/unrelated.md', selection: createNeedsAnalysisSelection() };
			const malformed = {
				...index,
				reports: [
					unrelatedReport,
					{ ...report, selection: { mode: 'singleSession', label: report.selection.label, range: { start: null, end: null } } },
				],
			};
			const indexPath = await persistExample(path.join(rootPath, '.chat'), malformed, report.reportPath);
			const before = await fs.readFile(indexPath, 'utf8');

			const result = await runImplementLatest(rootPath);

			assert.deepStrictEqual(result.builtFor, []);
			assert.equal(result.warnings.length, 1);
			const warning = result.warnings[0] ?? '';
			assert.ok(warning.includes('reports[1] (id "report-example")'), warning);
			assert.ok(warning.includes('selection.range for mode "singleSession"'), warning);
			assert.ok(warning.includes('{"start":null,"end":null}'), warning);
			assert.ok(warning.includes('"range": null'), warning);
			assert.ok(warning.includes('"sessionId"'), warning);
			// Diagnostics never rewrite the index: ids, paths, fingerprints and unrelated entries survive.
			assert.equal(await fs.readFile(indexPath, 'utf8'), before);
		} finally {
			await fs.rm(rootPath, { recursive: true, force: true });
		}
	});

	test('genuinely invalid date ranges stay rejected', () => {
		const invalidRanges: unknown[] = [
			{ start: 'not-a-date', end: '2026-10-07T00:00:00.000Z' },
			{ start: '2026-10-01T00:00:00.000Z' },
			{ start: null, end: null },
			undefined,
		];

		for (const range of invalidRanges) {
			const selection = { mode: 'customRange', label: 'Custom', range };
			assert.equal(isAnalysisSelection(selection), false, JSON.stringify(range));
			assert.ok(describeAnalysisSelectionProblem(selection)?.startsWith('selection.range for mode "customRange"'));
		}

		assert.equal(describeAnalysisSelectionProblem(singleSession), undefined);
		assert.ok(describeAnalysisSelectionProblem({ mode: 'lastYear', label: 'x', range: null })?.includes('not a supported mode'));
	});
});
