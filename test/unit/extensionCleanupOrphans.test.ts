import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { runCleanupOrphanedPartsCommand } from '../../src/extension';
import { OrphanedPartFile } from '../../src/sessionStore';

function makeWorkspaceFolder(name: string): vscode.WorkspaceFolder {
	return {
		name,
		uri: vscode.Uri.file(`e:/${name}`),
		index: 0,
	} as vscode.WorkspaceFolder;
}

function makeOrphan(overrides: Partial<OrphanedPartFile> & Pick<OrphanedPartFile, 'fileName'>): OrphanedPartFile {
	return {
		sessionId: 'session-1',
		title: 'Session (Part 2/2)',
		savedAt: '2026-07-04T11:00:00.000Z',
		danglingLink: 'deleted-part-1.json',
		superseded: true,
		...overrides,
	};
}

suite('extension cleanup orphaned parts', () => {
	test('shows guidance when no workspace is open', async () => {
		const messages: string[] = [];

		await runCleanupOrphanedPartsCommand({
			getWorkspaceFolders: () => undefined,
			showInformationMessage: async (message: string) => {
				messages.push(message);
				return undefined;
			},
		});

		assert.equal(messages.some((message) => message.includes('Open a workspace folder')), true);
	});

	test('reports when no orphaned part files exist', async () => {
		const messages: string[] = [];

		await runCleanupOrphanedPartsCommand({
			getWorkspaceFolders: () => [makeWorkspaceFolder('alpha')],
			getStoragePath: () => 'e:/alpha/.chat',
			findOrphanedPartFiles: async () => [],
			confirmCleanup: async () => {
				throw new Error('Must not prompt when there is nothing to remove');
			},
			showInformationMessage: async (message: string) => {
				messages.push(message);
				return undefined;
			},
		});

		assert.equal(messages.some((message) => message.includes('No orphaned session part files found')), true);
	});

	test('deletes superseded orphans after confirmation and refreshes before notifying', async () => {
		const deleted: Array<{ storageDirectory: string; fileName: string }> = [];
		const events: string[] = [];
		let confirmArgs: { fileCount: number; sessionCount: number } | undefined;

		await runCleanupOrphanedPartsCommand({
			getWorkspaceFolders: () => [makeWorkspaceFolder('alpha')],
			getStoragePath: () => 'e:/alpha/.chat',
			findOrphanedPartFiles: async () => [
				makeOrphan({ fileName: 'stale-a.json' }),
				makeOrphan({ fileName: 'stale-b.json', sessionId: 'session-2' }),
				makeOrphan({ fileName: 'keep-me.json', sessionId: 'session-3', superseded: false }),
			],
			confirmCleanup: async (fileCount, sessionCount) => {
				confirmArgs = { fileCount, sessionCount };
				return true;
			},
			deleteSession: async (storageDirectory, fileName) => {
				deleted.push({ storageDirectory, fileName });
				return true;
			},
			refreshSessionExplorer: () => events.push('refresh'),
			showInformationMessage: async (message: string) => {
				events.push(`message:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(confirmArgs, { fileCount: 2, sessionCount: 2 });
		assert.deepEqual(deleted.map((entry) => entry.fileName), ['stale-a.json', 'stale-b.json']);
		assert.equal(events[0], 'refresh');
		assert.equal(events[1]?.includes('Deleted 2 orphaned session part file(s)'), true);
		assert.equal(events[1]?.includes('1 file(s) with broken links were kept'), true);
	});

	test('does not delete anything when the confirmation is cancelled', async () => {
		const deleted: string[] = [];

		await runCleanupOrphanedPartsCommand({
			getWorkspaceFolders: () => [makeWorkspaceFolder('alpha')],
			getStoragePath: () => 'e:/alpha/.chat',
			findOrphanedPartFiles: async () => [makeOrphan({ fileName: 'stale-a.json' })],
			confirmCleanup: async () => false,
			deleteSession: async (_storageDirectory, fileName) => {
				deleted.push(fileName);
				return true;
			},
			showInformationMessage: async () => undefined,
		});

		assert.deepEqual(deleted, []);
	});

	test('keeps unsuperseded broken files and explains why nothing was removed', async () => {
		const messages: string[] = [];
		const deleted: string[] = [];

		await runCleanupOrphanedPartsCommand({
			getWorkspaceFolders: () => [makeWorkspaceFolder('alpha')],
			getStoragePath: () => 'e:/alpha/.chat',
			findOrphanedPartFiles: async () => [
				makeOrphan({ fileName: 'only-copy.json', superseded: false }),
			],
			confirmCleanup: async () => {
				throw new Error('Must not prompt when nothing is safely removable');
			},
			deleteSession: async (_storageDirectory, fileName) => {
				deleted.push(fileName);
				return true;
			},
			showInformationMessage: async (message: string) => {
				messages.push(message);
				return undefined;
			},
		});

		assert.deepEqual(deleted, []);
		assert.equal(messages.some((message) => message.includes('no newer intact copy')), true);
	});
});
