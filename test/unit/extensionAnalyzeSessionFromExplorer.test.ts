import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAnalysisStore, createSessionAnalysisFingerprint } from '../../src/analysisStore';
import { createAnalyzeSessionsFlowDeps, runAnalyzeSessionsFlow } from '../../src/chatParticipant';
import { runAnalyzeSessionFromExplorerCommand, WorkspaceSessionMeta } from '../../src/extension';
import { SessionExplorerGroup, SessionExplorerSessionItem } from '../../src/sessionExplorer';
import { CopilotSession } from '../../src/sessionReader';
import { createSessionStore } from '../../src/sessionStore';
import { createChatSession } from '../../src/sessionWriter';
import { AnalysisSelection, SessionMeta } from '../../src/types';

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

function createCopilotSource(title: string): CopilotSession {
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
				prompt: `Prompt for ${title}`,
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: `Response for ${title}`,
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
		],
	};
}

function createExplorerItem(workspaceFolder: vscode.WorkspaceFolder): SessionExplorerSessionItem {
	const session = createSessionMeta('Alpha Session', 'alpha.json');
	const group: SessionExplorerGroup = {
		workspaceFolder,
		storageDirectory: path.join(workspaceFolder.uri.fsPath, '.chat'),
		sessions: [session],
		analyzedSessions: [],
		harvestedSessions: [],
	};
	return new SessionExplorerSessionItem(group, session);
}

suite('runAnalyzeSessionFromExplorerCommand', () => {
	test('analyzes only the clicked session with a single-session selection and refreshes on success', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const events: string[] = [];
		let flowSessions: WorkspaceSessionMeta[] | undefined;
		let flowSelection: AnalysisSelection | undefined;

		await runAnalyzeSessionFromExplorerCommand(item, {
			getWorkspaceFolders: () => [alpha],
			selectChatModels: async () => [{} as vscode.LanguageModelChat],
			getCommands: async () => [],
			pickAnalysisProvider: async (models) => {
				const model = models[0];
				return model ? { kind: 'model', model } : undefined;
			},
			runAnalyzeFlow: async (_workspaceFolders, workspaceSessions, selection) => {
				flowSessions = workspaceSessions;
				flowSelection = selection;
				events.push('analyze');
				return {
					metadata: {
						resultType: 'analysis-report',
						analysisStatus: 'complete',
						analysisReportPath: 'analysis/reports/report-1.md',
						analysisStorageDirectory: item.storageDirectory,
					},
				};
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			openTextDocument: async (uri: vscode.Uri) => ({ uri } as vscode.TextDocument),
			showTextDocument: async (_document: vscode.TextDocument) => ({}) as vscode.TextEditor,
			onReportSaved: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message: string) => {
				events.push(`info:${message}`);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(flowSessions?.length, 1);
		assert.equal(flowSessions?.[0]?.id, item.session.id);
		assert.equal(flowSessions?.[0]?.fileName, 'alpha.json');
		assert.equal(flowSessions?.[0]?.storageDirectory, item.storageDirectory);
		assert.equal(flowSessions?.[0]?.workspaceFolder, alpha);
		assert.equal(flowSelection?.mode, 'singleSession');
		assert.equal(flowSelection?.sessionId, item.session.id);
		assert.equal(flowSelection?.label, 'Session: Alpha Session');
		assert.deepEqual(events, [
			'analyze',
			'refresh',
			'info:Saved analysis report to analysis/reports/report-1.md. Run Session Control: Implement Latest Analysis to continue.',
		]);
	});

	test('persists an index entry and report metadata for exactly the clicked session', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analyze-one-'));
		const store = createSessionStore();
		const analysisStore = createAnalysisStore();
		const storageDirectory = path.join(tempRoot, '.chat');

		try {
			const workspaceFolder = createWorkspaceFolder(tempRoot, 'repo', 0);
			await store.writeSession(storageDirectory, createChatSession(createCopilotSource('Target Session'), {
				title: 'Target Session',
				vscodeVersion: '1.115.0',
			}));
			await store.writeSession(storageDirectory, createChatSession(createCopilotSource('Other Session'), {
				title: 'Other Session',
				vscodeVersion: '1.115.0',
			}));

			const sessions = await store.listSessions(storageDirectory);
			const targetMeta = sessions.find((session) => session.title === 'Target Session');
			assert.ok(targetMeta);
			const group: SessionExplorerGroup = {
				workspaceFolder,
				storageDirectory,
				sessions,
				analyzedSessions: [],
				harvestedSessions: [],
			};
			const item = new SessionExplorerSessionItem(group, targetMeta);

			await runAnalyzeSessionFromExplorerCommand(item, {
				getWorkspaceFolders: () => [workspaceFolder],
				selectChatModels: async () => [{} as vscode.LanguageModelChat],
				getCommands: async () => [],
				pickAnalysisProvider: async (models) => {
					const model = models[0];
					return model ? { kind: 'model', model } : undefined;
				},
				// Mirrors the production runAnalyzeFlow wiring, with the model call
				// stubbed and the owner workspace pinned to the temp folder so the
				// report and index are written to real files under it.
				runAnalyzeFlow: async (workspaceFolders, workspaceSessions, selection, _model, _token, onStatus) =>
					runAnalyzeSessionsFlow('', workspaceFolders, workspaceSessions, createAnalyzeSessionsFlowDeps({
						resolveSelection: async () => selection,
						runModelPrompt: async () => '## Findings\n\nSingle session report',
						streamMarkdown: (markdown: string) => onStatus(markdown),
						pickOwnerWorkspace: (folders) => folders[0],
						getStoragePath: () => storageDirectory,
					})),
				withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
				openTextDocument: async (uri: vscode.Uri) => ({ uri } as vscode.TextDocument),
				showTextDocument: async (_document: vscode.TextDocument) => ({}) as vscode.TextEditor,
				showInformationMessage: async () => undefined,
				showWarningMessage: async () => undefined,
			});

			const targetSession = await store.readSession(storageDirectory, targetMeta.fileName);
			const expectedFingerprint = createSessionAnalysisFingerprint(targetSession);
			const index = await analysisStore.readIndex(storageDirectory);

			assert.equal(index.reports.length, 1);
			const report = index.reports[0];
			assert.equal(report?.selection.mode, 'singleSession');
			assert.equal(report?.selection.label, 'Session: Target Session');
			assert.equal(report?.sessionCount, 1);
			assert.deepEqual(report?.analyzedFingerprints, [expectedFingerprint]);
			assert.equal(report?.sourceSessions?.length, 1);
			assert.equal(report?.sourceSessions?.[0]?.sessionId, targetMeta.id);
			assert.equal(index.analyzedSessions.length, 1);
			assert.equal(index.analyzedSessions[0]?.fingerprint, expectedFingerprint);
			assert.equal(index.analyzedSessions[0]?.sessionId, targetMeta.id);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('routes an agent provider through the handoff with only the clicked session', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const infoMessages: string[] = [];
		let handoffSessions: WorkspaceSessionMeta[] | undefined;
		let handoffSelection: AnalysisSelection | undefined;
		let dispatchedTarget: string | undefined;

		await runAnalyzeSessionFromExplorerCommand(item, {
			getWorkspaceFolders: () => [alpha],
			selectChatModels: async () => [],
			getCommands: async () => ['chatgpt.openSidebar'],
			pickAnalysisProvider: async () => ({ kind: 'agent', provider: 'codex' }),
			buildAgentHandoffPrompt: async (_workspaceFolders, workspaceSessions, selection) => {
				handoffSessions = workspaceSessions;
				handoffSelection = selection;
				return { prompt: 'ANALYZE ONE SESSION' };
			},
			dispatchHandoff: async (_prompt, target) => {
				dispatchedTarget = target;
				return {
					selectedTarget: 'codex',
					deliveredTo: 'codex',
					method: 'paste',
					instruction: 'Opened Codex and pasted the analysis handoff prompt. Review it and send it when ready.',
					failures: [],
				};
			},
			runAnalyzeFlow: async () => {
				throw new Error('runAnalyzeFlow should not be called for an agent handoff.');
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.equal(handoffSessions?.length, 1);
		assert.equal(handoffSessions?.[0]?.id, item.session.id);
		assert.equal(handoffSelection?.mode, 'singleSession');
		assert.equal(handoffSelection?.sessionId, item.session.id);
		assert.equal(dispatchedTarget, 'codex');
		assert.deepEqual(infoMessages, [
			'Opened Codex and pasted the analysis handoff prompt. Review it and send it when ready.',
		]);
	});

	test('does not refresh the explorer when analysis stops without saving a report', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const events: string[] = [];

		await runAnalyzeSessionFromExplorerCommand(item, {
			getWorkspaceFolders: () => [alpha],
			selectChatModels: async () => [{} as vscode.LanguageModelChat],
			getCommands: async () => [],
			pickAnalysisProvider: async (models) => {
				const model = models[0];
				return model ? { kind: 'model', model } : undefined;
			},
			runAnalyzeFlow: async (_workspaceFolders, _workspaceSessions, _selection, _model, _token, onStatus) => {
				onStatus('No usable saved sessions found. Some saved sessions could not be read.');
				return undefined;
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			openTextDocument: async (uri: vscode.Uri) => ({ uri } as vscode.TextDocument),
			showTextDocument: async (_document: vscode.TextDocument) => ({}) as vscode.TextEditor,
			onReportSaved: () => {
				events.push('refresh');
			},
			showInformationMessage: async (message: string) => {
				events.push(`info:${message}`);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(events, ['info:No usable saved sessions found. Some saved sessions could not be read.']);
	});

	test('shows guidance when invoked without a tree item', async () => {
		const infoMessages: string[] = [];
		const events: string[] = [];

		await runAnalyzeSessionFromExplorerCommand(undefined, {
			getWorkspaceFolders: () => {
				events.push('workspace-folders');
				return [];
			},
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
		});

		assert.deepEqual(infoMessages, ['Select a saved session in the Session Control explorer to analyze it.']);
		assert.deepEqual(events, []);
	});

	test('shows guidance when no workspace folder is open', async () => {
		const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
		const item = createExplorerItem(alpha);
		const infoMessages: string[] = [];

		await runAnalyzeSessionFromExplorerCommand(item, {
			getWorkspaceFolders: () => undefined,
			showInformationMessage: async (message: string) => {
				infoMessages.push(message);
				return undefined;
			},
			showWarningMessage: async () => undefined,
		});

		assert.deepEqual(infoMessages, ['Open a workspace folder before analyzing saved chats.']);
	});
});
