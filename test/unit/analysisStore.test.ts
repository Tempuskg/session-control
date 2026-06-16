import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	buildAnalysisPersistenceContract,
	createAnalysisStore,
	createSessionAnalysisFingerprint,
} from '../../src/analysisStore';
import { ANALYSIS_PROMPT_VERSION, createNeedsAnalysisSelection } from '../../src/sessionAnalysis';
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
				status: 'complete',
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
				status: 'complete',
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

	test('readReport returns the persisted markdown report content', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analysis-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createAnalysisStore();

		try {
			const persisted = await store.writeReport(storageDirectory, {
				selection: createNeedsAnalysisSelection(),
				promptVersion: '1',
				contributingWorkspaces: ['workspace'],
				analyzedFingerprints: ['fingerprint-a'],
				status: 'complete',
				content: '## Findings\n\nA useful finding.',
				createdAt: '2026-05-17T12:00:00.000Z',
			});

			const reportContent = await store.readReport(storageDirectory, persisted.report.reportPath);
			assert.equal(reportContent.includes('A useful finding.'), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('createSessionAnalysisFingerprint ignores non-content metadata but changes when content changes', () => {
		const first = createSession('session-a', '2026-05-17T10:00:00.000Z', 'Title', 'Initial response');
		const sameContentDifferentSave = createSession('session-a', '2026-05-18T10:00:00.000Z', 'Title', 'Initial response');
		const sameContentDifferentMetadata: ChatSession = {
			...sameContentDifferentSave,
			provider: 'cursor',
			git: { branch: 'feature/test', commit: '1234567890abcdef', dirty: true },
			vscodeVersion: '1.116.0',
			markdownSummary: '# Different summary',
		};
		const changed = createSession('session-a', '2026-05-18T10:00:00.000Z', 'Title', 'Changed response');

		const firstFingerprint = createSessionAnalysisFingerprint(first);
		const sameFingerprint = createSessionAnalysisFingerprint(sameContentDifferentSave);
		const sameMetadataFingerprint = createSessionAnalysisFingerprint(sameContentDifferentMetadata);
		const changedFingerprint = createSessionAnalysisFingerprint(changed);

		assert.equal(firstFingerprint, sameFingerprint);
		assert.equal(firstFingerprint, sameMetadataFingerprint);
		assert.notEqual(firstFingerprint, changedFingerprint);
	});

	test('buildAnalysisPersistenceContract documents the report, index, and fingerprint contract', () => {
		const contract = buildAnalysisPersistenceContract(ANALYSIS_PROMPT_VERSION);

		assert.equal(contract.includes(`# Chat Analysis Report`), true);
		assert.equal(contract.includes(`Use report prompt version \`${ANALYSIS_PROMPT_VERSION}\``), true);
		assert.equal(contract.includes('"reports": ['), true);
		assert.equal(contract.includes('"analyzedSessions": ['), true);
		assert.equal(contract.includes('"id": "session-example"'), true);
		assert.equal(contract.includes('SHA-256 over the UTF-8 bytes of `JSON.stringify(normalizedSession)`'), true);
		assert.equal(contract.includes('Ignore `savedAt`, `provider`, `git`, `vscodeVersion`, `markdownSummary`, `part`, `totalParts`, `previousPartFile`, and `nextPartFile`'), true);
		assert.equal(contract.includes('A `savedAt` change by itself must not change the fingerprint.'), true);
	});
});