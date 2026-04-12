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
			assert.equal(files.some((file) => file.endsWith('.tmp')), false);
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
			assert.equal(remaining.some((session) => session.id === 'a'), false);
			assert.equal(archivedEntries.some((entry) => entry.endsWith('.json')), true);
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
});
