import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	createStorageGitignoreEntry,
	ensureStoragePathInGitignore,
	listSessionsAcrossWorkspaceFolders,
	runHandoffLatestAnalysisCommand,
	runOpenSavedSessionCommand,
	runResumeSessionFromViewerCommand,
	runViewSessionFileCommand,
	resolveManualWorkspaceFolder,
	validateStoragePath,
} from '../../src/extension';
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

suite('extension phase 10', () => {
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
				listSessionsAcrossWorkspaceFolders: async () => [
					{
						label: '[repo] Session 1',
						description: '2 turns',
						detail: '2026-04-13T00:00:00.000Z | saved.json',
						fileName: 'saved.json',
						storageDirectory: 'C:/repo/.chat',
						workspaceFolder,
					},
				],
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
});

suite('runHandoffLatestAnalysisCommand', () => {
	test('shows guidance when no workspace is open', async () => {
		const infoMessages: string[] = [];

		await runHandoffLatestAnalysisCommand({
			getWorkspaceFolders: () => undefined,
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(infoMessages, ['Open a workspace folder before handing off a saved analysis.']);
	});

	test('shows guidance when no saved analysis reports exist', async () => {
		const infoMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);

		await runHandoffLatestAnalysisCommand({
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

		assert.deepEqual(infoMessages, ['No saved analysis reports found. Run @session-control /analyze first.']);
	});

	test('opens chat with the latest usable saved analysis report', async () => {
		const infoMessages: string[] = [];
		const workspaceA = createWorkspaceFolder('C:/repo-a', 'alpha', 0);
		const workspaceB = createWorkspaceFolder('C:/repo-b', 'beta', 1);
		let openedPrompt: string | undefined;

		await runHandoffLatestAnalysisCommand({
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
			buildPrompt: (reportFilePath: string) => `HANDOFF ${reportFilePath}`,
			getCommands: async () => [],
			pickTarget: async (_agentSessionAvailable: boolean): Promise<'chat'> => 'chat',
			openChat: async (prompt: string) => {
				openedPrompt = prompt;
			},
			openAgentSession: async () => undefined,
			writeClipboard: async () => undefined,
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(
			openedPrompt?.toLowerCase(),
			`HANDOFF ${path.join('C:/repo-a/.chat', 'analysis/reports/alpha-report.md')}`.toLowerCase(),
		);
		assert.deepEqual(infoMessages, ['Opened chat with an implementation handoff prompt for Alpha report.']);
	});

	test('opens an agent session and copies the latest analysis handoff prompt when available', async () => {
		const infoMessages: string[] = [];
		const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
		let openedCommand: string | undefined;
		let clipboardText: string | undefined;

		await runHandoffLatestAnalysisCommand({
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
			buildPrompt: (reportFilePath: string) => `HANDOFF ${reportFilePath}`,
			getCommands: async () => ['github.copilot.cli.newSession'],
			pickTarget: async (_agentSessionAvailable: boolean): Promise<'agentSession'> => 'agentSession',
			openChat: async () => undefined,
			openAgentSession: async (commandId: string) => {
				openedCommand = commandId;
			},
			writeClipboard: async (text: string) => {
				clipboardText = text;
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(openedCommand, 'github.copilot.cli.newSession');
		assert.equal(clipboardText, `HANDOFF ${path.join('C:/repo/.chat', 'analysis/reports/report-1.md')}`);
		assert.deepEqual(infoMessages, [
			'Opened an agent session for the latest analysis handoff from repo. The generated prompt is on the clipboard.',
		]);
	});
});