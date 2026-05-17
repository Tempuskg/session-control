import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	createAnalysisStore,
	createSessionAnalysisFingerprint,
} from '../../src/analysisStore';
import { createNeedsAnalysisSelection } from '../../src/sessionAnalysis';
import { ChatSession } from '../../src/types';

function createSession(id: string, savedAt: string, title: string, response: string): ChatSession {
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
				prompt: 'Investigate the issue',
				references: [],
				timestamp: '2026-05-17T10:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: response,
				toolCalls: [
					{
						name: 'read_file',
						summary: 'Read the implementation file',
						arguments: 'src/file.ts',
					},
				],
				timestamp: '2026-05-17T10:01:00.000Z',
			},
		],
		markdownSummary: `# Chat: ${title}`,
	};
}

suite('analysisStore', () => {
	test('writeReport persists a markdown report under analysis/reports', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analysis-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createAnalysisStore();

		try {
			const persisted = await store.writeReport(storageDirectory, {
				selection: createNeedsAnalysisSelection(),
				promptVersion: '1',
				contributingWorkspaces: ['workspace'],
				analyzedFingerprints: ['fingerprint-a'],
				content: '## Findings\n\nA useful finding.',
				createdAt: '2026-05-17T12:00:00.000Z',
			});

			const reportContent = await fs.readFile(persisted.reportFilePath, 'utf8');
			assert.equal(persisted.report.reportPath.startsWith('analysis/reports/'), true);
			assert.equal(reportContent.includes('# Chat Analysis Report'), true);
			assert.equal(reportContent.includes('Needs Analysis'), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('recordAnalysis persists analyzed fingerprints and supports lookup', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analysis-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createAnalysisStore();

		try {
			const persisted = await store.writeReport(storageDirectory, {
				selection: createNeedsAnalysisSelection(),
				promptVersion: '1',
				contributingWorkspaces: ['workspace'],
				analyzedFingerprints: ['fingerprint-a'],
				content: '## Findings\n\nA useful finding.',
				createdAt: '2026-05-17T12:00:00.000Z',
			});

			await store.recordAnalysis(storageDirectory, persisted.report, [
				{
					fingerprint: 'fingerprint-a',
					sessionId: 'session-a',
					title: 'Session A',
					savedAt: '2026-05-17T10:00:00.000Z',
				},
			]);

			const index = await store.readIndex(storageDirectory);
			assert.equal(index.reports.length, 1);
			assert.equal(index.analyzedSessions.length, 1);
			assert.equal(await store.hasAnalyzedFingerprint(storageDirectory, 'fingerprint-a'), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('createSessionAnalysisFingerprint ignores savedAt but changes when content changes', () => {
		const first = createSession('session-a', '2026-05-17T10:00:00.000Z', 'Title', 'Initial response');
		const sameContentDifferentSave = createSession('session-a', '2026-05-18T10:00:00.000Z', 'Title', 'Initial response');
		const changed = createSession('session-a', '2026-05-18T10:00:00.000Z', 'Title', 'Changed response');

		const firstFingerprint = createSessionAnalysisFingerprint(first);
		const sameFingerprint = createSessionAnalysisFingerprint(sameContentDifferentSave);
		const changedFingerprint = createSessionAnalysisFingerprint(changed);

		assert.equal(firstFingerprint, sameFingerprint);
		assert.notEqual(firstFingerprint, changedFingerprint);
	});
});