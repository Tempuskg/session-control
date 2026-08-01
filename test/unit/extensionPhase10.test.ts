import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	createSessionProviderPickItems,
	createStorageGitignoreEntry,
	ensureStoragePathInGitignore,
	listSessionsAcrossWorkspaceFolders,
	resolveAutoSaveProviders,
	resolveImplicitSaveProviderForHost,
	resolveSaveProviderForHost,
	runAnalyzeSavedChatsCommand,
	runImplementLatestAnalysisCommand,
	runOpenSavedSessionCommand,
	runResumeSessionFromViewerCommand,
	runViewSessionFileCommand,
	resolveManualWorkspaceFolder,
	validateStoragePath,
} from '../../src/extension';
import { type HandoffSelectionId } from '../../src/handoffDispatcher';
import { ANALYSIS_PROMPT_VERSION } from '../../src/sessionAnalysis';
import { SessionViewerPanel } from '../../src/sessionViewer';
import { createSessionStore } from '../../src/sessionStore';
import { createChatSession } from '../../src/sessionWriter';
import { CopilotSession } from '../../src/sessionReader';
import { AnalysisReportReference } from '../../src/types';

function createWorkspaceFolder(rootPath: string, name: string, index: number): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(rootPath),
		name,
		index,
	} as vscode.WorkspaceFolder;
}

function createCopilotSession(title: string): CopilotSession {
	return {
		provider: 'copilot',
		id: `${title}-id`,
		title,
		lastMessageDate: '2026-04-12T12:05:00.000Z',
		sourceFile: `${title}-source`,
		turns: [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Prompt',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'Response',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
		],
	};
}

function createAnalysisReportReference(overrides: Partial<AnalysisReportReference> = {}): AnalysisReportReference {
	return {
		id: overrides.id ?? 'report-1',
		createdAt: overrides.createdAt ?? '2026-05-17T18:00:00.000Z',
		selection: overrides.selection ?? {
			mode: 'needsAnalysis',
			label: 'Needs Analysis',
			range: null,
		},
		promptVersion: overrides.promptVersion ?? '1',
		reportPath: overrides.reportPath ?? 'analysis/reports/report-1.md',
		contributingWorkspaces: overrides.contributingWorkspaces ?? ['repo'],
		analyzedFingerprints: overrides.analyzedFingerprints ?? ['fingerprint-1'],
		...(overrides.sessionCount === undefined ? {} : { sessionCount: overrides.sessionCount }),
		...(overrides.ownerWorkspaceName === undefined ? {} : { ownerWorkspaceName: overrides.ownerWorkspaceName }),
		...(overrides.repositories === undefined ? {} : { repositories: overrides.repositories }),
		...(overrides.sourceSessions === undefined ? {} : { sourceSessions: overrides.sourceSessions }),
		...(overrides.status === undefined ? {} : { status: overrides.status }),
		...(overrides.warnings === undefined ? {} : { warnings: overrides.warnings }),
	};
}

function createWorkspaceSessionMeta(
	workspaceFolder: vscode.WorkspaceFolder,
	title: string,
	storageDirectory = path.join(workspaceFolder.uri.fsPath, '.chat'),
): Awaited<ReturnType<typeof listSessionsAcrossWorkspaceFolders>>[number] {
	return {
		id: `${title}-id`,
		title,
		savedAt: '2026-05-17T18:00:00.000Z',
		fileName: 'saved.json',
		turnCount: 2,
		git: null,
		label: `[${workspaceFolder.name}] ${title}`,
		description: '2 turns',
		detail: '2026-05-17T18:00:00.000Z | saved.json',
		displayTitle: `[${workspaceFolder.name}] ${title}`,
		storageDirectory,
		workspaceFolder,
	};
}

suite('extension phase 10', () => {
	test('resolveImplicitSaveProviderForHost defaults to Cursor or Codex only inside those hosts', () => {
		assert.equal(resolveImplicitSaveProviderForHost('Cursor'), 'cursor');
		assert.equal(resolveImplicitSaveProviderForHost('Cursor Nightly'), 'cursor');
		assert.equal(resolveImplicitSaveProviderForHost('Codex'), 'codex');
		assert.equal(resolveImplicitSaveProviderForHost('OpenAI Codex'), 'codex');
		assert.equal(resolveImplicitSaveProviderForHost('Claude Code'), 'claude-code');
		assert.equal(resolveImplicitSaveProviderForHost('Visual Studio Code'), 'copilot');
	});

	test('createSessionProviderPickItems replaces Copilot with Cursor inside Cursor hosts', () => {
		const cursorItems = createSessionProviderPickItems('Cursor');
		assert.deepEqual(cursorItems.map((item) => item.provider), ['cursor', 'codex', 'claude-code']);
		assert.equal(cursorItems[0]?.label, 'Cursor');

		const nightlyItems = createSessionProviderPickItems('Cursor Nightly');
		assert.equal(nightlyItems[0]?.provider, 'cursor');
	});

	test('createSessionProviderPickItems offers Copilot outside Cursor hosts', () => {
		for (const appName of ['Visual Studio Code', 'Codex', 'Claude Code']) {
			const items = createSessionProviderPickItems(appName);
			assert.deepEqual(items.map((item) => item.provider), ['copilot', 'codex', 'claude-code']);
			assert.equal(items[0]?.label, 'Copilot');
		}
	});

	test('resolveSaveProviderForHost prefers explicit provider overrides', () => {
		assert.equal(resolveSaveProviderForHost('copilot', 'Cursor'), 'copilot');
		assert.equal(resolveSaveProviderForHost('codex', 'Cursor'), 'codex');
		assert.equal(resolveSaveProviderForHost('claude-code', 'Cursor'), 'claude-code');
		assert.equal(resolveSaveProviderForHost(undefined, 'Cursor'), 'cursor');
		assert.equal(resolveSaveProviderForHost(undefined, 'Codex'), 'codex');
		assert.equal(resolveSaveProviderForHost(undefined, 'Claude Code'), 'claude-code');
		assert.equal(resolveSaveProviderForHost(undefined, 'Visual Studio Code'), 'copilot');
	});

	test('resolveAutoSaveProviders defaults to all saved providers and honors only its own setting', () => {
		assert.deepEqual(
			resolveAutoSaveProviders(undefined),
			['copilot', 'codex', 'claude-code', 'cursor'],
		);
		assert.deepEqual(
			resolveAutoSaveProviders(['cursor', 'codex']),
			['cursor', 'codex'],
		);
		assert.deepEqual(
			resolveAutoSaveProviders(['codex', 'invalid', 'codex']),
			['codex'],
		);
	});

	test('contributes auto-save settings and the diagnostic command', async () => {
		const packageJsonPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
		const manifest = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
			contributes?: {
				commands?: Array<{
					command: string;
					title: string;
					category: string;
				}>;
				configuration?: {
					properties?: Record<string, {
						default?: unknown;
						description?: string;
						scope?: string;
					}>;
				};
				menus?: {
					commandPalette?: Array<{ command: string }>;
				};
			};
		};
		const properties = manifest.contributes?.configuration?.properties;
		const autoSaveProviders = properties?.['session-control.autoSave.providers'];
		const copilotHomePath = properties?.['session-control.copilot.homePath'];
		const manualProvider = properties?.['session-control.save.provider'];

		assert.deepEqual(
			autoSaveProviders?.default,
			['copilot', 'codex', 'claude-code', 'cursor'],
		);
		assert.equal(autoSaveProviders?.scope, 'resource');
		assert.equal(copilotHomePath?.default, '');
		assert.equal(copilotHomePath?.scope, 'resource');
		assert.match(manualProvider?.description ?? '', /does not control auto-save/);
		assert.deepEqual(
			manifest.contributes?.commands?.find(
				(command) => command.command === 'session-control.diagnoseAutoSave',
			),
			{
				command: 'session-control.diagnoseAutoSave',
				title: 'Diagnose Auto-Save',
				category: 'Session Control',
			},
		);
		assert.equal(
			manifest.contributes?.menus?.commandPalette?.some(
				(item) => item.command === 'session-control.diagnoseAutoSave',
			),
			true,
		);
	});

	test('validateStoragePath accepts in-workspace relative paths and rejects invalid ones', () => {
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);

		assert.equal(validateStoragePath(workspaceFolder, '.chat').toLowerCase(), path.resolve('C:/repo', '.chat').toLowerCase());
		assert.throws(() => validateStoragePath(workspaceFolder, '../outside'));
		assert.throws(() => validateStoragePath(workspaceFolder, ''));
		assert.throws(() => validateStoragePath(workspaceFolder, 'C:/absolute'));
	});

	test('resolveManualWorkspaceFolder prefers active editor workspace', async () => {
		const first = createWorkspaceFolder('C:/repo-one', 'one', 0);
		const second = createWorkspaceFolder('C:/repo-two', 'two', 1);
		const activeUri = vscode.Uri.file('C:/repo-two/src/file.ts');

		const resolved = await resolveManualWorkspaceFolder({
			getWorkspaceFolders: () => [first, second],
			getActiveEditorUri: () => activeUri,
			getWorkspaceFolder: (uri) => (uri.fsPath.startsWith(second.uri.fsPath) ? second : first),
			pickWorkspaceFolder: async () => undefined,
		});

		assert.equal(resolved?.name, 'two');
	});

	test('resolveManualWorkspaceFolder prompts when multiple folders are open without an active editor', async () => {
		const first = createWorkspaceFolder('C:/repo-one', 'one', 0);
		const second = createWorkspaceFolder('C:/repo-two', 'two', 1);

		const resolved = await resolveManualWorkspaceFolder({
			getWorkspaceFolders: () => [first, second],
			getActiveEditorUri: () => undefined,
			getWorkspaceFolder: () => undefined,
			pickWorkspaceFolder: async (items) => items[1],
		});

		assert.equal(resolved?.name, 'two');
	});

	test('listSessionsAcrossWorkspaceFolders aggregates saved sessions from all folders', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-phase10-'));
		const store = createSessionStore();

		try {
			const workspaceAPath = path.join(tempRoot, 'workspace-a');
			const workspaceBPath = path.join(tempRoot, 'workspace-b');
			await fs.mkdir(workspaceAPath, { recursive: true });
			await fs.mkdir(workspaceBPath, { recursive: true });

			const workspaceA = createWorkspaceFolder(workspaceAPath, 'alpha', 0);
			const workspaceB = createWorkspaceFolder(workspaceBPath, 'beta', 1);

			await store.writeSession(
				path.join(workspaceAPath, '.chat'),
				createChatSession(createCopilotSession('Alpha Session'), {
					title: 'Alpha Session',
					savedAt: '2026-04-12T13:00:00.000Z',
					vscodeVersion: '1.115.0',
				}),
			);

			await store.writeSession(
				path.join(workspaceBPath, '.chat'),
				createChatSession(createCopilotSession('Beta Session'), {
					title: 'Beta Session',
					savedAt: '2026-04-12T14:00:00.000Z',
					vscodeVersion: '1.115.0',
				}),
			);

			const sessions = await listSessionsAcrossWorkspaceFolders([workspaceA, workspaceB]);

			assert.equal(sessions.length, 2);
			assert.equal(sessions[0]?.label, '[beta] Beta Session');
			assert.equal(sessions[1]?.label, '[alpha] Alpha Session');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('ensureStoragePathInGitignore appends the relative storage path once', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-gitignore-'));

		try {
			const workspaceFolder = createWorkspaceFolder(tempRoot, 'repo', 0);
			const storageDirectory = path.join(tempRoot, '.chat');
			const entry = createStorageGitignoreEntry(workspaceFolder, storageDirectory);

			assert.equal(entry, '.chat/');

			const created = await ensureStoragePathInGitignore(workspaceFolder, storageDirectory);
			const duplicated = await ensureStoragePathInGitignore(workspaceFolder, storageDirectory);
			const gitignore = await fs.readFile(path.join(tempRoot, '.gitignore'), 'utf8');

			assert.equal(created, true);
			assert.equal(duplicated, false);
			assert.equal(gitignore, '.chat/\n');
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('runOpenSavedSessionCommand prompts for a session when no explorer item is provided', async () => {
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
		const opened: Array<{ storageDirectory: string; fileName: string; extensionUri: vscode.Uri }> = [];

		await runOpenSavedSessionCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			undefined,
			{
				getWorkspaceFolders: () => [workspaceFolder],
				listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1', 'C:/repo/.chat')],
				pickSession: async (sessions) => sessions[0],
				readSession: async () => ({ id: 's1' } as ReturnType<typeof createChatSession>),
				showSession: (_session, extensionUri, storageDirectory, fileName) => {
					opened.push({ extensionUri, storageDirectory, fileName });
				},
				showInformationMessage: async () => undefined,
			},
		);

		assert.equal(opened.length, 1);
		assert.equal(opened[0]?.storageDirectory, 'C:/repo/.chat');
		assert.equal(opened[0]?.fileName, 'saved.json');
		assert.equal(opened[0]?.extensionUri.fsPath.toLowerCase(), vscode.Uri.file('C:/extension').fsPath.toLowerCase());
	});

	test('runOpenSavedSessionCommand opens a Session Explorer target directly without prompting', async () => {
		const opened: Array<{ storageDirectory: string; fileName: string; extensionUri: vscode.Uri }> = [];
		let pickerUsed = false;

		await runOpenSavedSessionCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				storageDirectory: 'C:/repo/.chat',
				fileName: 'saved.json',
			},
			{
				listSessionsAcrossWorkspaceFolders: async () => {
					pickerUsed = true;
					return [];
				},
				pickSession: async () => {
					pickerUsed = true;
					return undefined;
				},
				readSession: async () => ({ id: 's1' } as ReturnType<typeof createChatSession>),
				showSession: (_session, extensionUri, storageDirectory, fileName) => {
					opened.push({ extensionUri, storageDirectory, fileName });
				},
				showInformationMessage: async () => undefined,
			},
		);

		assert.equal(pickerUsed, false);
		assert.deepEqual(opened, [{
			storageDirectory: 'C:/repo/.chat',
			fileName: 'saved.json',
			extensionUri: vscode.Uri.file('C:/extension'),
		}]);
	});

	test('runOpenSavedSessionCommand shows guidance when no workspace is open', async () => {
		const infoMessages: string[] = [];

		await runOpenSavedSessionCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			undefined,
			{
				getWorkspaceFolders: () => undefined,
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
			},
		);

		assert.equal(infoMessages.length, 1);
		assert.equal(infoMessages[0], 'Open a workspace folder before opening saved sessions.');
	});

	test('runViewSessionFileCommand opens session viewer for valid session JSON', async () => {
		const session = createChatSession(createCopilotSession('Viewer Session'), {
			title: 'Viewer Session',
			savedAt: '2026-04-13T12:00:00.000Z',
			vscodeVersion: '1.115.0',
		});
		const opened: Array<{ storageDirectory: string; fileName: string; extensionUri: vscode.Uri }> = [];

		await runViewSessionFileCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				getActiveEditor: () => ({
					document: {
						uri: vscode.Uri.file('C:/repo/.chat/viewer-session.json'),
						getText: () => JSON.stringify(session),
					},
				} as unknown as vscode.TextEditor),
				showSession: (_session, extensionUri, storageDirectory, fileName) => {
					opened.push({ extensionUri, storageDirectory, fileName });
				},
				showInformationMessage: async () => undefined,
			},
		);

		assert.equal(opened.length, 1);
		assert.equal(opened[0]?.storageDirectory.toLowerCase(), path.normalize('C:/repo/.chat').toLowerCase());
		assert.equal(opened[0]?.fileName, 'viewer-session.json');
		assert.equal(opened[0]?.extensionUri.fsPath.toLowerCase(), vscode.Uri.file('C:/extension').fsPath.toLowerCase());
	});

	test('runViewSessionFileCommand shows message for invalid JSON', async () => {
		const infoMessages: string[] = [];

		await runViewSessionFileCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				getActiveEditor: () => ({
					document: {
						uri: vscode.Uri.file('C:/repo/.chat/bad.json'),
						getText: () => '{ bad json',
					},
				} as unknown as vscode.TextEditor),
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
			},
		);

		assert.equal(infoMessages[0], 'The active file is not valid JSON.');
	});

	test('runViewSessionFileCommand shows message for non-session JSON', async () => {
		const infoMessages: string[] = [];

		await runViewSessionFileCommand(
			{ extensionUri: vscode.Uri.file('C:/extension') } as vscode.ExtensionContext,
			{
				getActiveEditor: () => ({
					document: {
						uri: vscode.Uri.file('C:/repo/.chat/not-session.json'),
						getText: () => JSON.stringify({ hello: 'world' }),
					},
				} as unknown as vscode.TextEditor),
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
			},
		);

		assert.equal(infoMessages[0], 'This file is not a recognized Session Control session format.');
	});
});

suite('runResumeSessionFromViewerCommand', () => {
	test('shows info message when no session viewer is open', async () => {
		const infoMessages: string[] = [];
		let originalExecuteCommand = vscode.commands.executeCommand;
		const executedCommands: string[] = [];

		// Store original state to restore later
		const originalCurrentPanel = (SessionViewerPanel as any).currentPanel;

		try {
			// Mock vscode.commands.executeCommand temporarily
			(vscode.commands as any).executeCommand = async (...args: unknown[]) => {
				executedCommands.push(String(args[0]));
				return undefined;
			};

			// Ensure no panel is open
			(SessionViewerPanel as any).currentPanel = undefined;

			// Mock window methods
			const originalShowMessage = vscode.window.showInformationMessage;
			(vscode.window as any).showInformationMessage = async (message: string) => {
				infoMessages.push(message);
				return undefined;
			};

			await runResumeSessionFromViewerCommand();

			assert.equal(infoMessages.length, 1);
			assert.equal(infoMessages[0], 'No session viewer is currently open.');
			assert.equal(executedCommands.length, 0, 'No commands should be executed when no viewer is open');

			// Restore
			(vscode.window as any).showInformationMessage = originalShowMessage;
		} finally {
			// Restore original state
			(vscode.commands as any).executeCommand = originalExecuteCommand;
			(SessionViewerPanel as any).currentPanel = originalCurrentPanel;
		}
	});

	test('routes a non-Copilot viewer session directly to the origin agent', async () => {
		const originalCurrentPanel = (SessionViewerPanel as any).currentPanel;
		const originalExecuteCommand = vscode.commands.executeCommand;
		const originalGetCommands = vscode.commands.getCommands;
		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const session = {
			...createChatSession(createCopilotSession('Viewer Codex Session'), {
				title: 'Viewer Codex Session',
				savedAt: '2026-04-13T12:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'codex' as const,
		};
		const executedCommands: string[] = [];
		let clipboardText: string | undefined;

		try {
			(SessionViewerPanel as any).currentPanel = {
				getSessionTitle: () => session.title,
				getSessionProvider: () => session.provider,
				getSession: () => session,
				getFilePath: () => 'C:/repo/.chat/viewer-codex-session.json',
			};
			(vscode.commands as any).getCommands = async () => ['chatgpt.openSidebar', 'chatgpt.sidebarSecondaryView.focus', 'chatgpt.sidebarView.focus', 'workbench.action.chat.open'];
			(vscode.commands as any).executeCommand = async (commandId: string) => {
				executedCommands.push(commandId);
				return undefined;
			};
			(vscode.window as any).showInformationMessage = async () => undefined;

			await runResumeSessionFromViewerCommand({
				writeClipboard: async (text: string) => {
					clipboardText = text;
				},
			});

			assert.deepEqual(executedCommands, [
				'chatgpt.openSidebar',
				'chatgpt.sidebarSecondaryView.focus',
				'editor.action.clipboardPasteAction',
			]);
			assert.equal(clipboardText?.includes('Viewer Codex Session'), false);
			assert.equal(clipboardText?.includes('User follow-up: Continue this session.'), true);
		} finally {
			(SessionViewerPanel as any).currentPanel = originalCurrentPanel;
			(vscode.commands as any).executeCommand = originalExecuteCommand;
			(vscode.commands as any).getCommands = originalGetCommands;
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
		}
	});

	test('routes a Claude Code viewer session to the Claude sidebar tab', async () => {
		const originalCurrentPanel = (SessionViewerPanel as any).currentPanel;
		const originalExecuteCommand = vscode.commands.executeCommand;
		const originalGetCommands = vscode.commands.getCommands;
		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const session = {
			...createChatSession(createCopilotSession('Viewer Claude Session'), {
				title: 'Viewer Claude Session',
				savedAt: '2026-04-13T12:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'claude-code' as const,
		};
		const executedCommands: string[] = [];
		let clipboardText: string | undefined;

		try {
			(SessionViewerPanel as any).currentPanel = {
				getSessionTitle: () => session.title,
				getSessionProvider: () => session.provider,
				getSession: () => session,
				getFilePath: () => 'C:/repo/.chat/viewer-claude-session.json',
			};
			(vscode.commands as any).getCommands = async () => ['claude-vscode.sidebar.open', 'claude-vscode.newConversation', 'claude-vscode.focus', 'claudeVSCodeSidebar.focus', 'workbench.action.chat.open'];
			(vscode.commands as any).executeCommand = async (commandId: string) => {
				executedCommands.push(commandId);
				return undefined;
			};
			(vscode.window as any).showInformationMessage = async () => undefined;

			await runResumeSessionFromViewerCommand({
				writeClipboard: async (text: string) => {
					clipboardText = text;
				},
			});

			assert.deepEqual(executedCommands, [
				'claude-vscode.sidebar.open',
				'claude-vscode.newConversation',
				'claude-vscode.focus',
				'claude-vscode.focus',
				'editor.action.clipboardPasteAction',
			]);
			assert.equal(clipboardText?.includes('Viewer Claude Session'), false);
			assert.equal(clipboardText?.includes('User follow-up: Continue this session.'), true);
		} finally {
			(SessionViewerPanel as any).currentPanel = originalCurrentPanel;
			(vscode.commands as any).executeCommand = originalExecuteCommand;
			(vscode.commands as any).getCommands = originalGetCommands;
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
		}
	});
});

suite('runImplementLatestAnalysisCommand', () => {
	test('shows guidance when no workspace is open', async () => {
		const infoMessages: string[] = [];

		await runImplementLatestAnalysisCommand({
			getWorkspaceFolders: () => undefined,
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(infoMessages, ['Open a workspace folder before implementing from a saved analysis.']);
	});

	test('shows guidance when no saved analysis reports exist', async () => {
		const infoMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);

		await runImplementLatestAnalysisCommand({
			getWorkspaceFolders: () => [workspaceFolder],
			getStoragePath: () => 'C:/repo/.chat',
			readIndex: async () => ({ reports: [] }),
			readReport: async () => '# report',
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(infoMessages, ['No saved analysis reports found. Run Session Control: Analyze Saved Chats or @session-control /analyze first.']);
	});

	test('routes the latest usable saved analysis report through the shared dispatcher', async () => {
		const infoMessages: string[] = [];
		const workspaceA = createWorkspaceFolder('C:/repo-a', 'alpha', 0);
		const workspaceB = createWorkspaceFolder('C:/repo-b', 'beta', 1);
		let dispatchedPrompt: string | undefined;
		let dispatchedTarget: HandoffSelectionId | undefined;
		const model = {
			name: 'GPT-4.1',
			vendor: 'copilot',
			family: 'gpt-4.1',
			id: 'copilot-gpt-4.1',
		} as vscode.LanguageModelChat;

		await runImplementLatestAnalysisCommand({
			getWorkspaceFolders: () => [workspaceA, workspaceB],
			getStoragePath: (workspaceFolder) => path.join(workspaceFolder.uri.fsPath, '.chat'),
			readIndex: async (storageDirectory: string) => {
				if (storageDirectory.toLowerCase().includes('repo-a')) {
					return {
						reports: [createAnalysisReportReference({
							id: 'alpha-report',
							createdAt: '2026-05-17T17:00:00.000Z',
							reportPath: 'analysis/reports/alpha-report.md',
							selection: {
								mode: 'needsAnalysis',
								label: 'Alpha report',
								range: null,
							},
						})],
					};
				}

				return {
					reports: [createAnalysisReportReference({
						id: 'beta-report',
						createdAt: '2026-05-17T18:00:00.000Z',
						reportPath: 'analysis/reports/beta-report.md',
						selection: {
							mode: 'last7Days',
							label: 'Beta report',
							range: {
								start: '2026-05-10T00:00:00.000Z',
								end: '2026-05-17T23:59:59.999Z',
							},
						},
					})],
				};
			},
			readReport: async (storageDirectory: string, reportPath: string) => {
				if (storageDirectory.toLowerCase().includes('repo-b')) {
					throw new Error(`ENOENT ${reportPath}`);
				}

				return '# Chat Analysis Report';
			},
			buildPrompt: (reportFilePath: string) => `IMPLEMENT ${reportFilePath}`,
			selectChatModels: async () => [model],
			getCommands: async () => [],
			pickProvider: async (): Promise<{ kind: 'model'; model: vscode.LanguageModelChat }> => ({ kind: 'model', model }),
			dispatchHandoff: async (prompt, target) => {
				dispatchedPrompt = prompt;
				dispatchedTarget = target;
				return {
					selectedTarget: 'chat',
					deliveredTo: 'chat',
					method: 'prefill',
					instruction: 'Opened Chat with the implementation prompt prefilled. Review it and send it when ready.',
					failures: [],
				};
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(dispatchedTarget, 'chat');
		assert.equal(
			dispatchedPrompt?.toLowerCase(),
			`IMPLEMENT ${path.join('C:/repo-a/.chat', 'analysis/reports/alpha-report.md')}`.toLowerCase(),
		);
		assert.deepEqual(infoMessages, [
			'Opened Chat with the implementation prompt prefilled. Review it and send it when ready. Analysis: Alpha report.',
		]);
	});

	test('routes the selected provider through the shared dispatcher', async () => {
		const infoMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
		let dispatchedTarget: HandoffSelectionId | undefined;
		let dispatchedPrompt: string | undefined;

		await runImplementLatestAnalysisCommand({
			getWorkspaceFolders: () => [workspaceFolder],
			getStoragePath: () => 'C:/repo/.chat',
			readIndex: async () => ({
				reports: [createAnalysisReportReference({
					selection: {
						mode: 'needsAnalysis',
						label: 'Needs Analysis',
						range: null,
					},
				})],
			}),
			readReport: async () => '# Chat Analysis Report',
			buildPrompt: (reportFilePath: string) => `IMPLEMENT ${reportFilePath}`,
			selectChatModels: async () => [],
			getCommands: async () => ['chatgpt.openSidebar'],
			pickProvider: async (): Promise<{ kind: 'agent'; provider: 'codex' }> => ({ kind: 'agent', provider: 'codex' }),
			dispatchHandoff: async (prompt, target) => {
				dispatchedTarget = target;
				dispatchedPrompt = prompt;
				return {
					selectedTarget: 'codex',
					deliveredTo: 'codex',
					method: 'paste',
					instruction: 'Opened Codex and pasted the implementation prompt. Review it and send it when ready.',
					failures: [],
				};
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(dispatchedTarget, 'codex');
		assert.equal(dispatchedPrompt, `IMPLEMENT ${path.join('C:/repo/.chat', 'analysis/reports/report-1.md')}`);
		assert.deepEqual(infoMessages, [
			'Opened Codex and pasted the implementation prompt. Review it and send it when ready. Source analysis workspace: repo.',
		]);
	});
});

suite('runAnalyzeSavedChatsCommand', () => {
	test('shows guidance when no workspace is open', async () => {
		const infoMessages: string[] = [];

		await runAnalyzeSavedChatsCommand('', {
			getWorkspaceFolders: () => undefined,
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(infoMessages, ['Open a workspace folder before analyzing saved chats.']);
	});

	test('warns when no host chat model is available outside Cursor', async () => {
		const warningMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);

		await runAnalyzeSavedChatsCommand('', {
			getWorkspaceFolders: () => [workspaceFolder],
			listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1')],
			resolveSelection: async () => ({
				mode: 'needsAnalysis',
				label: 'Needs Analysis',
				range: null,
			}),
			selectChatModels: async () => [],
			getAppName: () => 'Visual Studio Code',
			runAnalyzeFlow: async () => {
				throw new Error('runAnalyzeFlow should not be called without a model.');
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			openTextDocument: async (uri: vscode.Uri) => ({ uri } as vscode.TextDocument),
			showTextDocument: async (_document: vscode.TextDocument) => ({}) as vscode.TextEditor,
			showInformationMessage: async () => undefined,
			showWarningMessage: async (message: string) => {
				warningMessages.push(message);
				return undefined;
			},
		});

		assert.deepEqual(warningMessages, [
			'No host chat model or installed analysis agent is available. Sign in, enable a chat model, or install Codex/Claude Code, then try again.',
		]);
	});

	test('routes a self-contained analysis handoff through the dispatcher when Cursor has no extension-callable model', async () => {
		const infoMessages: string[] = [];
		const warningMessages: string[] = [];
		let dispatchedPrompt: string | undefined;
		let dispatchedTarget: HandoffSelectionId | undefined;
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-handoff-'));
		const store = createSessionStore();

		try {
			const workspaceFolder = createWorkspaceFolder(tempRoot, 'repo', 0);
			await store.writeSession(
				path.join(tempRoot, '.chat'),
				createChatSession(createCopilotSession('Session 1'), {
					title: 'Session 1',
					savedAt: '2026-05-17T18:00:00.000Z',
					vscodeVersion: '1.115.0',
				}),
			);
			const workspaceSessions = await listSessionsAcrossWorkspaceFolders([workspaceFolder]);
			const savedSession = workspaceSessions[0];
			assert.ok(savedSession);

			await runAnalyzeSavedChatsCommand('', {
				getWorkspaceFolders: () => [workspaceFolder],
				listSessionsAcrossWorkspaceFolders: async () => workspaceSessions,
				resolveSelection: async () => ({
					mode: 'needsAnalysis',
					label: 'Needs Analysis',
					range: null,
					onlyUnanalyzed: true,
				}),
				selectChatModels: async () => [],
				getAppName: () => 'Cursor',
				dispatchHandoff: async (prompt, target) => {
					dispatchedPrompt = prompt;
					dispatchedTarget = target;
					return {
						selectedTarget: 'chat',
						deliveredTo: 'chat',
						method: 'prefill',
						instruction: 'Opened Chat with the analysis handoff prompt prefilled. Review it and send it when ready.',
						failures: [],
					};
				},
				runAnalyzeFlow: async () => {
					throw new Error('runAnalyzeFlow should not be called without a model.');
				},
				withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
				openTextDocument: async (uri: vscode.Uri) => ({ uri } as vscode.TextDocument),
				showTextDocument: async (_document: vscode.TextDocument) => ({}) as vscode.TextEditor,
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
					return undefined;
				},
				showWarningMessage: async (message: string) => {
					warningMessages.push(message);
					return undefined;
				},
			});

			assert.equal(dispatchedTarget, 'chat');
			assert.equal(typeof dispatchedPrompt, 'string');
			const prompt = dispatchedPrompt ?? '';
			assert.equal(prompt.includes('This handoff runs inside the target repository workspace, not inside the Session Control source repository.'), true);
			assert.equal(prompt.includes('Do not search the target repository for Session Control implementation files'), true);
			assert.equal(prompt.includes(`Owner workspace for persisted output: ${workspaceFolder.name}`), true);
			assert.equal(prompt.includes('".chat/analysis/reports"'), true);
			assert.equal(prompt.includes('".chat/analysis/index.json"'), true);
			assert.equal(prompt.includes(`.chat/${savedSession.fileName}`), true);
			assert.equal(prompt.includes(savedSession.title), true);
			assert.equal(prompt.includes(`Use report prompt version \`${ANALYSIS_PROMPT_VERSION}\``), true);
			assert.equal(prompt.includes('"analyzedSessions": ['), true);
			assert.equal(prompt.includes('A `savedAt` change by itself must not change the fingerprint.'), true);
			assert.equal(prompt.includes('src/sessionAnalysis.ts'), false);
			assert.equal(prompt.includes('src/analysisStore.ts'), false);
			assert.equal(prompt.includes('.github/instructions/saved-chat-analysis.instructions.md'), false);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}

		assert.deepEqual(infoMessages, [
			'Cursor does not currently expose extension-callable chat models. Opened Chat with the analysis handoff prompt prefilled. Review it and send it when ready.',
		]);
		assert.deepEqual(warningMessages, []);
	});

	test('routes a selected analysis agent through the shared dispatcher', async () => {
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
		const infoMessages: string[] = [];
		let dispatchedPrompt: string | undefined;
		let dispatchedTarget: HandoffSelectionId | undefined;

		await runAnalyzeSavedChatsCommand('', {
			getWorkspaceFolders: () => [workspaceFolder],
			listSessionsAcrossWorkspaceFolders: async () => [
				createWorkspaceSessionMeta(workspaceFolder, 'Session 1'),
			],
			resolveSelection: async () => ({
				mode: 'needsAnalysis',
				label: 'Needs Analysis',
				range: null,
			}),
			selectChatModels: async () => [],
			getCommands: async () => ['chatgpt.openSidebar'],
			pickAnalysisProvider: async () => ({
				kind: 'agent',
				provider: 'codex',
			}),
			buildAgentHandoffPrompt: async () => ({
				prompt: 'ANALYZE SAVED CHATS',
			}),
			dispatchHandoff: async (prompt, target) => {
				dispatchedPrompt = prompt;
				dispatchedTarget = target;
				return {
					selectedTarget: 'codex',
					deliveredTo: 'codex',
					method: 'paste',
					instruction: 'Opened Codex and pasted the analysis handoff prompt. Review it and send it when ready.',
					failures: [],
				};
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(dispatchedTarget, 'codex');
		assert.equal(dispatchedPrompt, 'ANALYZE SAVED CHATS');
		assert.deepEqual(infoMessages, [
			'Opened Codex and pasted the analysis handoff prompt. Review it and send it when ready.',
		]);
	});

	test('opens the saved analysis report after a successful run', async () => {
		const infoMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
		let openedDocumentPath: string | undefined;
		let shownDocumentPath: string | undefined;

		await runAnalyzeSavedChatsCommand('', {
			getWorkspaceFolders: () => [workspaceFolder],
			listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1')],
			resolveSelection: async () => ({
				mode: 'needsAnalysis',
				label: 'Needs Analysis',
				range: null,
			}),
			selectChatModels: async () => [{} as vscode.LanguageModelChat],
			pickAnalysisProvider: async (models) => {
				const model = models[0];
				return model ? { kind: 'model', model } : undefined;
			},
			runAnalyzeFlow: async (_workspaceFolders, _workspaceSessions, _selection, _model, _token, onStatus) => {
				onStatus('Saved analysis report.');
				return {
					metadata: {
						resultType: 'analysis-report',
						analysisStatus: 'complete',
						analysisReportPath: 'analysis/reports/report-1.md',
						analysisStorageDirectory: 'C:/repo/.chat',
					},
				};
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			openTextDocument: async (uri: vscode.Uri) => {
				openedDocumentPath = uri.fsPath;
				return { uri } as vscode.TextDocument;
			},
			showTextDocument: async (document: vscode.TextDocument) => {
				shownDocumentPath = document.uri.fsPath;
				return {} as vscode.TextEditor;
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		const expectedPath = path.join('C:/repo/.chat', 'analysis/reports/report-1.md');
		assert.equal(openedDocumentPath?.toLowerCase(), expectedPath.toLowerCase());
		assert.equal(shownDocumentPath?.toLowerCase(), expectedPath.toLowerCase());
		assert.deepEqual(infoMessages, [
			'Saved analysis report to analysis/reports/report-1.md. Run Session Control: Implement Latest Analysis to continue.',
		]);
	});

	test('surfaces the last status message when analysis stops without saving a report', async () => {
		const infoMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);

		await runAnalyzeSavedChatsCommand('', {
			getWorkspaceFolders: () => [workspaceFolder],
			listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1')],
			resolveSelection: async () => ({
				mode: 'needsAnalysis',
				label: 'Needs Analysis',
				range: null,
			}),
			selectChatModels: async () => [{} as vscode.LanguageModelChat],
			pickAnalysisProvider: async (models) => {
				const model = models[0];
				return model ? { kind: 'model', model } : undefined;
			},
			runAnalyzeFlow: async (_workspaceFolders, _workspaceSessions, _selection, _model, _token, onStatus) => {
				onStatus('No saved sessions currently need analysis.');
				return undefined;
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			openTextDocument: async (uri: vscode.Uri) => ({ uri } as vscode.TextDocument),
			showTextDocument: async (_document: vscode.TextDocument) => ({}) as vscode.TextEditor,
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(infoMessages, ['No saved sessions currently need analysis.']);
	});
});
