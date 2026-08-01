import * as assert from 'node:assert';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	createAutoSaveController,
	createAutoSaveSourceRevisionInput,
	type AutoSaveCheckpointState,
	type AutoSaveControllerWatcher,
	type AutoSaveSource,
} from '../../src/autoSaveController';
import { createAutoSaveDiagnosticState } from '../../src/autoSaveDiagnostics';
import { createSessionStore } from '../../src/sessionStore';
import { type ChatSession, type SourceChatSession } from '../../src/types';

function drainAsyncWork(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	assert.fail(message);
}

interface FakeWatcher extends AutoSaveControllerWatcher {
	emitChange: (sourcePath?: string) => void;
	emitCreate: (sourcePath?: string) => void;
	isDisposed: () => boolean;
}

function createFakeWatcher(): FakeWatcher {
	let changeListener: ((sourcePath?: string) => void) | undefined;
	let createListener: ((sourcePath?: string) => void) | undefined;
	let disposed = false;

	return {
		onDidChange: (listener) => {
			changeListener = listener;
			return {
				dispose: () => {
					changeListener = undefined;
				},
			};
		},
		onDidCreate: (listener) => {
			createListener = listener;
			return {
				dispose: () => {
					createListener = undefined;
				},
			};
		},
		dispose: () => {
			disposed = true;
			changeListener = undefined;
			createListener = undefined;
		},
		emitChange: (sourcePath) => changeListener?.(sourcePath),
		emitCreate: (sourcePath) => createListener?.(sourcePath),
		isDisposed: () => disposed,
	};
}

interface TestSession {
	id: string;
	title: string;
	turnCount: number;
	semanticContent?: string;
}

const immediateSettlement = {
	settleReadDelayMs: 0,
	maxSettleReadAttempts: 2,
	incompleteRetryDelaysMs: [],
	failureRetryDelayMs: 60_000,
	directoryRecoveryDelayMs: 0,
	fallbackScanIntervalMs: 0,
} as const;

function createSource(
	session: TestSession,
	overrides: Partial<AutoSaveSource<TestSession>> = {},
): AutoSaveSource<TestSession> {
	return {
		sourceId: 'codex-cli',
		directory: 'C:/Users/test/.codex',
		glob: 'sessions/**/*.jsonl',
		label: 'Codex session transcripts',
		sessionLabel: 'Codex',
		storageDirectory: 'E:/chat-commit/.chat',
		readCandidates: async () => [
			{
				identity: `codex:${session.id}`,
				sourceSessionId: session.id,
				sourcePath: session.id,
				sourceRevision: `revision:${session.semanticContent ?? session.turnCount}`,
				title: session.title,
				turnCount: session.turnCount,
				session,
			},
		],
		findExistingAutoSaves: async () => [],
		saveCandidates: async () => ['saved.json'],
		...overrides,
	};
}

suite('auto-save controller', () => {
	test('builds revisions from normalized identity and semantic content without timestamps', () => {
		const session: SourceChatSession = {
			provider: 'codex',
			id: 'session-1',
			title: 'Semantic revisions',
			lastMessageDate: '2026-07-30T12:00:00.000Z',
			turns: [
				{
					type: 'request',
					participant: 'user',
					prompt: 'Fix semantic dedupe.',
					references: ['src/autoSaveController.ts'],
					timestamp: '2026-07-30T11:59:00.000Z',
				},
				{
					type: 'response',
					participant: 'codex',
					content: 'Updated the revision.',
					toolCalls: [
						{
							name: 'apply_patch',
							summary: 'Edit the controller',
							arguments: '{"file":"src/autoSaveController.ts"}',
							output: 'Done',
						},
					],
					timestamp: '2026-07-30T12:00:00.000Z',
				},
			],
			sourceFile: 'session-1.jsonl',
			sourceRevision: 'raw-source-revision',
		};

		const revisionInput = createAutoSaveSourceRevisionInput('codex-cli', session);
		assert.deepEqual(JSON.parse(revisionInput), {
			sourceId: 'codex-cli',
			provider: 'codex',
			sessionId: 'session-1',
			title: 'Semantic revisions',
			turns: [
				{
					type: 'request',
					participant: 'user',
					text: 'Fix semantic dedupe.',
					references: ['src/autoSaveController.ts'],
				},
				{
					type: 'response',
					participant: 'codex',
					text: 'Updated the revision.',
					toolCalls: [
						{
							name: 'apply_patch',
							summary: 'Edit the controller',
							arguments: '{"file":"src/autoSaveController.ts"}',
							output: 'Done',
						},
					],
				},
			],
		});

		const timestampOnlyChange: SourceChatSession = {
			...session,
			lastMessageDate: '2026-07-30T12:05:00.000Z',
			turns: session.turns.map((turn) => ({
				...turn,
				timestamp: '2026-07-30T12:05:00.000Z',
			})),
		};
		assert.equal(createAutoSaveSourceRevisionInput('codex-cli', timestampOnlyChange), revisionInput);
	});

	test('saves a current session during explicit reconciliation without a file event', async () => {
		const watcher = createFakeWatcher();
		const diagnosticState = createAutoSaveDiagnosticState();
		const session: TestSession = {
			id: 'present-before-activation',
			title: 'Present before activation',
			turnCount: 3,
		};
		let saveCount = 0;
		const controller = createAutoSaveController(
			[
				createSource(session, {
					saveCandidates: async () => {
						saveCount += 1;
						return ['present-before-activation.json'];
					},
				}),
			],
			{
				createWatcher: () => watcher,
				pathExists: () => true,
				diagnosticState,
				appendLine: () => undefined,
				showWarningMessage: async () => undefined,
				hash: (value) => value,
				schedule: (callback) => setTimeout(callback, 0),
				clearSchedule: (handle) => clearTimeout(handle),
				debounceDelayMs: 5000,
				...immediateSettlement,
			},
		);

		assert.equal(saveCount, 0);
		controller.reconcile();
		await drainAsyncWork();

		assert.equal(saveCount, 1);
		assert.deepEqual(diagnosticState.getSource('codex-cli')?.lastSuccess?.fileNames, [
			'present-before-activation.json',
		]);
		controller.dispose();
	});

	test('discovers a source directory created after activation without reloading', async () => {
		const watcher = createFakeWatcher();
		const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
		let nextHandle = 0;
		let sourcePathExists = false;
		let watcherRegistrationCount = 0;
		let saveCount = 0;
		const source = createSource(
			{
				id: 'late-directory',
				title: 'Late directory session',
				turnCount: 2,
			},
			{
				saveCandidates: async () => {
					saveCount += 1;
					return ['late-directory.json'];
				},
			},
		);
		const controller = createAutoSaveController([source], {
			createWatcher: () => {
				watcherRegistrationCount += 1;
				return watcher;
			},
			pathExists: () => sourcePathExists,
			diagnosticState: createAutoSaveDiagnosticState(),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback, delayMs) => {
				nextHandle += 1;
				scheduled.set(nextHandle, { callback, delayMs });
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				scheduled.delete(handle as unknown as number);
			},
			debounceDelayMs: 5000,
			...immediateSettlement,
			directoryRecoveryDelayMs: 30_000,
		});

		assert.equal(watcherRegistrationCount, 1);
		const recoveryEntry = [...scheduled.entries()].find(([, entry]) => entry.delayMs === 30_000);
		assert.ok(recoveryEntry);

		sourcePathExists = true;
		scheduled.delete(recoveryEntry[0]);
		recoveryEntry[1].callback();
		await drainAsyncWork();

		assert.equal(watcherRegistrationCount, 1);
		assert.equal(saveCount, 1);
		controller.dispose();
		assert.equal(watcher.isDisposed(), true);
	});

	test('runs a low-frequency fallback scan with injected timing', async () => {
		const watcher = createFakeWatcher();
		const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
		let nextHandle = 0;
		let saveCount = 0;
		const source = createSource(
			{
				id: 'fallback-session',
				title: 'Fallback session',
				turnCount: 2,
			},
			{
				saveCandidates: async () => {
					saveCount += 1;
					return ['fallback-session.json'];
				},
			},
		);
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState(),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback, delayMs) => {
				nextHandle += 1;
				scheduled.set(nextHandle, { callback, delayMs });
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				scheduled.delete(handle as unknown as number);
			},
			debounceDelayMs: 5000,
			...immediateSettlement,
			fallbackScanIntervalMs: 120_000,
		});

		const fallbackEntry = [...scheduled.entries()].find(([, entry]) => entry.delayMs === 120_000);
		assert.ok(fallbackEntry);
		scheduled.delete(fallbackEntry[0]);
		fallbackEntry[1].callback();
		await drainAsyncWork();

		assert.equal(saveCount, 1);
		assert.equal([...scheduled.values()].filter(({ delayMs }) => delayMs === 120_000).length, 1);
		controller.dispose();
	});

	test('disposal clears directory recovery and fallback timers', () => {
		const watcher = createFakeWatcher();
		const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
		const clearedHandles: number[] = [];
		let nextHandle = 0;
		let watcherRegistrationCount = 0;
		const controller = createAutoSaveController(
			[
				createSource({
					id: 'missing-on-dispose',
					title: 'Missing on dispose',
					turnCount: 2,
				}),
			],
			{
				createWatcher: () => {
					watcherRegistrationCount += 1;
					return watcher;
				},
				pathExists: () => false,
				diagnosticState: createAutoSaveDiagnosticState(),
				appendLine: () => undefined,
				showWarningMessage: async () => undefined,
				hash: (value) => value,
				schedule: (callback, delayMs) => {
					nextHandle += 1;
					scheduled.set(nextHandle, { callback, delayMs });
					return nextHandle as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: (handle) => {
					const numericHandle = handle as unknown as number;
					clearedHandles.push(numericHandle);
					scheduled.delete(numericHandle);
				},
				debounceDelayMs: 5000,
				...immediateSettlement,
				directoryRecoveryDelayMs: 30_000,
				fallbackScanIntervalMs: 120_000,
			},
		);

		assert.deepEqual(
			[...scheduled.values()].map(({ delayMs }) => delayMs).sort((left, right) => left - right),
			[30_000, 120_000],
		);
		controller.dispose();

		assert.equal(scheduled.size, 0);
		assert.deepEqual(
			clearedHandles.sort((left, right) => left - right),
			[1, 2],
		);
		assert.equal(watcherRegistrationCount, 1);
		assert.equal(watcher.isDisposed(), true);
	});

	test('uses semantic revisions to skip touches and save same-turn content changes', async () => {
		const watcher = createFakeWatcher();
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-29T22:00:00.000Z',
		});
		const session: TestSession = {
			id: 'session-1',
			title: 'Controller-owned auto-save',
			turnCount: 2,
		};
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const scheduled = new Map<number, () => void>();
		const clearedHandles: number[] = [];
		const hashInputs: string[] = [];
		const outputLines: string[] = [];
		let nextHandle = 0;
		let readCount = 0;
		let saveCount = 0;

		const source = createSource(session, {
			readCandidates: async () => {
				readCount += 1;
				return [
					{
						identity: `codex:${session.id}`,
						sourceSessionId: session.id,
						sourcePath: session.id,
						sourceRevision: `revision:${session.semanticContent ?? session.turnCount}`,
						title: session.title,
						turnCount: session.turnCount,
						session,
					},
				];
			},
			saveCandidates: async () => {
				saveCount += 1;
				return [`saved-v${saveCount}-part1.json`, `saved-v${saveCount}-part2.json`];
			},
		});
		const controller = createAutoSaveController([source], {
			createWatcher: (directory, glob) => {
				watchedTargets.push({ directory, glob });
				return watcher;
			},
			pathExists: () => true,
			diagnosticState,
			appendLine: (value) => {
				outputLines.push(value);
			},
			showWarningMessage: async () => undefined,
			hash: (value) => {
				hashInputs.push(value);
				return `test-hash:${value}`;
			},
			schedule: (callback) => {
				nextHandle += 1;
				scheduled.set(nextHandle, callback);
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				const numericHandle = handle as unknown as number;
				clearedHandles.push(numericHandle);
				scheduled.delete(numericHandle);
			},
			debounceDelayMs: 5000,
			...immediateSettlement,
		});

		assert.deepEqual(watchedTargets, [
			{
				directory: source.directory,
				glob: source.glob,
			},
		]);

		watcher.emitChange('C:/Users/test/.codex/sessions/session-1.jsonl');
		watcher.emitChange('C:/Users/test/.codex/sessions/session-1.jsonl');
		assert.equal(scheduled.size, 1);
		assert.deepEqual(clearedHandles, [1]);

		const firstCallback = scheduled.get(2);
		assert.ok(firstCallback);
		scheduled.delete(2);
		firstCallback();
		await drainAsyncWork();

		assert.equal(saveCount, 1);
		assert.equal(diagnosticState.getSource('codex-cli')?.lastScan?.candidateCount, 1);
		assert.equal(
			diagnosticState.getSource('codex-cli')?.lastEvent?.sourcePath,
			'C:/Users/test/.codex/sessions/session-1.jsonl',
		);
		assert.deepEqual(diagnosticState.getSource('codex-cli')?.lastSuccess?.fileNames, [
			'saved-v1-part1.json',
			'saved-v1-part2.json',
		]);

		watcher.emitCreate('C:/Users/test/.codex/sessions/session-1.jsonl');
		const unchangedCallback = scheduled.get(3);
		assert.ok(unchangedCallback);
		scheduled.delete(3);
		unchangedCallback();
		await drainAsyncWork();

		assert.equal(saveCount, 1);
		assert.equal(
			diagnosticState.getSource('codex-cli')?.skipReason?.reason,
			'Semantic revision unchanged for session session-1.',
		);

		session.semanticContent = 'corrected response text';
		watcher.emitChange('C:/Users/test/.codex/sessions/session-1.jsonl');
		const updatedCallback = scheduled.get(4);
		assert.ok(updatedCallback);
		scheduled.delete(4);
		updatedCallback();
		await drainAsyncWork();

		assert.equal(saveCount, 2);
		assert.equal(readCount, 6);
		assert.deepEqual(hashInputs, [
			'{"sourceId":"codex-cli","sourceSessionId":"session-1","sourceRevision":"revision:2"}',
			'{"sourceId":"codex-cli","sourceSessionId":"session-1","sourceRevision":"revision:2"}',
			'{"sourceId":"codex-cli","sourceSessionId":"session-1","sourceRevision":"revision:corrected response text"}',
		]);
		assert.equal(
			outputLines.some((line) => line.includes('Saved "Controller-owned auto-save"')),
			true,
		);

		watcher.emitChange();
		assert.equal(scheduled.size, 1);
		controller.dispose();
		assert.equal(scheduled.size, 0);
		assert.equal(watcher.isDisposed(), true);
	});

	test('uses a persisted workspace checkpoint for an unchanged revision without scanning saved files', async () => {
		const watcher = createFakeWatcher();
		const session: TestSession = {
			id: 'persisted-session',
			title: 'Persisted session',
			turnCount: 2,
		};
		let lookupCount = 0;
		let saveCount = 0;
		const source = createSource(session, {
			findExistingAutoSaves: async () => {
				lookupCount += 1;
				return [];
			},
			saveCandidates: async () => {
				saveCount += 1;
				return ['persisted-session.json'];
			},
		});
		const revisionHash =
			'{"sourceId":"codex-cli","sourceSessionId":"persisted-session","sourceRevision":"revision:2"}';
		const checkpointState: AutoSaveCheckpointState = {
			version: 1,
			checkpoints: [
				{
					sourceId: 'codex-cli',
					sourceSessionId: session.id,
					fileNames: ['persisted-session.json'],
					revisionHash,
				},
			],
		};
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState(),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => callback as unknown as ReturnType<typeof setTimeout>,
			clearSchedule: () => undefined,
			debounceDelayMs: 0,
			checkpointStorage: {
				read: () => checkpointState,
				write: async () => undefined,
			},
			...immediateSettlement,
		});

		controller.reconcile();
		await drainAsyncWork();

		assert.equal(lookupCount, 0);
		assert.equal(saveCount, 0);
		controller.dispose();
	});

	test('recovers existing auto-save files before updating a continued session', async () => {
		const watcher = createFakeWatcher();
		const session: TestSession = {
			id: 'continued-session',
			title: 'Continued session',
			turnCount: 4,
			semanticContent: 'new response',
		};
		const lookupSessionIds: string[] = [];
		const checkpointWrites: AutoSaveCheckpointState[] = [];
		let saveCount = 0;
		const source = createSource(session, {
			findExistingAutoSaves: async (sourceSessionId) => {
				lookupSessionIds.push(sourceSessionId);
				return [
					{
						fileName: 'previous-part-1.json',
						sourceRevision: 'revision:old response',
					},
					{
						fileName: 'previous-part-2.json',
						sourceRevision: 'revision:old response',
					},
				];
			},
			saveCandidates: async () => {
				saveCount += 1;
				return ['continued-session.json'];
			},
		});
		const outputLines: string[] = [];
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState(),
			appendLine: (value) => {
				outputLines.push(value);
			},
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => callback as unknown as ReturnType<typeof setTimeout>,
			clearSchedule: () => undefined,
			debounceDelayMs: 0,
			checkpointStorage: {
				read: () => undefined,
				write: async (state) => {
					checkpointWrites.push(state);
				},
			},
			...immediateSettlement,
		});

		controller.reconcile();
		await drainAsyncWork();
		await drainAsyncWork();

		assert.deepEqual(lookupSessionIds, ['continued-session']);
		assert.equal(saveCount, 1);
		assert.deepEqual(checkpointWrites.at(-1), {
			version: 1,
			checkpoints: [
				{
					sourceId: 'codex-cli',
					sourceSessionId: 'continued-session',
					fileNames: ['continued-session.json'],
					revisionHash:
						'{"sourceId":"codex-cli","sourceSessionId":"continued-session","sourceRevision":"revision:new response"}',
				},
			],
		});
		assert.equal(
			outputLines.some(
				(line) =>
					line.includes('Recovered 2 existing auto-save file(s)') && line.includes('codex-cli:continued-session'),
			),
			true,
		);
		controller.dispose();
	});

	test('reloads a persisted checkpoint and upserts a continued provider session without a duplicate', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-auto-save-checkpoint-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'codex-cli';
		const sourceSessionId = 'provider-session';
		const session: TestSession = {
			id: sourceSessionId,
			title: 'Continued provider session',
			turnCount: 2,
			semanticContent: 'first continued response',
		};
		const store = createSessionStore();
		const createStoredSession = (sourceRevision: string, response: string): ChatSession => ({
			version: 1,
			id: sourceSessionId,
			title: session.title,
			savedAt: '2026-07-30T12:00:00.000Z',
			provider: 'codex',
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
			git: null,
			vscodeVersion: '1.115.0',
			totalTurns: 2,
			part: null,
			totalParts: null,
			previousPartFile: null,
			nextPartFile: null,
			turns: [
				{
					type: 'request',
					participant: 'user',
					prompt: 'Continue.',
					references: [],
					timestamp: '2026-07-30T11:59:00.000Z',
				},
				{
					type: 'response',
					participant: 'codex',
					content: response,
					toolCalls: [],
					timestamp: '2026-07-30T12:00:00.000Z',
				},
			],
			markdownSummary: `# Chat: ${session.title}`,
		});
		let checkpointState: AutoSaveCheckpointState | undefined;
		let lookupCount = 0;
		let saveCount = 0;
		const source = createSource(session, {
			storageDirectory,
			findExistingAutoSaves: async (candidateSessionId) => {
				lookupCount += 1;
				return store.findAutoSaveSessionFiles(storageDirectory, sourceId, candidateSessionId);
			},
			saveCandidates: async (candidates) => {
				const selected = candidates[0];
				assert.ok(selected);
				const fileNames = await store.upsertAutoSaveSessions(
					storageDirectory,
					[createStoredSession(selected.sourceRevision, selected.session.semanticContent ?? '')],
					{ sourceId, sourceSessionId },
					{ includeTimestampInFileName: false },
				);
				saveCount += 1;
				return fileNames;
			},
		});
		const createController = () =>
			createAutoSaveController([source], {
				createWatcher: () => createFakeWatcher(),
				pathExists: (candidatePath) => candidatePath === source.directory || existsSync(candidatePath),
				diagnosticState: createAutoSaveDiagnosticState(),
				appendLine: () => undefined,
				showWarningMessage: async () => undefined,
				hash: (value) => value,
				schedule: (callback) => callback as unknown as ReturnType<typeof setTimeout>,
				clearSchedule: () => undefined,
				debounceDelayMs: 0,
				checkpointStorage: {
					read: () => checkpointState,
					write: async (state) => {
						checkpointState = state;
					},
				},
				...immediateSettlement,
			});

		try {
			await store.writeSession(
				storageDirectory,
				createStoredSession('revision:before-reload', 'Before reload'),
				{ includeTimestampInFileName: false },
			);

			const firstController = createController();
			firstController.reconcile();
			await waitForCondition(() => saveCount === 1 && checkpointState !== undefined, 'first checkpoint was not saved');
			firstController.dispose();

			let autoSaves = await store.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId);
			assert.equal(autoSaves.length, 1);
			assert.equal(autoSaves[0]?.sourceRevision, 'revision:first continued response');

			session.semanticContent = 'continued after extension reload';
			const reloadedController = createController();
			reloadedController.reconcile();
			await waitForCondition(() => saveCount === 2, 'continued session was not saved after reload');
			reloadedController.dispose();

			autoSaves = await store.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId);
			assert.equal(autoSaves.length, 1);
			assert.equal(autoSaves[0]?.sourceRevision, 'revision:continued after extension reload');
			assert.equal(lookupCount, 1);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('selects the session represented by the changed source path', async () => {
		const watcher = createFakeWatcher();
		const scheduled: Array<() => void> = [];
		const savedCandidateIds: string[][] = [];
		const newestSession: TestSession = {
			id: 'unrelated-newest',
			title: 'Unrelated newest session',
			turnCount: 6,
		};
		const changedSession: TestSession = {
			id: 'changed-session',
			title: 'Changed session',
			turnCount: 4,
		};
		const source = createSource(newestSession, {
			readCandidates: async () => [
				{
					identity: `codex:${newestSession.id}`,
					sourceSessionId: newestSession.id,
					sourcePath: newestSession.id,
					sourceRevision: `revision:${newestSession.turnCount}`,
					title: newestSession.title,
					turnCount: newestSession.turnCount,
					session: newestSession,
				},
				{
					identity: `codex:${changedSession.id}`,
					sourceSessionId: changedSession.id,
					sourcePath: changedSession.id,
					sourceRevision: `revision:${changedSession.turnCount}`,
					title: changedSession.title,
					turnCount: changedSession.turnCount,
					session: changedSession,
				},
			],
			saveCandidates: async (candidates) => {
				savedCandidateIds.push(candidates.map((candidate) => candidate.sourceSessionId));
				return ['changed-session.json'];
			},
		});
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-30T15:00:00.000Z',
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState,
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => {
				scheduled.push(callback);
				return callback as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: () => undefined,
			debounceDelayMs: 5000,
			...immediateSettlement,
		});

		watcher.emitChange('C:\\Users\\test\\.codex\\sessions\\changed-session.jsonl');
		scheduled[0]?.();
		await drainAsyncWork();

		assert.deepEqual(savedCandidateIds, [['changed-session']]);
		assert.equal(diagnosticState.getSource('codex-cli')?.lastSuccess?.sourceSessionId, 'changed-session');
		controller.dispose();
	});

	test('falls back to the full provider scan when the changed path cannot be mapped safely', async () => {
		const watcher = createFakeWatcher();
		const scheduled: Array<() => void> = [];
		const savedCandidateIds: string[][] = [];
		const newestSession: TestSession = {
			id: 'newest-session',
			title: 'Newest session',
			turnCount: 6,
		};
		const olderSession: TestSession = {
			id: 'older-session',
			title: 'Older session',
			turnCount: 4,
		};
		const source = createSource(newestSession, {
			readCandidates: async () => [
				{
					identity: `codex:${newestSession.id}`,
					sourceSessionId: newestSession.id,
					sourcePath: newestSession.id,
					sourceRevision: `revision:${newestSession.turnCount}`,
					title: newestSession.title,
					turnCount: newestSession.turnCount,
					session: newestSession,
				},
				{
					identity: `codex:${olderSession.id}`,
					sourceSessionId: olderSession.id,
					sourcePath: olderSession.id,
					sourceRevision: `revision:${olderSession.turnCount}`,
					title: olderSession.title,
					turnCount: olderSession.turnCount,
					session: olderSession,
				},
			],
			saveCandidates: async (candidates) => {
				savedCandidateIds.push(candidates.map((candidate) => candidate.sourceSessionId));
				return ['newest-session.json'];
			},
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState({
				now: () => '2026-07-30T15:05:00.000Z',
			}),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => {
				scheduled.push(callback);
				return callback as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: () => undefined,
			debounceDelayMs: 5000,
			...immediateSettlement,
		});

		watcher.emitChange('C:\\Users\\test\\.codex\\sessions\\unknown-session.jsonl');
		scheduled[0]?.();
		await drainAsyncWork();

		assert.deepEqual(savedCandidateIds, [['newest-session', 'older-session']]);
		controller.dispose();
	});

	test('saves only after source revisions are stable across bounded reads', async () => {
		const watcher = createFakeWatcher();
		const scheduled: Array<() => void> = [];
		const revisions = ['revision:streaming-1', 'revision:complete', 'revision:complete'];
		const savedRevisions: string[] = [];
		let readCount = 0;
		const session: TestSession = {
			id: 'settling-session',
			title: 'Settling session',
			turnCount: 2,
		};
		const source = createSource(session, {
			readCandidates: async () => {
				const sourceRevision = revisions[Math.min(readCount, revisions.length - 1)];
				readCount += 1;
				assert.ok(sourceRevision);
				return [
					{
						identity: `codex:${session.id}`,
						sourceSessionId: session.id,
						sourcePath: session.id,
						sourceRevision,
						title: session.title,
						turnCount: session.turnCount,
						session,
					},
				];
			},
			saveCandidates: async (candidates) => {
				const candidate = candidates[0];
				assert.ok(candidate);
				savedRevisions.push(candidate.sourceRevision);
				return ['settled.json'];
			},
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState({
				now: () => '2026-07-30T16:00:00.000Z',
			}),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => {
				scheduled.push(callback);
				return callback as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: () => undefined,
			debounceDelayMs: 5000,
			settleReadDelayMs: 0,
			maxSettleReadAttempts: 4,
			incompleteRetryDelaysMs: [],
			failureRetryDelayMs: 60_000,
			directoryRecoveryDelayMs: 0,
			fallbackScanIntervalMs: 0,
		});

		watcher.emitChange();
		scheduled[0]?.();
		await drainAsyncWork();

		assert.equal(readCount, 3);
		assert.deepEqual(savedRevisions, ['revision:complete']);
		controller.dispose();
	});

	test('does not save a source that changes throughout the bounded settle window', async () => {
		const watcher = createFakeWatcher();
		const scheduled: Array<() => void> = [];
		let readCount = 0;
		let saveCount = 0;
		const session: TestSession = {
			id: 'still-streaming',
			title: 'Still streaming',
			turnCount: 2,
		};
		const source = createSource(session, {
			readCandidates: async () => {
				readCount += 1;
				return [
					{
						identity: `codex:${session.id}`,
						sourceSessionId: session.id,
						sourcePath: session.id,
						sourceRevision: `revision:streaming-${readCount}`,
						title: session.title,
						turnCount: session.turnCount,
						session,
					},
				];
			},
			saveCandidates: async () => {
				saveCount += 1;
				return ['should-not-save.json'];
			},
		});
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-30T16:05:00.000Z',
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState,
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => {
				scheduled.push(callback);
				return callback as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: () => undefined,
			debounceDelayMs: 5000,
			settleReadDelayMs: 0,
			maxSettleReadAttempts: 3,
			incompleteRetryDelaysMs: [],
			failureRetryDelayMs: 60_000,
			directoryRecoveryDelayMs: 0,
			fallbackScanIntervalMs: 0,
		});

		watcher.emitChange();
		scheduled[0]?.();
		await drainAsyncWork();

		assert.equal(readCount, 3);
		assert.equal(saveCount, 0);
		assert.equal(
			diagnosticState.getSource('codex-cli')?.skipReason?.reason,
			'Source content did not settle after 3 reads.',
		);
		controller.dispose();
	});

	test('retries recognized incomplete JSON and JSONL reads with bounded backoff', async () => {
		const watcher = createFakeWatcher();
		const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
		let readCount = 0;
		let saveCount = 0;
		const session: TestSession = {
			id: 'partial-jsonl',
			title: 'Partial JSONL',
			turnCount: 2,
		};
		const source = createSource(session, {
			readCandidates: async () => {
				readCount += 1;
				if (readCount === 1) {
					throw new SyntaxError(`Invalid Codex JSON in ${session.id}.json`);
				}
				if (readCount === 2) {
					throw new SyntaxError(`Invalid Codex JSONL in ${session.id}.jsonl`);
				}

				return [
					{
						identity: `codex:${session.id}`,
						sourceSessionId: session.id,
						sourcePath: session.id,
						sourceRevision: 'revision:complete',
						title: session.title,
						turnCount: session.turnCount,
						session,
					},
				];
			},
			saveCandidates: async () => {
				saveCount += 1;
				return ['recovered.json'];
			},
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState({
				now: () => '2026-07-30T16:10:00.000Z',
			}),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback, delayMs) => {
				scheduled.push({ callback, delayMs });
				return callback as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: () => undefined,
			debounceDelayMs: 5000,
			settleReadDelayMs: 0,
			maxSettleReadAttempts: 2,
			incompleteRetryDelaysMs: [100, 250],
			failureRetryDelayMs: 60_000,
			directoryRecoveryDelayMs: 0,
			fallbackScanIntervalMs: 0,
		});

		watcher.emitChange();
		scheduled[0]?.callback();
		await drainAsyncWork();
		scheduled[1]?.callback();
		await drainAsyncWork();
		scheduled[2]?.callback();
		await drainAsyncWork();

		assert.deepEqual(
			scheduled.map(({ delayMs }) => delayMs),
			[5000, 100, 250],
		);
		assert.equal(readCount, 4);
		assert.equal(saveCount, 1);
		controller.dispose();
	});

	test('coalesces events during an active save into one trailing reconciliation', async () => {
		const watcher = createFakeWatcher();
		const scheduled = new Map<number, () => void>();
		let nextHandle = 0;
		let readCount = 0;
		let saveCount = 0;
		let completeFirstSave: ((fileNames: readonly string[]) => void) | undefined;
		const firstSave = new Promise<readonly string[]>((resolve) => {
			completeFirstSave = resolve;
		});
		const session: TestSession = {
			id: 'active-save',
			title: 'Active save',
			turnCount: 2,
		};
		const source = createSource(session, {
			readCandidates: async () => {
				readCount += 1;
				return [
					{
						identity: `codex:${session.id}`,
						sourceSessionId: session.id,
						sourcePath: session.id,
						sourceRevision: `revision:${session.turnCount}`,
						title: session.title,
						turnCount: session.turnCount,
						session,
					},
				];
			},
			saveCandidates: async () => {
				saveCount += 1;
				return saveCount === 1 ? firstSave : [`saved-v${saveCount}.json`];
			},
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState({
				now: () => '2026-07-30T16:15:00.000Z',
			}),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback) => {
				nextHandle += 1;
				scheduled.set(nextHandle, callback);
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				scheduled.delete(handle as unknown as number);
			},
			debounceDelayMs: 5000,
			...immediateSettlement,
		});
		const runOnlyScheduledCallback = (): void => {
			assert.equal(scheduled.size, 1);
			const entry = scheduled.entries().next().value as [number, () => void] | undefined;
			assert.ok(entry);
			scheduled.delete(entry[0]);
			entry[1]();
		};

		watcher.emitChange();
		runOnlyScheduledCallback();
		await drainAsyncWork();
		assert.equal(saveCount, 1);

		session.turnCount = 4;
		watcher.emitChange();
		watcher.emitChange();
		runOnlyScheduledCallback();
		assert.equal(readCount, 2);

		assert.ok(completeFirstSave);
		completeFirstSave(['saved-v1.json']);
		await drainAsyncWork();

		assert.equal(readCount, 4);
		assert.equal(saveCount, 2);
		assert.equal(scheduled.size, 0);
		controller.dispose();
	});

	test('saves a normally completed response within the 15-second target', async () => {
		const watcher = createFakeWatcher();
		const scheduled = new Map<number, { callback: () => void; dueAtMs: number }>();
		let nextHandle = 0;
		let nowMs = 0;
		let savedAtMs: number | undefined;
		const session: TestSession = {
			id: 'normal-response',
			title: 'Normal response',
			turnCount: 2,
		};
		const source = createSource(session, {
			saveCandidates: async () => {
				savedAtMs = nowMs;
				return ['normal-response.json'];
			},
		});
		const controller = createAutoSaveController([source], {
			createWatcher: () => watcher,
			pathExists: () => true,
			diagnosticState: createAutoSaveDiagnosticState({
				now: () => '2026-07-30T16:20:00.000Z',
			}),
			appendLine: () => undefined,
			showWarningMessage: async () => undefined,
			hash: (value) => value,
			schedule: (callback, delayMs) => {
				nextHandle += 1;
				scheduled.set(nextHandle, {
					callback,
					dueAtMs: nowMs + delayMs,
				});
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				scheduled.delete(handle as unknown as number);
			},
			debounceDelayMs: 5000,
			settleReadDelayMs: 250,
			maxSettleReadAttempts: 4,
			incompleteRetryDelaysMs: [250, 500, 1000],
			failureRetryDelayMs: 60_000,
			directoryRecoveryDelayMs: 0,
			fallbackScanIntervalMs: 0,
		});
		const runNextScheduledCallback = (): void => {
			const entry = [...scheduled.entries()].sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
			assert.ok(entry);
			scheduled.delete(entry[0]);
			nowMs = entry[1].dueAtMs;
			entry[1].callback();
		};

		watcher.emitChange();
		runNextScheduledCallback();
		await drainAsyncWork();
		runNextScheduledCallback();
		await drainAsyncWork();

		assert.equal(savedAtMs, 5250);
		assert.ok(savedAtMs !== undefined);
		assert.ok(savedAtMs <= 15000);
		controller.dispose();
	});

	test('isolates persistent source failures, warns once, retries periodically, and recovers only that source', async () => {
		const codexWatcher = createFakeWatcher();
		const claudeWatcher = createFakeWatcher();
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-29T23:00:00.000Z',
		});
		const outputLines: string[] = [];
		const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
		const warnings: string[] = [];
		let nextHandle = 0;
		let codexShouldFail = true;
		let claudeShouldFail = false;
		let codexSaveCount = 0;
		let claudeSaveCount = 0;
		const codexSession: TestSession = {
			id: 'codex-session',
			title: 'Recovering Codex session',
			turnCount: 2,
		};
		const claudeSession: TestSession = {
			id: 'claude-session',
			title: 'Independent Claude session',
			turnCount: 2,
		};
		const codexSource = createSource(codexSession, {
			readCandidates: async () => {
				if (codexShouldFail) {
					throw new SyntaxError('Unexpected token in Codex JSON');
				}
				return [
					{
						identity: `codex:${codexSession.id}`,
						sourceSessionId: codexSession.id,
						sourcePath: codexSession.id,
						sourceRevision: 'codex-revision',
						title: codexSession.title,
						turnCount: codexSession.turnCount,
						session: codexSession,
					},
				];
			},
			saveCandidates: async () => {
				codexSaveCount += 1;
				return ['codex.json'];
			},
		});
		const claudeSource = createSource(claudeSession, {
			sourceId: 'claude-code-cli',
			directory: 'C:/Users/test/.claude/projects/chat-commit',
			glob: '*.jsonl',
			label: 'Claude Code session transcripts',
			sessionLabel: 'Claude Code',
			readCandidates: async () => {
				if (claudeShouldFail) {
					throw new Error('Claude path is unavailable');
				}
				return [
					{
						identity: `claude:${claudeSession.id}`,
						sourceSessionId: claudeSession.id,
						sourcePath: claudeSession.id,
						sourceRevision: `claude-revision:${claudeSession.turnCount}`,
						title: claudeSession.title,
						turnCount: claudeSession.turnCount,
						session: claudeSession,
					},
				];
			},
			saveCandidates: async () => {
				claudeSaveCount += 1;
				return ['claude.json'];
			},
		});
		const controller = createAutoSaveController([codexSource, claudeSource], {
			createWatcher: (_directory, glob) => (glob === '*.jsonl' ? claudeWatcher : codexWatcher),
			pathExists: () => true,
			diagnosticState,
			appendLine: (value) => {
				outputLines.push(value);
			},
			showWarningMessage: async (message) => {
				warnings.push(message);
			},
			hash: (value) => value,
			schedule: (callback, delayMs) => {
				nextHandle += 1;
				scheduled.set(nextHandle, { callback, delayMs });
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				scheduled.delete(handle as unknown as number);
			},
			debounceDelayMs: 5000,
			...immediateSettlement,
		});
		const runScheduled = (delayMs: number): void => {
			const entry = [...scheduled.entries()].find(([, scheduledEntry]) => scheduledEntry.delayMs === delayMs);
			assert.ok(entry);
			scheduled.delete(entry[0]);
			entry[1].callback();
		};

		codexWatcher.emitChange();
		claudeWatcher.emitChange();
		runScheduled(5000);
		runScheduled(5000);
		await drainAsyncWork();

		assert.equal(codexSaveCount, 0);
		assert.equal(claudeSaveCount, 1);
		assert.equal(diagnosticState.getSource('codex-cli')?.lastError?.message, 'Unexpected token in Codex JSON');
		assert.equal(diagnosticState.getSource('codex-cli')?.disabled, true);
		assert.equal(diagnosticState.getSource('claude-code-cli')?.disabled, false);
		assert.equal(warnings.length, 1);
		assert.equal(
			outputLines.some((line) => line.includes('Other sources remain active')),
			true,
		);

		codexWatcher.emitChange();
		assert.equal([...scheduled.values()].filter(({ delayMs }) => delayMs === 60_000).length, 1);
		runScheduled(60_000);
		await drainAsyncWork();
		assert.equal(warnings.length, 1);
		assert.equal(diagnosticState.getSource('codex-cli')?.lastRetry?.attempt, 2);

		claudeShouldFail = true;
		claudeWatcher.emitChange();
		runScheduled(5000);
		await drainAsyncWork();
		const claudeFailure = diagnosticState.getSource('claude-code-cli');
		assert.equal(claudeFailure?.disabled, true);
		assert.equal(warnings.length, 2);

		codexShouldFail = false;
		runScheduled(60_000);
		await drainAsyncWork();

		const codexRecovery = diagnosticState.getSource('codex-cli');
		assert.equal(codexSaveCount, 1);
		assert.equal(codexRecovery?.health, 'healthy');
		assert.equal(codexRecovery?.disabled, false);
		assert.equal(codexRecovery?.warningShown, false);
		assert.equal(codexRecovery?.lastError, undefined);
		assert.equal(codexRecovery?.lastRetry, undefined);
		assert.deepEqual(diagnosticState.getSource('claude-code-cli'), claudeFailure);
		assert.equal(
			outputLines.some(
				(line) => line.includes('recovered') && line.includes('only its source diagnostic state was cleared'),
			),
			true,
		);
		controller.dispose();
	});

	test('isolates watcher path failures and retries only the failed source watcher', async () => {
		const codexWatcher = createFakeWatcher();
		const claudeWatcher = createFakeWatcher();
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-30T18:30:00.000Z',
		});
		const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
		const warnings: string[] = [];
		let nextHandle = 0;
		let codexWatcherAttempts = 0;
		let codexSaveCount = 0;
		let claudeSaveCount = 0;
		const codexSource = createSource(
			{
				id: 'codex-path-recovery',
				title: 'Codex path recovery',
				turnCount: 2,
			},
			{
				saveCandidates: async () => {
					codexSaveCount += 1;
					return ['codex-path-recovery.json'];
				},
			},
		);
		const claudeSource = createSource(
			{
				id: 'claude-independent',
				title: 'Claude remains active',
				turnCount: 2,
			},
			{
				sourceId: 'claude-code-cli',
				directory: 'C:/Users/test/.claude/projects/chat-commit',
				glob: '*.jsonl',
				label: 'Claude Code session transcripts',
				sessionLabel: 'Claude Code',
				saveCandidates: async () => {
					claudeSaveCount += 1;
					return ['claude-independent.json'];
				},
			},
		);
		const controller = createAutoSaveController([codexSource, claudeSource], {
			createWatcher: (_directory, glob) => {
				if (glob === '*.jsonl') {
					return claudeWatcher;
				}
				codexWatcherAttempts += 1;
				if (codexWatcherAttempts === 1) {
					throw new Error('Codex source directory is temporarily unavailable');
				}
				return codexWatcher;
			},
			pathExists: () => true,
			diagnosticState,
			appendLine: () => undefined,
			showWarningMessage: async (message) => {
				warnings.push(message);
			},
			hash: (value) => value,
			schedule: (callback, delayMs) => {
				nextHandle += 1;
				scheduled.set(nextHandle, { callback, delayMs });
				return nextHandle as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: (handle) => {
				scheduled.delete(handle as unknown as number);
			},
			debounceDelayMs: 5000,
			...immediateSettlement,
		});
		const runScheduled = (delayMs: number): void => {
			const entry = [...scheduled.entries()].find(([, scheduledEntry]) => scheduledEntry.delayMs === delayMs);
			assert.ok(entry);
			scheduled.delete(entry[0]);
			entry[1].callback();
		};

		assert.equal(codexWatcherAttempts, 1);
		assert.equal(diagnosticState.getSource('codex-cli')?.disabled, true);
		assert.equal(diagnosticState.getSource('claude-code-cli')?.disabled, false);

		claudeWatcher.emitChange();
		runScheduled(5000);
		await drainAsyncWork();
		assert.equal(claudeSaveCount, 1);

		runScheduled(60_000);
		await drainAsyncWork();
		assert.equal(codexWatcherAttempts, 2);
		assert.equal(codexSaveCount, 1);
		assert.equal(diagnosticState.getSource('codex-cli')?.disabled, false);
		assert.equal(warnings.length, 1);
		controller.dispose();
	});
});
