import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	ANALYZE_SESSION_FROM_EXPLORER_COMMAND,
	DEFAULT_SESSION_EXPLORER_SORT_ORDER,
	REANALYZE_SESSION_FROM_EXPLORER_COMMAND,
	SORT_SESSION_EXPLORER_COMMAND,
	createSessionExplorerSortQuickPickItems,
	findAnalyzedEntry,
	findHarvestedEntry,
	isSessionExplorerSortOrder,
	listSessionExplorerGroups,
	readAnalysisIndexForExplorer,
	readHarvestIndexForExplorer,
	registerSessionExplorerAnalysisCommands,
	registerSessionExplorerVisibilityRefresh,
	runSortSessionExplorerCommand,
	sortSessionExplorerSessions,
	SessionExplorerGroup,
	SessionExplorerProvider,
	SessionExplorerSessionItem,
	SessionExplorerWorkspaceItem,
} from '../../src/sessionExplorer';
import { AnalysisIndex, AnalysisIndexEntry, HarvestIndex, HarvestIndexEntry, SessionMeta } from '../../src/types';

interface CommandContribution {
	command: string;
	title: string;
	icon?: string;
}

interface MenuContribution {
	command: string;
	when?: string;
	group?: string;
}

interface PackageManifest {
	contributes: {
		commands: CommandContribution[];
		menus: {
			commandPalette?: MenuContribution[];
			'view/title'?: MenuContribution[];
			'view/item/context'?: MenuContribution[];
		};
	};
}

// Start with a fixed local wall-clock time, then store it as ISO just like a
// real savedAt value. This keeps the assertion portable across runner zones.
const KNOWN_LOCAL_SAVED_AT = new Date(2026, 3, 12, 4, 0, 0, 0).toISOString();
const KNOWN_LOCAL_SAVED_AT_TEXT = '2026-04-12 04:00';

function createWorkspaceFolder(rootPath: string, name: string, index: number): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name,
		index,
	} as vscode.WorkspaceFolder;
}

function createSession(title: string, fileName: string, savedAt: string, id?: string): SessionMeta {
	return {
		id: id ?? `${title}-${savedAt}`,
		title,
		savedAt,
		fileName,
		turnCount: 4,
		git: null,
	};
}

function createAnalyzedEntry(overrides: Partial<AnalysisIndexEntry> = {}): AnalysisIndexEntry {
	return {
		fingerprint: 'fingerprint-1',
		sessionId: 'session-1',
		title: 'Analyzed Session',
		savedAt: '2026-04-12T10:00:00.000Z',
		analyzedAt: '2026-04-13T09:00:00.000Z',
		reportPath: 'analysis/reports/report.md',
		...overrides,
	};
}

function createAnalysisIndex(analyzedSessions: AnalysisIndexEntry[]): AnalysisIndex {
	return {
		version: 1,
		updatedAt: '2026-04-13T09:00:00.000Z',
		reports: [],
		analyzedSessions,
	};
}

function createHarvestedEntry(overrides: Partial<HarvestIndexEntry> = {}): HarvestIndexEntry {
	return {
		sessionId: 'session-1',
		harvestedAt: '2026-04-14T09:00:00.000Z',
		...overrides,
	};
}

function createHarvestIndex(sessions: HarvestIndexEntry[]): HarvestIndex {
	return {
		version: 1,
		sessions,
	};
}

function createGroup(
	workspaceFolder: vscode.WorkspaceFolder,
	sessions: SessionMeta[],
	analyzedSessions: AnalysisIndexEntry[] = [],
): SessionExplorerGroup {
	return {
		workspaceFolder,
		storageDirectory: path.join(workspaceFolder.uri.fsPath, '.chat'),
		sessions,
		analyzedSessions,
		harvestedSessions: [],
	};
}

async function readPackageManifest(): Promise<PackageManifest> {
	const manifestPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
	return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as PackageManifest;
}

async function getSessionItems(provider: SessionExplorerProvider): Promise<SessionExplorerSessionItem[]> {
	const rootNodes = await provider.getChildren();
	const items: SessionExplorerSessionItem[] = [];
	for (const rootNode of rootNodes) {
		const children = await provider.getChildren(rootNode);
		items.push(...(children as SessionExplorerSessionItem[]));
	}
	return items;
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
		assert.equal(workspaceNode.description, '1 session');
		assert.equal(workspaceNode.tooltip, alpha.uri.fsPath);
		assert.equal(workspaceNode.contextValue, 'session-control.workspace');
		assert.equal(workspaceNode.iconPath, vscode.ThemeIcon.Folder);
		const childNodes = await provider.getChildren(workspaceNode);
		assert.equal(childNodes.length, 1);
		assert.equal(childNodes[0] instanceof SessionExplorerSessionItem, true);
		assert.equal(childNodes[0]?.label, 'Alpha Session');
	});

	test('sortSessionExplorerSessions supports date and name directions without mutating sessions', () => {
		const sessions = [
			createSession('Zulu', 'zulu.json', '2026-04-12T10:00:00.000Z'),
			createSession('Alpha 10', 'alpha-10.json', '2026-04-12T12:00:00.000Z'),
			createSession('Alpha 2', 'alpha-2.json', '2026-04-12T11:00:00.000Z'),
		];
		const originalFileNames = sessions.map((session) => session.fileName);

		assert.deepEqual(
			sortSessionExplorerSessions(sessions, 'saved-desc').map((session) => session.fileName),
			['alpha-10.json', 'alpha-2.json', 'zulu.json'],
		);
		assert.deepEqual(
			sortSessionExplorerSessions(sessions, 'saved-asc').map((session) => session.fileName),
			['zulu.json', 'alpha-2.json', 'alpha-10.json'],
		);
		assert.deepEqual(
			sortSessionExplorerSessions(sessions, 'name-asc').map((session) => session.fileName),
			['alpha-2.json', 'alpha-10.json', 'zulu.json'],
		);
		assert.deepEqual(
			sortSessionExplorerSessions(sessions, 'name-desc').map((session) => session.fileName),
			['zulu.json', 'alpha-10.json', 'alpha-2.json'],
		);
		assert.deepEqual(sessions.map((session) => session.fileName), originalFileNames);
	});

	test('SessionExplorerProvider sorts within each workspace and refreshes only when the order changes', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const beta = createWorkspaceFolder('C:/beta', 'beta', 1);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha, beta],
			getStoragePath: (workspaceFolder) => `${workspaceFolder.uri.fsPath}/.chat`,
			listSessions: async (storageDirectory) => storageDirectory.includes('alpha')
				? [
					createSession('Zulu', 'alpha-zulu.json', '2026-04-12T10:00:00.000Z'),
					createSession('Alpha', 'alpha-alpha.json', '2026-04-12T11:00:00.000Z'),
				]
				: [
					createSession('Delta', 'beta-delta.json', '2026-04-12T12:00:00.000Z'),
					createSession('Bravo', 'beta-bravo.json', '2026-04-12T09:00:00.000Z'),
				],
		});
		let refreshCount = 0;
		const subscription = provider.onDidChangeTreeData(() => {
			refreshCount += 1;
		});

		const roots = await provider.getChildren();
		assert.deepEqual(roots.map((root) => root.label), ['alpha', 'beta']);
		assert.equal(provider.currentSortOrder, DEFAULT_SESSION_EXPLORER_SORT_ORDER);
		assert.deepEqual(
			(await provider.getChildren(roots[0])).map((item) => item.label),
			['Alpha', 'Zulu'],
		);
		assert.deepEqual(
			(await provider.getChildren(roots[1])).map((item) => item.label),
			['Delta', 'Bravo'],
		);

		provider.setSortOrder('name-asc');
		provider.setSortOrder('name-asc');
		assert.equal(refreshCount, 1);
		assert.equal(provider.currentSortOrder, 'name-asc');
		assert.deepEqual(
			(await provider.getChildren(roots[0])).map((item) => item.label),
			['Alpha', 'Zulu'],
		);
		assert.deepEqual(
			(await provider.getChildren(roots[1])).map((item) => item.label),
			['Bravo', 'Delta'],
		);
		subscription.dispose();
	});

	test('sort picker marks the current order and the command applies and persists a selection', async () => {
		const items = createSessionExplorerSortQuickPickItems('name-desc');
		assert.deepEqual(items.map((item) => item.label), [
			'Date: Newest First',
			'Date: Oldest First',
			'Session Name: A to Z',
			'Session Name: Z to A',
		]);
		assert.deepEqual(
			items.filter((item) => item.description === 'Current').map((item) => item.sortOrder),
			['name-desc'],
		);

		let sortOrder = DEFAULT_SESSION_EXPLORER_SORT_ORDER;
		let persistedSortOrder: string | undefined;
		await runSortSessionExplorerCommand({
			getSortOrder: () => sortOrder,
			showQuickPick: async (quickPickItems, options) => {
				assert.equal(options.placeHolder, 'Sort saved sessions by');
				assert.equal(quickPickItems[0]?.description, 'Current');
				return quickPickItems.find((item) => item.sortOrder === 'name-asc');
			},
			setSortOrder: (selectedSortOrder) => {
				sortOrder = selectedSortOrder;
			},
			persistSortOrder: async (selectedSortOrder) => {
				persistedSortOrder = selectedSortOrder;
			},
		});

		assert.equal(sortOrder, 'name-asc');
		assert.equal(persistedSortOrder, 'name-asc');
	});

	test('sort command leaves the current order unchanged when the picker is cancelled', async () => {
		let changed = false;
		await runSortSessionExplorerCommand({
			getSortOrder: () => 'saved-desc',
			showQuickPick: async () => undefined,
			setSortOrder: () => {
				changed = true;
			},
			persistSortOrder: async () => {
				changed = true;
			},
		});

		assert.equal(changed, false);
		assert.equal(isSessionExplorerSortOrder('saved-asc'), true);
		assert.equal(isSessionExplorerSortOrder('invalid'), false);
	});

	test('registerSessionExplorerVisibilityRefresh refreshes when the view becomes visible', () => {
		let listener: ((event: { visible: boolean }) => void) | undefined;
		let disposed = false;
		let refreshCount = 0;

		const registration = registerSessionExplorerVisibilityRefresh(
			{
				onDidChangeVisibility: (nextListener) => {
					listener = nextListener;
					return { dispose: () => { disposed = true; } } as vscode.Disposable;
				},
			},
			() => {
				refreshCount += 1;
			},
		);

		assert.notEqual(listener, undefined);
		listener?.({ visible: true });
		assert.equal(refreshCount, 1);

		listener?.({ visible: false });
		assert.equal(refreshCount, 1);

		listener?.({ visible: true });
		assert.equal(refreshCount, 2);

		registration.dispose();
		assert.equal(disposed, true);
	});

	test('session leaf nodes get unique ids even when titles collide', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Same Title', 'first.json', '2026-04-12T10:00:00.000Z'),
				createSession('Same Title', 'second.json', '2026-04-12T11:00:00.000Z'),
			],
		});

		const rootNodes = await provider.getChildren();
		const childNodes = await provider.getChildren(rootNodes[0] as SessionExplorerWorkspaceItem);

		assert.equal(childNodes.length, 2);
		assert.notEqual(childNodes[0]?.id, undefined);
		assert.notEqual(childNodes[0]?.id, childNodes[1]?.id);
	});

	test('inline analysis actions expose state-specific tooltip titles', async () => {
		const manifest = await readPackageManifest();
		const analyzeCommand = manifest.contributes.commands.find(
			(contribution) => contribution.command === ANALYZE_SESSION_FROM_EXPLORER_COMMAND,
		);
		const reanalyzeCommand = manifest.contributes.commands.find(
			(contribution) => contribution.command === REANALYZE_SESSION_FROM_EXPLORER_COMMAND,
		);
		assert.equal(analyzeCommand?.title, 'Analyze This Session');
		assert.equal(reanalyzeCommand?.title, 'Reanalyze This Session');

		const inlineActions = manifest.contributes.menus['view/item/context'] ?? [];
		const analyzeAction = inlineActions.find(
			(contribution) => contribution.command === ANALYZE_SESSION_FROM_EXPLORER_COMMAND,
		);
		const reanalyzeAction = inlineActions.find(
			(contribution) => contribution.command === REANALYZE_SESSION_FROM_EXPLORER_COMMAND,
		);
		assert.equal(
			analyzeAction?.when,
			'view == session-control.sessionExplorer && viewItem == session-control.session',
		);
		assert.equal(
			reanalyzeAction?.when,
			'view == session-control.sessionExplorer && viewItem == session-control.session.analyzed',
		);
		assert.equal(analyzeAction?.group, 'inline@2');
		assert.equal(reanalyzeAction?.group, 'inline@2');

		const commandPalette = manifest.contributes.menus.commandPalette ?? [];
		assert.equal(
			commandPalette.find((contribution) => contribution.command === REANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.when,
			'false',
		);
	});

	test('sort action is contributed to the Saved Sessions toolbar', async () => {
		const manifest = await readPackageManifest();
		const sortCommand = manifest.contributes.commands.find(
			(contribution) => contribution.command === SORT_SESSION_EXPLORER_COMMAND,
		);
		assert.equal(sortCommand?.title, 'Sort Saved Sessions...');
		assert.equal(sortCommand?.icon, '$(list-ordered)');

		const titleActions = manifest.contributes.menus['view/title'] ?? [];
		const refreshAction = titleActions.find(
			(contribution) => contribution.command === 'session-control.refreshSessionExplorer',
		);
		const sortAction = titleActions.find(
			(contribution) => contribution.command === SORT_SESSION_EXPLORER_COMMAND,
		);
		assert.equal(refreshAction?.group, 'navigation@1');
		assert.equal(sortAction?.when, 'view == session-control.sessionExplorer');
		assert.equal(sortAction?.group, 'navigation@2');
	});

	test('inline session actions use compact icons and keep delete rightmost', async () => {
		const manifest = await readPackageManifest();
		const commandById = new Map(
			manifest.contributes.commands.map((contribution) => [contribution.command, contribution]),
		);
		const inlineActions = manifest.contributes.menus['view/item/context'] ?? [];
		const actionById = new Map(
			inlineActions.map((contribution) => [contribution.command, contribution]),
		);

		const openCommand = commandById.get('session-control.openSessionFromExplorer');
		assert.equal(openCommand?.title, 'Open Saved Session');
		assert.equal(openCommand?.icon, '$(open-preview)');
		assert.equal(commandById.get(ANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.icon, '$(search-sparkle)');
		assert.equal(commandById.get(REANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.icon, '$(search-sparkle)');
		assert.equal(commandById.get('session-control-pro.harvestSessionFromExplorer')?.icon, '$(book)');
		assert.equal(commandById.get('session-control.deleteSessionFromExplorer')?.icon, '$(trash)');

		assert.equal(actionById.get('session-control.openSessionFromExplorer')?.group, 'inline@1');
		assert.equal(actionById.get(ANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.group, 'inline@2');
		assert.equal(actionById.get(REANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.group, 'inline@2');
		assert.equal(actionById.get('session-control-pro.harvestSessionFromExplorer')?.group, 'inline@3');
		assert.equal(actionById.get('session-control.deleteSessionFromExplorer')?.group, 'inline@4');

		const sessionActionContext = 'view == session-control.sessionExplorer && viewItem =~ /^session-control\\.session/';
		assert.equal(actionById.get('session-control.openSessionFromExplorer')?.when, sessionActionContext);
		assert.equal(actionById.get('session-control.deleteSessionFromExplorer')?.when, sessionActionContext);

		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const session = createSession('Keyboard Session', 'keyboard.json', '2026-04-12T10:00:00.000Z');
		const item = new SessionExplorerSessionItem(createGroup(alpha, [session]), session);
		assert.equal(item.command?.command, 'session-control.openSessionFromExplorer');
		assert.equal(item.command?.title, 'Open Saved Session');
		assert.equal(item.command?.arguments?.[0], item);
	});

	test('both inline analysis command variants run the shared single-session handler', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const unanalyzedSession = createSession(
			'Unanalyzed Session',
			'unanalyzed.json',
			'2026-04-12T10:00:00.000Z',
			'session-1',
		);
		const analyzedSession = createSession(
			'Analyzed Session',
			'analyzed.json',
			'2026-04-12T11:00:00.000Z',
			'session-2',
		);
		const unanalyzedItem = new SessionExplorerSessionItem(
			createGroup(alpha, [unanalyzedSession]),
			unanalyzedSession,
		);
		const analyzedItem = new SessionExplorerSessionItem(
			createGroup(alpha, [analyzedSession], [
				createAnalyzedEntry({ sessionId: analyzedSession.id }),
			]),
			analyzedSession,
		);
		const handlers = new Map<
			string,
			(item: SessionExplorerSessionItem | undefined) => Promise<void>
		>();
		const handledItems: SessionExplorerSessionItem[] = [];

		const registrations = registerSessionExplorerAnalysisCommands(
			(command, handler) => {
				handlers.set(command, handler);
				return {
					dispose: () => {
						handlers.delete(command);
					},
				};
			},
			async (item) => {
				if (item) {
					handledItems.push(item);
				}
			},
		);

		assert.equal(unanalyzedItem.contextValue, 'session-control.session');
		assert.equal(analyzedItem.contextValue, 'session-control.session.analyzed');
		assert.equal(
			handlers.get(ANALYZE_SESSION_FROM_EXPLORER_COMMAND),
			handlers.get(REANALYZE_SESSION_FROM_EXPLORER_COMMAND),
		);

		await handlers.get(ANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.(unanalyzedItem);
		await handlers.get(REANALYZE_SESSION_FROM_EXPLORER_COMMAND)?.(analyzedItem);
		assert.deepEqual(handledItems, [unanalyzedItem, analyzedItem]);

		for (const registration of registrations) {
			registration.dispose();
		}
	});

	test('analyzed session shows the analyzed indicator and date in the tooltip', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Analyzed Session', 'analyzed.json', KNOWN_LOCAL_SAVED_AT, 'session-1'),
			],
			readAnalysisIndex: async () => createAnalysisIndex([
				createAnalyzedEntry({ sessionId: 'session-1', rootFileName: 'analyzed.json' }),
			]),
		});

		const items = await getSessionItems(provider);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns · analyzed`);
		assert.equal(String(items[0]?.tooltip).includes('Analyzed: 2026-04-13T09:00:00.000Z'), true);
		assert.equal(String(items[0]?.tooltip).includes('Harvested:'), false);
		assert.equal((items[0]?.iconPath as vscode.ThemeIcon).id, 'graph');
		assert.equal(items[0]?.contextValue, 'session-control.session.analyzed');
	});

	test('harvested session shows the harvested badge and date in the tooltip', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Harvested Session', 'harvested.json', KNOWN_LOCAL_SAVED_AT, 'session-1'),
			],
			readAnalysisIndex: async () => null,
			readHarvestIndex: async () => createHarvestIndex([
				createHarvestedEntry({ sessionId: 'session-1' }),
			]),
		});

		const items = await getSessionItems(provider);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns · harvested`);
		assert.equal(String(items[0]?.tooltip).includes('Harvested: 2026-04-14T09:00:00.000Z'), true);
		assert.equal(String(items[0]?.tooltip).includes('Analyzed:'), false);
		assert.equal((items[0]?.iconPath as vscode.ThemeIcon).id, 'book');
	});

	test('analyzed and harvested session shows both badges', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Processed Session', 'processed.json', KNOWN_LOCAL_SAVED_AT, 'session-1'),
			],
			readAnalysisIndex: async () => createAnalysisIndex([
				createAnalyzedEntry({ sessionId: 'session-1' }),
			]),
			readHarvestIndex: async () => createHarvestIndex([
				createHarvestedEntry({ sessionId: 'session-1' }),
			]),
		});

		const items = await getSessionItems(provider);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns · analyzed · harvested`);
		const tooltip = String(items[0]?.tooltip);
		assert.equal(tooltip.includes('Analyzed: 2026-04-13T09:00:00.000Z'), true);
		assert.equal(tooltip.includes('Harvested: 2026-04-14T09:00:00.000Z'), true);
		assert.equal((items[0]?.iconPath as vscode.ThemeIcon).id, 'library');
	});

	test('unanalyzed session renders without an indicator', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Plain Session', 'plain.json', KNOWN_LOCAL_SAVED_AT, 'session-2'),
			],
			readAnalysisIndex: async () => createAnalysisIndex([
				createAnalyzedEntry({ sessionId: 'other-session', rootFileName: 'other.json' }),
			]),
			readHarvestIndex: async () => createHarvestIndex([
				createHarvestedEntry({ sessionId: 'other-session' }),
			]),
		});

		const items = await getSessionItems(provider);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns`);
		assert.equal(items[0]?.tooltip, `${KNOWN_LOCAL_SAVED_AT}\nplain.json`);
		const icon = items[0]?.iconPath as vscode.ThemeIcon;
		assert.equal(icon.id, 'comment-discussion');
		assert.equal(icon.color, undefined);
		assert.equal(items[0]?.contextValue, 'session-control.session');
	});

	test('missing analysis and harvest indexes render the tree without indicators', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Plain Session', 'plain.json', KNOWN_LOCAL_SAVED_AT),
			],
			readAnalysisIndex: async () => null,
			readHarvestIndex: async () => null,
		});

		const items = await getSessionItems(provider);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns`);
	});

	test('multi-part saves sharing a session id are all marked analyzed', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [
				createSession('Split Session', 'split.json', KNOWN_LOCAL_SAVED_AT, 'shared-id'),
				createSession('Split Session', 'split.part2.json', KNOWN_LOCAL_SAVED_AT, 'shared-id'),
			],
			readAnalysisIndex: async () => createAnalysisIndex([
				createAnalyzedEntry({ sessionId: 'shared-id', rootFileName: 'split.json' }),
			]),
			readHarvestIndex: async () => createHarvestIndex([
				createHarvestedEntry({ sessionId: 'shared-id' }),
			]),
		});

		const items = await getSessionItems(provider);
		assert.equal(items.length, 2);
		assert.equal(items[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns · analyzed · harvested`);
		assert.equal(items[1]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns · analyzed · harvested`);
	});

	test('analyzed status is resolved per workspace storage directory', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const beta = createWorkspaceFolder('C:/beta', 'beta', 1);
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha, beta],
			getStoragePath: (workspaceFolder) => `${workspaceFolder.uri.fsPath}/.chat`,
			listSessions: async () => [
				createSession('Shared Session', 'shared.json', KNOWN_LOCAL_SAVED_AT, 'session-1'),
			],
			readAnalysisIndex: async (storageDirectory) => storageDirectory.includes('alpha')
				? createAnalysisIndex([createAnalyzedEntry({ sessionId: 'session-1' })])
				: null,
			readHarvestIndex: async (storageDirectory) => storageDirectory.includes('alpha')
				? createHarvestIndex([createHarvestedEntry({ sessionId: 'session-1' })])
				: null,
		});

		const rootNodes = await provider.getChildren();
		assert.equal(rootNodes.length, 2);

		const alphaItems = await provider.getChildren(rootNodes[0] as SessionExplorerWorkspaceItem);
		const betaItems = await provider.getChildren(rootNodes[1] as SessionExplorerWorkspaceItem);
		assert.equal(alphaItems[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns · analyzed · harvested`);
		assert.equal(betaItems[0]?.description, `${KNOWN_LOCAL_SAVED_AT_TEXT} · 4 turns`);
		assert.equal(alphaItems[0]?.contextValue, 'session-control.session.analyzed');
		assert.equal(betaItems[0]?.contextValue, 'session-control.session');
	});

	test('refresh rereads the analysis index and changes the inline action without recreating the provider', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const session = createSession(
			'Newly Analyzed Session',
			'newly-analyzed.json',
			'2026-04-12T10:00:00.000Z',
			'session-1',
		);
		let analysisIndex: AnalysisIndex | null = null;
		const provider = new SessionExplorerProvider({
			getWorkspaceFolders: () => [alpha],
			getStoragePath: () => 'C:/alpha/.chat',
			listSessions: async () => [session],
			readAnalysisIndex: async () => analysisIndex,
			readHarvestIndex: async () => null,
		});
		let refreshCount = 0;
		const subscription = provider.onDidChangeTreeData(() => {
			refreshCount += 1;
		});

		let items = await getSessionItems(provider);
		assert.equal(items[0]?.contextValue, 'session-control.session');

		analysisIndex = createAnalysisIndex([
			createAnalyzedEntry({ sessionId: session.id, rootFileName: session.fileName }),
		]);
		provider.refresh();

		items = await getSessionItems(provider);
		assert.equal(refreshCount, 1);
		assert.equal(items[0]?.contextValue, 'session-control.session.analyzed');
		subscription.dispose();
	});

	test('analysis action context uses both session-id and root-file-name badge matching rules', () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const byIdSession = createSession(
			'ID Match',
			'id-match.json',
			'2026-04-12T10:00:00.000Z',
			'id-match',
		);
		const byFileSession = createSession(
			'File Match',
			'file-match.json',
			'2026-04-12T11:00:00.000Z',
			'file-match',
		);
		const group = createGroup(alpha, [byIdSession, byFileSession], [
			createAnalyzedEntry({ sessionId: 'id-match', rootFileName: 'different.json' }),
			createAnalyzedEntry({ sessionId: 'different-id', rootFileName: 'file-match.json' }),
		]);

		const byIdItem = new SessionExplorerSessionItem(group, byIdSession);
		const byFileItem = new SessionExplorerSessionItem(group, byFileSession);
		assert.equal(String(byIdItem.description).includes('analyzed'), true);
		assert.equal(String(byFileItem.description).includes('analyzed'), true);
		assert.equal(byIdItem.contextValue, 'session-control.session.analyzed');
		assert.equal(byFileItem.contextValue, 'session-control.session.analyzed');
	});

	test('findAnalyzedEntry matches by session id or root file name and prefers the latest analysis', () => {
		const session = createSession('Session', 'root.json', '2026-04-12T10:00:00.000Z', 'session-1');

		const bySessionId = findAnalyzedEntry(
			[createAnalyzedEntry({ sessionId: 'session-1', rootFileName: 'renamed.json' })],
			session,
		);
		assert.notEqual(bySessionId, undefined);

		const byRootFileName = findAnalyzedEntry(
			[createAnalyzedEntry({ sessionId: 'other-id', rootFileName: 'root.json' })],
			session,
		);
		assert.notEqual(byRootFileName, undefined);

		const noMatch = findAnalyzedEntry(
			[createAnalyzedEntry({ sessionId: 'other-id', rootFileName: 'other.json' })],
			session,
		);
		assert.equal(noMatch, undefined);

		const latest = findAnalyzedEntry(
			[
				createAnalyzedEntry({ sessionId: 'session-1', analyzedAt: '2026-04-13T09:00:00.000Z' }),
				createAnalyzedEntry({ sessionId: 'session-1', analyzedAt: '2026-04-20T09:00:00.000Z' }),
			],
			session,
		);
		assert.equal(latest?.analyzedAt, '2026-04-20T09:00:00.000Z');
	});

	test('findHarvestedEntry matches by session id and prefers the latest harvest', () => {
		const session = createSession('Session', 'root.json', '2026-04-12T10:00:00.000Z', 'session-1');

		const noMatch = findHarvestedEntry([createHarvestedEntry({ sessionId: 'other-id' })], session);
		assert.equal(noMatch, undefined);

		const latest = findHarvestedEntry(
			[
				createHarvestedEntry({ sessionId: 'session-1', harvestedAt: '2026-04-14T09:00:00.000Z' }),
				createHarvestedEntry({ sessionId: 'session-1', harvestedAt: '2026-04-21T09:00:00.000Z' }),
			],
			session,
		);
		assert.equal(latest?.harvestedAt, '2026-04-21T09:00:00.000Z');
	});

	suite('readAnalysisIndexForExplorer', () => {
		async function withTempStorage(run: (storageDirectory: string) => Promise<void>): Promise<void> {
			const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'session-explorer-analysis-'));
			try {
				await run(storageDirectory);
			} finally {
				await fs.rm(storageDirectory, { recursive: true, force: true });
			}
		}

		test('returns null when the analysis directory does not exist', async () => {
			await withTempStorage(async (storageDirectory) => {
				assert.equal(await readAnalysisIndexForExplorer(storageDirectory), null);
			});
		});

		test('returns null for unparseable or schema-invalid index files', async () => {
			await withTempStorage(async (storageDirectory) => {
				const analysisDirectory = path.join(storageDirectory, 'analysis');
				await fs.mkdir(analysisDirectory, { recursive: true });

				await fs.writeFile(path.join(analysisDirectory, 'index.json'), 'not json {', 'utf8');
				assert.equal(await readAnalysisIndexForExplorer(storageDirectory), null);

				await fs.writeFile(path.join(analysisDirectory, 'index.json'), JSON.stringify({ version: 1 }), 'utf8');
				assert.equal(await readAnalysisIndexForExplorer(storageDirectory), null);
			});
		});

		test('returns the parsed index when it is valid', async () => {
			await withTempStorage(async (storageDirectory) => {
				const analysisDirectory = path.join(storageDirectory, 'analysis');
				await fs.mkdir(analysisDirectory, { recursive: true });
				const index = createAnalysisIndex([createAnalyzedEntry()]);
				await fs.writeFile(path.join(analysisDirectory, 'index.json'), JSON.stringify(index), 'utf8');

				const parsed = await readAnalysisIndexForExplorer(storageDirectory);
				assert.equal(parsed?.analyzedSessions.length, 1);
				assert.equal(parsed?.analyzedSessions[0]?.sessionId, 'session-1');
			});
		});

		test('readHarvestIndexForExplorer falls back to null and parses valid indexes', async () => {
			await withTempStorage(async (storageDirectory) => {
				assert.equal(await readHarvestIndexForExplorer(storageDirectory), null);

				const harvestDirectory = path.join(storageDirectory, 'harvest');
				await fs.mkdir(harvestDirectory, { recursive: true });
				const indexPath = path.join(harvestDirectory, 'index.json');

				await fs.writeFile(indexPath, 'not json {', 'utf8');
				assert.equal(await readHarvestIndexForExplorer(storageDirectory), null);

				await fs.writeFile(indexPath, JSON.stringify({ version: 1, sessions: [{ sessionId: 42 }] }), 'utf8');
				assert.equal(await readHarvestIndexForExplorer(storageDirectory), null);

				// Extra Pro-owned fields on entries must be tolerated.
				await fs.writeFile(indexPath, JSON.stringify({
					version: 1,
					updatedAt: '2026-04-14T09:00:00.000Z',
					sessions: [{
						sessionId: 'session-1',
						harvestedAt: '2026-04-14T09:00:00.000Z',
						fingerprint: 'fingerprint-1',
						bundlePath: 'knowledge/index.md',
						backend: 'copilot',
						executionSource: 'extension',
					}],
				}), 'utf8');
				const parsed = await readHarvestIndexForExplorer(storageDirectory);
				assert.equal(parsed?.sessions.length, 1);
				assert.equal(parsed?.sessions[0]?.sessionId, 'session-1');
			});
		});
	});
});
