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
exports.runAnalyzeSessionsFlow = void 0;
exports.renderSessionListMarkdown = renderSessionListMarkdown;
exports.resolveAnalysisSelection = resolveAnalysisSelection;
exports.createAnalysisCandidates = createAnalysisCandidates;
exports.createAnalyzeSessionsFlowDeps = createAnalyzeSessionsFlowDeps;
exports.runResumeIntoOriginAgent = runResumeIntoOriginAgent;
exports.runImplementationHandoffFlow = runImplementationHandoffFlow;
exports.buildParticipantFollowups = buildParticipantFollowups;
exports.trimTurnsForResume = trimTurnsForResume;
exports.resolveSummarizeNoteWithFallback = resolveSummarizeNoteWithFallback;
exports.buildResumePrompt = buildResumePrompt;
exports.selectSessionForResume = selectSessionForResume;
exports.loadReassembledSession = loadReassembledSession;
exports.registerChatParticipant = registerChatParticipant;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const analysisStore_1 = require("./analysisStore");
const analysisOrchestrator_1 = require("./analysisOrchestrator");
const sessionStore_1 = require("./sessionStore");
const sessionAnalysis_1 = require("./sessionAnalysis");
const resumeTarget_1 = require("./resumeTarget");
const utils_1 = require("./utils");
var analysisOrchestrator_2 = require("./analysisOrchestrator");
Object.defineProperty(exports, "runAnalyzeSessionsFlow", { enumerable: true, get: function () { return analysisOrchestrator_2.runAnalyzeSessionsFlow; } });
const chatSessionStore = (0, sessionStore_1.createSessionStore)();
const analysisStore = (0, analysisStore_1.createAnalysisStore)();
const CHAT_PARTICIPANT_ID = 'session-control.resume';
const MIN_AUTO_SELECT_SCORE = 60;
const AI_RECOMMENDATION_FILE_PATTERNS = [
    'AGENTS.md',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    '**/SKILL.md',
    '**/*.instructions.md',
    '**/*.prompt.md',
    '**/*.agent.md',
];
const AI_RECOMMENDATION_EXCLUDE_GLOB = '**/{.git,node_modules,dist,dist-test,.vscode-test}/**';
const MAX_AI_RECOMMENDATION_BASELINE_CHARS = 16000;
const MAX_AI_RECOMMENDATION_FILE_CHARS = 4000;
const CLAUDE_CODE_FOCUS_MOUNT_DELAY_MS = 250;
const CLAUDE_CODE_NEW_CONVERSATION_SETTLE_MS = 250;
const CLAUDE_CODE_PASTE_SETTLE_MS = 75;
const CLAUDE_CODE_PASTE_RETRY_DELAY_MS = 150;
const CLAUDE_CODE_PASTE_MAX_ATTEMPTS = 6;
const CODEX_PASTE_SETTLE_MS = 250;
const CODEX_PASTE_RETRY_DELAY_MS = 150;
const CODEX_PASTE_MAX_ATTEMPTS = 6;
const SUMMARIZE_FALLBACK_NOTE = 'Summary generation failed - showing most recent turns only.';
async function sleepFor(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function pasteClipboardIntoFocusedChat(provider, focusCommand, deps) {
    const sleep = deps.sleep ?? sleepFor;
    let settleMs = 0;
    let retryDelayMs = 0;
    let attemptCount = 1;
    if (provider === 'claude-code' && focusCommand === 'claude-vscode.focus') {
        // Claude's focus command dispatches through the webview bridge. On a cold
        // sidebar open the first focus event can fire before the webview is ready
        // to receive it, so wait for mount, refocus, then give the input a beat
        // to claim focus before we paste.
        await sleep(CLAUDE_CODE_FOCUS_MOUNT_DELAY_MS);
        await deps.executeCommand(focusCommand);
        settleMs = CLAUDE_CODE_PASTE_SETTLE_MS;
        retryDelayMs = CLAUDE_CODE_PASTE_RETRY_DELAY_MS;
        attemptCount = CLAUDE_CODE_PASTE_MAX_ATTEMPTS;
    }
    if (provider === 'codex') {
        // Codex can take a moment to mount the composer on a cold sidebar open,
        // even after the view itself is focused.
        settleMs = CODEX_PASTE_SETTLE_MS;
        retryDelayMs = CODEX_PASTE_RETRY_DELAY_MS;
        attemptCount = CODEX_PASTE_MAX_ATTEMPTS;
    }
    if (settleMs > 0) {
        await sleep(settleMs);
    }
    let lastError;
    for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        try {
            await deps.executeCommand('editor.action.clipboardPasteAction');
            return;
        }
        catch (error) {
            lastError = error;
            if (attempt >= attemptCount) {
                throw error;
            }
            await sleep(retryDelayMs);
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(lastError ? String(lastError) : 'Automatic paste failed.');
}
async function prepareClaudeCodeConversationForResume(availableCommands, deps) {
    if (!availableCommands.includes('claude-vscode.newConversation')) {
        return;
    }
    const sleep = deps.sleep ?? sleepFor;
    await sleep(CLAUDE_CODE_FOCUS_MOUNT_DELAY_MS);
    await deps.executeCommand('claude-vscode.newConversation');
    await sleep(CLAUDE_CODE_NEW_CONVERSATION_SETTLE_MS);
}
function getStoragePath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('storagePath', '.chat');
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
function pickWorkspaceFolder() {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const fromActiveEditor = vscode.workspace.getWorkspaceFolder(activeUri);
        if (fromActiveEditor) {
            return fromActiveEditor;
        }
    }
    return vscode.workspace.workspaceFolders?.[0];
}
function asMarkdownListItem(session) {
    const commit = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
    const branch = session.git?.branch ?? 'n/a';
    return `- **${session.title}** | ${session.savedAt} | ${session.turnCount} turns | ${branch}@${commit}`;
}
function asWorkspaceMarkdownListItem(session) {
    const commit = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
    const branch = session.git?.branch ?? 'n/a';
    return `- **[${session.workspaceFolder.name}] ${session.title}** | ${session.savedAt} | ${session.turnCount} turns | ${branch}@${commit}`;
}
function normalizeRelativePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function truncateText(value, maxChars) {
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, Math.max(0, maxChars)).trimEnd()}\n...[truncated]`;
}
async function findExistingAiInstructionFiles(workspaceFolder) {
    const matches = await Promise.all(AI_RECOMMENDATION_FILE_PATTERNS.map(async (pattern) => vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, pattern), AI_RECOMMENDATION_EXCLUDE_GLOB)));
    const deduped = new Map();
    for (const uri of matches.flat()) {
        deduped.set(uri.fsPath.toLowerCase(), uri);
    }
    return [...deduped.values()].sort((left, right) => left.fsPath.localeCompare(right.fsPath));
}
async function loadRecommendationBaseline(workspaceFolders, candidates) {
    const relevantStorageDirectories = new Set(candidates.map((candidate) => candidate.storageDirectory));
    const relevantWorkspaces = workspaceFolders.filter((workspaceFolder) => {
        try {
            return relevantStorageDirectories.has(getStoragePath(workspaceFolder));
        }
        catch {
            return false;
        }
    });
    if (!relevantWorkspaces.length) {
        return '';
    }
    const lines = [];
    let remainingChars = MAX_AI_RECOMMENDATION_BASELINE_CHARS;
    for (const workspaceFolder of relevantWorkspaces) {
        lines.push(`### Workspace: ${workspaceFolder.name}`);
        lines.push('');
        const files = await findExistingAiInstructionFiles(workspaceFolder);
        if (!files.length) {
            lines.push('No existing AI instruction or skill files found.');
            lines.push('');
            continue;
        }
        for (const file of files) {
            if (remainingChars <= 0) {
                lines.push('[Additional AI instruction or skill files omitted due to prompt budget.]');
                lines.push('');
                break;
            }
            const relativePath = normalizeRelativePath(path.relative(workspaceFolder.uri.fsPath, file.fsPath));
            let content;
            try {
                content = await fs.readFile(file.fsPath, 'utf8');
            }
            catch {
                continue;
            }
            const normalizedContent = content.trim().length > 0 ? content : '[empty file]';
            const maxCharsForFile = Math.min(MAX_AI_RECOMMENDATION_FILE_CHARS, remainingChars);
            const truncatedContent = truncateText(normalizedContent, maxCharsForFile);
            remainingChars -= truncatedContent.length;
            lines.push(`#### ${relativePath}`);
            lines.push('');
            lines.push('```md');
            lines.push(truncatedContent);
            lines.push('```');
            lines.push('');
        }
    }
    return lines.join('\n').trim();
}
async function listSessionsAcrossWorkspaceFolders(workspaceFolders) {
    if (!workspaceFolders?.length) {
        return [];
    }
    const results = await Promise.all(workspaceFolders.map(async (workspaceFolder) => {
        const storageDirectory = getStoragePath(workspaceFolder);
        const sessions = await chatSessionStore.listSessions(storageDirectory);
        return sessions.map((session) => ({
            ...session,
            workspaceFolder,
            storageDirectory,
            displayTitle: `[${workspaceFolder.name}] ${session.title}`,
        }));
    }));
    return results.flat().sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}
function renderSessionListMarkdown(sessions) {
    if (!sessions.length) {
        return 'No saved sessions found. Use Command Palette: Session Control: Save Current Chat Session.';
    }
    return ['## Saved Sessions', '', ...sessions.map((session) => asMarkdownListItem(session))].join('\n');
}
function renderWorkspaceSessionListMarkdown(sessions) {
    if (!sessions.length) {
        return 'No saved sessions found. Use Command Palette: Session Control: Save Current Chat Session.';
    }
    return ['## Saved Sessions', '', ...sessions.map((session) => asWorkspaceMarkdownListItem(session))].join('\n');
}
function normalizeDateInput(value, endOfDay) {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return `${trimmed}T${endOfDay ? '23:59:59.999Z' : '00:00:00.000Z'}`;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('Date input must be ISO-8601 or YYYY-MM-DD.');
    }
    return parsed.toISOString();
}
async function promptDateRangeAnalysisMode() {
    const pick = await vscode.window.showQuickPick([
        {
            label: 'Only unanalyzed items in this range',
            description: 'Skip chats in the date range that were already analyzed unless their content changed',
            onlyUnanalyzed: true,
        },
        {
            label: 'Everything in this range',
            description: 'Re-analyze all chats in the date range even if they were analyzed before',
            onlyUnanalyzed: false,
        },
    ], { title: 'Choose how to analyze the selected date range' });
    return pick?.onlyUnanalyzed;
}
async function resolveAnalysisSelection(prompt) {
    const parsed = (0, sessionAnalysis_1.parseAnalysisSelectionAlias)(prompt);
    if (parsed) {
        return parsed;
    }
    const pick = await vscode.window.showQuickPick([
        { label: 'Last 24 Hours', mode: 'last24Hours' },
        { label: 'Last 7 Days', mode: 'last7Days' },
        { label: 'Last 30 Days', mode: 'last30Days' },
        { label: 'Custom Range', mode: 'customRange' },
        { label: 'Needs Analysis', mode: 'needsAnalysis' },
    ], { title: 'Select saved-chat analysis scope' });
    if (!pick) {
        return undefined;
    }
    if (pick.mode === 'last24Hours' || pick.mode === 'last7Days' || pick.mode === 'last30Days') {
        const onlyUnanalyzed = await promptDateRangeAnalysisMode();
        if (onlyUnanalyzed === undefined) {
            return undefined;
        }
        return (0, sessionAnalysis_1.createPresetAnalysisSelection)(pick.mode, new Date(), onlyUnanalyzed);
    }
    if (pick.mode === 'needsAnalysis') {
        return (0, sessionAnalysis_1.createNeedsAnalysisSelection)();
    }
    const startInput = await vscode.window.showInputBox({
        title: 'Analysis range start',
        prompt: 'Enter the start date as YYYY-MM-DD or ISO timestamp',
        value: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
    });
    if (!startInput) {
        return undefined;
    }
    const endInput = await vscode.window.showInputBox({
        title: 'Analysis range end',
        prompt: 'Enter the end date as YYYY-MM-DD or ISO timestamp',
        value: new Date().toISOString().slice(0, 10),
    });
    if (!endInput) {
        return undefined;
    }
    const onlyUnanalyzed = await promptDateRangeAnalysisMode();
    if (onlyUnanalyzed === undefined) {
        return undefined;
    }
    try {
        return (0, sessionAnalysis_1.createCustomRangeSelection)(normalizeDateInput(startInput, false), normalizeDateInput(endInput, true), onlyUnanalyzed);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showWarningMessage(`Invalid custom analysis range: ${message}`);
        return undefined;
    }
}
async function createAnalysisCandidates(workspaceSessions) {
    const seenRoots = new Set();
    const candidates = [];
    for (const session of workspaceSessions) {
        let reassembled;
        try {
            reassembled = await loadReassembledSession(session.storageDirectory, session.fileName);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const recoverable = error instanceof SyntaxError
                || /no such file|cannot find|enoent|invalid session schema|detected cyclic (?:previous|next)partfile chain/i.test(message);
            if (recoverable) {
                continue;
            }
            throw error;
        }
        const rootKey = `${session.storageDirectory}::${reassembled.rootFileName}`;
        if (seenRoots.has(rootKey)) {
            continue;
        }
        seenRoots.add(rootKey);
        candidates.push({
            workspaceName: session.workspaceFolder.name,
            storageDirectory: session.storageDirectory,
            fileName: reassembled.rootFileName,
            rootFileName: reassembled.rootFileName,
            fingerprint: (0, analysisStore_1.createSessionAnalysisFingerprint)(reassembled.session),
            session: reassembled.session,
        });
    }
    return candidates.sort((a, b) => Date.parse(b.session.savedAt) - Date.parse(a.session.savedAt));
}
async function loadAnalyzedFingerprintSet(candidates) {
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
async function collectModelTextFromModel(model, streamText, token, prompt) {
    const modelResponse = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
    let text = '';
    for await (const part of modelResponse.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
            text += part.value;
            if (streamText) {
                streamText(part.value);
            }
        }
    }
    return text.trim();
}
async function collectModelText(request, stream, token, prompt) {
    return collectModelTextFromModel(request.model, stream ? (markdown) => stream.markdown(markdown) : undefined, token, prompt);
}
function findLatestAnalysisReportMeta(history) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const turn = history[index];
        if (!(turn instanceof vscode.ChatResponseTurn)) {
            continue;
        }
        if (turn.participant !== CHAT_PARTICIPANT_ID) {
            continue;
        }
        const metadata = turn.result.metadata;
        if (!metadata?.analysisReportPath || !metadata.analysisStorageDirectory) {
            continue;
        }
        return {
            analysisReportPath: metadata.analysisReportPath,
            analysisStorageDirectory: metadata.analysisStorageDirectory,
        };
    }
    return null;
}
function createAnalyzeSessionsFlowDeps(overrides) {
    return {
        resolveSelection: overrides.resolveSelection ?? (async (prompt) => resolveAnalysisSelection(prompt)),
        createCandidates: overrides.createCandidates ?? (async (workspaceSessions) => createAnalysisCandidates(workspaceSessions)),
        loadAnalyzedFingerprints: overrides.loadAnalyzedFingerprints
            ?? (async (candidates) => loadAnalyzedFingerprintSet(candidates)),
        loadRecommendationBaseline: overrides.loadRecommendationBaseline ?? (async (workspaceFolders, candidates) => loadRecommendationBaseline(workspaceFolders, candidates)),
        splitIntoBatches: overrides.splitIntoBatches
            ?? ((candidates, maxChars) => (0, sessionAnalysis_1.splitCandidatesIntoAnalysisBatches)(candidates, maxChars)),
        buildPrompt: overrides.buildPrompt ?? ((selection, candidates, recommendationBaseline, detailLevel) => (0, sessionAnalysis_1.buildAnalysisPrompt)(selection, candidates, recommendationBaseline, detailLevel)),
        buildSynthesisPrompt: overrides.buildSynthesisPrompt ?? ((selection, batchSummaries, recommendationBaseline) => (0, sessionAnalysis_1.buildAnalysisSynthesisPrompt)(selection, batchSummaries, recommendationBaseline)),
        runModelPrompt: overrides.runModelPrompt,
        streamMarkdown: overrides.streamMarkdown,
        pickOwnerWorkspace: overrides.pickOwnerWorkspace ?? ((workspaceFolders) => pickWorkspaceFolder() ?? workspaceFolders[0]),
        getStoragePath: overrides.getStoragePath ?? ((workspaceFolder) => getStoragePath(workspaceFolder)),
        writeReport: overrides.writeReport ?? (async (storageDirectory, input) => analysisStore.writeReport(storageDirectory, input)),
        recordAnalysis: overrides.recordAnalysis ?? (async (storageDirectory, report, sessions) => analysisStore.recordAnalysis(storageDirectory, report, sessions)),
        batchCharBudget: overrides.batchCharBudget ?? sessionAnalysis_1.DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET,
    };
}
function createDefaultAnalyzeSessionsFlowDeps(request, stream, token) {
    return createAnalyzeSessionsFlowDeps({
        runModelPrompt: async (prompt, streamOutput) => collectModelText(request, streamOutput ? stream : undefined, token, prompt),
        streamMarkdown: (markdown) => stream.markdown(markdown),
    });
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
function formatProviderLabel(provider) {
    if (/^copilot$/i.test(provider)) {
        return 'Copilot';
    }
    if (/^codex$/i.test(provider)) {
        return 'Codex';
    }
    if (/^cursor$/i.test(provider)) {
        return 'Cursor';
    }
    if (/^claude-code$/i.test(provider)) {
        return 'Claude Code';
    }
    return provider.trim() || 'Assistant';
}
function createDefaultResumeIntoOriginAgentDeps(stream) {
    return {
        getCommands: async () => vscode.commands.getCommands(true),
        executeCommand: async (commandId, args) => {
            if (args === undefined) {
                await vscode.commands.executeCommand(commandId);
                return;
            }
            await vscode.commands.executeCommand(commandId, args);
        },
        writeClipboard: async (text) => vscode.env.clipboard.writeText(text),
        streamMarkdown: (markdown) => stream.markdown(markdown),
    };
}
async function runResumeIntoOriginAgent(session, userPrompt, config, depsOverrides = {}) {
    const provider = session.provider;
    if (!provider || provider === 'copilot') {
        return false;
    }
    const deps = {
        getCommands: async () => [],
        executeCommand: async () => undefined,
        writeClipboard: async () => undefined,
        streamMarkdown: () => undefined,
        ...depsOverrides,
    };
    const providerLabel = formatProviderLabel(provider);
    let target;
    try {
        const availableCommands = await deps.getCommands();
        target = (0, resumeTarget_1.resolveResumeTarget)(provider, availableCommands, config.providerCommands);
        if (!target) {
            deps.streamMarkdown(`Could not find an installed ${providerLabel} chat command. Falling back to VS Code chat resume.\n\n`);
            return false;
        }
        const constrained = applyResumeOverflowStrategy(session.turns, config.maxTurns, config.maxContextChars, config.overflowStrategy);
        const resumePrompt = composeResumePrompt(constrained.turns, userPrompt, constrained.note);
        if (target.supportsQuery) {
            await deps.executeCommand(target.commandId, { query: resumePrompt });
            deps.streamMarkdown(`Opened ${providerLabel} chat with the resumed conversation context.`);
            return true;
        }
        await deps.executeCommand(target.commandId);
        await deps.writeClipboard(resumePrompt);
        if (provider === 'claude-code') {
            await prepareClaudeCodeConversationForResume(availableCommands, deps);
        }
        const focusCommand = (0, resumeTarget_1.resolveProviderFocusCommand)(provider, availableCommands);
        if (focusCommand) {
            try {
                await deps.executeCommand(focusCommand);
                if (provider === 'codex' || provider === 'claude-code') {
                    const tabLabel = provider === 'codex' ? 'Codex' : 'Claude Code';
                    try {
                        await pasteClipboardIntoFocusedChat(provider, focusCommand, deps);
                        deps.streamMarkdown(`Opened the ${tabLabel} chat tab and pasted the conversation context.`);
                        return true;
                    }
                    catch (pasteError) {
                        const pasteMessage = pasteError instanceof Error ? pasteError.message : String(pasteError);
                        deps.streamMarkdown(`Opened the ${tabLabel} chat tab and copied the conversation context, but automatic paste failed (${pasteMessage}) - paste (Ctrl+V) to continue.`);
                        return true;
                    }
                }
                deps.streamMarkdown(`Opened ${providerLabel} chat, focused the panel, and copied the conversation context - paste (Ctrl+V) to continue.`);
                return true;
            }
            catch (focusError) {
                const focusMessage = focusError instanceof Error ? focusError.message : String(focusError);
                deps.streamMarkdown(`Opened ${providerLabel} chat and copied the conversation context, but focusing the panel failed (${focusMessage}) - switch to the ${providerLabel} panel and paste to continue.`);
                return true;
            }
        }
        deps.streamMarkdown(`Opened ${providerLabel} chat and copied the conversation context - paste to continue.`);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.streamMarkdown(`Could not open ${providerLabel} chat (${message}). Falling back to VS Code chat resume.\n\n`);
        return false;
    }
}
function createDefaultImplementationHandoffFlowDeps(stream) {
    return {
        findAnalysisReportMeta: (history) => findLatestAnalysisReportMeta(history),
        buildPrompt: (reportFilePath, userPrompt) => (0, sessionAnalysis_1.buildImplementationHandoffPrompt)(reportFilePath, userPrompt),
        getCommands: async () => vscode.commands.getCommands(true),
        pickTarget: async (agentSessionAvailable) => {
            if (!agentSessionAvailable) {
                return 'chat';
            }
            const pick = await vscode.window.showQuickPick([
                {
                    label: 'Chat',
                    description: 'Prefill a new chat with the generated implementation handoff prompt',
                    target: 'chat',
                },
                {
                    label: 'Agent Session',
                    description: 'Open an agent session and copy the generated handoff prompt to the clipboard',
                    target: 'agentSession',
                },
            ], {
                title: 'Open implementation handoff in',
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
        streamMarkdown: (markdown) => stream.markdown(markdown),
    };
}
async function runImplementationHandoffFlow(requestPrompt, history, depsOverrides = {}) {
    const deps = {
        findAnalysisReportMeta: () => null,
        buildPrompt: (reportFilePath, userPrompt) => (0, sessionAnalysis_1.buildImplementationHandoffPrompt)(reportFilePath, userPrompt),
        getCommands: async () => [],
        pickTarget: async () => 'chat',
        openChat: async () => undefined,
        openAgentSession: async () => undefined,
        writeClipboard: async () => undefined,
        streamMarkdown: () => undefined,
        ...depsOverrides,
    };
    const analysisMeta = deps.findAnalysisReportMeta(history);
    if (!analysisMeta) {
        deps.streamMarkdown('Use @session-control /analyze first, then ask me to implement the recommendations.');
        return;
    }
    const reportFilePath = path.join(analysisMeta.analysisStorageDirectory, analysisMeta.analysisReportPath);
    const prompt = deps.buildPrompt(reportFilePath, requestPrompt);
    const agentSessionCommandId = findAgentSessionCommandId(await deps.getCommands());
    const target = await deps.pickTarget(agentSessionCommandId !== undefined);
    if (!target) {
        return;
    }
    if (target === 'agentSession' && agentSessionCommandId) {
        try {
            await deps.writeClipboard(prompt);
            await deps.openAgentSession(agentSessionCommandId);
            deps.streamMarkdown('Opened an agent session and copied the generated implementation handoff prompt to the clipboard. Paste it into the new session to continue.');
            return;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.streamMarkdown(`Failed to open an agent session (${message}). Opening chat with the generated handoff prompt instead.\n\n`);
        }
    }
    try {
        await deps.openChat(prompt);
        deps.streamMarkdown('Opened chat with a generated implementation handoff prompt.');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.streamMarkdown(`Failed to open chat with the generated handoff prompt: ${message}`);
    }
}
function buildParticipantFollowups(result) {
    const metadata = result.metadata;
    if (metadata?.resultType === 'analysis-report' && metadata.analysisReportPath && metadata.analysisStorageDirectory) {
        return [{
                label: 'Implement Recommendations',
                prompt: 'Open a generated implementation prompt for this analysis report.',
                participant: CHAT_PARTICIPANT_ID,
                command: 'implement',
            }];
    }
    return [];
}
function trimTurnsForResume(turns, maxTurns, maxContextChars) {
    if (maxTurns <= 0 || maxContextChars <= 0) {
        return [];
    }
    const byTurnBudget = turns.slice(Math.max(0, turns.length - maxTurns));
    const selected = [];
    let charCount = 0;
    for (let index = byTurnBudget.length - 1; index >= 0; index -= 1) {
        const turn = byTurnBudget[index];
        if (!turn) {
            continue;
        }
        const turnText = turn.type === 'request' ? turn.prompt : turn.content;
        const projected = charCount + turnText.length;
        if (projected > maxContextChars && selected.length > 0) {
            break;
        }
        if (projected <= maxContextChars || selected.length === 0) {
            selected.unshift(turn);
            charCount = projected;
        }
    }
    return selected;
}
function summarizeTurns(omittedTurns) {
    if (!omittedTurns.length) {
        return '';
    }
    const requestCount = omittedTurns.filter((turn) => turn.type === 'request').length;
    const responseCount = omittedTurns.length - requestCount;
    const first = omittedTurns[0];
    const last = omittedTurns[omittedTurns.length - 1];
    const firstSnippet = first
        ? (first.type === 'request' ? first.prompt : first.content).slice(0, 100)
        : '';
    const lastSnippet = last
        ? (last.type === 'request' ? last.prompt : last.content).slice(0, 100)
        : '';
    return [
        `Summary of omitted context: ${omittedTurns.length} earlier turns (${requestCount} user, ${responseCount} assistant).`,
        `Earliest omitted snippet: ${firstSnippet}`,
        `Latest omitted snippet: ${lastSnippet}`,
    ].join(' ');
}
function splitRecentAndOmittedTurns(turns, maxTurns) {
    const recent = turns.slice(Math.max(0, turns.length - maxTurns));
    const omitted = turns.slice(0, Math.max(0, turns.length - recent.length));
    return { recent, omitted };
}
function applyResumeOverflowStrategy(turns, maxTurns, maxContextChars, strategy) {
    if (strategy === 'recent-only') {
        const split = splitRecentAndOmittedTurns(turns, maxTurns);
        const recent = split.recent;
        const omitted = split.omitted.length;
        const constrained = trimTurnsForResume(recent, recent.length || maxTurns, maxContextChars);
        const note = omitted > 0 ? `Earlier turns omitted (${omitted} total).` : undefined;
        return {
            turns: constrained,
            ...(note ? { note } : {}),
        };
    }
    if (strategy === 'summarize') {
        const split = splitRecentAndOmittedTurns(turns, maxTurns);
        const recent = split.recent;
        const omittedTurns = split.omitted;
        const constrained = trimTurnsForResume(recent, recent.length || maxTurns, maxContextChars);
        const summary = summarizeTurns(omittedTurns);
        return {
            turns: constrained,
            ...(summary ? { note: summary } : {}),
        };
    }
    return {
        turns: trimTurnsForResume(turns, maxTurns, maxContextChars),
    };
}
function turnsToContextBlock(turns) {
    return turns
        .map((turn) => {
        if (turn.type === 'request') {
            return `User: ${turn.prompt}`;
        }
        return `${formatProviderLabel(turn.participant)}: ${turn.content}`;
    })
        .join('\n\n');
}
function composeResumePrompt(turns, prompt, note) {
    const contextBlock = turnsToContextBlock(turns);
    const overflowNote = note ? `${note}\n\n` : '';
    return [
        'The following is a previous conversation that the user wants to continue.',
        'Use it as context for the next response.',
        '',
        overflowNote,
        contextBlock,
        '',
        `User follow-up: ${prompt}`,
    ].join('\n');
}
function turnsToSummaryInput(omittedTurns) {
    return omittedTurns
        .map((turn) => (turn.type === 'request' ? `User: ${turn.prompt}` : `Assistant: ${turn.content}`))
        .join('\n\n');
}
async function resolveSummarizeNoteWithFallback(omittedTurns, summarizer) {
    if (!omittedTurns.length) {
        return undefined;
    }
    try {
        const summary = await summarizer(turnsToSummaryInput(omittedTurns));
        const trimmed = summary.trim();
        if (!trimmed) {
            return SUMMARIZE_FALLBACK_NOTE;
        }
        return `Summary of omitted context: ${trimmed}`;
    }
    catch {
        return SUMMARIZE_FALLBACK_NOTE;
    }
}
function buildResumePrompt(session, prompt, maxTurns, maxContextChars, overflowStrategy = 'truncate') {
    const constrained = applyResumeOverflowStrategy(session.turns, maxTurns, maxContextChars, overflowStrategy);
    return composeResumePrompt(constrained.turns, prompt, constrained.note);
}
function selectSessionForResume(query, sessions) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return {};
    }
    const scored = (0, utils_1.fuzzyMatchSessions)(normalizedQuery, sessions.map((session) => {
        const displayTitle = 'displayTitle' in session && typeof session.displayTitle === 'string'
            ? session.displayTitle
            : session.title;
        return {
            ...session,
            title: displayTitle,
        };
    }));
    if (!scored.length) {
        return {};
    }
    const findOriginal = (scoredSession) => sessions.find((session) => session.fileName === scoredSession.fileName && session.savedAt === scoredSession.savedAt);
    if (scored.length === 1) {
        const single = scored[0];
        if (!single) {
            return {};
        }
        const onlyMatch = findOriginal(single);
        return onlyMatch ? { session: onlyMatch } : {};
    }
    const best = scored[0];
    if (best && best.score >= MIN_AUTO_SELECT_SCORE) {
        const match = findOriginal(best);
        return match ? { session: match } : {};
    }
    return {
        candidates: scored.slice(0, 5).map((session) => findOriginal(session)).filter((session) => Boolean(session)),
    };
}
function mergeSessionParts(parts) {
    const first = parts[0];
    if (!first) {
        throw new Error('Cannot merge empty session parts.');
    }
    const mergedTurns = parts.flatMap((part) => part.turns);
    const merged = {
        ...first,
        part: null,
        totalParts: null,
        previousPartFile: null,
        nextPartFile: null,
        turns: mergedTurns,
        totalTurns: mergedTurns.length,
    };
    return merged;
}
async function loadReassembledSession(storageDirectory, startFileName, depsOverrides = {}) {
    const deps = {
        readSession: (directory, fileName) => chatSessionStore.readSession(directory, fileName),
        ...depsOverrides,
    };
    const cache = new Map();
    const readPart = async (fileName) => {
        const cached = cache.get(fileName);
        if (cached) {
            return cached;
        }
        const loaded = await deps.readSession(storageDirectory, fileName);
        cache.set(fileName, loaded);
        return loaded;
    };
    const visitedBackward = new Set();
    let rootFileName = startFileName;
    let cursor = await readPart(startFileName);
    while (cursor.previousPartFile) {
        if (visitedBackward.has(rootFileName)) {
            throw new Error('Detected cyclic previousPartFile chain while loading session parts.');
        }
        visitedBackward.add(rootFileName);
        rootFileName = cursor.previousPartFile;
        cursor = await readPart(rootFileName);
    }
    const partFiles = [];
    const parts = [];
    const visitedForward = new Set();
    let nextFileName = rootFileName;
    while (nextFileName) {
        if (visitedForward.has(nextFileName)) {
            throw new Error('Detected cyclic nextPartFile chain while loading session parts.');
        }
        visitedForward.add(nextFileName);
        partFiles.push(nextFileName);
        const part = await readPart(nextFileName);
        parts.push(part);
        nextFileName = part.nextPartFile;
    }
    return {
        session: mergeSessionParts(parts),
        rootFileName,
        partFiles,
    };
}
function findResumedSessionMeta(history) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const turn = history[index];
        if (!(turn instanceof vscode.ChatResponseTurn)) {
            continue;
        }
        if (turn.participant !== CHAT_PARTICIPANT_ID) {
            continue;
        }
        const metadata = turn.result.metadata;
        if (!metadata?.resumedSessionFile || !metadata.storageDirectory) {
            continue;
        }
        return {
            fileName: metadata.resumedSessionFile,
            storageDirectory: metadata.storageDirectory,
        };
    }
    return null;
}
function findWorkspaceFolderForStorageDirectory(storageDirectory) {
    return vscode.workspace.workspaceFolders?.find((workspaceFolder) => {
        const relative = path.relative(workspaceFolder.uri.fsPath, storageDirectory);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
}
async function sendModelResponse(request, response, token, session, prompt, maxTurns, maxContextChars, overflowStrategy) {
    const constrained = applyResumeOverflowStrategy(session.turns, maxTurns, maxContextChars, overflowStrategy);
    let overflowNote = constrained.note;
    if (overflowStrategy === 'summarize') {
        const split = splitRecentAndOmittedTurns(session.turns, maxTurns);
        overflowNote = await resolveSummarizeNoteWithFallback(split.omitted, async (input) => {
            const summaryRequest = await request.model.sendRequest([
                vscode.LanguageModelChatMessage.User(`Summarize this prior conversation context in 3 concise bullet points:\n\n${input}`),
            ], {}, token);
            let summaryText = '';
            for await (const part of summaryRequest.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    summaryText += part.value;
                }
            }
            return summaryText;
        });
        if (overflowNote === SUMMARIZE_FALLBACK_NOTE) {
            response.markdown(`*${SUMMARIZE_FALLBACK_NOTE}*`);
        }
    }
    const messageText = composeResumePrompt(constrained.turns, prompt, overflowNote);
    const modelResponse = await request.model.sendRequest([vscode.LanguageModelChatMessage.User(messageText)], {}, token);
    for await (const part of modelResponse.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
            response.markdown(part.value);
        }
    }
}
function registerChatParticipant(context) {
    const participant = vscode.chat.createChatParticipant(CHAT_PARTICIPANT_ID, async (request, chatContext, stream, token) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            stream.markdown('Open a workspace folder before using @session-control.');
            return;
        }
        const workspaceSessions = await listSessionsAcrossWorkspaceFolders(workspaceFolders);
        const workspaceFolder = pickWorkspaceFolder() ?? workspaceFolders[0];
        if (request.command === 'list') {
            stream.markdown(renderWorkspaceSessionListMarkdown(workspaceSessions));
            return;
        }
        if (request.command === 'analyze') {
            return (0, analysisOrchestrator_1.runAnalyzeSessionsFlow)(request.prompt, workspaceFolders, workspaceSessions, createDefaultAnalyzeSessionsFlowDeps(request, stream, token));
        }
        if (request.command === 'implement' || request.command === 'handoff') {
            return runImplementationHandoffFlow(request.prompt, chatContext.history, createDefaultImplementationHandoffFlowDeps(stream));
        }
        if (request.command === 'resume') {
            if (!workspaceSessions.length) {
                stream.markdown('No saved sessions found. Save a session before resuming.');
                return;
            }
            const selection = selectSessionForResume(request.prompt, workspaceSessions);
            if (selection.session) {
                const reassembled = await loadReassembledSession(selection.session.storageDirectory, selection.session.fileName);
                const resumed = reassembled.session;
                const maxTurns = vscode.workspace
                    .getConfiguration('session-control', selection.session.workspaceFolder.uri)
                    .get('resume.maxTurns', 50);
                const maxContextChars = vscode.workspace
                    .getConfiguration('session-control', selection.session.workspaceFolder.uri)
                    .get('resume.maxContextChars', 80000);
                const overflowStrategy = vscode.workspace
                    .getConfiguration('session-control', selection.session.workspaceFolder.uri)
                    .get('resume.overflowStrategy', 'summarize');
                const resumeTargetMode = vscode.workspace
                    .getConfiguration('session-control', selection.session.workspaceFolder.uri)
                    .get('resume.target', 'origin-agent');
                const providerCommands = vscode.workspace
                    .getConfiguration('session-control', selection.session.workspaceFolder.uri)
                    .get('resume.providerCommands', {});
                if (resumeTargetMode === 'origin-agent' && resumed.provider && resumed.provider !== 'copilot') {
                    const openedOriginAgent = await runResumeIntoOriginAgent(resumed, request.prompt, {
                        maxTurns,
                        maxContextChars,
                        overflowStrategy,
                        providerCommands,
                    }, createDefaultResumeIntoOriginAgentDeps(stream));
                    if (openedOriginAgent) {
                        return {
                            metadata: {
                                resumedSessionFile: reassembled.rootFileName,
                                storageDirectory: selection.session.storageDirectory,
                            },
                        };
                    }
                }
                const constrained = applyResumeOverflowStrategy(resumed.turns, maxTurns, maxContextChars, overflowStrategy);
                stream.markdown([
                    `Loaded **${resumed.title}** (${constrained.turns.length}/${resumed.turns.length} turns).`,
                    'Reply in this thread with @session-control and your follow-up question to continue with this context.',
                ].join('\n\n'));
                return {
                    metadata: {
                        resumedSessionFile: reassembled.rootFileName,
                        storageDirectory: selection.session.storageDirectory,
                    },
                };
            }
            if (selection.candidates?.length) {
                stream.markdown([
                    'Multiple sessions match your query. Try a more specific title or pick one of these:',
                    '',
                    ...selection.candidates.map((session) => asWorkspaceMarkdownListItem(session)),
                ].join('\n'));
                return;
            }
            stream.markdown(`No saved session matching '${request.prompt}'. Try @session-control /list.`);
            return;
        }
        const analysisReportMeta = findLatestAnalysisReportMeta(chatContext.history);
        if (analysisReportMeta) {
            stream.markdown('Use @session-control /implement to continue from the latest saved analysis report.');
            return;
        }
        const resumedSessionMeta = findResumedSessionMeta(chatContext.history);
        if (!resumedSessionMeta) {
            stream.markdown('Use @session-control /resume <session name> or @session-control /analyze first, then ask your follow-up.');
            return;
        }
        const reassembled = await loadReassembledSession(resumedSessionMeta.storageDirectory, resumedSessionMeta.fileName);
        const resumedSession = reassembled.session;
        const resumedWorkspaceFolder = findWorkspaceFolderForStorageDirectory(resumedSessionMeta.storageDirectory)
            ?? workspaceFolder
            ?? workspaceFolders[0];
        if (!resumedWorkspaceFolder) {
            stream.markdown('Open a workspace folder before using @session-control.');
            return;
        }
        const maxTurns = vscode.workspace
            .getConfiguration('session-control', resumedWorkspaceFolder.uri)
            .get('resume.maxTurns', 50);
        const maxContextChars = vscode.workspace
            .getConfiguration('session-control', resumedWorkspaceFolder.uri)
            .get('resume.maxContextChars', 80000);
        const overflowStrategy = vscode.workspace
            .getConfiguration('session-control', resumedWorkspaceFolder.uri)
            .get('resume.overflowStrategy', 'summarize');
        await sendModelResponse(request, stream, token, resumedSession, request.prompt, maxTurns, maxContextChars, overflowStrategy);
        return {
            metadata: {
                resumedSessionFile: reassembled.rootFileName,
                storageDirectory: resumedSessionMeta.storageDirectory,
            },
        };
    });
    participant.followupProvider = {
        provideFollowups: (result) => buildParticipantFollowups(result),
    };
    context.subscriptions.push(participant);
}
//# sourceMappingURL=chatParticipant.js.map