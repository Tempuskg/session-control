import * as path from 'node:path';
import * as vscode from 'vscode';
import { createSessionStore } from './sessionStore';
import { SessionMeta } from './types';

const sessionStore = createSessionStore();

export interface SessionExplorerGroup {
	workspaceFolder: vscode.WorkspaceFolder;
	storageDirectory: string;
	sessions: SessionMeta[];
}

interface SessionExplorerDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	listSessions: (storageDirectory: string) => Promise<SessionMeta[]>;
}

export class SessionExplorerWorkspaceItem extends vscode.TreeItem {
	constructor(public readonly group: SessionExplorerGroup) {
		super(group.workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${group.sessions.length} session${group.sessions.length === 1 ? '' : 's'}`;
		this.tooltip = group.workspaceFolder.uri.fsPath;
		this.contextValue = 'chat-commit.workspace';
		this.iconPath = vscode.ThemeIcon.Folder;
	}
}

export class SessionExplorerSessionItem extends vscode.TreeItem {
	readonly fileName: string;
	readonly storageDirectory: string;
	readonly workspaceFolder: vscode.WorkspaceFolder;

	constructor(group: SessionExplorerGroup, public readonly session: SessionMeta) {
		super(session.title, vscode.TreeItemCollapsibleState.None);
		this.fileName = session.fileName;
		this.storageDirectory = group.storageDirectory;
		this.workspaceFolder = group.workspaceFolder;
		this.resourceUri = vscode.Uri.file(path.join(group.storageDirectory, session.fileName));
		this.description = `${session.turnCount} turns`;
		this.tooltip = `${session.savedAt}\n${session.fileName}`;
		this.contextValue = 'chat-commit.session';
		this.iconPath = new vscode.ThemeIcon('comment-discussion');
		this.command = {
			command: 'chat-commit.openSessionFromExplorer',
			title: 'Open Saved Session',
			arguments: [this],
		};
	}
}

export type SessionExplorerNode = SessionExplorerWorkspaceItem | SessionExplorerSessionItem;

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('chat-commit', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	if (!configured.trim()) {
		throw new Error('chat-commit.storagePath must not be empty.');
	}

	if (path.isAbsolute(configured)) {
		throw new Error('chat-commit.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
	const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('chat-commit.storagePath must stay within the workspace folder.');
	}

	return resolved;
}

function createDefaultDeps(): SessionExplorerDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getStoragePath,
		listSessions: (storageDirectory: string) => sessionStore.listSessions(storageDirectory),
	};
}

export async function listSessionExplorerGroups(
	depsOverrides: Partial<SessionExplorerDeps> = {},
): Promise<SessionExplorerGroup[]> {
	const deps = {
		...createDefaultDeps(),
		...depsOverrides,
	};

	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		return [];
	}

	const groups = await Promise.all(
		workspaceFolders.map(async (workspaceFolder) => {
			const storageDirectory = deps.getStoragePath(workspaceFolder);
			const sessions = await deps.listSessions(storageDirectory);
			return {
				workspaceFolder,
				storageDirectory,
				sessions,
			};
		}),
	);

	return groups.filter((group) => group.sessions.length > 0);
}

export class SessionExplorerProvider implements vscode.TreeDataProvider<SessionExplorerNode> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SessionExplorerNode | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(private readonly depsOverrides: Partial<SessionExplorerDeps> = {}) {}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: SessionExplorerNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: SessionExplorerNode): Promise<SessionExplorerNode[]> {
		if (!element) {
			const groups = await listSessionExplorerGroups(this.depsOverrides);
			return groups.map((group) => new SessionExplorerWorkspaceItem(group));
		}

		if (element instanceof SessionExplorerWorkspaceItem) {
			return element.group.sessions.map((session) => new SessionExplorerSessionItem(element.group, session));
		}

		return [];
	}
}