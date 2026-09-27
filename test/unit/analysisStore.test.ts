import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	JUDGMENT_CACHE_VERSION,
	buildAnalysisPersistenceContract,
	createAnalysisStore,
	createJudgmentCacheKey,
	createSessionAnalysisFingerprint,
	getOrQueryCachedJudgment,
	isCachedJudgmentEntry,
	isJudgmentCache,
	parseJudgmentCacheKey,
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

	suite('judgment cache', () => {
		test('createJudgmentCacheKey formats key from session fingerprint and question-set version', () => {
			const key = createJudgmentCacheKey('abc123fingerprint', 'v1');
			assert.strictEqual(key, 'abc123fingerprint:v1');

			const parsed = parseJudgmentCacheKey(key);
			assert.deepStrictEqual(parsed, {
				sessionFingerprint: 'abc123fingerprint',
				questionSetVersion: 'v1',
			});

			assert.throws(() => createJudgmentCacheKey('', 'v1'));
			assert.throws(() => createJudgmentCacheKey('abc', ''));
			assert.strictEqual(parseJudgmentCacheKey('invalid-key-no-colon'), undefined);
		});

		test('cache miss, hit, and persistence across store instances', async () => {
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-judgment-cache-'));
			const storageDirectory = path.join(tempRoot, '.chat');
			const store = createAnalysisStore();

			try {
				// Cache miss on non-existent judgment
				const miss = await store.getJudgment(storageDirectory, 'session-fp-1', 'v1');
				assert.strictEqual(miss, undefined);
				assert.strictEqual(await store.hasJudgment(storageDirectory, 'session-fp-1', 'v1'), false);

				// Save judgment
				const saved = await store.saveJudgment(storageDirectory, {
					sessionFingerprint: 'session-fp-1',
					questionSetVersion: 'v1',
					answers: {
						friction: { value: 0.8, confidence: 0.9 },
						trivial: { value: false, confidence: 0.95 },
					},
					model: 'jev-latest',
					usage: { input_tokens: 120, output_tokens: 45 },
				});

				assert.strictEqual(saved.key, 'session-fp-1:v1');
				assert.strictEqual(saved.sessionFingerprint, 'session-fp-1');
				assert.strictEqual(saved.questionSetVersion, 'v1');

				// Cache hit
				const hit = await store.getJudgment(storageDirectory, 'session-fp-1', 'v1');
				assert.ok(hit);
				assert.strictEqual(hit.key, 'session-fp-1:v1');
				assert.deepStrictEqual(hit.answers, {
					friction: { value: 0.8, confidence: 0.9 },
					trivial: { value: false, confidence: 0.95 },
				});
				assert.strictEqual(hit.model, 'jev-latest');
				assert.deepStrictEqual(hit.usage, { input_tokens: 120, output_tokens: 45 });
				assert.strictEqual(await store.hasJudgment(storageDirectory, 'session-fp-1', 'v1'), true);

				// Verify file path is alongside index.json in analysis/
				const judgmentsPath = store.getJudgmentCachePath(storageDirectory);
				assert.strictEqual(judgmentsPath, path.join(storageDirectory, 'analysis', 'judgments.json'));
				const rawOnDisk = await fs.readFile(judgmentsPath, 'utf8');
				const parsedJson = JSON.parse(rawOnDisk) as Record<string, unknown>;
				assert.strictEqual(parsedJson.version, JUDGMENT_CACHE_VERSION);

				// Fresh store instance reads persisted judgments
				const freshStore = createAnalysisStore();
				const freshHit = await freshStore.getJudgment(storageDirectory, 'session-fp-1', 'v1');
				assert.ok(freshHit);
				assert.deepStrictEqual(freshHit.answers, hit.answers);
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});

		test('version bump invalidation separates question sets and triggers cache miss', async () => {
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-judgment-cache-'));
			const storageDirectory = path.join(tempRoot, '.chat');
			const store = createAnalysisStore();

			try {
				const fingerprint = 'session-fp-alpha';

				// Save version 1
				await store.saveJudgment(storageDirectory, {
					sessionFingerprint: fingerprint,
					questionSetVersion: '1',
					answers: { friction: { value: 0.3 } },
				});

				// v1 hits
				const hitV1 = await store.getJudgment(storageDirectory, fingerprint, '1');
				assert.ok(hitV1);
				assert.strictEqual(hitV1.key, `${fingerprint}:1`);

				// Bumping to version 2 causes a cache miss (invalidation)
				const missV2 = await store.getJudgment(storageDirectory, fingerprint, '2');
				assert.strictEqual(missV2, undefined, 'expected version 2 to miss cache before being stored');
				assert.strictEqual(await store.hasJudgment(storageDirectory, fingerprint, '2'), false);

				// Save version 2
				await store.saveJudgment(storageDirectory, {
					sessionFingerprint: fingerprint,
					questionSetVersion: '2',
					answers: { friction: { value: 0.7 }, controlFileLesson: { value: true } },
				});

				// Both versions are now accessible independently
				const hitV1After = await store.getJudgment(storageDirectory, fingerprint, '1');
				const hitV2After = await store.getJudgment(storageDirectory, fingerprint, '2');
				assert.ok(hitV1After);
				assert.ok(hitV2After);
				assert.deepStrictEqual(hitV1After.answers, { friction: { value: 0.3 } });
				assert.deepStrictEqual(hitV2After.answers, { friction: { value: 0.7 }, controlFileLesson: { value: true } });

				// Version 3 is also a miss
				assert.strictEqual(await store.getJudgment(storageDirectory, fingerprint, '3'), undefined);
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});

		test('changing a threshold or weight does not trigger new requests', async () => {
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-judgment-cache-'));
			const storageDirectory = path.join(tempRoot, '.chat');
			const store = createAnalysisStore();

			try {
				const session = createSession('session-test-weights', '2026-05-17T10:00:00.000Z', 'Test weights', 'Response');
				const fingerprint = createSessionAnalysisFingerprint(session);
				const questionSetVersion = 'triage-v1';

				let queryExecutionCount = 0;
				const mockTypeSafeInference = async () => {
					queryExecutionCount++;
					return {
						friction: { value: 0.8, confidence: 0.9 },
						toolFailureLoops: { value: 0.4, confidence: 0.85 },
						trivial: { value: false, confidence: 0.95 },
					};
				};

				interface TriagePolicy {
					frictionWeight: number;
					loopsWeight: number;
					trivialConfidenceThreshold: number;
				}

				function evaluatePolicy(
					answers: {
						friction: { value: number };
						toolFailureLoops: { value: number };
						trivial: { value: boolean; confidence: number };
					},
					policy: TriagePolicy,
				): { priority: number; skipAsTrivial: boolean } {
					const skipAsTrivial = answers.trivial.value && answers.trivial.confidence >= policy.trivialConfidenceThreshold;
					const priority = answers.friction.value * policy.frictionWeight + answers.toolFailureLoops.value * policy.loopsWeight;
					return { priority, skipAsTrivial };
				}

				// Initial evaluation: Policy 1 (weights: 1.0, 1.0; threshold: 0.8)
				const policy1: TriagePolicy = {
					frictionWeight: 1.0,
					loopsWeight: 1.0,
					trivialConfidenceThreshold: 0.8,
				};

				const answers1 = await getOrQueryCachedJudgment(
					store,
					storageDirectory,
					fingerprint,
					questionSetVersion,
					mockTypeSafeInference,
				);
				assert.ok(answers1);
				const eval1 = evaluatePolicy(answers1, policy1);
				// priority = 0.8 * 1.0 + 0.4 * 1.0 = 1.2
				assert.strictEqual(Math.round(eval1.priority * 100) / 100, 1.2);
				assert.strictEqual(eval1.skipAsTrivial, false);
				assert.strictEqual(queryExecutionCount, 1, 'first run should trigger inference');

				// Policy change: update frictionWeight to 2.5 and loopsWeight to 0.5
				const policy2: TriagePolicy = {
					frictionWeight: 2.5,
					loopsWeight: 0.5,
					trivialConfidenceThreshold: 0.8,
				};

				const answers2 = await getOrQueryCachedJudgment(
					store,
					storageDirectory,
					fingerprint,
					questionSetVersion,
					mockTypeSafeInference,
				);
				assert.ok(answers2);
				const eval2 = evaluatePolicy(answers2, policy2);
				// priority = 0.8 * 2.5 + 0.4 * 0.5 = 2.0 + 0.2 = 2.2
				assert.strictEqual(Math.round(eval2.priority * 100) / 100, 2.2);
				assert.strictEqual(queryExecutionCount, 1, 'changing weights must NOT trigger new requests');

				// Policy change: update threshold
				const policy3: TriagePolicy = {
					frictionWeight: 2.5,
					loopsWeight: 0.5,
					trivialConfidenceThreshold: 0.99,
				};

				const answers3 = await getOrQueryCachedJudgment(
					store,
					storageDirectory,
					fingerprint,
					questionSetVersion,
					mockTypeSafeInference,
				);
				assert.ok(answers3);
				const eval3 = evaluatePolicy(answers3, policy3);
				assert.strictEqual(Math.round(eval3.priority * 100) / 100, 2.2);
				assert.strictEqual(queryExecutionCount, 1, 'changing thresholds must NOT trigger new requests');

				// Bumping question set version DOES trigger new request
				const bumpedAnswers = await getOrQueryCachedJudgment(
					store,
					storageDirectory,
					fingerprint,
					'triage-v2',
					mockTypeSafeInference,
				);
				assert.ok(bumpedAnswers);
				assert.strictEqual(queryExecutionCount, 2, 'bumping question-set version triggers inference');
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});

		test('deleteJudgment and clearJudgments clean up cache correctly', async () => {
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-judgment-cache-'));
			const storageDirectory = path.join(tempRoot, '.chat');
			const store = createAnalysisStore();

			try {
				await store.saveJudgment(storageDirectory, {
					sessionFingerprint: 'fp-1',
					questionSetVersion: 'v1',
					answers: { a: 1 },
				});
				await store.saveJudgment(storageDirectory, {
					sessionFingerprint: 'fp-2',
					questionSetVersion: 'v1',
					answers: { b: 2 },
				});

				assert.strictEqual(await store.hasJudgment(storageDirectory, 'fp-1', 'v1'), true);
				assert.strictEqual(await store.hasJudgment(storageDirectory, 'fp-2', 'v1'), true);

				// Delete single entry
				const deleted = await store.deleteJudgment(storageDirectory, 'fp-1', 'v1');
				assert.strictEqual(deleted, true);
				assert.strictEqual(await store.hasJudgment(storageDirectory, 'fp-1', 'v1'), false);
				assert.strictEqual(await store.hasJudgment(storageDirectory, 'fp-2', 'v1'), true);

				// Clear all judgments
				await store.clearJudgments(storageDirectory);
				assert.strictEqual(await store.hasJudgment(storageDirectory, 'fp-2', 'v1'), false);
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});

		test('schema type guards validate entries and cache', () => {
			const validEntry = {
				key: 'fp:v1',
				sessionFingerprint: 'fp',
				questionSetVersion: 'v1',
				createdAt: '2026-09-25T12:00:00.000Z',
				answers: { friction: 0.5 },
			};
			assert.strictEqual(isCachedJudgmentEntry(validEntry), true);

			const validCache = {
				version: 1,
				updatedAt: '2026-09-25T12:00:00.000Z',
				judgments: { 'fp:v1': validEntry },
			};
			assert.strictEqual(isJudgmentCache(validCache), true);

			assert.strictEqual(isCachedJudgmentEntry({ key: 123 }), false);
			assert.strictEqual(isJudgmentCache({ version: 'one' }), false);
			assert.strictEqual(isJudgmentCache({ version: 1, updatedAt: 'invalid-date', judgments: {} }), false);
		});
	});
});