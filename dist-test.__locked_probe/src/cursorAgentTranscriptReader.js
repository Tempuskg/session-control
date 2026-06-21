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
exports.getDefaultCursorProjectsPath = getDefaultCursorProjectsPath;
exports.deriveCursorProjectSlug = deriveCursorProjectSlug;
exports.deriveCursorAgentTranscriptsPath = deriveCursorAgentTranscriptsPath;
exports.normalizeCursorAgentTranscriptRecords = normalizeCursorAgentTranscriptRecords;
exports.normalizeCursorAgentTranscriptJsonl = normalizeCursorAgentTranscriptJsonl;
exports.readCursorAgentTranscriptSessions = readCursorAgentTranscriptSessions;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function getDefaultCursorProjectsPath() {
    return path.join(os.homedir(), '.cursor', 'projects');
}
function deriveCursorProjectSlug(workspaceFolderPath) {
    const normalized = path.normalize(workspaceFolderPath);
    const windowsMatch = /^([A-Za-z]):\\?(.*)$/.exec(normalized);
    if (windowsMatch?.[1]) {
        const drive = windowsMatch[1].toLowerCase();
        const rest = (windowsMatch[2] ?? '')
            .replace(/[./\\]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return rest ? `${drive}-${rest}` : drive;
    }
    return normalized
        .replace(/^[/\\]+/, '')
        .replace(/[/\\:]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}
function deriveCursorAgentTranscriptsPath(cursorProjectsPath, projectSlug) {
    return path.join(cursorProjectsPath, projectSlug, 'agent-transcripts');
}
function normalizeTitle(value) {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
        return 'Untitled Cursor Session';
    }
    if (collapsed.length <= 80) {
        return collapsed;
    }
    return `${collapsed.slice(0, 77).trimEnd()}...`;
}
function stripUserPromptWrappers(text) {
    const withoutTimestamp = text.replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/gi, '').trim();
    const queryMatch = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i.exec(withoutTimestamp);
    if (queryMatch?.[1]) {
        return queryMatch[1].trim();
    }
    return withoutTimestamp.trim();
}
function extractTextParts(content) {
    if (!Array.isArray(content)) {
        return [];
    }
    const parts = [];
    for (const item of content) {
        if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') {
            continue;
        }
        const trimmed = item.text.trim();
        if (trimmed) {
            parts.push(trimmed);
        }
    }
    return parts;
}
function extractToolCalls(content) {
    if (!Array.isArray(content)) {
        return [];
    }
    const toolCalls = [];
    for (const item of content) {
        if (!isRecord(item) || item.type !== 'tool_use') {
            continue;
        }
        const toolCall = {
            name: typeof item.name === 'string' ? item.name : 'unknown',
        };
        if (item.input !== undefined) {
            try {
                toolCall.arguments = JSON.stringify(item.input);
            }
            catch {
                toolCall.arguments = String(item.input);
            }
        }
        toolCalls.push(toolCall);
    }
    return toolCalls;
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
function normalizeCursorAgentTranscriptRecords(records, sourceFile, baseTimestampMs) {
    const turns = [];
    let turnIndex = 0;
    for (const record of records) {
        if (!isRecord(record)) {
            continue;
        }
        if (record.type === 'turn_ended') {
            continue;
        }
        const role = typeof record.role === 'string' ? record.role : undefined;
        const message = isRecord(record.message) ? record.message : undefined;
        const content = message?.content;
        const timestamp = new Date(baseTimestampMs + turnIndex * 1000).toISOString();
        if (role === 'user') {
            const textParts = extractTextParts(content).map(stripUserPromptWrappers).filter(Boolean);
            const prompt = textParts.join('\n\n').trim();
            if (!prompt) {
                continue;
            }
            appendTurn(turns, {
                type: 'request',
                participant: 'user',
                prompt,
                references: [],
                timestamp,
            });
            turnIndex++;
            continue;
        }
        if (role === 'assistant') {
            const textParts = extractTextParts(content);
            const contentText = textParts.join('\n\n').trim();
            const toolCalls = extractToolCalls(content);
            if (!contentText && !toolCalls.length) {
                continue;
            }
            appendTurn(turns, {
                type: 'response',
                participant: 'cursor',
                content: contentText || `[${toolCalls.length} tool call(s)]`,
                toolCalls,
                timestamp,
            });
            turnIndex++;
        }
    }
    if (!turns.length) {
        return null;
    }
    const firstPrompt = turns.find((turn) => turn.type === 'request');
    const lastTurn = turns[turns.length - 1];
    return {
        provider: 'cursor',
        id: sourceFile,
        title: normalizeTitle(firstPrompt?.type === 'request' ? firstPrompt.prompt : sourceFile),
        lastMessageDate: lastTurn ? lastTurn.timestamp : new Date(baseTimestampMs).toISOString(),
        turns,
        sourceFile,
    };
}
function normalizeCursorAgentTranscriptJsonl(content, sourceFile, baseTimestampMs) {
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
            throw new SyntaxError(`Invalid Cursor agent transcript JSONL in ${sourceFile}`);
        }
    });
    return normalizeCursorAgentTranscriptRecords(records, sourceFile, baseTimestampMs);
}
async function listAgentTranscriptFiles(agentTranscriptsDirectory) {
    const entries = await fs.readdir(agentTranscriptsDirectory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const candidate = path.join(agentTranscriptsDirectory, entry.name, `${entry.name}.jsonl`);
        try {
            const stat = await fs.stat(candidate);
            if (stat.isFile()) {
                files.push(candidate);
            }
        }
        catch {
            continue;
        }
    }
    return files;
}
async function readCursorAgentTranscriptSessions(workspaceFolderPath, cursorProjectsPath, readFile, logWarning) {
    const projectSlug = deriveCursorProjectSlug(workspaceFolderPath);
    const agentTranscriptsDirectory = deriveCursorAgentTranscriptsPath(cursorProjectsPath, projectSlug);
    let transcriptFiles;
    try {
        transcriptFiles = await listAgentTranscriptFiles(agentTranscriptsDirectory);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/no such file|cannot find|enoent/i.test(message)) {
            return [];
        }
        throw error;
    }
    const sessions = [];
    for (const filePath of transcriptFiles) {
        const sourceFile = path.basename(filePath, '.jsonl');
        try {
            const [content, stat] = await Promise.all([
                readFile(filePath),
                fs.stat(filePath),
            ]);
            if (!content.trim()) {
                logWarning(`Skipped empty Cursor agent transcript: ${sourceFile}`);
                continue;
            }
            const session = normalizeCursorAgentTranscriptJsonl(content, sourceFile, stat.mtimeMs);
            if (!session) {
                logWarning(`Skipped unreadable Cursor agent transcript: ${sourceFile}`);
                continue;
            }
            sessions.push(session);
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                logWarning(`Skipped corrupt Cursor agent transcript: ${sourceFile}`);
                continue;
            }
            throw error;
        }
    }
    return sessions.sort((a, b) => Date.parse(b.lastMessageDate) - Date.parse(a.lastMessageDate));
}
//# sourceMappingURL=cursorAgentTranscriptReader.js.map