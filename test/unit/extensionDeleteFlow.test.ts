import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { runDeleteSessionCommand, runDeleteSessionFromExplorerCommand, WorkspaceSessionMeta } from '../../src/extension';
import { SessionExplorerGroup, SessionExplorerSessionItem } from '../../src/sessionExplorer';
import { SessionMeta } from '../../src/types';

function createWorkspaceFolder(rootPath: string, name: string, index: number): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name,
		index,
	} as vscode.WorkspaceFolder;
}

function createSessionMeta(title: string, fileName: string): SessionMeta {
	return {
		id: `${title}-${fileName}`,
		title,
		savedAt: '2026-04-12T10:00:00.000Z',
		fileName,
		turnCount: 4,
		git: null,
	};
}

function createWorkspaceSessionMeta(workspaceFolder: vscode.WorkspaceFolder): WorkspaceSessionMeta {
	const session = createSessionMeta('Alpha Session', 'alpha.json');
	return {
		...session,
		label: session.title,
		displayTitle: session.title,
		storageDirectory: `${workspaceFolder.uri.fsPath}/.chat`,
		workspaceFolder,
	};
}

function createExplorerItem(workspaceFolder: vscode.WorkspaceFolder): SessionExplorerSessionItem {
	const session = createSessionMeta('Alpha Session', 'alpha.json');
	const group: SessionExplorerGroup = {
		workspaceFolder,
		storageDirectory: `${workspaceFolder.uri.fsPath}/.chat`,
		sessions: [session],
		analyzedSessions: [],
		harvestedSessions: [],
	};
	return new SessionExplorerSessionItem(group, session);
}

suite('extension delete flow', () => {
	test('runDeleteSessionCommand refreshes the explorer after a successful delete, before notifying', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const pick = createWorkspaceSessionMeta(alpha);
		const events: string[] = [];

		await runDeleteSessionCommand({
			getWorkspaceFolders: () => [alpha],
			listSessionsAcrossWorkspaceFolders: async () => [pick],
			pickSession: async (sessions) => sessions[0],
			confirmDelete: async () => true,
			deleteSession: async () => {
				events.push('delete');
				return true;
			},
			refreshSessionExplorer: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message) => {
				events.push(`info:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(events, ['delete', 'refresh', 'info:Deleted session Alpha Session']);
	});

	test('runDeleteSessionCommand refreshes the explorer when the file is already gone', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const pick = createWorkspaceSessionMeta(alpha);
		const events: string[] = [];

		await runDeleteSessionCommand({
			getWorkspaceFolders: () => [alpha],
			listSessionsAcrossWorkspaceFolders: async () => [pick],
			pickSession: async (sessions) => sessions[0],
			confirmDelete: async () => true,
			deleteSession: async () => {
				events.push('delete');
				return false;
			},
			refreshSessionExplorer: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message) => {
				events.push(`info:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(events, ['delete', 'refresh', 'info:Session file no longer exists.']);
	});

	test('runDeleteSessionCommand does not delete or refresh when the confirmation is cancelled', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const pick = createWorkspaceSessionMeta(alpha);
		const events: string[] = [];

		await runDeleteSessionCommand({
			getWorkspaceFolders: () => [alpha],
			listSessionsAcrossWorkspaceFolders: async () => [pick],
			pickSession: async (sessions) => sessions[0],
			confirmDelete: async () => false,
			deleteSession: async () => {
				events.push('delete');
				return true;
			},
			refreshSessionExplorer: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message) => {
				events.push(`info:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(events, []);
	});

	test('runDeleteSessionFromExplorerCommand refreshes the explorer after a successful delete, before notifying', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const events: string[] = [];

		await runDeleteSessionFromExplorerCommand(item, {
			confirmDelete: async (label) => {
				events.push(`confirm:${label}`);
				return true;
			},
			deleteSession: async (storageDirectory, fileName) => {
				events.push(`delete:${storageDirectory}:${fileName}`);
				return true;
			},
			refreshSessionExplorer: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message) => {
				events.push(`info:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(events, [
			'confirm:Alpha Session',
			`delete:${item.storageDirectory}:alpha.json`,
			'refresh',
			'info:Deleted session Alpha Session',
		]);
	});

	test('runDeleteSessionFromExplorerCommand refreshes the explorer when the file is already gone', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const events: string[] = [];

		await runDeleteSessionFromExplorerCommand(item, {
			confirmDelete: async () => true,
			deleteSession: async () => {
				events.push('delete');
				return false;
			},
			refreshSessionExplorer: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message) => {
				events.push(`info:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(events, ['delete', 'refresh', 'info:Session file no longer exists.']);
	});

	test('runDeleteSessionFromExplorerCommand does not delete or refresh when the confirmation is cancelled', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const events: string[] = [];

		await runDeleteSessionFromExplorerCommand(item, {
			confirmDelete: async () => false,
			deleteSession: async () => {
				events.push('delete');
				return true;
			},
			refreshSessionExplorer: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message) => {
				events.push(`info:${message}`);
				return undefined;
			},
		});

		assert.deepEqual(events, []);
	});
});
