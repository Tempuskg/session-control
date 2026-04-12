import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	listSessionExplorerGroups,
	SessionExplorerProvider,
	SessionExplorerSessionItem,
	SessionExplorerWorkspaceItem,
} from '../../src/sessionExplorer';
import { SessionMeta } from '../../src/types';

function createWorkspaceFolder(rootPath: string, name: string, index: number): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name,
		index,
	} as vscode.WorkspaceFolder;
}

function createSession(title: string, fileName: string, savedAt: string): SessionMeta {
	return {
		id: `${title}-${savedAt}`,
		title,
		savedAt,
		fileName,
		turnCount: 4,
		git: null,
	};
}

suite('session explorer', () => {
	test('listSessionExplorerGroups returns only workspaces with sessions', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const beta = createWorkspaceFolder('C:/beta', 'beta', 1);

		const groups = await listSessionExplorerGroups({
			getWorkspaceFolders: () => [alpha, beta],
			getStoragePath: (workspaceFolder) => `${workspaceFolder.uri.fsPath}/.chat`,
			listSessions: async (storageDirectory) => storageDirectory.includes('alpha')
				? [createSession('Alpha Session', 'alpha.json', '2026-04-12T10:00:00.000Z')]
				: [],
		});

		assert.equal(groups.length, 1);
		assert.equal(groups[0]?.workspaceFolder.name, 'alpha');
		assert.equal(groups[0]?.sessions[0]?.title, 'Alpha Session');
	});

	test('SessionExplorerProvider returns workspace nodes and session leaf nodes', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Alpha Session', 'alpha.json', '2026-04-12T10:00:00.000Z'),
			],
		});

		const rootNodes = await provider.getChildren();
		assert.equal(rootNodes.length, 1);
		assert.equal(rootNodes[0] instanceof SessionExplorerWorkspaceItem, true);

		const workspaceNode = rootNodes[0] as SessionExplorerWorkspaceItem;
		const childNodes = await provider.getChildren(workspaceNode);
		assert.equal(childNodes.length, 1);
		assert.equal(childNodes[0] instanceof SessionExplorerSessionItem, true);
		assert.equal(childNodes[0]?.label, 'Alpha Session');
	});
});