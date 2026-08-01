import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChatSession } from '../../src/types';
import { createSessionFileName, createSessionStore } from '../../src/sessionStore';

function createSession(id: string, savedAt: string, title: string): ChatSession {
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
				prompt: 'Prompt',
				references: [],
				timestamp: savedAt,
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'Response',
				toolCalls: [],
				timestamp: savedAt,
			},
		],
		markdownSummary: '# Chat: Summary',
	};
}

suite('sessionStore', () => {
	test('createSessionFileName uses timestamp and slugified title', () => {
		const fileName = createSessionFileName({
			savedAt: '2026-04-12T14:30:00.000Z',
			title: 'Fix Auth Bug!',
		});

		assert.equal(fileName, '2026-04-12T14-30-fix-auth-bug.json');
	});

	test('writeSession uses title-only filename when configured', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const session = createSession('title-only-a', '2026-04-12T10:00:00.000Z', 'Write Test');
			const fileName = await store.writeSession(storageDirectory, session, {
				includeTimestampInFileName: false,
			});

			assert.equal(fileName, 'write-test.json');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('writeSession appends id suffix when title-only filename collides', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const first = createSession('duplicate-a', '2026-04-12T10:00:00.000Z', 'Duplicate Title');
			const second = createSession('duplicate-b', '2026-04-12T10:00:30.000Z', 'Duplicate Title');

			const firstFile = await store.writeSession(storageDirectory, first, {
				includeTimestampInFileName: false,
			});
			const secondFile = await store.writeSession(storageDirectory, second, {
				includeTimestampInFileName: false,
			});

			assert.equal(firstFile, 'duplicate-title.json');
			assert.equal(secondFile, 'duplicate-title-duplicate-b.json');

			const files = await fs.readdir(storageDirectory);
			assert.equal(files.includes('duplicate-title.json'), true);
			assert.equal(files.includes('duplicate-title-duplicate-b.json'), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('listSessions logs skipped files that fail to parse or validate', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const warnings: string[] = [];
		const store = createSessionStore({
			logWarning: (message) => {
				warnings.push(message);
			},
		});

		try {
			await fs.mkdir(storageDirectory, { recursive: true });
			await fs.writeFile(path.join(storageDirectory, 'broken.json'), '{ not json', 'utf8');
			await fs.writeFile(
				path.join(storageDirectory, 'invalid-schema.json'),
				JSON.stringify({ id: 'missing-fields' }),
				'utf8',
			);
			await store.writeSession(
				storageDirectory,
				createSession('valid-a', '2026-04-12T10:00:00.000Z', 'Valid Session'),
				{
					includeTimestampInFileName: false,
				},
			);

			const sessions = await store.listSessions(storageDirectory);

			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.id, 'valid-a');
			assert.equal(
				warnings.some((warning) => warning.includes('broken.json')),
				true,
			);
			assert.equal(
				warnings.some(
					(warning) => warning.includes('invalid-schema.json') && warning.includes('Invalid session schema'),
				),
				true,
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('writeSessions preserves linked part filenames when title-only split names collide', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await store.writeSession(
				storageDirectory,
				createSession('existing-a', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 1/2)'),
				{
					includeTimestampInFileName: false,
				},
			);
			await store.writeSession(
				storageDirectory,
				createSession('existing-b', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 2/2)'),
				{
					includeTimestampInFileName: false,
				},
			);

			const partOne = {
				...createSession('split-session', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 1/2)'),
				part: 1,
				totalParts: 2,
				nextPartFile: 'placeholder-part-2.json',
			};
			const partTwo = {
				...createSession('split-session', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 2/2)'),
				part: 2,
				totalParts: 2,
				previousPartFile: 'placeholder-part-1.json',
			};

			const writtenFiles = await store.writeSessions(storageDirectory, [partOne, partTwo], {
				includeTimestampInFileName: false,
			});

			assert.equal(writtenFiles[0], 'status-plan-part-1-2-split-sessio.json');
			assert.equal(writtenFiles[1], 'status-plan-part-2-2-split-sessio.json');

			const restoredPartOne = await store.readSession(storageDirectory, writtenFiles[0] as string);
			const restoredPartTwo = await store.readSession(storageDirectory, writtenFiles[1] as string);

			assert.equal(restoredPartOne.nextPartFile, writtenFiles[1]);
			assert.equal(restoredPartTwo.previousPartFile, writtenFiles[0]);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('writeSession persists session atomically and readSession restores it', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const session = createSession('a', '2026-04-12T10:00:00.000Z', 'Write Test');
			const fileName = await store.writeSession(storageDirectory, session);
			const restored = await store.readSession(storageDirectory, fileName);

			assert.equal(restored.id, 'a');
			assert.equal(restored.title, 'Write Test');

			const files = await fs.readdir(storageDirectory);
			assert.equal(
				files.some((file) => file.endsWith('.tmp')),
				false,
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('listSessions returns metadata sorted by newest first', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await store.writeSession(storageDirectory, createSession('older', '2026-04-10T10:00:00.000Z', 'Older Session'));
			await store.writeSession(storageDirectory, createSession('newer', '2026-04-12T10:00:00.000Z', 'Newer Session'));

			const sessions = await store.listSessions(storageDirectory);
			assert.equal(sessions.length, 2);
			assert.equal(sessions[0]?.id, 'newer');
			assert.equal(sessions[1]?.id, 'older');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('listSessions returns empty when directory does not exist', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const sessions = await store.listSessions(storageDirectory);
			assert.equal(sessions.length, 0);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('findAutoSaveSessionFiles matches exact auto-save origin and excludes manual identity collisions', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();
		const sourceId = 'codex-cli';
		const sourceSessionId = 'provider-session-1';
		const withOrigin = (
			title: string,
			savedAt: string,
			saveKind: 'manual' | 'auto',
			originSourceId = sourceId,
			originSessionId = sourceSessionId,
		): ChatSession => ({
			...createSession(sourceSessionId, savedAt, title),
			provider: 'codex',
			origin: {
				saveKind,
				sourceId: originSourceId,
				sourceSessionId: originSessionId,
				sourceRevision: 'sha256:matching-revision',
			},
		});

		try {
			const expectedFiles = [
				await store.writeSession(
					storageDirectory,
					withOrigin('Matching auto save part one', '2026-07-30T12:00:00.000Z', 'auto'),
				),
				await store.writeSession(
					storageDirectory,
					withOrigin('Matching auto save part two', '2026-07-30T12:00:00.000Z', 'auto'),
				),
			];
			await store.writeSession(storageDirectory, withOrigin('Manual collision', '2026-07-30T12:01:00.000Z', 'manual'));
			await store.writeSession(
				storageDirectory,
				withOrigin('Different source', '2026-07-30T12:02:00.000Z', 'auto', 'copilot-cli'),
			);
			await store.writeSession(
				storageDirectory,
				withOrigin('Different provider session', '2026-07-30T12:03:00.000Z', 'auto', sourceId, 'provider-session-2'),
			);
			await store.writeSession(storageDirectory, {
				...createSession(sourceSessionId, '2026-07-30T12:04:00.000Z', 'Legacy manual collision'),
				provider: 'codex',
			});

			// A fresh store has no in-memory or workspace checkpoint state and
			// must recover ownership solely from the self-identifying .chat files.
			const recovered = await createSessionStore().findAutoSaveSessionFiles(
				storageDirectory,
				sourceId,
				sourceSessionId,
			);

			assert.deepEqual(recovered.map((match) => match.fileName).sort(), expectedFiles.sort());
			assert.deepEqual([...new Set(recovered.map((match) => match.sourceRevision))], ['sha256:matching-revision']);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions publishes a complete split set before retiring only matching auto-saves', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'codex-cli';
		const sourceSessionId = 'provider-session-1';
		const withOrigin = (
			title: string,
			savedAt: string,
			saveKind: 'manual' | 'auto',
			sourceRevision: string,
		): ChatSession => ({
			...createSession(sourceSessionId, savedAt, title),
			provider: 'codex',
			origin: {
				saveKind,
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		try {
			const seedStore = createSessionStore();
			const previousPartOne = {
				...withOrigin('Previous snapshot (Part 1/2)', '2026-07-30T12:00:00.000Z', 'auto', 'sha256:old'),
				part: 1,
				totalParts: 2,
			};
			const previousPartTwo = {
				...withOrigin('Previous snapshot (Part 2/2)', '2026-07-30T12:00:00.000Z', 'auto', 'sha256:old'),
				part: 2,
				totalParts: 2,
			};
			const previousFileNames = await seedStore.writeSessions(storageDirectory, [previousPartOne, previousPartTwo], {
				includeTimestampInFileName: false,
			});
			const manualFileName = await seedStore.writeSession(
				storageDirectory,
				withOrigin('Current snapshot (Part 1/2)', '2026-07-30T12:05:00.000Z', 'manual', 'sha256:manual'),
				{ includeTimestampInFileName: false },
			);
			const manualSnapshotBefore = await seedStore.readSession(storageDirectory, manualFileName);
			const unrelatedOldFileName = await seedStore.writeSession(
				storageDirectory,
				createSession('unrelated-old', '2026-07-29T12:00:00.000Z', 'Unrelated old snapshot'),
			);

			const operations: string[] = [];
			const store = createSessionStore({
				writeFile: async (filePath, content) => {
					operations.push(`write:${path.basename(filePath)}`);
					await fs.writeFile(filePath, content, 'utf8');
				},
				rename: async (fromPath, toPath) => {
					operations.push(`rename:${path.basename(fromPath)}->${path.basename(toPath)}`);
					await fs.rename(fromPath, toPath);
				},
				unlink: async (filePath) => {
					operations.push(`unlink:${path.basename(filePath)}`);
					await fs.unlink(filePath);
				},
			});
			const nextPartOne = {
				...withOrigin('Current snapshot (Part 1/2)', '2026-07-30T12:05:00.000Z', 'auto', 'sha256:new'),
				part: 1,
				totalParts: 2,
			};
			const nextPartTwo = {
				...withOrigin('Current snapshot (Part 2/2)', '2026-07-30T12:05:00.000Z', 'auto', 'sha256:new'),
				part: 2,
				totalParts: 2,
			};

			const newFileNames = await store.upsertAutoSaveSessions(
				storageDirectory,
				[nextPartOne, nextPartTwo],
				{ sourceId, sourceSessionId },
				{ includeTimestampInFileName: false },
			);

			const writeIndexes = operations
				.map((operation, index) => (operation.startsWith('write:') ? index : -1))
				.filter((index) => index >= 0);
			const publishIndexes = operations
				.map((operation, index) => (operation.startsWith('rename:') ? index : -1))
				.filter((index) => index >= 0);
			const retireIndexes = operations
				.map((operation, index) =>
					previousFileNames.some((fileName) => operation === `unlink:${fileName}`) ? index : -1,
				)
				.filter((index) => index >= 0);
			assert.equal(writeIndexes.length, 2);
			assert.equal(publishIndexes.length, 2);
			assert.equal(retireIndexes.length, 2);
			assert.ok(Math.max(...writeIndexes) < Math.min(...publishIndexes));
			assert.ok(Math.max(...publishIndexes) < Math.min(...retireIndexes));
			assert.deepEqual(
				operations
					.filter((operation) => operation.startsWith('unlink:'))
					.map((operation) => operation.slice('unlink:'.length))
					.sort(),
				[...previousFileNames].sort(),
			);

			const pruneResult = await store.pruneSessions(storageDirectory, 1, 'delete');
			assert.deepEqual(pruneResult, { archived: 0, deleted: 1 });

			const remainingFiles = await fs.readdir(storageDirectory);
			assert.equal(remainingFiles.includes(manualFileName), true);
			assert.equal(remainingFiles.includes(unrelatedOldFileName), false);
			assert.equal(
				remainingFiles.some((fileName) => fileName.endsWith('.tmp')),
				false,
			);
			for (const previousFileName of previousFileNames) {
				assert.equal(remainingFiles.includes(previousFileName), false);
			}
			for (const newFileName of newFileNames) {
				assert.equal(remainingFiles.includes(newFileName), true);
			}

			const manualSnapshot = await store.readSession(storageDirectory, manualFileName);
			assert.deepEqual(manualSnapshot, manualSnapshotBefore);
			const currentAutoSaves = await store.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId);
			assert.deepEqual(currentAutoSaves.map((file) => file.fileName).sort(), [...newFileNames].sort());
			const restoredPartOne = await store.readSession(storageDirectory, newFileNames[0] as string);
			const restoredPartTwo = await store.readSession(storageDirectory, newFileNames[1] as string);
			assert.equal(restoredPartOne.nextPartFile, newFileNames[1]);
			assert.equal(restoredPartTwo.previousPartFile, newFileNames[0]);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions rolls back a partially published new set and keeps previous and manual snapshots', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'claude-code';
		const sourceSessionId = 'provider-session-2';
		const createAutoSave = (title: string, savedAt: string, sourceRevision: string): ChatSession => ({
			...createSession(sourceSessionId, savedAt, title),
			provider: 'claude-code',
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		try {
			const seedStore = createSessionStore();
			const previousFileName = await seedStore.writeSession(
				storageDirectory,
				createAutoSave('Previous complete snapshot', '2026-07-30T12:00:00.000Z', 'sha256:old'),
			);
			const manualFileName = await seedStore.writeSession(storageDirectory, {
				...createSession(sourceSessionId, '2026-07-30T12:01:00.000Z', 'Independent manual snapshot'),
				provider: 'claude-code',
				origin: {
					saveKind: 'manual',
					sourceId,
					sourceSessionId,
					sourceRevision: 'sha256:manual',
				},
			});
			const manualSnapshotBefore = await fs.readFile(path.join(storageDirectory, manualFileName), 'utf8');
			let publishCount = 0;
			const store = createSessionStore({
				rename: async (fromPath, toPath) => {
					publishCount += 1;
					if (publishCount === 2) {
						throw new Error('simulated second-part rename failure');
					}
					await fs.rename(fromPath, toPath);
				},
			});
			const nextPartOne = {
				...createAutoSave('Next snapshot (Part 1/2)', '2026-07-30T12:05:00.000Z', 'sha256:new'),
				part: 1,
				totalParts: 2,
			};
			const nextPartTwo = {
				...createAutoSave('Next snapshot (Part 2/2)', '2026-07-30T12:05:00.000Z', 'sha256:new'),
				part: 2,
				totalParts: 2,
			};

			await assert.rejects(
				store.upsertAutoSaveSessions(storageDirectory, [nextPartOne, nextPartTwo], { sourceId, sourceSessionId }),
				/simulated second-part rename failure/,
			);

			const remainingFiles = await fs.readdir(storageDirectory);
			assert.deepEqual(remainingFiles.sort(), [manualFileName, previousFileName].sort());
			assert.equal(
				await fs.readFile(path.join(storageDirectory, manualFileName), 'utf8'),
				manualSnapshotBefore,
			);
			const currentAutoSaves = await seedStore.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId);
			assert.deepEqual(
				currentAutoSaves.map((file) => file.fileName),
				[previousFileName],
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('deleteSession removes an existing file and returns false when missing', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const fileName = await store.writeSession(
				storageDirectory,
				createSession('delete-me', '2026-04-12T12:00:00.000Z', 'Delete me'),
			);

			const firstDelete = await store.deleteSession(storageDirectory, fileName);
			const secondDelete = await store.deleteSession(storageDirectory, fileName);

			assert.equal(firstDelete, true);
			assert.equal(secondDelete, false);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('pruneSessions archives oldest sessions when action is archive', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await store.writeSession(storageDirectory, createSession('a', '2026-04-10T10:00:00.000Z', 'A'));
			await store.writeSession(storageDirectory, createSession('b', '2026-04-11T10:00:00.000Z', 'B'));
			await store.writeSession(storageDirectory, createSession('c', '2026-04-12T10:00:00.000Z', 'C'));

			const result = await store.pruneSessions(storageDirectory, 2, 'archive');
			const remaining = await store.listSessions(storageDirectory);
			const archivedEntries = await fs.readdir(path.join(storageDirectory, '.archive'));

			assert.equal(result.archived, 1);
			assert.equal(result.deleted, 0);
			assert.equal(remaining.length, 2);
			assert.equal(
				remaining.some((session) => session.id === 'a'),
				false,
			);
			assert.equal(
				archivedEntries.some((entry) => entry.endsWith('.json')),
				true,
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('pruneSessions deletes oldest sessions when action is delete', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await store.writeSession(storageDirectory, createSession('a', '2026-04-10T10:00:00.000Z', 'A'));
			await store.writeSession(storageDirectory, createSession('b', '2026-04-11T10:00:00.000Z', 'B'));
			await store.writeSession(storageDirectory, createSession('c', '2026-04-12T10:00:00.000Z', 'C'));

			const result = await store.pruneSessions(storageDirectory, 1, 'delete');
			const remaining = await store.listSessions(storageDirectory);

			assert.equal(result.archived, 0);
			assert.equal(result.deleted, 2);
			assert.equal(remaining.length, 1);
			assert.equal(remaining[0]?.id, 'c');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('findOrphanedPartFiles flags dangling part links and marks superseded copies', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await fs.mkdir(storageDirectory, { recursive: true });
			const writeRaw = async (fileName: string, session: ChatSession) =>
				fs.writeFile(path.join(storageDirectory, fileName), JSON.stringify(session, null, 2), 'utf8');

			// Newest intact chain for the 'split' session.
			const partOne = createSession('split', '2026-07-04T12:00:00.000Z', 'Split (Part 1/2)');
			partOne.nextPartFile = 'split-part-2.json';
			const partTwo = createSession('split', '2026-07-04T12:00:00.000Z', 'Split (Part 2/2)');
			partTwo.previousPartFile = 'split-part-1.json';
			await writeRaw('split-part-1.json', partOne);
			await writeRaw('split-part-2.json', partTwo);

			// Stale auto-save iteration of the same session with a dangling link.
			const staleOrphan = createSession('split', '2026-07-04T11:00:00.000Z', 'Split (Part 2/2)');
			staleOrphan.previousPartFile = 'deleted-part-1.json';
			await writeRaw('split-part-2-stale.json', staleOrphan);

			// Broken chain with no surviving intact copy of its session.
			const lonely = createSession('lonely', '2026-07-03T10:00:00.000Z', 'Lonely (Part 2/2)');
			lonely.previousPartFile = 'gone-part-1.json';
			await writeRaw('lonely-part-2.json', lonely);

			await writeRaw('healthy.json', createSession('healthy', '2026-07-05T10:00:00.000Z', 'Healthy'));

			const orphans = await store.findOrphanedPartFiles(storageDirectory);
			const byFileName = new Map(orphans.map((orphan) => [orphan.fileName, orphan]));

			assert.equal(orphans.length, 2);
			assert.equal(byFileName.get('split-part-2-stale.json')?.superseded, true);
			assert.equal(byFileName.get('split-part-2-stale.json')?.danglingLink, 'deleted-part-1.json');
			assert.equal(byFileName.get('lonely-part-2.json')?.superseded, false);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('findOrphanedPartFiles returns empty for a missing directory and intact chains', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			assert.deepEqual(await store.findOrphanedPartFiles(storageDirectory), []);

			const partOne = createSession('split', '2026-07-04T12:00:00.000Z', 'Split (Part 1/2)');
			const partTwo = createSession('split', '2026-07-04T12:00:00.000Z', 'Split (Part 2/2)');
			await store.writeSessions(storageDirectory, [partOne, partTwo]);

			assert.deepEqual(await store.findOrphanedPartFiles(storageDirectory), []);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('pruneSessions keeps or removes split-session part files as one unit', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await store.writeSession(storageDirectory, createSession('old', '2026-04-10T10:00:00.000Z', 'Old'));
			await store.writeSession(storageDirectory, createSession('mid', '2026-04-11T10:00:00.000Z', 'Mid'));

			const partOne = createSession('split', '2026-04-12T10:00:00.000Z', 'Split (Part 1/2)');
			partOne.part = 1;
			partOne.totalParts = 2;
			const partTwo = createSession('split', '2026-04-12T10:00:00.000Z', 'Split (Part 2/2)');
			partTwo.part = 2;
			partTwo.totalParts = 2;
			const partFileNames = await store.writeSessions(storageDirectory, [partOne, partTwo]);
			assert.equal(partFileNames.length, 2);

			const result = await store.pruneSessions(storageDirectory, 2, 'delete');
			const remainingFiles = await fs.readdir(storageDirectory);

			assert.equal(result.deleted, 1);
			assert.equal(remainingFiles.filter((file) => file.endsWith('.json')).length, 3);
			for (const partFileName of partFileNames) {
				assert.equal(remainingFiles.includes(partFileName), true, `part file ${partFileName} must survive pruning`);
			}
			assert.equal(
				remainingFiles.some((file) => file.includes('old')),
				false,
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});
