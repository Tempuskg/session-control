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
exports.deriveClaudeCodeProjectsPath = deriveClaudeCodeProjectsPath;
exports.deriveClaudeCodeProjectSlug = deriveClaudeCodeProjectSlug;
exports.createClaudeCodeSessionReader = createClaudeCodeSessionReader;
exports.readClaudeCodeSessions = readClaudeCodeSessions;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toIsoTimestamp(value, fallback = new Date().toISOString()) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
        return new Date(value).toISOString();
    }
    return fallback;
}
function normalizeTitle(value) {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
        return 'Untitled Claude Code Session';
    }
    if (collapsed.length <= 80) {
        return collapsed;
    }
    return `${collapsed.slice(0, 77).trimEnd()}...`;
}
function stringifyUnknown(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return undefined;
    }
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function extractTextContent(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : undefined;
    }
    if (!Array.isArray(value)) {
        return undefined;
    }
    const parts = value
        .map((item) => {
        if (!isRecord(item) || item.type !== 'text') {
            return undefined;
        }
        return typeof item.text === 'string' ? item.text.trim() : undefined;
    })
        .filter((item) => Boolean(item));
    if (!parts.length) {
        return undefined;
    }
    return parts.join('\n').trim();
}
function appendTurn(turns, turn) {
    const previous = turns[turns.length - 1];
    if (!previous) {
        turns.push(turn);
        return;
    }
    if (turn.type === 'request' && previous.type === 'request' && previous.prompt === turn.prompt) {
        return;
    }
    if (turn.type === 'response' && previous.type === 'response' && previous.content === turn.content) {
        return;
    }
    turns.push(turn);
}
function flushPendingToolCalls(pendingToolCalls) {
    const toolCalls = pendingToolCalls.map((toolCall) => {
        const normalized = {
            name: toolCall.name,
        };
        if (toolCall.summary !== undefined) {
            normalized.summary = toolCall.summary;
        }
        if (toolCall.arguments !== undefined) {
            normalized.arguments = toolCall.arguments;
        }
        if (toolCall.output !== undefined) {
            normalized.output = toolCall.output;
        }
        return normalized;
    });
    pendingToolCalls.length = 0;
    return toolCalls;
}
function attachToolResult(pendingToolCalls, block) {
    const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined;
    const output = stringifyUnknown(block.content);
    const existing = id ? pendingToolCalls.find((toolCall) => toolCall.id === id) : undefined;
    if (existing) {
        if (output !== undefined) {
            existing.output = output;
        }
        return;
    }
    const toolCall = {
        name: 'unknown',
    };
    if (id !== undefined) {
        toolCall.id = id;
    }
    if (output !== undefined) {
        toolCall.output = output;
    }
    pendingToolCalls.push(toolCall);
}
function normalizeClaudeCodeRecords(records, sourceFile) {
    const turns = [];
    const pendingToolCalls = [];
    let sessionId = sourceFile;
    let sessionTimestamp;
    let sessionWorkingDirectory;
    let aiTitle;
    for (const record of records) {
        if (!isRecord(record)) {
            continue;
        }
        if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
            sessionId = record.sessionId;
        }
        if (typeof record.timestamp === 'string') {
            sessionTimestamp = record.timestamp;
        }
        if (typeof record.cwd === 'string' && record.cwd.trim()) {
            sessionWorkingDirectory = record.cwd.trim();
        }
        if (record.type === 'ai-title' && typeof record.aiTitle === 'string' && record.aiTitle.trim()) {
            aiTitle = record.aiTitle;
            continue;
        }
        if (record.isSidechain === true) {
            continue;
        }
        if (record.type === 'queue-operation'
            || record.type === 'attachment'
            || record.type === 'file-history-snapshot'
            || record.type === 'summary') {
            continue;
        }
        const timestamp = toIsoTimestamp(record.timestamp, sessionTimestamp);
        const message = isRecord(record.message) ? record.message : undefined;
        if (!message) {
            continue;
        }
        if (record.type === 'user' && message.role === 'user') {
            if (Array.isArray(message.content)) {
                for (const block of message.content) {
                    if (isRecord(block) && block.type === 'tool_result') {
                        attachToolResult(pendingToolCalls, block);
                    }
                }
            }
            const text = extractTextContent(message.content);
            if (text) {
                appendTurn(turns, {
                    type: 'request',
                    participant: 'user',
                    prompt: text,
                    references: [],
                    timestamp,
                });
            }
            continue;
        }
        if (record.type === 'assistant' && message.role === 'assistant' && Array.isArray(message.content)) {
            for (const block of message.content) {
                if (!isRecord(block)) {
                    continue;
                }
                if (block.type === 'tool_use') {
                    const toolCall = {
                        name: typeof block.name === 'string' ? block.name : 'unknown',
                    };
                    if (typeof block.id === 'string') {
                        toolCall.id = block.id;
                    }
                    const argumentsText = stringifyUnknown(block.input);
                    if (argumentsText !== undefined) {
                        toolCall.arguments = argumentsText;
                    }
                    pendingToolCalls.push(toolCall);
                    continue;
                }
                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                    appendTurn(turns, {
                        type: 'response',
                        participant: 'claude-code',
                        content: block.text.trim(),
                        toolCalls: flushPendingToolCalls(pendingToolCalls),
                        timestamp,
                    });
                }
            }
        }
    }
    if (!turns.length) {
        return null;
    }
    const firstPrompt = turns.find((turn) => turn.type === 'request');
    const lastTurn = turns[turns.length - 1];
    const titleSource = aiTitle ?? (firstPrompt?.type === 'request' ? firstPrompt.prompt : sourceFile);
    return {
        provider: 'claude-code',
        id: sessionId,
        title: normalizeTitle(titleSource),
        lastMessageDate: lastTurn ? lastTurn.timestamp : toIsoTimestamp(sessionTimestamp),
        turns,
        sourceFile,
        ...(sessionWorkingDirectory ? { cwd: sessionWorkingDirectory } : {}),
    };
}
function normalizeClaudeCodeJsonl(content, sourceFile) {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) {
        return null;
    }
    const records = lines.map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            throw new SyntaxError(`Invalid Claude Code JSONL in ${sourceFile}`);
        }
    });
    return normalizeClaudeCodeRecords(records, sourceFile);
}
async function listFilesDirect(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(directoryPath, entry.name));
}
function hasSubagentsSegment(filePath) {
    return filePath.split(/[\\/]+/).some((segment) => segment.toLowerCase() === 'subagents');
}
function createDefaultDeps() {
    return {
        listFiles: listFilesDirect,
        readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
        showInformationMessage: async (message) => vscode.window.showInformationMessage(message),
        logWarning: (message) => {
            console.warn(message);
        },
    };
}
function deriveClaudeCodeProjectsPath(claudeCodeHomePath) {
    return path.join(claudeCodeHomePath, 'projects');
}
function deriveClaudeCodeProjectSlug(workspacePath) {
    // Claude Code names its per-project transcript directory by replacing every
    // non-alphanumeric character in the workspace path with a single dash, without
    // collapsing consecutive dashes or trimming. For example, "e:\chat-commit"
    // becomes "e--chat-commit" (one dash for ":" and one for "\"). VS Code already
    // lowercases the drive letter in uri.fsPath, so no extra casing is needed.
    return workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
}
function createClaudeCodeSessionReader(overrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...overrides,
    };
    return {
        async readClaudeCodeSessions(claudeCodeHomePath, workspacePath) {
            const projectDirectory = path.join(deriveClaudeCodeProjectsPath(claudeCodeHomePath), deriveClaudeCodeProjectSlug(workspacePath));
            let files;
            try {
                files = await deps.listFiles(projectDirectory);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (/no such file|cannot find|enoent/i.test(message)) {
                    await deps.showInformationMessage(`No Claude Code sessions found in ${projectDirectory}.`);
                    return [];
                }
                throw error;
            }
            const sessionFiles = files.filter((filePath) => /\.jsonl$/i.test(filePath) && !hasSubagentsSegment(filePath));
            const sessions = [];
            for (const filePath of sessionFiles) {
                const sourceFile = path.basename(filePath).replace(/\.jsonl$/i, '');
                try {
                    const content = await deps.readFile(filePath);
                    if (!content.trim()) {
                        deps.logWarning(`Skipped empty Claude Code session file: ${path.basename(filePath)}`);
                        continue;
                    }
                    const session = normalizeClaudeCodeJsonl(content, sourceFile);
                    if (!session) {
                        deps.logWarning(`Skipped unreadable Claude Code session file: ${path.basename(filePath)}`);
                        continue;
                    }
                    sessions.push(session);
                }
                catch (error) {
                    if (error instanceof SyntaxError) {
                        deps.logWarning(`Skipped corrupt Claude Code session file: ${path.basename(filePath)}`);
                        continue;
                    }
                    throw error;
                }
            }
            if (!sessions.length) {
                await deps.showInformationMessage(`No usable Claude Code sessions found in ${projectDirectory}.`);
                return [];
            }
            return sessions.sort((left, right) => Date.parse(right.lastMessageDate) - Date.parse(left.lastMessageDate));
        },
    };
}
const defaultClaudeCodeSessionReader = createClaudeCodeSessionReader();
async function readClaudeCodeSessions(claudeCodeHomePath, workspacePath) {
    return defaultClaudeCodeSessionReader.readClaudeCodeSessions(claudeCodeHomePath, workspacePath);
}
//# sourceMappingURL=claudeCodeSessionReader.js.map