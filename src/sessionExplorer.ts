import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createSessionStore } from './sessionStore';
import {
	AnalysisIndex,
	AnalysisIndexEntry,
	HarvestIndex,
	HarvestIndexEntry,
	SessionMeta,
	isAnalysisIndex,
	isHarvestIndex,
} from './types';

const sessionStore = createSessionStore();

export const ANALYZE_SESSION_FROM_EXPLORER_COMMAND = 'session-control.analyzeSessionFromExplorer';
export const REANALYZE_SESSION_FROM_EXPLORER_COMMAND = 'session-control.reanalyzeSessionFromExplorer';

function formatSavedAt(savedAt: string): string {
	const date = new Date(savedAt);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

export interface SessionExplorerGroup {
	workspaceFolder: vscode.WorkspaceFolder;
	storageDirectory: string;
	sessions: SessionMeta[];
	analyzedSessions: AnalysisIndexEntry[];
	harvestedSessions: HarvestIndexEntry[];
}

interface SessionExplorerDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	listSessions: (storageDirectory: string) => Promise<SessionMeta[]>;
	readAnalysisIndex: (storageDirectory: string) => Promise<AnalysisIndex | null>;
	readHarvestIndex: (storageDirectory: string) => Promise<HarvestIndex | null>;
}

// Read-only index loading for tree rendering. Unlike the analysis store's
// readIndex this never creates directories and never throws: a missing,
// unreadable, or schema-invalid index renders the tree without status badges
// instead of surfacing an error.
async function readExplorerIndexFile<T>(
	indexPath: string,
	isValid: (value: unknown) => value is T,
): Promise<T | null> {
	try {
		const content = await fs.readFile(indexPath, 'utf8');
		const parsed = JSON.parse(content) as unknown;
		return isValid(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function readAnalysisIndexForExplorer(storageDirectory: string): Promise<AnalysisIndex | null> {
	return readExplorerIndexFile(path.join(storageDirectory, 'analysis', 'index.json'), isAnalysisIndex);
}

// Written by Session Control Pro's knowledge harvest; absent unless Pro has
// harvested sessions in this workspace.
export async function readHarvestIndexForExplorer(storageDirectory: string): Promise<HarvestIndex | null> {
	return readExplorerIndexFile(path.join(storageDirectory, 'harvest', 'index.json'), isHarvestIndex);
}

// Part files of a split session share one session id while the index records
// only the root part's file name, so matching by sessionId keeps every part of
// a multi-part save consistent; rootFileName covers index entries written for
// a session id that has since been re-saved.
export function findAnalyzedEntry(
	entries: readonly AnalysisIndexEntry[],
	session: SessionMeta,
): AnalysisIndexEntry | undefined {
	let latest: AnalysisIndexEntry | undefined;
	for (const entry of entries) {
		if (entry.sessionId !== session.id && entry.rootFileName !== session.fileName) {
			continue;
		}

		if (!latest || Date.parse(entry.analyzedAt) > Date.parse(latest.analyzedAt)) {
			latest = entry;
		}
	}

	return latest;
}

// Harvest entries carry no rootFileName, but part files of a split session
// share one session id, so id matching keeps multi-part saves consistent.
export function findHarvestedEntry(
	entries: readonly HarvestIndexEntry[],
	session: SessionMeta,
): HarvestIndexEntry | undefined {
	let latest: HarvestIndexEntry | undefined;
	for (const entry of entries) {
		if (entry.sessionId !== session.id) {
			continue;
		}

		if (!latest || Date.parse(entry.harvestedAt) > Date.parse(latest.harvestedAt)) {
			latest = entry;
		}
	}

	return latest;
}

export class SessionExplorerWorkspaceItem extends vscode.TreeItem {
	constructor(public readonly group: SessionExplorerGroup) {
		super(group.workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);
		// Explicit, stable id keyed by storage directory. Without an id VS Code
		// derives one from the label, which collides when folder names repeat.
		this.id = `workspace:${group.storageDirectory}`;
		this.description = `${group.sessions.length} session${group.sessions.length === 1 ? '' : 's'}`;
		this.tooltip = group.workspaceFolder.uri.fsPath;
		this.contextValue = 'session-control.workspace';
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
		// Explicit, stable id keyed by the file path so VS Code can track each
		// node individually. Without an id VS Code derives one from the title,
		// so sessions sharing a title (e.g. multi-part saves) collide and a
		// deleted session keeps showing because a sibling node reuses its id.
		this.id = `session:${path.join(group.storageDirectory, session.fileName)}`;
		this.resourceUri = vscode.Uri.file(path.join(group.storageDirectory, session.fileName));
		// Analyzed and harvested are independent statuses, so both are shown as
		// text badges that compose (`analyzed`, `harvested`, or both) — an icon
		// color alone cannot distinguish the combinations.
		const analyzed = findAnalyzedEntry(group.analyzedSessions, session);
		const harvested = findHarvestedEntry(group.harvestedSessions, session);
		const badges = [
			...(analyzed ? ['analyzed'] : []),
			...(harvested ? ['harvested'] : []),
		];
		this.description = [formatSavedAt(session.savedAt), `${session.turnCount} turns`, ...badges].join(' · ');
		const tooltipLines = [session.savedAt, session.fileName];
		if (analyzed) {
			tooltipLines.push(`Analyzed: ${analyzed.analyzedAt}`);
		}
		if (harvested) {
			tooltipLines.push(`Harvested: ${harvested.harvestedAt}`);
		}
		this.tooltip = tooltipLines.join('\n');
		// Each state combination gets its own icon shape so it stays glanceable
		// without relying on color alone; the tint is secondary reinforcement.
		if (analyzed && harvested) {
			this.iconPath = new vscode.ThemeIcon('library', new vscode.ThemeColor('charts.purple'));
		} else if (analyzed) {
			this.iconPath = new vscode.ThemeIcon('graph', new vscode.ThemeColor('charts.green'));
		} else if (harvested) {
			this.iconPath = new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.orange'));
		} else {
			this.iconPath = new vscode.ThemeIcon('comment-discussion');
		}
		this.contextValue = analyzed
			? 'session-control.session.analyzed'
			: 'session-control.session';
		this.command = {
			command: 'session-control.openSessionFromExplorer',
			title: 'Open Saved Session',
			arguments: [this],
		};
	}
}

export type SessionExplorerAnalysisCommandHandler = (
	item: SessionExplorerSessionItem | undefined,
) => Promise<void>;

export function registerSessionExplorerAnalysisCommands(
	registerCommand: (
		command: string,
		handler: SessionExplorerAnalysisCommandHandler,
	) => vscode.Disposable,
	handler: SessionExplorerAnalysisCommandHandler,
): vscode.Disposable[] {
	return [
		registerCommand(ANALYZE_SESSION_FROM_EXPLORER_COMMAND, handler),
		registerCommand(REANALYZE_SESSION_FROM_EXPLORER_COMMAND, handler),
	];
}

export type SessionExplorerNode = SessionExplorerWorkspaceItem | SessionExplorerSessionItem;

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	if (!configured.trim()) {
		throw new Error('session-control.storagePath must not be empty.');
	}

	if (path.isAbsolute(configured)) {
		throw new Error('session-control.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
	const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('session-control.storagePath must stay within the workspace folder.');
	}

	return resolved;
}

function createDefaultDeps(): SessionExplorerDeps {
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getStoragePath,
		listSessions: (storageDirectory: string) => sessionStore.listSessions(storageDirectory),
		readAnalysisIndex: (storageDirectory: string) => readAnalysisIndexForExplorer(storageDirectory),
		readHarvestIndex: (storageDirectory: string) => readHarvestIndexForExplorer(storageDirectory),
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
			const [sessions, analysisIndex, harvestIndex] = await Promise.all([
				deps.listSessions(storageDirectory),
				deps.readAnalysisIndex(storageDirectory),
				deps.readHarvestIndex(storageDirectory),
			]);
			return {
				workspaceFolder,
				storageDirectory,
				sessions,
				analyzedSessions: analysisIndex?.analyzedSessions ?? [],
				harvestedSessions: harvestIndex?.sessions ?? [],
			};
		}),
	);

	return groups.filter((group) => group.sessions.length > 0);
}

export interface SessionExplorerViewLike {
	onDidChangeVisibility(listener: (event: { visible: boolean }) => void): vscode.Disposable;
}

// VS Code keeps a hidden tree view's nodes cached and does not re-query them
// when the view is shown again, so sessions saved while the sidebar was closed
// (e.g. by auto-save) would not appear until some other trigger refreshed the
// tree. Refresh whenever the view becomes visible.
export function registerSessionExplorerVisibilityRefresh(
	view: SessionExplorerViewLike,
	refresh: () => void,
): vscode.Disposable {
	return view.onDidChangeVisibility((event) => {
		if (event.visible) {
			refresh();
		}
	});
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
