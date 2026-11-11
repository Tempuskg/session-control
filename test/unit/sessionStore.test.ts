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
			// Auto-save identity lock files share these deps; record only session-file
			// operations so the assertions keep checking write -> publish -> retire order.
			const isLockFile = (filePath: string) => path.basename(filePath).startsWith('.session-control-autosave-');
			const store = createSessionStore({
				writeFile: async (filePath, content) => {
					if (!isLockFile(filePath)) {
						operations.push(`write:${path.basename(filePath)}`);
					}
					await fs.writeFile(filePath, content, 'utf8');
				},
				rename: async (fromPath, toPath) => {
					if (!isLockFile(fromPath)) {
						operations.push(`rename:${path.basename(fromPath)}->${path.basename(toPath)}`);
					}
					await fs.rename(fromPath, toPath);
				},
				unlink: async (filePath) => {
					if (!isLockFile(filePath)) {
						operations.push(`unlink:${path.basename(filePath)}`);
					}
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
	test('upsertAutoSaveSessions treats a peer-deleted previous file as successful retire', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'claude-code';
		const sourceSessionId = 'provider-session-missing-export';
		const withOrigin = (
			title: string,
			savedAt: string,
			sourceRevision: string,
			part: number,
			totalParts: number,
		): ChatSession => ({
			...createSession(sourceSessionId, savedAt, title),
			provider: 'claude-code',
			part,
			totalParts,
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		try {
			const seedStore = createSessionStore();
			const previousFileNames = await seedStore.writeSessions(
				storageDirectory,
				[
					withOrigin('Welcome content (Part 1/2)', '2026-10-22T18:49:00.000Z', 'sha256:old', 1, 2),
					withOrigin('Welcome content (Part 2/2)', '2026-10-22T18:49:00.000Z', 'sha256:old', 2, 2),
				],
				{ includeTimestampInFileName: false },
			);
			const previousSet = new Set(previousFileNames.map((fileName) => fileName.toLowerCase()));
			let published = false;
			let peerDeleted = false;
			const manualFile = await seedStore.writeSession(storageDirectory, {
				...withOrigin('Manual snapshot', '2026-10-22T18:49:00.000Z', 'sha256:old', 1, 1),
				origin: { saveKind: 'manual', sourceId, sourceSessionId, sourceRevision: 'sha256:old' },
			});
			const manualBefore = await fs.readFile(path.join(storageDirectory, manualFile), 'utf8');

			const store = createSessionStore({
				rename: async (fromPath, toPath) => {
					await fs.rename(fromPath, toPath);
					published = true;
				},
				readFile: async (filePath) => {
					const content = await fs.readFile(filePath, 'utf8');
					const baseName = path.basename(filePath);
					if (published && !peerDeleted && previousSet.has(baseName.toLowerCase())) {
						await fs.unlink(filePath);
						peerDeleted = true;
					}
					return content;
				},
			});

			const newFileNames = await store.upsertAutoSaveSessions(
				storageDirectory,
				[
					withOrigin('Welcome content (Part 1/2)', '2026-10-22T20:52:00.000Z', 'sha256:new', 1, 2),
					withOrigin('Welcome content (Part 2/2)', '2026-10-22T20:52:00.000Z', 'sha256:new', 2, 2),
				],
				{ sourceId, sourceSessionId },
				{ includeTimestampInFileName: false },
			);

			assert.equal(peerDeleted, true);
			assert.equal(await fs.readFile(path.join(storageDirectory, manualFile), 'utf8'), manualBefore);
			assert.equal(newFileNames.length, 2);
			for (const [index, fileName] of newFileNames.entries()) {
				const saved = await seedStore.readSession(storageDirectory, fileName);
				assert.equal(saved.previousPartFile, newFileNames[index - 1] ?? null);
				assert.equal(saved.nextPartFile, newFileNames[index + 1] ?? null);
				assert.equal(saved.origin?.sourceRevision, 'sha256:new');
				assert.equal(saved.turns.length, 2);
			}
			const remaining = await fs.readdir(storageDirectory);
			for (const previousFileName of previousFileNames) {
				assert.equal(remaining.includes(previousFileName), false);
			}
			for (const newFileName of newFileNames) {
				assert.equal(remaining.includes(newFileName), true);
			}
			assert.deepEqual(
				(await store.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId))
					.map((file) => file.fileName)
					.sort(),
				[...newFileNames].sort(),
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
/**
 * Add these cases to test/unit/sessionStore.test.ts after approval.
 * They assume the reviewed sessionStore patch (identity lock + complete-set adoption)
 * is already applied. Do not call non-exported writeSessionToFile; plant files with
 * fs.writeFile / writeSession only.
 *
 * Coverage required by candidate-review.md / card-mw5le1cs-3:
 * - forced check-then-publish interleaving under the identity lock
 * - separate-process writers (filesystem exclusive-create exclusivity)
 * - owner delay / crash recovery (I1, I3) with injectable lock timings
 * - manual snapshot preservation
 * - multipart duplicate / incomplete chains (no sort-and-slice heal)
 * - same-revision adopt of collision copies without a nonexistent store API
 */

	test('upsertAutoSaveSessions concurrent same-revision writers force old check-then-publish overlap and converge', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'cursor-cli';
		const sourceSessionId = '0a543769-b19a-4873-b798-37f742c75391';
		const sourceRevision = '3fa2e9fe7485a6a310961ffeea783e30833a81333d42a97249daf41a07175c8d';
		const createAutoSave = (title: string, savedAt: string, vscodeVersion: string): ChatSession => ({
			...createSession(sourceSessionId, savedAt, title),
			provider: 'cursor',
			vscodeVersion,
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		// Barrier recreates the historical race window: every writer reaches the
		// upsert entrypoint before any returns, which previously allowed
		// check-then-publish interleaving across hosts.
		let releaseWriters!: () => void;
		const writersReady = new Promise<void>((resolve) => {
			releaseWriters = resolve;
		});
		let readyCount = 0;
		const markReady = async (): Promise<void> => {
			readyCount += 1;
			if (readyCount === 3) {
				releaseWriters();
			}
			await writersReady;
		};

		try {
			const seedStore = createSessionStore();
			const manualFileName = await seedStore.writeSession(storageDirectory, {
				...createSession(sourceSessionId, '2026-10-21T23:56:00.000Z', 'Deliberate manual snapshot'),
				provider: 'cursor',
				origin: {
					saveKind: 'manual',
					sourceId,
					sourceSessionId,
					sourceRevision: 'sha256:manual',
				},
			});
			const manualBefore = await seedStore.readSession(storageDirectory, manualFileName);

			const writers = [0, 1, 2].map(async (index) => {
				await markReady();
				return createSessionStore().upsertAutoSaveSessions(
					storageDirectory,
					[
						createAutoSave(
							'Reply with exactly cursor auto save smoke test complete do not read files',
							'2026-10-21T23:57:35.821Z',
							index === 0 ? '1.128.0' : '1.143.0',
						),
					],
					{ sourceId, sourceSessionId },
				);
			});

			const results = await Promise.all(writers);
			assert.equal(results.length, 3);
			assert.deepEqual(results[1], results[0]);
			assert.deepEqual(results[2], results[0]);
			assert.equal(results[0]?.length, 1);

			const remaining = await fs.readdir(storageDirectory);
			const autoFiles = remaining.filter((fileName) => fileName !== manualFileName && fileName.endsWith('.json'));
			assert.deepEqual(autoFiles.sort(), [...(results[0] ?? [])].sort());
			assert.equal(
				remaining.some((fileName) => /0a543769-b19(?:-\d+)?\.json$/i.test(fileName)),
				false,
			);
			assert.deepEqual(await seedStore.readSession(storageDirectory, manualFileName), manualBefore);

			const recovered = await seedStore.findAutoSaveSessionFiles(storageDirectory, sourceId, sourceSessionId);
			assert.deepEqual(
				recovered.map((entry) => entry.fileName).sort(),
				[...(results[0] ?? [])].sort(),
			);
			assert.deepEqual(
				[...new Set(recovered.map((entry) => entry.sourceRevision))],
				[sourceRevision],
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions separate-process writers rely on filesystem exclusive create', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'cursor-cli';
		const sourceSessionId = 'separate-process-session';
		const sourceRevision = 'sha256:separate-process';
		const sessionModulePath = path.resolve(__dirname, '../../src/sessionStore.js');
		const workerScript = `
const { createSessionStore } = require(${JSON.stringify(sessionModulePath)});
// With \`node -e <script> a b c\`, user arguments start at process.argv[1].
const [storageDirectory, sourceId, sourceSessionId, sourceRevision, title] = process.argv.slice(1);
const savedAt = '2026-10-21T23:57:35.821Z';
(async () => {
  const store = createSessionStore();
  const fileNames = await store.upsertAutoSaveSessions(
    storageDirectory,
    [{
      version: 1,
      id: sourceSessionId,
      title,
      savedAt,
      provider: 'cursor',
      git: { branch: 'main', commit: 'abcdef123456', dirty: false },
      vscodeVersion: '1.143.0',
      totalTurns: 2,
      part: null,
      totalParts: null,
      previousPartFile: null,
      nextPartFile: null,
      origin: { saveKind: 'auto', sourceId, sourceSessionId, sourceRevision },
      turns: [
        { type: 'request', participant: 'copilot', prompt: 'Prompt', references: [], timestamp: savedAt },
        { type: 'response', participant: 'copilot', content: 'Response', toolCalls: [], timestamp: savedAt },
      ],
      markdownSummary: '# Chat: Summary',
    }],
    { sourceId, sourceSessionId },
  );
  process.stdout.write(JSON.stringify(fileNames));
})().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
`;

		try {
			const { spawn } = await import('node:child_process');
			const runWorker = (title: string) =>
				new Promise<string[]>((resolve, reject) => {
					const child = spawn(process.execPath, ['-e', workerScript, storageDirectory, sourceId, sourceSessionId, sourceRevision, title], {
						stdio: ['ignore', 'pipe', 'pipe'],
					});
					let stdout = '';
					let stderr = '';
					child.stdout.on('data', (chunk: Buffer | string) => {
						stdout += String(chunk);
					});
					child.stderr.on('data', (chunk: Buffer | string) => {
						stderr += String(chunk);
					});
					child.on('error', reject);
					child.on('close', (code) => {
						if (code !== 0) {
							reject(new Error(`worker exited ${code}: ${stderr || stdout}`));
							return;
						}
						resolve(JSON.parse(stdout) as string[]);
					});
				});

			const [first, second, third] = await Promise.all([
				runWorker('Separate process writer A'),
				runWorker('Separate process writer B'),
				runWorker('Separate process writer C'),
			]);
			assert.deepEqual(second, first);
			assert.deepEqual(third, first);
			assert.equal(first.length, 1);

			const remaining = (await fs.readdir(storageDirectory)).filter((name) => name.endsWith('.json'));
			assert.deepEqual(remaining.sort(), [...first].sort());
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions delayed live lock owner is not stolen across recovery grace', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'cursor-cli';
		const sourceSessionId = 'lock-delay-owner';
		const sourceRevision = 'sha256:lock-delay';
		const createAutoSave = (title: string): ChatSession => ({
			...createSession(sourceSessionId, '2026-10-21T23:57:35.821Z', title),
			provider: 'cursor',
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		let ownerHold!: () => void;
		const holdGate = new Promise<void>((resolve) => {
			ownerHold = resolve;
		});
		let publishCount = 0;
		const slowOwner = createSessionStore({
			autoSaveLockHeartbeatMs: 20,
			autoSaveLockRecoveryGraceMs: 80,
			autoSaveLockRetryMs: 5,
			autoSaveLockMaxAttempts: 40,
			rename: async (fromPath, toPath) => {
				if (fromPath.endsWith('.tmp') || fromPath.includes('.tmp')) {
					publishCount += 1;
					if (publishCount === 1) {
						await holdGate;
					}
				}
				await fs.rename(fromPath, toPath);
			},
		});
		const contender = createSessionStore({
			autoSaveLockHeartbeatMs: 20,
			autoSaveLockRecoveryGraceMs: 80,
			autoSaveLockRetryMs: 5,
			autoSaveLockMaxAttempts: 40,
		});

		try {
			const ownerPromise = slowOwner.upsertAutoSaveSessions(
				storageDirectory,
				[createAutoSave('Delayed live owner')],
				{ sourceId, sourceSessionId },
			);
			await new Promise((resolve) => setTimeout(resolve, 30));
			const contenderPromise = contender.upsertAutoSaveSessions(
				storageDirectory,
				[createAutoSave('Contender waiting on live owner')],
				{ sourceId, sourceSessionId },
			);
			await new Promise((resolve) => setTimeout(resolve, 200));
			ownerHold();
			const [ownerResult, contenderResult] = await Promise.all([ownerPromise, contenderPromise]);
			assert.deepEqual(contenderResult, ownerResult);
			assert.equal(ownerResult.length, 1);
			const remaining = (await fs.readdir(storageDirectory)).filter((name) => name.endsWith('.json'));
			assert.deepEqual(remaining.sort(), [...ownerResult].sort());
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions recovers after abandoned lock bytes stay unchanged', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'cursor-cli';
		const sourceSessionId = 'lock-crash-recovery';
		const sourceRevision = 'sha256:lock-crash';
		await fs.mkdir(storageDirectory, { recursive: true });
		// Plant a crashed-owner lock: opaque bytes that never heartbeat.
		const lockName = (() => {
			const raw = `${sourceId}\0${sourceSessionId}`;
			let hash = 0;
			for (let index = 0; index < raw.length; index += 1) {
				hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
			}
			return `.session-control-autosave-${hash.toString(16)}.lock`;
		})();
		await fs.writeFile(path.join(storageDirectory, lockName), 'crashed-owner\n1\n', 'utf8');

		const store = createSessionStore({
			autoSaveLockHeartbeatMs: 20,
			autoSaveLockRecoveryGraceMs: 40,
			autoSaveLockRetryMs: 5,
			autoSaveLockMaxAttempts: 40,
		});
		const session: ChatSession = {
			...createSession(sourceSessionId, '2026-10-21T23:57:35.821Z', 'Recover after crash'),
			provider: 'cursor',
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		};

		try {
			const fileNames = await store.upsertAutoSaveSessions(storageDirectory, [session], {
				sourceId,
				sourceSessionId,
			});
			assert.equal(fileNames.length, 1);
			const remaining = await fs.readdir(storageDirectory);
			assert.equal(remaining.includes(lockName), false);
			assert.equal(remaining.filter((name) => name.endsWith('.json')).length, 1);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions adopts complete same-revision export and preserves manual plus incomplete multipart leftovers', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'cursor-cli';
		const sourceSessionId = 'provider-session-heal';
		const oldRevision = 'sha256:old';
		const incompleteRevision = 'sha256:incomplete';
		const createAutoSave = (
			title: string,
			savedAt: string,
			sourceRevision: string,
			part: number | null = null,
			totalParts: number | null = null,
			links: { previousPartFile?: string | null; nextPartFile?: string | null } = {},
		): ChatSession => ({
			...createSession(sourceSessionId, savedAt, title),
			provider: 'cursor',
			part,
			totalParts,
			previousPartFile: links.previousPartFile ?? null,
			nextPartFile: links.nextPartFile ?? null,
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		try {
			const seedStore = createSessionStore();
			const preferred = await seedStore.writeSession(
				storageDirectory,
				createAutoSave('Heal title', '2026-10-21T23:57:00.000Z', oldRevision),
				{ includeTimestampInFileName: false },
			);
			// Plant a collision-suffix copy via fs — writeSessionToFile is not on the store API.
			const collisionName = preferred.replace(/\.json$/i, '-deadbeef.json');
			await fs.writeFile(
				path.join(storageDirectory, collisionName),
				JSON.stringify(
					{
						...createAutoSave('Heal title', '2026-10-21T23:57:00.000Z', oldRevision),
						id: 'collision-copy-1',
					},
					null,
					2,
				),
				'utf8',
			);

			const manualFileName = await seedStore.writeSession(storageDirectory, {
				...createSession(sourceSessionId, '2026-10-21T23:56:00.000Z', 'Manual keep'),
				provider: 'cursor',
				origin: {
					saveKind: 'manual',
					sourceId,
					sourceSessionId,
					sourceRevision: 'sha256:manual',
				},
			});
			const manualBefore = await seedStore.readSession(storageDirectory, manualFileName);

			// Complete linked chain for incompleteRevision, plus orphan duplicate
			// part-1 files that cannot reach a part-2 (must not be heal-deleted).
			const completePart1 = 'complete-part-1.json';
			const completePart2 = 'complete-part-2.json';
			const orphanPart1a = 'orphan-part-1a.json';
			const orphanPart1b = 'orphan-part-1b.json';
			await fs.writeFile(
				path.join(storageDirectory, completePart1),
				JSON.stringify(
					createAutoSave('Complete (Part 1/2)', '2026-10-21T23:58:00.000Z', incompleteRevision, 1, 2, {
						nextPartFile: completePart2,
					}),
					null,
					2,
				),
				'utf8',
			);
			await fs.writeFile(
				path.join(storageDirectory, completePart2),
				JSON.stringify(
					createAutoSave('Complete (Part 2/2)', '2026-10-21T23:58:00.000Z', incompleteRevision, 2, 2, {
						previousPartFile: completePart1,
					}),
					null,
					2,
				),
				'utf8',
			);
			await fs.writeFile(
				path.join(storageDirectory, orphanPart1a),
				JSON.stringify(
					createAutoSave('Orphan (Part 1/2)', '2026-10-21T23:58:01.000Z', incompleteRevision, 1, 2, {
						nextPartFile: 'missing-part-2.json',
					}),
					null,
					2,
				),
				'utf8',
			);
			await fs.writeFile(
				path.join(storageDirectory, orphanPart1b),
				JSON.stringify(
					createAutoSave('Orphan duplicate root', '2026-10-21T23:58:02.000Z', incompleteRevision, 1, 2, {
						nextPartFile: 'also-missing-part-2.json',
					}),
					null,
					2,
				),
				'utf8',
			);

			const store = createSessionStore();
			const adopted = await store.upsertAutoSaveSessions(
				storageDirectory,
				[createAutoSave('Heal title', '2026-10-21T23:57:00.000Z', oldRevision)],
				{ sourceId, sourceSessionId },
				{ includeTimestampInFileName: false },
			);
			assert.deepEqual(adopted, [preferred]);

			const adoptedMultipart = await store.upsertAutoSaveSessions(
				storageDirectory,
				[
					createAutoSave('Complete (Part 1/2)', '2026-10-21T23:58:00.000Z', incompleteRevision, 1, 2),
					createAutoSave('Complete (Part 2/2)', '2026-10-21T23:58:00.000Z', incompleteRevision, 2, 2),
				],
				{ sourceId, sourceSessionId },
				{ includeTimestampInFileName: false },
			);
			assert.deepEqual(adoptedMultipart, [completePart1, completePart2]);

			const after = await fs.readdir(storageDirectory);
			assert.equal(after.includes(manualFileName), true);
			assert.deepEqual(await store.readSession(storageDirectory, manualFileName), manualBefore);
			assert.equal(after.includes(orphanPart1a), true);
			assert.equal(after.includes(orphanPart1b), true);
			assert.equal(after.includes(collisionName), true);

			// Missing + valid incoming revisions must reject (no blank filtering).
			await assert.rejects(
				() =>
					store.upsertAutoSaveSessions(
						storageDirectory,
						[
							{
								...createAutoSave('Bad part', '2026-10-21T23:59:00.000Z', 'sha256:mixed', 1, 2),
								origin: {
									saveKind: 'auto',
									sourceId,
									sourceSessionId,
									sourceRevision: '',
								},
							},
							createAutoSave('Good part', '2026-10-21T23:59:00.000Z', 'sha256:mixed', 2, 2),
						],
						{ sourceId, sourceSessionId },
					),
				/sourceRevision/,
			);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('upsertAutoSaveSessions adopts a complete linked multipart set and leaves a duplicate complete chain', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const sourceId = 'cursor-cli';
		const sourceSessionId = 'multipart-adopt';
		const sourceRevision = 'sha256:multipart';
		const store = createSessionStore();

		const part1a = 'multipart-a-1.json';
		const part2a = 'multipart-a-2.json';
		const part1b = 'multipart-b-1.json';
		const part2b = 'multipart-b-2.json';
		const makePart = (
			fileName: string,
			part: number,
			previousPartFile: string | null,
			nextPartFile: string | null,
		): ChatSession => ({
			...createSession(sourceSessionId, '2026-10-21T23:58:00.000Z', `Multipart ${part}/2`),
			provider: 'cursor',
			part,
			totalParts: 2,
			previousPartFile,
			nextPartFile,
			origin: {
				saveKind: 'auto',
				sourceId,
				sourceSessionId,
				sourceRevision,
			},
		});

		try {
			await fs.mkdir(storageDirectory, { recursive: true });
			await fs.writeFile(
				path.join(storageDirectory, part1a),
				JSON.stringify(makePart(part1a, 1, null, part2a), null, 2),
				'utf8',
			);
			await fs.writeFile(
				path.join(storageDirectory, part2a),
				JSON.stringify(makePart(part2a, 2, part1a, null), null, 2),
				'utf8',
			);
			await fs.writeFile(
				path.join(storageDirectory, part1b),
				JSON.stringify(makePart(part1b, 1, null, part2b), null, 2),
				'utf8',
			);
			await fs.writeFile(
				path.join(storageDirectory, part2b),
				JSON.stringify(makePart(part2b, 2, part1b, null), null, 2),
				'utf8',
			);

			const adopted = await store.upsertAutoSaveSessions(
				storageDirectory,
				[makePart('ignored-1.json', 1, null, 'ignored-2.json'), makePart('ignored-2.json', 2, 'ignored-1.json', null)],
				{ sourceId, sourceSessionId },
				{ includeTimestampInFileName: false },
			);
			assert.deepEqual(adopted, [part1a, part2a]);
			const remaining = await fs.readdir(storageDirectory);
			assert.equal(remaining.includes(part1b), true);
			assert.equal(remaining.includes(part2b), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});
