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
exports.validateStoragePath = validateStoragePath;
exports.createStorageGitignoreEntry = createStorageGitignoreEntry;
exports.ensureStoragePathInGitignore = ensureStoragePathInGitignore;
exports.resolveImplicitSaveProviderForHost = resolveImplicitSaveProviderForHost;
exports.resolveSaveProviderForHost = resolveSaveProviderForHost;
exports.resolveAutoSaveProvidersForHost = resolveAutoSaveProvidersForHost;
exports.resolveResumeConfiguration = resolveResumeConfiguration;
exports.resolveManualWorkspaceFolder = resolveManualWorkspaceFolder;
exports.listSessionsAcrossWorkspaceFolders = listSessionsAcrossWorkspaceFolders;
exports.runSaveSessionFlow = runSaveSessionFlow;
exports.runOpenSavedSessionCommand = runOpenSavedSessionCommand;
exports.runViewSessionFileCommand = runViewSessionFileCommand;
exports.runImplementLatestAnalysisCommand = runImplementLatestAnalysisCommand;
exports.runAnalyzeSavedChatsCommand = runAnalyzeSavedChatsCommand;
exports.registerAutoSaveOnChatResponseListener = registerAutoSaveOnChatResponseListener;
exports.runResumeSessionFromViewerCommand = runResumeSessionFromViewerCommand;
exports.activate = activate;
exports.deactivate = deactivate;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const analysisStore_1 = require("./analysisStore");
const chatParticipant_1 = require("./chatParticipant");
const claudeCodeSessionReader_1 = require("./claudeCodeSessionReader");
const cursorAgentTranscriptReader_1 = require("./cursorAgentTranscriptReader");
const cursorSessionReader_1 = require("./cursorSessionReader");
const codexSkillImporter_1 = require("./codexSkillImporter");
const codexSessionReader_1 = require("./codexSessionReader");
const gitIntegration_1 = require("./gitIntegration");
const sessionReader_1 = require("./sessionReader");
const sessionAnalysis_1 = require("./sessionAnalysis");
const sessionExplorer_1 = require("./sessionExplorer");
const sessionViewer_1 = require("./sessionViewer");
const sessionStore_1 = require("./sessionStore");
const sessionWriter_1 = require("./sessionWriter");
const types_1 = require("./types");
const utils_1 = require("./utils");
const sessionStore = (0, sessionStore_1.createSessionStore)();
const analysisStore = (0, analysisStore_1.createAnalysisStore)();
function isAbsolutePathLike(value) {
    return path.isAbsolute(value) || path.win32.isAbsolute(value);
}
function normalizeComparablePath(value) {
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function isSameOrDescendantPath(candidatePath, basePath) {
    const relative = path.relative(basePath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function pathsOverlap(leftPath, rightPath) {
    const left = normalizeComparablePath(leftPath);
    const right = normalizeComparablePath(rightPath);
    return isSameOrDescendantPath(left, right) || isSameOrDescendantPath(right, left);
}
function filterSessionsForWorkspace(sessions, workspaceFolder, provider) {
    const matches = sessions.filter((session) => session.provider === provider
        && typeof session.cwd === 'string'
        && session.cwd.length > 0
        && pathsOverlap(session.cwd, workspaceFolder.uri.fsPath));
    return matches.length > 0 ? matches : sessions;
}
function validateStoragePath(workspaceFolder, configured) {
    if (!configured.trim()) {
        throw new Error('session-control.storagePath must not be empty.');
    }
    if (isAbsolutePathLike(configured)) {
        throw new Error('session-control.storagePath must be relative to the workspace folder.');
    }
    const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
    const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
    if (relative.startsWith('..') || isAbsolutePathLike(relative)) {
        throw new Error('session-control.storagePath must stay within the workspace folder.');
    }
    return resolved;
}
function normalizeGitignoreEntry(value) {
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!normalized || normalized.startsWith('#')) {
        return '';
    }
    return `${normalized}/`;
}
function createStorageGitignoreEntry(workspaceFolder, storageDirectory) {
    const relative = path.relative(workspaceFolder.uri.fsPath, storageDirectory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Storage directory must be inside the workspace folder before updating .gitignore.');
    }
    return normalizeGitignoreEntry(relative);
}
async function ensureStoragePathInGitignore(workspaceFolder, storageDirectory) {
    const entry = createStorageGitignoreEntry(workspaceFolder, storageDirectory);
    const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');
    let existing = '';
    try {
        existing = await fs.readFile(gitignorePath, 'utf8');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/no such file|cannot find|enoent/i.test(message)) {
            throw error;
        }
    }
    const hasEntry = existing
        .split(/\r?\n/)
        .some((line) => normalizeGitignoreEntry(line) === entry);
    if (hasEntry) {
        return false;
    }
    const nextContent = existing.length === 0
        ? `${entry}\n`
        : `${existing.replace(/\s*$/, '')}\n${entry}\n`;
    await fs.writeFile(gitignorePath, nextContent, 'utf8');
    return true;
}
function getStoragePath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('storagePath', '.chat');
    return validateStoragePath(workspaceFolder, configured);
}
function getSaveConfiguration(workspaceFolder) {
    const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
    const configuredSize = config.get('save.maxFileSize', '1mb');
    const parsedSize = (0, utils_1.parseFileSize)(configuredSize);
    const overflowStrategy = config.get('save.overflowStrategy', 'split');
    const stripToolOutput = config.get('save.stripToolOutput', false);
    const includeTimestampRaw = config.get('save.useTimestampInFileName', true);
    const includeTimestampInFileName = typeof includeTimestampRaw === 'boolean'
        ? includeTimestampRaw
        : true;
    if (typeof includeTimestampRaw !== 'boolean') {
        console.warn(`Invalid session-control.save.useTimestampInFileName value (${String(includeTimestampRaw)}). Falling back to true.`);
    }
    return {
        maxFileSizeBytes: parsedSize,
        overflowStrategy,
        stripToolOutput,
        includeTimestampInFileName,
    };
}
function getProviderLabel(provider) {
    switch (provider) {
        case 'codex':
            return 'Codex';
        case 'cursor':
            return 'Cursor';
        case 'claude-code':
            return 'Claude Code';
        default:
            return 'Copilot';
    }
}
function resolveImplicitSaveProviderForHost(appName) {
    if (/cursor/i.test(appName)) {
        return 'cursor';
    }
    if (/codex/i.test(appName)) {
        return 'codex';
    }
    if (/claude/i.test(appName)) {
        return 'claude-code';
    }
    return 'copilot';
}
function resolveSaveProviderForHost(configuredProvider, appName) {
    if (configuredProvider) {
        return configuredProvider;
    }
    return resolveImplicitSaveProviderForHost(appName);
}
function resolveAutoSaveProvidersForHost(configuredProvider, appName) {
    if (configuredProvider) {
        return [configuredProvider];
    }
    const implicitProvider = resolveImplicitSaveProviderForHost(appName);
    if (implicitProvider === 'cursor') {
        return ['cursor'];
    }
    return ['copilot', 'codex', 'claude-code'];
}
function getConfiguredSaveProvider(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .inspect('save.provider');
    const explicitValue = configured?.workspaceFolderValue
        ?? configured?.workspaceValue
        ?? configured?.globalValue;
    if (explicitValue === undefined) {
        return undefined;
    }
    if ((0, types_1.isSessionProviderId)(explicitValue)) {
        return explicitValue;
    }
    console.warn(`Invalid session-control.save.provider value (${String(explicitValue)}). Falling back to host default.`);
    return undefined;
}
function getSaveProvider(workspaceFolder) {
    return resolveSaveProviderForHost(getConfiguredSaveProvider(workspaceFolder), vscode.env.appName);
}
function getAutoSaveProviders(workspaceFolder) {
    return resolveAutoSaveProvidersForHost(getConfiguredSaveProvider(workspaceFolder), vscode.env.appName);
}
function getCodexHomePath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('codex.homePath', '')
        .trim();
    if (configured) {
        return configured;
    }
    const fromEnvironment = process.env.CODEX_HOME?.trim();
    if (fromEnvironment) {
        return fromEnvironment;
    }
    return path.join(os.homedir(), '.codex');
}
function getClaudeCodeHomePath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('claudeCode.homePath', '')
        .trim();
    if (configured) {
        return configured;
    }
    const fromEnvironment = process.env.CLAUDE_CONFIG_DIR?.trim();
    if (fromEnvironment) {
        return fromEnvironment;
    }
    return path.join(os.homedir(), '.claude');
}
function getCursorUserDataPath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('cursor.userDataPath', '')
        .trim();
    if (configured) {
        return configured;
    }
    return (0, cursorSessionReader_1.getDefaultCursorUserDataPath)();
}
function getCursorProjectsPath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('cursor.projectsPath', '')
        .trim();
    if (configured) {
        return configured;
    }
    return (0, cursorSessionReader_1.getDefaultCursorProjectsPath)();
}
function resolveResumeConfiguration(workspaceFolder) {
    const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
    const maxTurns = Math.max(1, config.get('resume.maxTurns', 50));
    const maxContextChars = Math.max(1000, config.get('resume.maxContextChars', 80000));
    return { maxTurns, maxContextChars };
}
function getPruneConfiguration(workspaceFolder) {
    const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
    return {
        maxSavedSessions: config.get('save.maxSavedSessions', 0),
        pruneAction: config.get('save.pruneAction', 'archive'),
    };
}
async function resolveManualWorkspaceFolder(depsOverrides = {}) {
    const deps = {
        getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
        getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
        getWorkspaceFolder: (uri) => vscode.workspace.getWorkspaceFolder(uri),
        pickWorkspaceFolder: async (items) => vscode.window.showQuickPick(items, {
            title: 'Select workspace folder',
        }),
        ...depsOverrides,
    };
    const activeUri = deps.getActiveEditorUri();
    if (activeUri) {
        const fromActiveEditor = deps.getWorkspaceFolder(activeUri);
        if (fromActiveEditor) {
            return fromActiveEditor;
        }
    }
    const folders = deps.getWorkspaceFolders();
    if (!folders?.length) {
        return undefined;
    }
    if (folders.length === 1) {
        return folders[0];
    }
    const pick = await deps.pickWorkspaceFolder(folders.map((folder) => ({
        label: folder.name,
        detail: folder.uri.fsPath,
    })));
    if (!pick) {
        return undefined;
    }
    return folders.find((folder) => folder.name === pick.label && folder.uri.fsPath === pick.detail);
}
async function listSessionsAcrossWorkspaceFolders(workspaceFolders) {
    if (!workspaceFolders?.length) {
        return [];
    }
    const results = await Promise.all(workspaceFolders.map(async (workspaceFolder) => {
        const storageDirectory = getStoragePath(workspaceFolder);
        const sessions = await sessionStore.listSessions(storageDirectory);
        return sessions.map((session) => ({
            ...session,
            label: `[${workspaceFolder.name}] ${session.title}`,
            description: `${session.turnCount} turns`,
            detail: `${session.savedAt} | ${session.fileName}`,
            displayTitle: `[${workspaceFolder.name}] ${session.title}`,
            storageDirectory,
            workspaceFolder,
        }));
    }));
    return results.flat().sort((a, b) => Date.parse(b.detail.split('|')[0]?.trim() ?? '') - Date.parse(a.detail.split('|')[0]?.trim() ?? ''));
}
function findAgentSessionCommandId(commands) {
    const preferred = [
        'workbench.action.chat.openSessions',
        'workbench.action.chat.openSessionsInNewWindow',
        'workbench.action.chat.openAgentsWindow',
        'workbench.action.chat.openAgents',
        'github.copilot.cli.newSession',
    ];
    for (const candidate of preferred) {
        if (commands.includes(candidate)) {
            return candidate;
        }
    }
    return commands.find((command) => {
        const normalized = command.toLowerCase();
        if (normalized.includes('debug')) {
            return false;
        }
        return normalized.startsWith('workbench.action.chat.')
            && normalized.includes('open')
            && (normalized.includes('agent') || normalized.includes('session'));
    });
}
function createDefaultImplementLatestAnalysisDeps() {
    return {
        getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
        getStoragePath,
        readIndex: async (storageDirectory) => analysisStore.readIndex(storageDirectory),
        readReport: async (storageDirectory, reportPath) => analysisStore.readReport(storageDirectory, reportPath),
        buildPrompt: (reportFilePath, userPrompt) => (0, sessionAnalysis_1.buildImplementationHandoffPrompt)(reportFilePath, userPrompt),
        getCommands: async () => vscode.commands.getCommands(true),
        pickTarget: async (agentSessionAvailable) => {
            if (!agentSessionAvailable) {
                return 'chat';
            }
            const pick = await vscode.window.showQuickPick([
                {
                    label: 'Chat',
                    description: 'Prefill a new chat with the generated implementation prompt',
                    target: 'chat',
                },
                {
                    label: 'Agent Session',
                    description: 'Open an agent session and copy the generated implementation prompt to the clipboard',
                    target: 'agentSession',
                },
            ], {
                title: 'Open latest analysis implementation in',
            });
            return pick?.target;
        },
        openChat: async (prompt) => {
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
        },
        openAgentSession: async (commandId) => {
            await vscode.commands.executeCommand(commandId);
        },
        writeClipboard: async (text) => vscode.env.clipboard.writeText(text),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        showWarningMessage: (message) => vscode.window.showWarningMessage(message),
    };
}
function sanitizeMarkdownForStatusMessage(markdown) {
    return markdown
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
        .replace(/[`*_>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizePathForPrompt(filePath) {
    return filePath.replace(/\\/g, '/');
}
function toWorkspaceRelativePath(workspaceFolder, absolutePath) {
    return normalizePathForPrompt(path.relative(workspaceFolder.uri.fsPath, absolutePath));
}
async function loadAnalyzedFingerprintsForCandidates(candidates) {
    const storageDirectories = [...new Set(candidates.map((candidate) => candidate.storageDirectory))];
    const indexes = await Promise.all(storageDirectories.map(async (storageDirectory) => ({
        storageDirectory,
        index: await analysisStore.readIndex(storageDirectory),
    })));
    const analyzed = new Set();
    for (const item of indexes) {
        for (const entry of item.index.analyzedSessions) {
            analyzed.add(entry.fingerprint);
        }
    }
    return analyzed;
}
function buildCursorAnalyzeHandoffPrompt(selection, candidates, workspaceFolders, ownerWorkspace, ownerStorageDirectory) {
    const ownerReportsDirectory = toWorkspaceRelativePath(ownerWorkspace, path.join(ownerStorageDirectory, 'analysis', 'reports'));
    const ownerIndexPath = toWorkspaceRelativePath(ownerWorkspace, path.join(ownerStorageDirectory, 'analysis', 'index.json'));
    const persistenceContract = (0, analysisStore_1.buildAnalysisPersistenceContract)(sessionAnalysis_1.ANALYSIS_PROMPT_VERSION);
    const workspaceByName = new Map(workspaceFolders.map((workspaceFolder) => [workspaceFolder.name, workspaceFolder]));
    const formatCandidatePath = (candidate, absolutePath) => {
        const workspaceFolder = workspaceByName.get(candidate.workspaceName);
        if (workspaceFolder) {
            return toWorkspaceRelativePath(workspaceFolder, absolutePath);
        }
        if (absolutePath === candidate.storageDirectory) {
            return normalizePathForPrompt(path.basename(candidate.storageDirectory));
        }
        return normalizePathForPrompt(path.join(path.basename(candidate.storageDirectory), path.basename(absolutePath)));
    };
    const uniqueStorageDirectories = [...new Map(candidates.map((candidate) => [
            `${candidate.workspaceName}::${candidate.storageDirectory}`,
            `- [${candidate.workspaceName}] ${formatCandidatePath(candidate, candidate.storageDirectory)}`,
        ])).values()];
    const sessionLines = candidates
        .slice(0, 30)
        .map((candidate) => {
        const sessionFilePath = path.join(candidate.storageDirectory, candidate.rootFileName);
        return `- [${candidate.workspaceName}] ${formatCandidatePath(candidate, sessionFilePath)} | ${candidate.session.savedAt} | ${candidate.session.title}`;
    });
    const omittedCount = Math.max(0, candidates.length - sessionLines.length);
    return [
        'Analyze saved chat sessions using full workspace access. Session Control could not call a host language model directly in this environment, so this prompt is a handoff fallback.',
        'This handoff runs inside the target repository workspace, not inside the Session Control source repository.',
        'Start by reading AGENTS.md, .github/copilot-instructions.md, and any repository-local *.instructions.md, *.prompt.md, *.agent.md, or SKILL.md files only when they exist in the target repository.',
        'Do not search the target repository for Session Control implementation files or Session Control-only instruction files. Use the persistence contract below instead.',
        'Restrict all recommendations to repository-local AI control files and compare them against the existing AI instruction and skill files before recommending changes.',
        'Analyze only the saved-session roots and storage directories listed below. Treat them as the source of truth for this task rather than reverse-engineering Session Control itself.',
        `Selection: ${selection.label}`,
        `Selection mode: ${selection.mode}`,
        `Only unanalyzed: ${selection.onlyUnanalyzed === true ? 'yes' : 'no'}`,
        `Matching root sessions: ${candidates.length}`,
        `Owner workspace for persisted output: ${ownerWorkspace.name}`,
        `Write the markdown report using the existing Session Control format under "${ownerReportsDirectory}".`,
        `Update the relevant analysis indexes using the existing Session Control schema, including "${ownerIndexPath}" for the owner workspace and any source storage indexes that need report references.`,
        '',
        persistenceContract,
        'Source storage directories:',
        ...uniqueStorageDirectories,
        '',
        'Matching root session files:',
        ...sessionLines,
        ...(omittedCount > 0 ? [`- ... ${omittedCount} additional matching sessions omitted from this prompt. Use the listed storage directories and selection criteria to include them.`] : []),
        '',
        'If you cannot safely persist the report and analysis indexes from chat, return the completed report in chat and explain what blocked persistence.',
    ].join('\n');
}
async function buildCursorAnalyzeHandoffPromptForSelection(workspaceFolders, workspaceSessions, selection) {
    const candidates = await (0, chatParticipant_1.createAnalysisCandidates)(workspaceSessions);
    if (!candidates.length) {
        return { infoMessage: 'No usable saved sessions found. Some saved sessions could not be read.' };
    }
    const analyzedFingerprints = await loadAnalyzedFingerprintsForCandidates(candidates);
    const filtered = (0, sessionAnalysis_1.filterCandidatesForAnalysis)(candidates, selection, analyzedFingerprints);
    if (!filtered.length) {
        return {
            infoMessage: selection.mode === 'needsAnalysis'
                ? 'No saved sessions currently need analysis.'
                : `No saved sessions matched ${selection.label.toLowerCase()}.`,
        };
    }
    const ownerWorkspace = getImplicitWorkspaceFolder() ?? workspaceFolders[0];
    if (!ownerWorkspace) {
        return { infoMessage: 'Open a workspace folder before analyzing saved chats.' };
    }
    const ownerStorageDirectory = getStoragePath(ownerWorkspace);
    return {
        prompt: buildCursorAnalyzeHandoffPrompt(selection, filtered, workspaceFolders, ownerWorkspace, ownerStorageDirectory),
    };
}
function createDefaultAnalyzeSavedChatsCommandDeps() {
    return {
        getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
        listSessionsAcrossWorkspaceFolders,
        resolveSelection: async (requestPrompt) => (0, chatParticipant_1.resolveAnalysisSelection)(requestPrompt),
        selectChatModels: async () => vscode.lm.selectChatModels(),
        getAppName: () => vscode.env.appName,
        runAnalyzeFlow: async (workspaceFolders, workspaceSessions, selection, model, token, onStatus) => (0, chatParticipant_1.runAnalyzeSessionsFlow)('', workspaceFolders, workspaceSessions, (0, chatParticipant_1.createAnalyzeSessionsFlowDeps)({
            resolveSelection: async () => selection,
            runModelPrompt: async (prompt) => {
                const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
                let text = '';
                for await (const part of response.stream) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        text += part.value;
                    }
                }
                return text.trim();
            },
            streamMarkdown: (markdown) => onStatus(markdown),
        })),
        withProgress: (options, task) => vscode.window.withProgress(options, task),
        buildCursorHandoffPrompt: async (workspaceFolders, workspaceSessions, selection) => buildCursorAnalyzeHandoffPromptForSelection(workspaceFolders, workspaceSessions, selection),
        openChat: async (prompt) => {
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
        },
        openTextDocument: (uri) => vscode.workspace.openTextDocument(uri),
        showTextDocument: (document) => vscode.window.showTextDocument(document, { preview: false }),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        showWarningMessage: (message) => vscode.window.showWarningMessage(message),
    };
}
async function findLatestUsableAnalysisReport(workspaceFolders, deps) {
    const candidates = [];
    const warnings = [];
    for (const workspaceFolder of workspaceFolders) {
        const storageDirectory = deps.getStoragePath(workspaceFolder);
        try {
            const index = await deps.readIndex(storageDirectory);
            for (const report of index.reports) {
                candidates.push({
                    storageDirectory,
                    reportPath: report.reportPath,
                    createdAt: report.createdAt,
                    selectionLabel: report.selection.label,
                    workspaceFolder,
                });
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`${workspaceFolder.name}: ${message}`);
        }
    }
    candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    for (const candidate of candidates) {
        try {
            await deps.readReport(candidate.storageDirectory, candidate.reportPath);
            return { report: candidate, warnings };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`${candidate.workspaceFolder.name}: ${message}`);
        }
    }
    return { warnings };
}
function toSessionQuickPickItem(session) {
    return {
        label: session.title,
        description: `${session.turns.length} turns`,
        detail: `${session.lastMessageDate} (${session.id})`,
        session,
    };
}
function createDefaultSaveSourceSessionFlowDeps() {
    return {
        selectSession: async (sessions, provider) => {
            const pick = await vscode.window.showQuickPick(sessions.map((session) => toSessionQuickPickItem(session)), { title: `Select ${getProviderLabel(provider)} session to save` });
            return pick?.session;
        },
        promptTitle: async (defaultTitle) => vscode.window.showInputBox({
            title: 'Session title',
            value: defaultTitle,
            prompt: 'Edit the title before saving (optional)',
        }),
        getGitContext: gitIntegration_1.getGitContext,
        createChatSession: sessionWriter_1.createChatSession,
        applySaveBloatControls: sessionWriter_1.applySaveBloatControls,
        getIncludeInGitignore: (workspaceFolder) => vscode.workspace
            .getConfiguration('session-control', workspaceFolder.uri)
            .get('includeInGitignore', false),
        ensureGitignoreEntry: ensureStoragePathInGitignore,
        getPruneConfiguration,
        writeSession: async (storageDirectory, sessions, options) => sessionStore.writeSessions(storageDirectory, sessions, options),
        pruneSessions: async (storageDirectory, maxSavedSessions, action) => sessionStore.pruneSessions(storageDirectory, maxSavedSessions, action),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
    };
}
function createDefaultSaveFlowDeps() {
    return {
        readCopilotSessions: sessionReader_1.readCopilotSessions,
        ...createDefaultSaveSourceSessionFlowDeps(),
    };
}
async function runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory, depsOverrides = {}) {
    const deps = {
        ...createDefaultSaveSourceSessionFlowDeps(),
        ...depsOverrides,
    };
    if (!sessions.length) {
        return undefined;
    }
    const selected = await deps.selectSession(sessions, provider);
    if (!selected) {
        return undefined;
    }
    const title = await deps.promptTitle(selected.title, provider);
    if (title === undefined) {
        return undefined;
    }
    const git = await deps.getGitContext(workspaceFolder.uri);
    const chatSession = deps.createChatSession(selected, {
        title,
        git,
        vscodeVersion: vscode.version,
    });
    const saveConfig = getSaveConfiguration(workspaceFolder);
    const saveResult = deps.applySaveBloatControls(chatSession, {
        maxFileSizeBytes: saveConfig.maxFileSizeBytes,
        overflowStrategy: saveConfig.overflowStrategy,
        stripToolOutput: saveConfig.stripToolOutput,
    });
    const writtenFiles = await deps.writeSession(storageDirectory, saveResult.sessions, {
        includeTimestampInFileName: saveConfig.includeTimestampInFileName,
    });
    if (deps.getIncludeInGitignore(workspaceFolder)) {
        await deps.ensureGitignoreEntry(workspaceFolder, storageDirectory);
    }
    if (saveResult.warning) {
        await deps.showInformationMessage(saveResult.warning);
    }
    if (writtenFiles.length === 1) {
        await deps.showInformationMessage(`Saved chat session to ${path.join(storageDirectory, writtenFiles[0] ?? '')}`);
    }
    else {
        await deps.showInformationMessage(`Saved ${writtenFiles.length} session part files to ${storageDirectory}`);
    }
    const pruneConfig = deps.getPruneConfiguration(workspaceFolder);
    if (pruneConfig.maxSavedSessions > 0) {
        const pruneResult = await deps.pruneSessions(storageDirectory, pruneConfig.maxSavedSessions, pruneConfig.pruneAction);
        if (pruneResult.archived > 0) {
            await deps.showInformationMessage(`Archived ${pruneResult.archived} old session file(s) after save.`);
        }
        if (pruneResult.deleted > 0) {
            await deps.showInformationMessage(`Deleted ${pruneResult.deleted} old session file(s) after save.`);
        }
    }
    return writtenFiles[0];
}
async function runSaveSessionFlow(context, workspaceFolder, storageDirectory, depsOverrides = {}) {
    const deps = {
        ...createDefaultSaveFlowDeps(),
        ...depsOverrides,
    };
    const sessions = await deps.readCopilotSessions(context);
    return runSaveSourceSessionFlow('copilot', sessions, workspaceFolder, storageDirectory, deps);
}
async function runSaveSessionCommand(context) {
    const workspaceFolder = await resolveManualWorkspaceFolder();
    if (!workspaceFolder) {
        await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
        return;
    }
    const storageDirectory = getStoragePath(workspaceFolder);
    const provider = getSaveProvider(workspaceFolder);
    const sessions = await loadSessionsForProvider(context, workspaceFolder, provider);
    await runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory);
}
async function pickSessionProvider() {
    const pick = await vscode.window.showQuickPick([
        {
            label: 'Copilot',
            description: 'Save from VS Code Copilot chat storage',
            provider: 'copilot',
        },
        {
            label: 'Codex',
            description: 'Import from local Codex session transcripts',
            provider: 'codex',
        },
        {
            label: 'Claude Code',
            description: 'Import from local Claude Code JSONL transcripts',
            provider: 'claude-code',
        },
    ], {
        title: 'Choose a session provider',
    });
    return pick?.provider;
}
async function loadSessionsForProvider(context, workspaceFolder, provider) {
    if (provider === 'codex') {
        return filterSessionsForWorkspace(await (0, codexSessionReader_1.readCodexSessions)(getCodexHomePath(workspaceFolder)), workspaceFolder, 'codex');
    }
    if (provider === 'claude-code') {
        return filterSessionsForWorkspace(await (0, claudeCodeSessionReader_1.readClaudeCodeSessions)(getClaudeCodeHomePath(workspaceFolder), workspaceFolder.uri.fsPath), workspaceFolder, 'claude-code');
    }
    if (provider === 'cursor') {
        return (0, cursorSessionReader_1.readCursorSessions)(workspaceFolder, getCursorUserDataPath(workspaceFolder), context, getCursorProjectsPath(workspaceFolder));
    }
    return (0, sessionReader_1.readCopilotSessions)(context);
}
async function runSaveSessionFromProviderCommand(context) {
    const workspaceFolder = await resolveManualWorkspaceFolder();
    if (!workspaceFolder) {
        await vscode.window.showInformationMessage('Open a workspace folder before saving a chat session.');
        return;
    }
    const provider = await pickSessionProvider();
    if (!provider) {
        return;
    }
    const storageDirectory = getStoragePath(workspaceFolder);
    const sessions = await loadSessionsForProvider(context, workspaceFolder, provider);
    await runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory);
}
async function runImportCopilotGuidanceCommand(options) {
    const workspaceFolder = await resolveManualWorkspaceFolder();
    if (!workspaceFolder) {
        await vscode.window.showInformationMessage(`Open a workspace folder before importing ${options.skillLabel} skills.`);
        return;
    }
    const importer = (0, codexSkillImporter_1.createCodexSkillImporter)();
    const result = await importer.importSkills(workspaceFolder.uri.fsPath, options.skillDirectorySegments ? { skillDirectorySegments: [...options.skillDirectorySegments] } : {});
    if (!result.created.length && !result.skipped.length) {
        await vscode.window.showInformationMessage(`No Copilot guidance files were found to import as ${options.skillLabel} skills.`);
        return;
    }
    const summaryParts = [
        `${result.created.length} created`,
        `${result.skipped.length} skipped`,
    ];
    await vscode.window.showInformationMessage(`Imported Copilot guidance to ${options.targetDirectory} for ${workspaceFolder.name}: ${summaryParts.join(', ')}.`);
}
async function runImportCopilotSkillsToCodexCommand() {
    await runImportCopilotGuidanceCommand({
        skillLabel: 'Codex',
        targetDirectory: '.agents/skills',
    });
}
async function runImportCopilotSkillsToCursorCommand() {
    await runImportCopilotGuidanceCommand({
        skillLabel: 'Cursor',
        targetDirectory: '.cursor/skills',
        skillDirectorySegments: ['.cursor', 'skills'],
    });
}
async function runImportCopilotSkillsToClaudeCodeCommand() {
    await runImportCopilotGuidanceCommand({
        skillLabel: 'Claude Code',
        targetDirectory: '.claude/skills',
        skillDirectorySegments: ['.claude', 'skills'],
    });
}
async function runListSessionsCommand() {
    if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.window.showInformationMessage('Open a workspace folder before listing sessions.');
        return;
    }
    const sessions = await listSessionsAcrossWorkspaceFolders(vscode.workspace.workspaceFolders);
    if (!sessions.length) {
        await vscode.window.showInformationMessage('No saved sessions found.');
        return;
    }
    await vscode.window.showQuickPick(sessions, { title: 'Saved chat sessions' });
}
async function runDeleteSessionCommand() {
    if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.window.showInformationMessage('Open a workspace folder before deleting sessions.');
        return;
    }
    const sessions = await listSessionsAcrossWorkspaceFolders(vscode.workspace.workspaceFolders);
    if (!sessions.length) {
        await vscode.window.showInformationMessage('No saved sessions found.');
        return;
    }
    const pick = await vscode.window.showQuickPick(sessions, { title: 'Select saved session to delete' });
    if (!pick) {
        return;
    }
    const confirmation = await vscode.window.showWarningMessage(`Delete session '${pick.label}'?`, { modal: true }, 'Delete');
    if (confirmation !== 'Delete') {
        return;
    }
    const deleted = await sessionStore.deleteSession(pick.storageDirectory, pick.fileName);
    if (!deleted) {
        await vscode.window.showInformationMessage('Session file no longer exists.');
        return;
    }
    await vscode.window.showInformationMessage(`Deleted session ${pick.label}`);
}
function createDefaultOpenSavedSessionDeps() {
    return {
        getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
        listSessionsAcrossWorkspaceFolders,
        pickSession: async (sessions) => vscode.window.showQuickPick(sessions, { title: 'Select saved session to open' }),
        readSession: async (storageDirectory, fileName) => sessionStore.readSession(storageDirectory, fileName),
        showSession: (session, extensionUri, storageDirectory, fileName) => {
            sessionViewer_1.SessionViewerPanel.createOrShow(session, extensionUri, storageDirectory, fileName);
        },
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
    };
}
async function runOpenSavedSessionCommand(context, target, depsOverrides = {}) {
    const deps = {
        ...createDefaultOpenSavedSessionDeps(),
        ...depsOverrides,
    };
    let selectedTarget = target;
    if (!selectedTarget) {
        const workspaceFolders = deps.getWorkspaceFolders();
        if (!workspaceFolders?.length) {
            await deps.showInformationMessage('Open a workspace folder before opening saved sessions.');
            return;
        }
        const sessions = await deps.listSessionsAcrossWorkspaceFolders(workspaceFolders);
        if (!sessions.length) {
            await deps.showInformationMessage('No saved sessions found.');
            return;
        }
        const pick = await deps.pickSession(sessions);
        if (!pick) {
            return;
        }
        selectedTarget = pick;
    }
    const session = await deps.readSession(selectedTarget.storageDirectory, selectedTarget.fileName);
    deps.showSession(session, context.extensionUri, selectedTarget.storageDirectory, selectedTarget.fileName);
}
async function runViewSessionFileCommand(context, depsOverrides = {}) {
    const deps = {
        getActiveEditor: () => vscode.window.activeTextEditor,
        showSession: (session, extensionUri, storageDirectory, fileName) => {
            sessionViewer_1.SessionViewerPanel.createOrShow(session, extensionUri, storageDirectory, fileName);
        },
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        ...depsOverrides,
    };
    const editor = deps.getActiveEditor();
    if (!editor) {
        await deps.showInformationMessage('Open a JSON session file before using Session Viewer.');
        return;
    }
    const document = editor.document;
    if (document.uri.scheme !== 'file') {
        await deps.showInformationMessage('Only local JSON files can be opened in Session Viewer.');
        return;
    }
    const parsed = parseSessionDocument(document.getText());
    if (parsed.kind === 'invalid-json') {
        await deps.showInformationMessage('The active file is not valid JSON.');
        return;
    }
    if (parsed.kind === 'not-session') {
        await deps.showInformationMessage('This file is not a recognized Session Control session format.');
        return;
    }
    const filePath = document.uri.fsPath;
    deps.showSession(parsed.session, context.extensionUri, path.dirname(filePath), path.basename(filePath));
}
async function runImplementLatestAnalysisCommand(depsOverrides = {}) {
    const deps = {
        ...createDefaultImplementLatestAnalysisDeps(),
        ...depsOverrides,
    };
    const workspaceFolders = deps.getWorkspaceFolders();
    if (!workspaceFolders?.length) {
        await deps.showInformationMessage('Open a workspace folder before implementing from a saved analysis.');
        return;
    }
    const latest = await findLatestUsableAnalysisReport(workspaceFolders, deps);
    if (!latest.report) {
        if (latest.warnings.length > 0) {
            await deps.showWarningMessage(`No usable saved analysis report was found. ${latest.warnings[0] ?? ''}`.trim());
            return;
        }
        await deps.showInformationMessage('No saved analysis reports found. Run Session Control: Analyze Saved Chats or @session-control /analyze first.');
        return;
    }
    const prompt = deps.buildPrompt(path.join(latest.report.storageDirectory, latest.report.reportPath), '');
    const agentSessionCommandId = findAgentSessionCommandId(await deps.getCommands());
    const target = await deps.pickTarget(agentSessionCommandId !== undefined);
    if (!target) {
        return;
    }
    if (target === 'agentSession' && agentSessionCommandId) {
        try {
            await deps.writeClipboard(prompt);
            await deps.openAgentSession(agentSessionCommandId);
            await deps.showInformationMessage(`Opened an agent session for the latest saved analysis from ${latest.report.workspaceFolder.name}. The generated implementation prompt is on the clipboard.`);
            return;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await deps.showWarningMessage(`Failed to open an agent session (${message}). Opening chat instead.`);
        }
    }
    try {
        await deps.openChat(prompt);
        await deps.showInformationMessage(`Opened chat with an implementation prompt for ${latest.report.selectionLabel}.`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deps.showWarningMessage(`Failed to open chat with the generated implementation prompt: ${message}`);
    }
}
async function runAnalyzeSavedChatsCommand(requestPrompt = '', depsOverrides = {}) {
    const deps = {
        ...createDefaultAnalyzeSavedChatsCommandDeps(),
        ...depsOverrides,
    };
    const workspaceFolders = deps.getWorkspaceFolders();
    if (!workspaceFolders?.length) {
        await deps.showInformationMessage('Open a workspace folder before analyzing saved chats.');
        return;
    }
    const workspaceSessions = await deps.listSessionsAcrossWorkspaceFolders(workspaceFolders);
    if (!workspaceSessions.length) {
        await deps.showInformationMessage('No saved sessions found. Save chat sessions before running analysis.');
        return;
    }
    const selection = await deps.resolveSelection(requestPrompt);
    if (!selection) {
        return;
    }
    let models;
    try {
        models = await deps.selectChatModels();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deps.showWarningMessage(`Failed to access a chat model for analysis: ${message}`);
        return;
    }
    const model = models[0];
    if (!model) {
        if (/cursor/i.test(deps.getAppName())) {
            let handoff;
            try {
                handoff = await deps.buildCursorHandoffPrompt(workspaceFolders, workspaceSessions, selection);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await deps.showWarningMessage(`Cursor does not currently expose extension-callable chat models, and Session Control could not build an analysis handoff prompt: ${message}`);
                return;
            }
            if (handoff.infoMessage) {
                await deps.showInformationMessage(handoff.infoMessage);
                return;
            }
            if (!handoff.prompt) {
                await deps.showWarningMessage('Cursor does not currently expose extension-callable chat models, and no analysis handoff prompt could be generated.');
                return;
            }
            try {
                await deps.openChat(handoff.prompt);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await deps.showWarningMessage(`Cursor does not currently expose extension-callable chat models, and opening chat with the analysis handoff prompt failed: ${message}`);
                return;
            }
            await deps.showInformationMessage('Cursor does not currently expose extension-callable chat models, so Session Control opened chat with an analysis handoff prompt. Send it in chat to continue.');
            return;
        }
        await deps.showWarningMessage('No host chat model is available for analysis. Sign in or enable a chat model, then try again.');
        return;
    }
    let lastStatusMessage = '';
    const result = await deps.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Session Control',
        cancellable: true,
    }, async (progress, token) => {
        progress.report({ message: 'Analyzing saved chats...' });
        return deps.runAnalyzeFlow(workspaceFolders, workspaceSessions, selection, model, token, (markdown) => {
            lastStatusMessage = sanitizeMarkdownForStatusMessage(markdown);
            if (lastStatusMessage) {
                progress.report({ message: lastStatusMessage });
            }
        });
    });
    if (!result) {
        if (lastStatusMessage) {
            await deps.showInformationMessage(lastStatusMessage);
        }
        return;
    }
    const reportUri = vscode.Uri.file(path.join(result.metadata.analysisStorageDirectory, result.metadata.analysisReportPath));
    try {
        const document = await deps.openTextDocument(reportUri);
        await deps.showTextDocument(document);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deps.showWarningMessage(`Saved the analysis report, but failed to open it: ${message}`);
        return;
    }
    await deps.showInformationMessage(`Saved analysis report to ${result.metadata.analysisReportPath}. Run Session Control: Implement Latest Analysis to continue.`);
}
function parseSessionDocument(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { kind: 'invalid-json' };
    }
    if (!(0, types_1.isChatSession)(parsed)) {
        return { kind: 'not-session' };
    }
    return { kind: 'ok', session: parsed };
}
function createDefaultAutoSaveOnChatResponseDeps(context) {
    const autoSaveCursorSessionReader = (0, cursorSessionReader_1.createCursorSessionReader)({
        showInformationMessage: async () => undefined,
    });
    const autoSaveCodexSessionReader = (0, codexSessionReader_1.createCodexSessionReader)({
        showInformationMessage: async () => undefined,
    });
    const autoSaveClaudeCodeSessionReader = (0, claudeCodeSessionReader_1.createClaudeCodeSessionReader)({
        showInformationMessage: async () => undefined,
    });
    return {
        getStorageUri: () => context.storageUri,
        createWatcher: (sessionsDirectory, globPattern) => {
            const pattern = new vscode.RelativePattern(vscode.Uri.file(sessionsDirectory), globPattern);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            return {
                onDidChange: (listener) => watcher.onDidChange(() => listener()),
                onDidCreate: (listener) => watcher.onDidCreate(() => listener()),
                dispose: () => watcher.dispose(),
            };
        },
        getImplicitWorkspaceFolder,
        getSaveProvider,
        getAutoSaveProviders,
        getCodexHomePath,
        getClaudeCodeHomePath,
        getCursorProjectsPath,
        readCopilotSessions: () => (0, sessionReader_1.readCopilotSessions)(context),
        readCodexSessions: async (workspaceFolder) => filterSessionsForWorkspace(await autoSaveCodexSessionReader.readCodexSessions(getCodexHomePath(workspaceFolder)), workspaceFolder, 'codex'),
        readClaudeCodeSessions: async (workspaceFolder) => filterSessionsForWorkspace(await autoSaveClaudeCodeSessionReader.readClaudeCodeSessions(getClaudeCodeHomePath(workspaceFolder), workspaceFolder.uri.fsPath), workspaceFolder, 'claude-code'),
        readCursorSessions: (workspaceFolder) => autoSaveCursorSessionReader.readCursorSessions(workspaceFolder, {
            cursorUserDataPath: getCursorUserDataPath(workspaceFolder),
            cursorProjectsPath: getCursorProjectsPath(workspaceFolder),
        }, context),
        saveSessionSilently: async (workspaceFolder, storageDirectory, provider, sessions) => runSaveSourceSessionFlow(provider, sessions, workspaceFolder, storageDirectory, {
            selectSession: async (sessions) => sessions[0],
            promptTitle: async (defaultTitle) => defaultTitle,
            showInformationMessage: async () => undefined,
        }),
        deleteOldAutoSave: async (storageDirectory, fileName) => {
            await sessionStore.deleteSession(storageDirectory, fileName);
        },
        showWarningMessage: (message) => vscode.window.showWarningMessage(message),
        schedule: (callback, delayMs) => setTimeout(callback, delayMs),
        clearSchedule: (handle) => clearTimeout(handle),
    };
}
function resolveAutoSaveWatchTargets(workspaceFolder, provider, storageUri, deps) {
    if (provider === 'copilot') {
        if (!storageUri) {
            return [];
        }
        return [{
                provider,
                directory: (0, sessionReader_1.deriveChatSessionsPath)(storageUri.fsPath),
                glob: '*.{json,jsonl}',
                label: 'Copilot chatSessions',
            }];
    }
    if (provider === 'cursor') {
        const projectSlug = (0, cursorAgentTranscriptReader_1.deriveCursorProjectSlug)(workspaceFolder.uri.fsPath);
        const projectRoot = path.join(deps.getCursorProjectsPath(workspaceFolder), projectSlug);
        return [{
                provider,
                directory: projectRoot,
                glob: 'agent-transcripts/**/*.jsonl',
                label: 'Cursor agent transcripts',
            }];
    }
    if (provider === 'codex') {
        return [{
                provider,
                directory: deps.getCodexHomePath(workspaceFolder),
                glob: 'sessions/**/*.{json,jsonl}',
                label: 'Codex session transcripts',
            }];
    }
    if (provider === 'claude-code') {
        const projectSlug = (0, claudeCodeSessionReader_1.deriveClaudeCodeProjectSlug)(workspaceFolder.uri.fsPath);
        const projectDirectory = path.join((0, claudeCodeSessionReader_1.deriveClaudeCodeProjectsPath)(deps.getClaudeCodeHomePath(workspaceFolder)), projectSlug);
        return [{
                provider,
                directory: projectDirectory,
                glob: '*.jsonl',
                label: 'Claude Code transcripts',
            }];
    }
    return [];
}
async function readAutoSaveSessionsForProvider(provider, workspaceFolder, deps) {
    if (provider === 'cursor') {
        return deps.readCursorSessions(workspaceFolder);
    }
    if (provider === 'codex') {
        return deps.readCodexSessions(workspaceFolder);
    }
    if (provider === 'claude-code') {
        return deps.readClaudeCodeSessions(workspaceFolder);
    }
    return deps.readCopilotSessions();
}
function registerAutoSaveOnChatResponseListener(context, output, depsOverrides = {}) {
    const deps = {
        ...createDefaultAutoSaveOnChatResponseDeps(context),
        ...depsOverrides,
    };
    const storageUri = deps.getStorageUri();
    const workspaceFolder = deps.getImplicitWorkspaceFolder();
    if (!workspaceFolder) {
        output.appendLine('[auto-save] No workspace folder is open. Chat response auto-save is disabled.');
        return undefined;
    }
    const providers = deps.getAutoSaveProviders(workspaceFolder);
    const watchTargets = providers.flatMap((provider) => resolveAutoSaveWatchTargets(workspaceFolder, provider, storageUri, deps));
    if (!watchTargets.length) {
        output.appendLine(`[auto-save] No watch targets available for providers ${providers.join(', ')}.`);
        return undefined;
    }
    const watchers = watchTargets.map((target) => {
        output.appendLine(`[auto-save] Watching ${target.label}: ${target.directory} (${target.glob})`);
        return deps.createWatcher(target.directory, target.glob);
    });
    const lastAutoSave = new Map();
    const debounceTimers = new Map();
    let disabled = false;
    const disposables = [];
    const onStorageChanged = (provider) => {
        if (disabled) {
            output.appendLine('[auto-save] Skipped — listener disabled due to a previous error. Reload VS Code to re-enable.');
            return;
        }
        output.appendLine('[auto-save] File change detected, debouncing 5 s…');
        const debounceTimer = debounceTimers.get(provider);
        if (debounceTimer) {
            deps.clearSchedule(debounceTimer);
        }
        const nextDebounceTimer = deps.schedule(() => {
            debounceTimers.delete(provider);
            void (async () => {
                try {
                    const sessions = await readAutoSaveSessionsForProvider(provider, workspaceFolder, deps);
                    output.appendLine(`[auto-save] Read ${sessions.length} ${getProviderLabel(provider)} session(s).`);
                    if (!sessions.length) {
                        output.appendLine('[auto-save] No sessions found — nothing to save.');
                        return;
                    }
                    const latest = sessions[0];
                    if (!latest) {
                        return;
                    }
                    output.appendLine(`[auto-save] Latest: "${latest.title}" id=${latest.id} turns=${latest.turns.length}`);
                    const autoSaveKey = `${provider}:${latest.id}`;
                    const prev = lastAutoSave.get(autoSaveKey);
                    if (prev && prev.turnCount >= latest.turns.length) {
                        output.appendLine(`[auto-save] Skipped — turn count unchanged (${latest.turns.length}).`);
                        return;
                    }
                    const storageDirectory = getStoragePath(workspaceFolder);
                    output.appendLine(`[auto-save] Saving to ${storageDirectory}…`);
                    const newFileName = await deps.saveSessionSilently(workspaceFolder, storageDirectory, provider, sessions);
                    if (!newFileName) {
                        output.appendLine('[auto-save] Save returned no filename — session may already be up to date.');
                        return;
                    }
                    if (prev?.fileName && prev.fileName !== newFileName) {
                        try {
                            await deps.deleteOldAutoSave(storageDirectory, prev.fileName);
                        }
                        catch {
                            // Ignore cleanup errors for previous auto-save files
                        }
                    }
                    lastAutoSave.set(autoSaveKey, {
                        fileName: newFileName,
                        turnCount: latest.turns.length,
                    });
                    output.appendLine(`[auto-save] Saved "${latest.title}" (${latest.turns.length} turns) after chat response.`);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    output.appendLine(`[auto-save] Disabled after chat response save error: ${message}`);
                    void deps.showWarningMessage('Session Control auto-save on chat response encountered an error and was disabled for this session.');
                    disabled = true;
                }
            })();
        }, 5000);
        debounceTimers.set(provider, nextDebounceTimer);
    };
    for (let index = 0; index < watchers.length; index += 1) {
        const watcher = watchers[index];
        const target = watchTargets[index];
        if (!watcher || !target) {
            continue;
        }
        disposables.push(watcher.onDidChange(() => onStorageChanged(target.provider)), watcher.onDidCreate(() => onStorageChanged(target.provider)));
    }
    const registration = {
        dispose: () => {
            for (const debounceTimer of debounceTimers.values()) {
                deps.clearSchedule(debounceTimer);
            }
            debounceTimers.clear();
            for (const watcher of watchers) {
                watcher.dispose();
            }
            for (const d of disposables) {
                d.dispose();
            }
        },
    };
    context.subscriptions.push(registration);
    return registration;
}
function getImplicitWorkspaceFolder() {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
        if (workspaceFolder) {
            return workspaceFolder;
        }
    }
    return vscode.workspace.workspaceFolders?.[0];
}
function isAnyWorkspaceAutoSaveOnChatResponseEnabled() {
    return (vscode.workspace.workspaceFolders ?? []).some((workspaceFolder) => vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('autoSaveOnChatResponse', false));
}
function updateAutoSaveStatusBar(item) {
    const workspaceFolder = getImplicitWorkspaceFolder();
    if (!workspaceFolder) {
        item.hide();
        return;
    }
    const config = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
    const chatResponseEnabled = config.get('autoSaveOnChatResponse', false);
    item.text = `$(history) Session Control ${chatResponseEnabled ? 'Auto-Save On' : 'Auto-Save Off'}`;
    if (chatResponseEnabled) {
        item.tooltip = `${workspaceFolder.name}: auto-save on chat response`;
    }
    else {
        item.tooltip = `${workspaceFolder.name}: click to enable auto-save`;
    }
    item.show();
}
async function runResumeSessionFromViewerCommand() {
    const panel = sessionViewer_1.SessionViewerPanel.currentPanel;
    if (!panel) {
        await vscode.window.showInformationMessage('No session viewer is currently open.');
        return;
    }
    const sessionTitle = panel.getSessionTitle();
    if (!sessionTitle) {
        await vscode.window.showWarningMessage('Unable to determine session title.');
        return;
    }
    const openCopilotResume = async () => {
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: `@session-control /resume ${sessionTitle}`,
        });
    };
    const session = panel.getSession();
    const provider = panel.getSessionProvider();
    if (session && provider && provider !== 'copilot') {
        const fileUri = vscode.Uri.file(panel.getFilePath());
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) ?? getImplicitWorkspaceFolder();
        const configuration = vscode.workspace.getConfiguration('session-control', workspaceFolder?.uri ?? fileUri);
        const resumeTargetMode = configuration.get('resume.target', 'origin-agent');
        if (resumeTargetMode === 'origin-agent') {
            const openedOriginAgent = await (0, chatParticipant_1.runResumeIntoOriginAgent)(session, 'Continue this session.', {
                maxTurns: configuration.get('resume.maxTurns', 50),
                maxContextChars: configuration.get('resume.maxContextChars', 80000),
                overflowStrategy: configuration.get('resume.overflowStrategy', 'summarize'),
                providerCommands: configuration.get('resume.providerCommands', {}),
            }, {
                getCommands: async () => vscode.commands.getCommands(true),
                executeCommand: async (commandId, args) => {
                    if (args === undefined) {
                        await vscode.commands.executeCommand(commandId);
                        return;
                    }
                    await vscode.commands.executeCommand(commandId, args);
                },
                writeClipboard: async (text) => vscode.env.clipboard.writeText(text),
                streamMarkdown: (markdown) => {
                    void vscode.window.showInformationMessage(markdown.replace(/\s+/g, ' ').trim());
                },
            });
            if (openedOriginAgent) {
                return;
            }
        }
    }
    // Open the chat panel with a pre-filled resume command
    try {
        await openCopilotResume();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Failed to open chat: ${message}`);
    }
}
function activate(context) {
    const sessionExplorerProvider = new sessionExplorer_1.SessionExplorerProvider();
    const sessionExplorerView = vscode.window.createTreeView('session-control.sessionExplorer', {
        treeDataProvider: sessionExplorerProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(sessionExplorerView);
    const autoSaveStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    autoSaveStatusBar.command = 'session-control.toggleAutoSave';
    context.subscriptions.push(autoSaveStatusBar);
    const output = vscode.window.createOutputChannel('Session Control');
    context.subscriptions.push(output);
    let autoSaveOnChatResponseListener;
    const syncAutoSaveOnChatResponseListener = () => {
        const enabled = isAnyWorkspaceAutoSaveOnChatResponseEnabled();
        if (enabled && !autoSaveOnChatResponseListener) {
            autoSaveOnChatResponseListener = registerAutoSaveOnChatResponseListener(context, output);
            return;
        }
        if (!enabled && autoSaveOnChatResponseListener) {
            autoSaveOnChatResponseListener.dispose();
            autoSaveOnChatResponseListener = undefined;
        }
    };
    syncAutoSaveOnChatResponseListener();
    updateAutoSaveStatusBar(autoSaveStatusBar);
    const updateSessionFileContext = (editor) => {
        const document = editor?.document;
        const isSessionFile = document?.uri.scheme === 'file'
            && (path.extname(document.uri.fsPath).toLowerCase() === '.json' || path.extname(document.uri.fsPath).toLowerCase() === '.jsonl')
            && parseSessionDocument(document.getText()).kind === 'ok';
        void vscode.commands.executeCommand('setContext', 'session-control.isSessionFile', Boolean(isSessionFile));
    };
    updateSessionFileContext(vscode.window.activeTextEditor);
    context.subscriptions.push(vscode.commands.registerCommand('session-control.saveSession', async () => {
        await runSaveSessionCommand(context);
        sessionExplorerProvider.refresh();
    }), vscode.commands.registerCommand('session-control.saveSessionFromProvider', async () => {
        await runSaveSessionFromProviderCommand(context);
        sessionExplorerProvider.refresh();
    }), vscode.commands.registerCommand('session-control.listSessions', async () => runListSessionsCommand()), vscode.commands.registerCommand('session-control.deleteSession', async () => {
        await runDeleteSessionCommand();
        sessionExplorerProvider.refresh();
    }), vscode.commands.registerCommand('session-control.refreshSessionExplorer', () => sessionExplorerProvider.refresh()), vscode.commands.registerCommand('session-control.openSessionFromExplorer', async (item) => {
        try {
            await runOpenSavedSessionCommand(context, item);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await vscode.window.showErrorMessage(`Failed to open session: ${message}`);
        }
    }), vscode.commands.registerCommand('session-control.viewSessionFile', async () => {
        await runViewSessionFileCommand(context);
    }), vscode.commands.registerCommand('session-control.resumeSessionFromViewer', async () => {
        await runResumeSessionFromViewerCommand();
    }), vscode.commands.registerCommand('session-control.analyzeSavedChats', async () => {
        await runAnalyzeSavedChatsCommand();
    }), vscode.commands.registerCommand('session-control.implementLatestAnalysis', async () => {
        await runImplementLatestAnalysisCommand();
    }), vscode.commands.registerCommand('session-control.importCopilotSkillsToCursor', async () => {
        await runImportCopilotSkillsToCursorCommand();
    }), vscode.commands.registerCommand('session-control.importCopilotSkillsToCodex', async () => {
        await runImportCopilotSkillsToCodexCommand();
    }), vscode.commands.registerCommand('session-control.importCopilotSkillsToClaudeCode', async () => {
        await runImportCopilotSkillsToClaudeCodeCommand();
    }), vscode.commands.registerCommand('session-control.deleteSessionFromExplorer', async (item) => {
        const confirmation = await vscode.window.showWarningMessage(`Delete session '${item.label}'?`, { modal: true }, 'Delete');
        if (confirmation !== 'Delete') {
            return;
        }
        const deleted = await sessionStore.deleteSession(item.storageDirectory, item.fileName);
        if (!deleted) {
            await vscode.window.showInformationMessage('Session file no longer exists.');
            sessionExplorerProvider.refresh();
            return;
        }
        await vscode.window.showInformationMessage(`Deleted session ${item.label}`);
        sessionExplorerProvider.refresh();
    }), vscode.commands.registerCommand('session-control.toggleAutoSave', async () => {
        const workspaceFolder = await resolveManualWorkspaceFolder({
            getActiveEditorUri: () => vscode.window.activeTextEditor?.document.uri,
        });
        if (!workspaceFolder) {
            await vscode.window.showInformationMessage('Open a workspace folder before changing auto-save.');
            return;
        }
        const configuration = vscode.workspace.getConfiguration('session-control', workspaceFolder.uri);
        const current = configuration.get('autoSaveOnChatResponse', false);
        await configuration.update('autoSaveOnChatResponse', !current, vscode.ConfigurationTarget.WorkspaceFolder);
        updateAutoSaveStatusBar(autoSaveStatusBar);
        syncAutoSaveOnChatResponseListener();
        await vscode.window.showInformationMessage(`${workspaceFolder.name}: auto-save on chat response ${current ? 'disabled' : 'enabled'}.`);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        sessionExplorerProvider.refresh();
        syncAutoSaveOnChatResponseListener();
        updateAutoSaveStatusBar(autoSaveStatusBar);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('session-control.autoSaveOnChatResponse')
            || event.affectsConfiguration('session-control.save.provider')
            || event.affectsConfiguration('session-control.codex.homePath')
            || event.affectsConfiguration('session-control.claudeCode.homePath')
            || event.affectsConfiguration('session-control.cursor.projectsPath')
            || event.affectsConfiguration('session-control.cursor.userDataPath')) {
            if (autoSaveOnChatResponseListener) {
                autoSaveOnChatResponseListener.dispose();
                autoSaveOnChatResponseListener = undefined;
            }
            syncAutoSaveOnChatResponseListener();
            updateAutoSaveStatusBar(autoSaveStatusBar);
        }
        if (event.affectsConfiguration('session-control.storagePath')) {
            sessionExplorerProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        updateAutoSaveStatusBar(autoSaveStatusBar);
        updateSessionFileContext(editor);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
            updateSessionFileContext(vscode.window.activeTextEditor);
        }
    }));
    (0, chatParticipant_1.registerChatParticipant)(context);
}
function deactivate() {
    // Cleanup handled via context.subscriptions disposal above.
}
//# sourceMappingURL=extension.js.map