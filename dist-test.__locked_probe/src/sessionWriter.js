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
exports.createMarkdownSummary = createMarkdownSummary;
exports.createChatSession = createChatSession;
exports.applySaveBloatControls = applySaveBloatControls;
const crypto = __importStar(require("node:crypto"));
const utils_1 = require("./utils");
const DEFAULT_SUMMARY_MAX_TURNS = 50;
const DEFAULT_SUMMARY_MAX_CHARS = 100 * 1024;
function toIsoTimestamp(value) {
    if (value && Number.isFinite(Date.parse(value))) {
        return new Date(value).toISOString();
    }
    return new Date().toISOString();
}
function sanitizeTitle(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function formatAssistantLabel(participant) {
    const normalized = participant.trim();
    if (!normalized) {
        return 'Assistant';
    }
    if (/^copilot$/i.test(normalized)) {
        return 'Copilot';
    }
    if (/^codex$/i.test(normalized)) {
        return 'Codex';
    }
    if (/^cursor$/i.test(normalized)) {
        return 'Cursor';
    }
    if (/^claude-code$/i.test(normalized)) {
        return 'Claude Code';
    }
    return normalized
        .split(/\s+/)
        .map((segment) => segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}` : segment)
        .join(' ');
}
function estimateSessionSizeBytes(session) {
    return Buffer.byteLength(JSON.stringify(session, null, 2), 'utf8');
}
function createFileName(savedAt, title) {
    return `${(0, utils_1.formatTimestamp)(new Date(savedAt))}-${(0, utils_1.slugify)(title)}.json`;
}
function replaceToolOutput(value) {
    if (!value) {
        return value;
    }
    return `[output stripped - ${value.length} chars]`;
}
function withStrippedToolOutput(turns) {
    return turns.map((turn) => {
        if (turn.type === 'request') {
            return turn;
        }
        return {
            ...turn,
            toolCalls: turn.toolCalls.map((toolCall) => {
                const replaced = replaceToolOutput(toolCall.output);
                const normalizedToolCall = {
                    name: toolCall.name,
                };
                if (toolCall.summary !== undefined) {
                    normalizedToolCall.summary = toolCall.summary;
                }
                if (toolCall.arguments !== undefined) {
                    normalizedToolCall.arguments = toolCall.arguments;
                }
                if (replaced !== undefined) {
                    normalizedToolCall.output = replaced;
                }
                return normalizedToolCall;
            }),
        };
    });
}
function withTurns(base, turns) {
    const updated = {
        ...base,
        turns,
        totalTurns: turns.length,
        markdownSummary: '',
    };
    updated.markdownSummary = createMarkdownSummary(updated);
    return updated;
}
function splitTurnsByEstimatedSize(base, maxFileSizeBytes) {
    if (base.turns.length === 0) {
        return [[]];
    }
    const chunks = [];
    let currentChunk = [];
    for (const turn of base.turns) {
        const candidate = [...currentChunk, turn];
        const candidateSession = withTurns(base, candidate);
        const candidateSize = estimateSessionSizeBytes(candidateSession);
        if (candidateSize <= maxFileSizeBytes || currentChunk.length === 0) {
            currentChunk = candidate;
            continue;
        }
        chunks.push(currentChunk);
        currentChunk = [turn];
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    return chunks;
}
function splitSession(base, maxFileSizeBytes) {
    const chunks = splitTurnsByEstimatedSize(base, maxFileSizeBytes);
    if (chunks.length <= 1) {
        return [withTurns(base, base.turns)];
    }
    const totalParts = chunks.length;
    const parts = chunks.map((chunk, index) => {
        const partNumber = index + 1;
        const partTitle = `${base.title} (Part ${partNumber}/${totalParts})`;
        const partSession = withTurns({ ...base, title: partTitle }, chunk);
        partSession.part = partNumber;
        partSession.totalParts = totalParts;
        return partSession;
    });
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (!part) {
            continue;
        }
        const previousPart = index > 0 ? parts[index - 1] : undefined;
        const nextPart = index + 1 < parts.length ? parts[index + 1] : undefined;
        part.previousPartFile = previousPart ? createFileName(previousPart.savedAt, previousPart.title) : null;
        part.nextPartFile = nextPart ? createFileName(nextPart.savedAt, nextPart.title) : null;
    }
    return parts;
}
function truncateOldest(base, maxFileSizeBytes) {
    let turns = [...base.turns];
    let truncatedCount = 0;
    while (turns.length > 1) {
        const candidate = withTurns(base, turns);
        if (estimateSessionSizeBytes(candidate) <= maxFileSizeBytes) {
            const warning = truncatedCount > 0 ? `Truncated ${truncatedCount} oldest turn(s) to fit save.maxFileSize.` : undefined;
            return {
                sessions: [candidate],
                ...(warning ? { warning } : {}),
            };
        }
        turns = turns.slice(1);
        truncatedCount += 1;
    }
    return {
        sessions: [withTurns(base, turns)],
        warning: `Session still exceeds save.maxFileSize after truncating ${truncatedCount} turn(s).`,
    };
}
function generateTitle(turns) {
    const firstRequest = turns.find((turn) => turn.type === 'request');
    if (!firstRequest) {
        return 'Untitled Session';
    }
    const clean = sanitizeTitle(firstRequest.prompt);
    if (!clean) {
        return 'Untitled Session';
    }
    if (clean.length <= 80) {
        return clean;
    }
    return `${clean.slice(0, 77).trimEnd()}...`;
}
function renderToolCalls(toolCalls) {
    if (!toolCalls.length) {
        return null;
    }
    const rendered = toolCalls
        .map((toolCall) => {
        const summary = toolCall.summary?.trim();
        return summary ? `${toolCall.name} (${summary})` : toolCall.name;
    })
        .join(', ');
    return `> **Tool calls:** ${rendered}`;
}
function renderTurn(index, turn) {
    const turnNumber = index + 1;
    if (turn.type === 'request') {
        const references = turn.references.length
            ? `\n\n- References:\n${turn.references.map((ref) => `  - ${ref}`).join('\n')}`
            : '';
        return `### Turn ${turnNumber} - User\n${turn.prompt}${references}`;
    }
    const toolCalls = renderToolCalls(turn.toolCalls);
    return `### Turn ${turnNumber} - ${formatAssistantLabel(turn.participant)}\n${turn.content}${toolCalls ? `\n\n${toolCalls}` : ''}`;
}
function capTurnsForSummary(turns, maxTurns) {
    if (turns.length <= maxTurns) {
        return { turns, omittedCount: 0 };
    }
    const omittedCount = turns.length - maxTurns;
    return {
        turns: turns.slice(0, maxTurns),
        omittedCount,
    };
}
function enforceSummaryCharLimit(summary, turns, maxChars) {
    if (summary.length <= maxChars) {
        return summary;
    }
    if (turns.length <= 20) {
        return `${summary.slice(0, Math.max(0, maxChars - 40))}\n\n... summary truncated ...`;
    }
    const firstTen = turns.slice(0, 10);
    const lastTen = turns.slice(-10);
    const omitted = Math.max(0, turns.length - 20);
    const compact = [
        ...firstTen.map((turn, index) => renderTurn(index, turn)),
        `... ${omitted} turns omitted ...`,
        ...lastTen.map((turn, index) => renderTurn(firstTen.length + index, turn)),
    ].join('\n\n');
    if (compact.length <= maxChars) {
        return compact;
    }
    return `${compact.slice(0, Math.max(0, maxChars - 40))}\n\n... summary truncated ...`;
}
function createMarkdownSummary(session, options = {}) {
    const maxTurns = options.summaryMaxTurns ?? DEFAULT_SUMMARY_MAX_TURNS;
    const maxChars = options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS;
    const capped = capTurnsForSummary(session.turns, maxTurns);
    const commitShort = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
    const branch = session.git?.branch ?? 'n/a';
    const sections = capped.turns.map((turn, index) => renderTurn(index, turn));
    const omittedNote = capped.omittedCount > 0
        ? `\n\n... ${capped.omittedCount} additional turns not shown in summary`
        : '';
    const base = [
        `# Chat: ${session.title}`,
        '',
        `**Branch:** ${branch} | **Commit:** ${commitShort} | **Saved:** ${session.savedAt}`,
        `**Turns:** ${session.totalTurns}`,
        '',
        '---',
        '',
        sections.join('\n\n'),
    ].join('\n') + omittedNote;
    return enforceSummaryCharLimit(base, capped.turns, maxChars);
}
function createChatSession(source, options = {}) {
    const savedAt = toIsoTimestamp(options.savedAt);
    const title = options.title ? sanitizeTitle(options.title) : generateTitle(source.turns);
    const chatSession = {
        version: 1,
        id: source.id || crypto.randomUUID(),
        title,
        savedAt,
        provider: source.provider,
        git: options.git ?? null,
        vscodeVersion: options.vscodeVersion ?? 'unknown',
        totalTurns: source.turns.length,
        part: null,
        totalParts: null,
        previousPartFile: null,
        nextPartFile: null,
        turns: source.turns,
        markdownSummary: '',
    };
    chatSession.markdownSummary = createMarkdownSummary(chatSession, options);
    return chatSession;
}
function applySaveBloatControls(session, options) {
    const strippedTurns = options.stripToolOutput ? withStrippedToolOutput(session.turns) : session.turns;
    const normalized = withTurns(session, strippedTurns);
    if (estimateSessionSizeBytes(normalized) <= options.maxFileSizeBytes) {
        return { sessions: [normalized] };
    }
    if (options.overflowStrategy === 'warn') {
        return {
            sessions: [normalized],
            warning: 'Session exceeds save.maxFileSize and was saved as-is because save.overflowStrategy=warn.',
        };
    }
    if (options.overflowStrategy === 'truncateOldest') {
        return truncateOldest(normalized, options.maxFileSizeBytes);
    }
    const split = splitSession(normalized, options.maxFileSizeBytes);
    if (split.length > 1) {
        return {
            sessions: split,
            warning: `Session exceeded save.maxFileSize and was split into ${split.length} part files.`,
        };
    }
    return { sessions: split };
}
//# sourceMappingURL=sessionWriter.js.map