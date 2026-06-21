"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("node:assert"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const extension_1 = require("../../src/extension");
const sessionAnalysis_1 = require("../../src/sessionAnalysis");
const sessionViewer_1 = require("../../src/sessionViewer");
const sessionStore_1 = require("../../src/sessionStore");
const sessionWriter_1 = require("../../src/sessionWriter");
function createWorkspaceFolder(rootPath, name, index) {
    return {
        uri: vscode.Uri.file(rootPath),
        name,
        index,
    };
}
function createCopilotSession(title) {
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
function createAnalysisReportReference(overrides = {}) {
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
function createWorkspaceSessionMeta(workspaceFolder, title, storageDirectory = path.join(workspaceFolder.uri.fsPath, '.chat')) {
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
        assert.equal((0, extension_1.resolveImplicitSaveProviderForHost)('Cursor'), 'cursor');
        assert.equal((0, extension_1.resolveImplicitSaveProviderForHost)('Cursor Nightly'), 'cursor');
        assert.equal((0, extension_1.resolveImplicitSaveProviderForHost)('Codex'), 'codex');
        assert.equal((0, extension_1.resolveImplicitSaveProviderForHost)('OpenAI Codex'), 'codex');
        assert.equal((0, extension_1.resolveImplicitSaveProviderForHost)('Claude Code'), 'claude-code');
        assert.equal((0, extension_1.resolveImplicitSaveProviderForHost)('Visual Studio Code'), 'copilot');
    });
    test('resolveSaveProviderForHost prefers explicit provider overrides', () => {
        assert.equal((0, extension_1.resolveSaveProviderForHost)('copilot', 'Cursor'), 'copilot');
        assert.equal((0, extension_1.resolveSaveProviderForHost)('codex', 'Cursor'), 'codex');
        assert.equal((0, extension_1.resolveSaveProviderForHost)('claude-code', 'Cursor'), 'claude-code');
        assert.equal((0, extension_1.resolveSaveProviderForHost)(undefined, 'Cursor'), 'cursor');
        assert.equal((0, extension_1.resolveSaveProviderForHost)(undefined, 'Codex'), 'codex');
        assert.equal((0, extension_1.resolveSaveProviderForHost)(undefined, 'Claude Code'), 'claude-code');
        assert.equal((0, extension_1.resolveSaveProviderForHost)(undefined, 'Visual Studio Code'), 'copilot');
    });
    test('resolveAutoSaveProvidersForHost watches Copilot, Codex, and Claude Code unless explicitly overridden', () => {
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)('copilot', 'Visual Studio Code'), ['copilot']);
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)('codex', 'Visual Studio Code'), ['codex']);
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)('claude-code', 'Visual Studio Code'), ['claude-code']);
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)(undefined, 'Visual Studio Code'), ['copilot', 'codex', 'claude-code']);
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)(undefined, 'OpenAI Codex'), ['copilot', 'codex', 'claude-code']);
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)(undefined, 'Claude Code'), ['copilot', 'codex', 'claude-code']);
        assert.deepEqual((0, extension_1.resolveAutoSaveProvidersForHost)(undefined, 'Cursor'), ['cursor']);
    });
    test('validateStoragePath accepts in-workspace relative paths and rejects invalid ones', () => {
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        assert.equal((0, extension_1.validateStoragePath)(workspaceFolder, '.chat').toLowerCase(), path.resolve('C:/repo', '.chat').toLowerCase());
        assert.throws(() => (0, extension_1.validateStoragePath)(workspaceFolder, '../outside'));
        assert.throws(() => (0, extension_1.validateStoragePath)(workspaceFolder, ''));
        assert.throws(() => (0, extension_1.validateStoragePath)(workspaceFolder, 'C:/absolute'));
    });
    test('resolveManualWorkspaceFolder prefers active editor workspace', async () => {
        const first = createWorkspaceFolder('C:/repo-one', 'one', 0);
        const second = createWorkspaceFolder('C:/repo-two', 'two', 1);
        const activeUri = vscode.Uri.file('C:/repo-two/src/file.ts');
        const resolved = await (0, extension_1.resolveManualWorkspaceFolder)({
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
        const resolved = await (0, extension_1.resolveManualWorkspaceFolder)({
            getWorkspaceFolders: () => [first, second],
            getActiveEditorUri: () => undefined,
            getWorkspaceFolder: () => undefined,
            pickWorkspaceFolder: async (items) => items[1],
        });
        assert.equal(resolved?.name, 'two');
    });
    test('listSessionsAcrossWorkspaceFolders aggregates saved sessions from all folders', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-phase10-'));
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const workspaceAPath = path.join(tempRoot, 'workspace-a');
            const workspaceBPath = path.join(tempRoot, 'workspace-b');
            await fs.mkdir(workspaceAPath, { recursive: true });
            await fs.mkdir(workspaceBPath, { recursive: true });
            const workspaceA = createWorkspaceFolder(workspaceAPath, 'alpha', 0);
            const workspaceB = createWorkspaceFolder(workspaceBPath, 'beta', 1);
            await store.writeSession(path.join(workspaceAPath, '.chat'), (0, sessionWriter_1.createChatSession)(createCopilotSession('Alpha Session'), {
                title: 'Alpha Session',
                savedAt: '2026-04-12T13:00:00.000Z',
                vscodeVersion: '1.115.0',
            }));
            await store.writeSession(path.join(workspaceBPath, '.chat'), (0, sessionWriter_1.createChatSession)(createCopilotSession('Beta Session'), {
                title: 'Beta Session',
                savedAt: '2026-04-12T14:00:00.000Z',
                vscodeVersion: '1.115.0',
            }));
            const sessions = await (0, extension_1.listSessionsAcrossWorkspaceFolders)([workspaceA, workspaceB]);
            assert.equal(sessions.length, 2);
            assert.equal(sessions[0]?.label, '[beta] Beta Session');
            assert.equal(sessions[1]?.label, '[alpha] Alpha Session');
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('ensureStoragePathInGitignore appends the relative storage path once', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-gitignore-'));
        try {
            const workspaceFolder = createWorkspaceFolder(tempRoot, 'repo', 0);
            const storageDirectory = path.join(tempRoot, '.chat');
            const entry = (0, extension_1.createStorageGitignoreEntry)(workspaceFolder, storageDirectory);
            assert.equal(entry, '.chat/');
            const created = await (0, extension_1.ensureStoragePathInGitignore)(workspaceFolder, storageDirectory);
            const duplicated = await (0, extension_1.ensureStoragePathInGitignore)(workspaceFolder, storageDirectory);
            const gitignore = await fs.readFile(path.join(tempRoot, '.gitignore'), 'utf8');
            assert.equal(created, true);
            assert.equal(duplicated, false);
            assert.equal(gitignore, '.chat/\n');
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('runOpenSavedSessionCommand prompts for a session when no explorer item is provided', async () => {
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        const opened = [];
        await (0, extension_1.runOpenSavedSessionCommand)({ extensionUri: vscode.Uri.file('C:/extension') }, undefined, {
            getWorkspaceFolders: () => [workspaceFolder],
            listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1', 'C:/repo/.chat')],
            pickSession: async (sessions) => sessions[0],
            readSession: async () => ({ id: 's1' }),
            showSession: (_session, extensionUri, storageDirectory, fileName) => {
                opened.push({ extensionUri, storageDirectory, fileName });
            },
            showInformationMessage: async () => undefined,
        });
        assert.equal(opened.length, 1);
        assert.equal(opened[0]?.storageDirectory, 'C:/repo/.chat');
        assert.equal(opened[0]?.fileName, 'saved.json');
        assert.equal(opened[0]?.extensionUri.fsPath.toLowerCase(), vscode.Uri.file('C:/extension').fsPath.toLowerCase());
    });
    test('runOpenSavedSessionCommand shows guidance when no workspace is open', async () => {
        const infoMessages = [];
        await (0, extension_1.runOpenSavedSessionCommand)({ extensionUri: vscode.Uri.file('C:/extension') }, undefined, {
            getWorkspaceFolders: () => undefined,
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
        });
        assert.equal(infoMessages.length, 1);
        assert.equal(infoMessages[0], 'Open a workspace folder before opening saved sessions.');
    });
    test('runViewSessionFileCommand opens session viewer for valid session JSON', async () => {
        const session = (0, sessionWriter_1.createChatSession)(createCopilotSession('Viewer Session'), {
            title: 'Viewer Session',
            savedAt: '2026-04-13T12:00:00.000Z',
            vscodeVersion: '1.115.0',
        });
        const opened = [];
        await (0, extension_1.runViewSessionFileCommand)({ extensionUri: vscode.Uri.file('C:/extension') }, {
            getActiveEditor: () => ({
                document: {
                    uri: vscode.Uri.file('C:/repo/.chat/viewer-session.json'),
                    getText: () => JSON.stringify(session),
                },
            }),
            showSession: (_session, extensionUri, storageDirectory, fileName) => {
                opened.push({ extensionUri, storageDirectory, fileName });
            },
            showInformationMessage: async () => undefined,
        });
        assert.equal(opened.length, 1);
        assert.equal(opened[0]?.storageDirectory.toLowerCase(), path.normalize('C:/repo/.chat').toLowerCase());
        assert.equal(opened[0]?.fileName, 'viewer-session.json');
        assert.equal(opened[0]?.extensionUri.fsPath.toLowerCase(), vscode.Uri.file('C:/extension').fsPath.toLowerCase());
    });
    test('runViewSessionFileCommand shows message for invalid JSON', async () => {
        const infoMessages = [];
        await (0, extension_1.runViewSessionFileCommand)({ extensionUri: vscode.Uri.file('C:/extension') }, {
            getActiveEditor: () => ({
                document: {
                    uri: vscode.Uri.file('C:/repo/.chat/bad.json'),
                    getText: () => '{ bad json',
                },
            }),
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
        });
        assert.equal(infoMessages[0], 'The active file is not valid JSON.');
    });
    test('runViewSessionFileCommand shows message for non-session JSON', async () => {
        const infoMessages = [];
        await (0, extension_1.runViewSessionFileCommand)({ extensionUri: vscode.Uri.file('C:/extension') }, {
            getActiveEditor: () => ({
                document: {
                    uri: vscode.Uri.file('C:/repo/.chat/not-session.json'),
                    getText: () => JSON.stringify({ hello: 'world' }),
                },
            }),
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
        });
        assert.equal(infoMessages[0], 'This file is not a recognized Session Control session format.');
    });
});
suite('runResumeSessionFromViewerCommand', () => {
    test('shows info message when no session viewer is open', async () => {
        const infoMessages = [];
        let originalExecuteCommand = vscode.commands.executeCommand;
        const executedCommands = [];
        // Store original state to restore later
        const originalCurrentPanel = sessionViewer_1.SessionViewerPanel.currentPanel;
        try {
            // Mock vscode.commands.executeCommand temporarily
            vscode.commands.executeCommand = async (...args) => {
                executedCommands.push(String(args[0]));
                return undefined;
            };
            // Ensure no panel is open
            sessionViewer_1.SessionViewerPanel.currentPanel = undefined;
            // Mock window methods
            const originalShowMessage = vscode.window.showInformationMessage;
            vscode.window.showInformationMessage = async (message) => {
                infoMessages.push(message);
                return undefined;
            };
            await (0, extension_1.runResumeSessionFromViewerCommand)();
            assert.equal(infoMessages.length, 1);
            assert.equal(infoMessages[0], 'No session viewer is currently open.');
            assert.equal(executedCommands.length, 0, 'No commands should be executed when no viewer is open');
            // Restore
            vscode.window.showInformationMessage = originalShowMessage;
        }
        finally {
            // Restore original state
            vscode.commands.executeCommand = originalExecuteCommand;
            sessionViewer_1.SessionViewerPanel.currentPanel = originalCurrentPanel;
        }
    });
    test('routes a non-Copilot viewer session directly to the origin agent', async () => {
        const originalCurrentPanel = sessionViewer_1.SessionViewerPanel.currentPanel;
        const originalExecuteCommand = vscode.commands.executeCommand;
        const originalGetCommands = vscode.commands.getCommands;
        const originalWriteText = vscode.env.clipboard.writeText;
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        const session = {
            ...(0, sessionWriter_1.createChatSession)(createCopilotSession('Viewer Codex Session'), {
                title: 'Viewer Codex Session',
                savedAt: '2026-04-13T12:00:00.000Z',
                vscodeVersion: '1.115.0',
            }),
            provider: 'codex',
        };
        const executedCommands = [];
        let clipboardText;
        try {
            sessionViewer_1.SessionViewerPanel.currentPanel = {
                getSessionTitle: () => session.title,
                getSessionProvider: () => session.provider,
                getSession: () => session,
                getFilePath: () => 'C:/repo/.chat/viewer-codex-session.json',
            };
            vscode.commands.getCommands = async () => ['chatgpt.openSidebar', 'chatgpt.sidebarSecondaryView.focus', 'chatgpt.sidebarView.focus', 'workbench.action.chat.open'];
            vscode.commands.executeCommand = async (commandId) => {
                executedCommands.push(commandId);
                return undefined;
            };
            vscode.env.clipboard.writeText = async (text) => {
                clipboardText = text;
            };
            vscode.window.showInformationMessage = async () => undefined;
            await (0, extension_1.runResumeSessionFromViewerCommand)();
            assert.deepEqual(executedCommands, [
                'chatgpt.openSidebar',
                'chatgpt.sidebarSecondaryView.focus',
                'editor.action.clipboardPasteAction',
            ]);
            assert.equal(clipboardText?.includes('Viewer Codex Session'), false);
            assert.equal(clipboardText?.includes('User follow-up: Continue this session.'), true);
        }
        finally {
            sessionViewer_1.SessionViewerPanel.currentPanel = originalCurrentPanel;
            vscode.commands.executeCommand = originalExecuteCommand;
            vscode.commands.getCommands = originalGetCommands;
            vscode.env.clipboard.writeText = originalWriteText;
            vscode.window.showInformationMessage = originalShowInformationMessage;
        }
    });
    test('routes a Claude Code viewer session to the Claude sidebar tab', async () => {
        const originalCurrentPanel = sessionViewer_1.SessionViewerPanel.currentPanel;
        const originalExecuteCommand = vscode.commands.executeCommand;
        const originalGetCommands = vscode.commands.getCommands;
        const originalWriteText = vscode.env.clipboard.writeText;
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        const session = {
            ...(0, sessionWriter_1.createChatSession)(createCopilotSession('Viewer Claude Session'), {
                title: 'Viewer Claude Session',
                savedAt: '2026-04-13T12:00:00.000Z',
                vscodeVersion: '1.115.0',
            }),
            provider: 'claude-code',
        };
        const executedCommands = [];
        let clipboardText;
        try {
            sessionViewer_1.SessionViewerPanel.currentPanel = {
                getSessionTitle: () => session.title,
                getSessionProvider: () => session.provider,
                getSession: () => session,
                getFilePath: () => 'C:/repo/.chat/viewer-claude-session.json',
            };
            vscode.commands.getCommands = async () => ['claude-vscode.sidebar.open', 'claude-vscode.newConversation', 'claude-vscode.focus', 'claudeVSCodeSidebar.focus', 'workbench.action.chat.open'];
            vscode.commands.executeCommand = async (commandId) => {
                executedCommands.push(commandId);
                return undefined;
            };
            vscode.env.clipboard.writeText = async (text) => {
                clipboardText = text;
            };
            vscode.window.showInformationMessage = async () => undefined;
            await (0, extension_1.runResumeSessionFromViewerCommand)();
            assert.deepEqual(executedCommands, [
                'claude-vscode.sidebar.open',
                'claude-vscode.newConversation',
                'claude-vscode.focus',
                'claude-vscode.focus',
                'editor.action.clipboardPasteAction',
            ]);
            assert.equal(clipboardText?.includes('Viewer Claude Session'), false);
            assert.equal(clipboardText?.includes('User follow-up: Continue this session.'), true);
        }
        finally {
            sessionViewer_1.SessionViewerPanel.currentPanel = originalCurrentPanel;
            vscode.commands.executeCommand = originalExecuteCommand;
            vscode.commands.getCommands = originalGetCommands;
            vscode.env.clipboard.writeText = originalWriteText;
            vscode.window.showInformationMessage = originalShowInformationMessage;
        }
    });
});
suite('runImplementLatestAnalysisCommand', () => {
    test('shows guidance when no workspace is open', async () => {
        const infoMessages = [];
        await (0, extension_1.runImplementLatestAnalysisCommand)({
            getWorkspaceFolders: () => undefined,
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
            showWarningMessage: async () => undefined,
        });
        assert.deepEqual(infoMessages, ['Open a workspace folder before implementing from a saved analysis.']);
    });
    test('shows guidance when no saved analysis reports exist', async () => {
        const infoMessages = [];
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        await (0, extension_1.runImplementLatestAnalysisCommand)({
            getWorkspaceFolders: () => [workspaceFolder],
            getStoragePath: () => 'C:/repo/.chat',
            readIndex: async () => ({ reports: [] }),
            readReport: async () => '# report',
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
            showWarningMessage: async () => undefined,
        });
        assert.deepEqual(infoMessages, ['No saved analysis reports found. Run Session Control: Analyze Saved Chats or @session-control /analyze first.']);
    });
    test('opens chat with the latest usable saved analysis report', async () => {
        const infoMessages = [];
        const workspaceA = createWorkspaceFolder('C:/repo-a', 'alpha', 0);
        const workspaceB = createWorkspaceFolder('C:/repo-b', 'beta', 1);
        let openedPrompt;
        await (0, extension_1.runImplementLatestAnalysisCommand)({
            getWorkspaceFolders: () => [workspaceA, workspaceB],
            getStoragePath: (workspaceFolder) => path.join(workspaceFolder.uri.fsPath, '.chat'),
            readIndex: async (storageDirectory) => {
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
            readReport: async (storageDirectory, reportPath) => {
                if (storageDirectory.toLowerCase().includes('repo-b')) {
                    throw new Error(`ENOENT ${reportPath}`);
                }
                return '# Chat Analysis Report';
            },
            buildPrompt: (reportFilePath) => `IMPLEMENT ${reportFilePath}`,
            getCommands: async () => [],
            pickTarget: async (_agentSessionAvailable) => 'chat',
            openChat: async (prompt) => {
                openedPrompt = prompt;
            },
            openAgentSession: async () => undefined,
            writeClipboard: async () => undefined,
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
            showWarningMessage: async () => undefined,
        });
        assert.equal(openedPrompt?.toLowerCase(), `IMPLEMENT ${path.join('C:/repo-a/.chat', 'analysis/reports/alpha-report.md')}`.toLowerCase());
        assert.deepEqual(infoMessages, ['Opened chat with an implementation prompt for Alpha report.']);
    });
    test('opens an agent session and copies the latest analysis implementation prompt when available', async () => {
        const infoMessages = [];
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        let openedCommand;
        let clipboardText;
        await (0, extension_1.runImplementLatestAnalysisCommand)({
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
            buildPrompt: (reportFilePath) => `IMPLEMENT ${reportFilePath}`,
            getCommands: async () => ['github.copilot.cli.newSession'],
            pickTarget: async (_agentSessionAvailable) => 'agentSession',
            openChat: async () => undefined,
            openAgentSession: async (commandId) => {
                openedCommand = commandId;
            },
            writeClipboard: async (text) => {
                clipboardText = text;
            },
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
            showWarningMessage: async () => undefined,
        });
        assert.equal(openedCommand, 'github.copilot.cli.newSession');
        assert.equal(clipboardText, `IMPLEMENT ${path.join('C:/repo/.chat', 'analysis/reports/report-1.md')}`);
        assert.deepEqual(infoMessages, [
            'Opened an agent session for the latest saved analysis from repo. The generated implementation prompt is on the clipboard.',
        ]);
    });
});
suite('runAnalyzeSavedChatsCommand', () => {
    test('shows guidance when no workspace is open', async () => {
        const infoMessages = [];
        await (0, extension_1.runAnalyzeSavedChatsCommand)('', {
            getWorkspaceFolders: () => undefined,
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
            showWarningMessage: async () => undefined,
        });
        assert.deepEqual(infoMessages, ['Open a workspace folder before analyzing saved chats.']);
    });
    test('warns when no host chat model is available outside Cursor', async () => {
        const warningMessages = [];
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        await (0, extension_1.runAnalyzeSavedChatsCommand)('', {
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
            openTextDocument: async (uri) => ({ uri }),
            showTextDocument: async (_document) => ({}),
            showInformationMessage: async () => undefined,
            showWarningMessage: async (message) => {
                warningMessages.push(message);
                return undefined;
            },
        });
        assert.deepEqual(warningMessages, [
            'No host chat model is available for analysis. Sign in or enable a chat model, then try again.',
        ]);
    });
    test('opens chat with a self-contained analysis handoff prompt when Cursor has no extension-callable model', async () => {
        const infoMessages = [];
        const warningMessages = [];
        let openedPrompt;
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-handoff-'));
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const workspaceFolder = createWorkspaceFolder(tempRoot, 'repo', 0);
            await store.writeSession(path.join(tempRoot, '.chat'), (0, sessionWriter_1.createChatSession)(createCopilotSession('Session 1'), {
                title: 'Session 1',
                savedAt: '2026-05-17T18:00:00.000Z',
                vscodeVersion: '1.115.0',
            }));
            const workspaceSessions = await (0, extension_1.listSessionsAcrossWorkspaceFolders)([workspaceFolder]);
            const savedSession = workspaceSessions[0];
            assert.ok(savedSession);
            await (0, extension_1.runAnalyzeSavedChatsCommand)('', {
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
                openChat: async (prompt) => {
                    openedPrompt = prompt;
                },
                runAnalyzeFlow: async () => {
                    throw new Error('runAnalyzeFlow should not be called without a model.');
                },
                withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
                openTextDocument: async (uri) => ({ uri }),
                showTextDocument: async (_document) => ({}),
                showInformationMessage: async (message) => {
                    infoMessages.push(message);
                    return undefined;
                },
                showWarningMessage: async (message) => {
                    warningMessages.push(message);
                    return undefined;
                },
            });
            assert.equal(typeof openedPrompt, 'string');
            const prompt = openedPrompt ?? '';
            assert.equal(prompt.includes('This handoff runs inside the target repository workspace, not inside the Session Control source repository.'), true);
            assert.equal(prompt.includes('Do not search the target repository for Session Control implementation files'), true);
            assert.equal(prompt.includes(`Owner workspace for persisted output: ${workspaceFolder.name}`), true);
            assert.equal(prompt.includes('".chat/analysis/reports"'), true);
            assert.equal(prompt.includes('".chat/analysis/index.json"'), true);
            assert.equal(prompt.includes(`.chat/${savedSession.fileName}`), true);
            assert.equal(prompt.includes(savedSession.title), true);
            assert.equal(prompt.includes(`Use report prompt version \`${sessionAnalysis_1.ANALYSIS_PROMPT_VERSION}\``), true);
            assert.equal(prompt.includes('"analyzedSessions": ['), true);
            assert.equal(prompt.includes('A `savedAt` change by itself must not change the fingerprint.'), true);
            assert.equal(prompt.includes('src/sessionAnalysis.ts'), false);
            assert.equal(prompt.includes('src/analysisStore.ts'), false);
            assert.equal(prompt.includes('.github/instructions/saved-chat-analysis.instructions.md'), false);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
        assert.deepEqual(infoMessages, [
            'Cursor does not currently expose extension-callable chat models, so Session Control opened chat with an analysis handoff prompt. Send it in chat to continue.',
        ]);
        assert.deepEqual(warningMessages, []);
    });
    test('opens the saved analysis report after a successful run', async () => {
        const infoMessages = [];
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        let openedDocumentPath;
        let shownDocumentPath;
        await (0, extension_1.runAnalyzeSavedChatsCommand)('', {
            getWorkspaceFolders: () => [workspaceFolder],
            listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1')],
            resolveSelection: async () => ({
                mode: 'needsAnalysis',
                label: 'Needs Analysis',
                range: null,
            }),
            selectChatModels: async () => [{}],
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
            openTextDocument: async (uri) => {
                openedDocumentPath = uri.fsPath;
                return { uri };
            },
            showTextDocument: async (document) => {
                shownDocumentPath = document.uri.fsPath;
                return {};
            },
            showInformationMessage: async (message) => {
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
        const infoMessages = [];
        const workspaceFolder = createWorkspaceFolder('C:/repo', 'repo', 0);
        await (0, extension_1.runAnalyzeSavedChatsCommand)('', {
            getWorkspaceFolders: () => [workspaceFolder],
            listSessionsAcrossWorkspaceFolders: async () => [createWorkspaceSessionMeta(workspaceFolder, 'Session 1')],
            resolveSelection: async () => ({
                mode: 'needsAnalysis',
                label: 'Needs Analysis',
                range: null,
            }),
            selectChatModels: async () => [{}],
            runAnalyzeFlow: async (_workspaceFolders, _workspaceSessions, _selection, _model, _token, onStatus) => {
                onStatus('No saved sessions currently need analysis.');
                return undefined;
            },
            withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
            openTextDocument: async (uri) => ({ uri }),
            showTextDocument: async (_document) => ({}),
            showInformationMessage: async (message) => {
                infoMessages.push(message);
                return undefined;
            },
            showWarningMessage: async () => undefined,
        });
        assert.deepEqual(infoMessages, ['No saved sessions currently need analysis.']);
    });
});
//# sourceMappingURL=extensionPhase10.test.js.map