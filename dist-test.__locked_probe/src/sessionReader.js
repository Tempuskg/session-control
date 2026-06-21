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
exports.EmptySessionError = exports.UnknownFormatError = void 0;
exports.parseWorkspaceSessionJson = parseWorkspaceSessionJson;
exports.parseWorkspaceSessionJsonl = parseWorkspaceSessionJsonl;
exports.deriveChatSessionsPath = deriveChatSessionsPath;
exports.createSessionReader = createSessionReader;
exports.readCopilotSessions = readCopilotSessions;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
class UnknownFormatError extends Error {
    constructor(fileName) {
        super(`Unknown session format: ${fileName}`);
        this.name = 'UnknownFormatError';
    }
}
exports.UnknownFormatError = UnknownFormatError;
class EmptySessionError extends Error {
    constructor(fileName) {
        super(`Empty session (no completed turns): ${fileName}`);
        this.name = 'EmptySessionError';
    }
}
exports.EmptySessionError = EmptySessionError;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toIsoTimestamp(value) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
        return new Date(value).toISOString();
    }
    return new Date().toISOString();
}
function firstNonEmpty(...values) {
    for (const value of values) {
        const text = extractText(value);
        if (text) {
            return text;
        }
    }
    return undefined;
}
function extractText(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : undefined;
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((part) => extractText(part))
            .filter((part) => typeof part === 'string' && part.length > 0);
        if (!parts.length) {
            return undefined;
        }
        return parts.join('\n').trim();
    }
    if (!isRecord(value)) {
        return undefined;
    }
    return firstNonEmpty(value.text, value.value, value.markdown, value.content, value.prompt, value.message, value.input, value.output, value.parts, value.items);
}
function asReferences(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const references = [];
    for (const item of value) {
        if (typeof item === 'string') {
            references.push(item);
            continue;
        }
        if (!isRecord(item)) {
            continue;
        }
        const candidate = firstNonEmpty(item.path, item.uri, item.value, item.text);
        if (candidate) {
            references.push(candidate);
        }
    }
    return references;
}
function isRequestLike(rawType, rawRole) {
    return rawType === 'request'
        || rawType === 'user'
        || rawType === 'prompt'
        || rawType === 'human'
        || rawRole === 'user';
}
function isResponseLike(rawType, rawRole) {
    return rawType === 'response'
        || rawType === 'assistant'
        || rawType === 'model'
        || rawRole === 'assistant';
}
function toTurnCandidate(raw, type) {
    if (type === 'request') {
        const nested = isRecord(raw.request)
            ? raw.request
            : isRecord(raw.userMessage)
                ? raw.userMessage
                : isRecord(raw.promptMessage)
                    ? raw.promptMessage
                    : undefined;
        if (nested) {
            return {
                ...raw,
                ...nested,
                type,
            };
        }
    }
    const nested = isRecord(raw.response)
        ? raw.response
        : isRecord(raw.assistantMessage)
            ? raw.assistantMessage
            : isRecord(raw.modelResponse)
                ? raw.modelResponse
                : undefined;
    if (nested) {
        return {
            ...raw,
            ...nested,
            type,
        };
    }
    return {
        ...raw,
        type,
    };
}
function normalizeTurnEntry(raw) {
    if (!isRecord(raw)) {
        return [];
    }
    const hasNestedRequest = isRecord(raw.request) || isRecord(raw.userMessage) || isRecord(raw.promptMessage);
    const hasNestedResponse = isRecord(raw.response) || isRecord(raw.assistantMessage) || isRecord(raw.modelResponse);
    if (hasNestedRequest || hasNestedResponse) {
        const turns = [];
        const requestTurn = normalizeTurn(toTurnCandidate(raw, 'request'));
        if (requestTurn) {
            turns.push(requestTurn);
        }
        const responseTurn = normalizeTurn(toTurnCandidate(raw, 'response'));
        if (responseTurn) {
            turns.push(responseTurn);
        }
        return turns;
    }
    const turn = normalizeTurn(raw);
    return turn ? [turn] : [];
}
function pickRawTurns(payload) {
    if (Array.isArray(payload.turns)) {
        return payload.turns;
    }
    if (Array.isArray(payload.messages)) {
        return payload.messages;
    }
    if (Array.isArray(payload.entries)) {
        return payload.entries;
    }
    if (Array.isArray(payload.events)) {
        return payload.events;
    }
    if (Array.isArray(payload.exchanges)) {
        return payload.exchanges;
    }
    if (isRecord(payload.conversation)) {
        const conversation = payload.conversation;
        if (Array.isArray(conversation.turns)) {
            return conversation.turns;
        }
        if (Array.isArray(conversation.messages)) {
            return conversation.messages;
        }
        if (Array.isArray(conversation.entries)) {
            return conversation.entries;
        }
    }
    return undefined;
}
function asToolCalls(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => isRecord(item) && typeof item.name === 'string')
        .map((item) => ({
        name: String(item.name),
        summary: typeof item.summary === 'string' ? item.summary : undefined,
        arguments: typeof item.arguments === 'string' ? item.arguments : undefined,
        output: typeof item.output === 'string' ? item.output : undefined,
    }));
}
function normalizeTurn(raw) {
    if (!isRecord(raw)) {
        return null;
    }
    const rawType = typeof raw.type === 'string'
        ? raw.type.toLowerCase()
        : typeof raw.kind === 'string'
            ? raw.kind.toLowerCase()
            : typeof raw.messageType === 'string'
                ? raw.messageType.toLowerCase()
                : undefined;
    const rawRole = typeof raw.role === 'string'
        ? raw.role.toLowerCase()
        : typeof raw.author === 'string'
            ? raw.author.toLowerCase()
            : undefined;
    const participant = firstNonEmpty(raw.participant, raw.agent, raw.author) ?? 'copilot';
    const timestamp = toIsoTimestamp(raw.timestamp ?? raw.at ?? raw.createdAt);
    if (isRequestLike(rawType, rawRole)) {
        const prompt = firstNonEmpty(raw.prompt, raw.text, raw.content, raw.message, raw.input, raw.request, raw.userMessage) ?? '';
        if (!prompt) {
            return null;
        }
        const references = asReferences(raw.references ?? raw.files ?? raw.attachments);
        return {
            type: 'request',
            participant,
            prompt,
            references,
            timestamp,
        };
    }
    if (isResponseLike(rawType, rawRole)) {
        const content = firstNonEmpty(raw.content, raw.text, raw.message, raw.output, raw.response, raw.assistantMessage) ?? '';
        if (!content) {
            return null;
        }
        return {
            type: 'response',
            participant,
            content,
            toolCalls: asToolCalls(raw.toolCalls ?? raw.calls ?? raw.tools ?? raw.toolInvocations),
            timestamp,
        };
    }
    return null;
}
function normalizeTurns(rawTurns) {
    if (!Array.isArray(rawTurns)) {
        return [];
    }
    return rawTurns.flatMap((turn) => normalizeTurnEntry(turn));
}
function normalizeObjectPayload(payload, sourceFile) {
    const payloadTurns = pickRawTurns(payload);
    if (Array.isArray(payloadTurns)) {
        const turns = normalizeTurns(payloadTurns);
        if (!turns.length) {
            return null;
        }
        const id = typeof payload.id === 'string' ? payload.id : sourceFile;
        const title = typeof payload.title === 'string'
            ? payload.title
            : typeof payload.name === 'string'
                ? payload.name
                : id;
        const lastMessageDate = toIsoTimestamp(payload.lastMessageDate ?? payload.updatedAt ?? turns[turns.length - 1]?.timestamp);
        return {
            provider: 'copilot',
            id,
            title,
            lastMessageDate,
            turns,
            sourceFile,
        };
    }
    if (isRecord(payload.session)) {
        const session = payload.session;
        const turns = normalizeTurns(pickRawTurns(session));
        if (!turns.length) {
            return null;
        }
        const id = typeof session.id === 'string' ? session.id : sourceFile;
        const title = typeof session.title === 'string'
            ? session.title
            : typeof session.name === 'string'
                ? session.name
                : id;
        const lastMessageDate = toIsoTimestamp(session.lastMessageDate ?? session.updatedAt ?? turns[turns.length - 1]?.timestamp);
        return {
            provider: 'copilot',
            id,
            title,
            lastMessageDate,
            turns,
            sourceFile,
        };
    }
    return null;
}
function normalizeSnapshotPatchPayload(records, sourceFile) {
    const snapshotRecord = records.find((r) => isRecord(r) && r.kind === 0 && isRecord(r.v));
    if (!snapshotRecord || !isRecord(snapshotRecord)) {
        return null;
    }
    const snapshot = snapshotRecord.v;
    if (!isRecord(snapshot) || !Array.isArray(snapshot.requests)) {
        return null;
    }
    const requests = JSON.parse(JSON.stringify(snapshot.requests));
    // Apply kind:1 scalar patches to a mutable copy of the snapshot top-level properties.
    // These records set fields like `customTitle` after the initial snapshot is written.
    const snapshotOverrides = {};
    for (const record of records) {
        if (!isRecord(record)
            || record.kind !== 1
            || !Array.isArray(record.k)
            || record.k.length !== 1
            || typeof record.k[0] !== 'string') {
            continue;
        }
        snapshotOverrides[record.k[0]] = record.v;
    }
    const effectiveSnapshot = { ...snapshot, ...snapshotOverrides };
    for (const record of records) {
        if (!isRecord(record) || record.kind !== 2 || !Array.isArray(record.k) || !Array.isArray(record.v)) {
            continue;
        }
        const pathKeys = record.k;
        const patchValues = record.v;
        const spliceIndex = typeof record.i === 'number' ? record.i : undefined;
        if (pathKeys.length === 1 && pathKeys[0] === 'requests') {
            if (spliceIndex !== undefined) {
                requests.splice(spliceIndex, requests.length - spliceIndex, ...patchValues);
            }
            else {
                requests.push(...patchValues);
            }
            continue;
        }
        if (pathKeys.length === 3
            && pathKeys[0] === 'requests'
            && typeof pathKeys[1] === 'number'
            && pathKeys[2] === 'response') {
            const req = requests[pathKeys[1]];
            if (isRecord(req) && Array.isArray(req.response)) {
                if (spliceIndex !== undefined) {
                    req.response.splice(spliceIndex, req.response.length - spliceIndex, ...patchValues);
                }
                else {
                    req.response.push(...patchValues);
                }
            }
        }
    }
    const turns = [];
    for (const request of requests) {
        if (!isRecord(request)) {
            continue;
        }
        const msgObj = isRecord(request.message) ? request.message : undefined;
        const userText = msgObj && typeof msgObj.text === 'string' ? msgObj.text.trim() : '';
        if (userText) {
            const references = [];
            if (Array.isArray(request.contentReferences)) {
                for (const ref of request.contentReferences) {
                    if (!isRecord(ref)) {
                        continue;
                    }
                    const refObj = isRecord(ref.reference) ? ref.reference : ref;
                    const refPath = typeof refObj.fsPath === 'string'
                        ? refObj.fsPath
                        : typeof refObj.path === 'string'
                            ? refObj.path
                            : undefined;
                    if (typeof refPath === 'string') {
                        references.push(refPath);
                    }
                }
            }
            const agentName = isRecord(request.agent) && typeof request.agent.name === 'string'
                ? request.agent.name
                : 'copilot';
            turns.push({
                type: 'request',
                participant: agentName,
                prompt: userText,
                references,
                timestamp: typeof request.timestamp === 'number'
                    ? new Date(request.timestamp).toISOString()
                    : toIsoTimestamp(request.timestamp),
            });
        }
        if (Array.isArray(request.response)) {
            const textParts = [];
            const toolCalls = [];
            for (const part of request.response) {
                if (!isRecord(part)) {
                    continue;
                }
                if (part.kind === 'toolInvocationSerialized') {
                    const name = typeof part.toolId === 'string'
                        ? part.toolId
                        : typeof part.toolCallId === 'string'
                            ? part.toolCallId
                            : 'unknown';
                    const toolCall = { name };
                    if (isRecord(part.pastTenseMessage) && typeof part.pastTenseMessage.value === 'string') {
                        toolCall.summary = String(part.pastTenseMessage.value);
                    }
                    else if (isRecord(part.invocationMessage) && typeof part.invocationMessage.value === 'string') {
                        toolCall.summary = String(part.invocationMessage.value);
                    }
                    toolCalls.push(toolCall);
                    continue;
                }
                if (typeof part.kind === 'string' || typeof part.kind === 'number') {
                    continue;
                }
                if (typeof part.value === 'string' && part.value.trim()) {
                    textParts.push(part.value.trim());
                }
            }
            const content = textParts.join('\n\n').trim();
            if (content) {
                const agentName = isRecord(request.agent) && typeof request.agent.name === 'string'
                    ? request.agent.name
                    : 'copilot';
                turns.push({
                    type: 'response',
                    participant: agentName,
                    content,
                    toolCalls,
                    timestamp: typeof request.timestamp === 'number'
                        ? new Date(request.timestamp + 1).toISOString()
                        : toIsoTimestamp(request.timestamp),
                });
            }
        }
    }
    if (!turns.length) {
        return null;
    }
    const id = typeof effectiveSnapshot.sessionId === 'string' ? effectiveSnapshot.sessionId : sourceFile;
    const title = typeof effectiveSnapshot.customTitle === 'string'
        ? effectiveSnapshot.customTitle
        : typeof effectiveSnapshot.title === 'string'
            ? effectiveSnapshot.title
            : id;
    const lastMessageDate = turns[turns.length - 1]?.timestamp
        ?? (typeof effectiveSnapshot.creationDate === 'number'
            ? new Date(effectiveSnapshot.creationDate).toISOString()
            : new Date().toISOString());
    return {
        provider: 'copilot',
        id,
        title,
        lastMessageDate,
        turns,
        sourceFile,
    };
}
function normalizeJsonlPayload(records, sourceFile) {
    const snapshotResult = normalizeSnapshotPatchPayload(records, sourceFile);
    if (snapshotResult) {
        return snapshotResult;
    }
    const meta = records.find((record) => isRecord(record) && (record.kind === 'meta' || record.type === 'meta'));
    const turns = normalizeTurns(records);
    if (!turns.length) {
        return null;
    }
    const metaRecord = isRecord(meta) ? meta : undefined;
    const id = typeof metaRecord?.id === 'string' ? metaRecord.id : sourceFile;
    const title = typeof metaRecord?.title === 'string' ? metaRecord.title : id;
    const lastMessageDate = toIsoTimestamp(metaRecord?.lastMessageDate ?? turns[turns.length - 1]?.timestamp);
    return {
        provider: 'copilot',
        id,
        title,
        lastMessageDate,
        turns,
        sourceFile,
    };
}
function parseWorkspaceSessionJson(content, sourceFile, provider) {
    const session = parseJson(content, sourceFile);
    return { ...session, provider };
}
function parseWorkspaceSessionJsonl(content, sourceFile, provider) {
    const session = parseJsonl(content, sourceFile);
    return { ...session, provider };
}
function parseJson(content, sourceFile) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        throw new SyntaxError(`Invalid JSON in ${sourceFile}`);
    }
    if (!isRecord(parsed)) {
        throw new UnknownFormatError(sourceFile);
    }
    const normalized = normalizeObjectPayload(parsed, sourceFile);
    if (!normalized) {
        throw new UnknownFormatError(sourceFile);
    }
    return normalized;
}
function parseJsonl(content, sourceFile) {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const records = lines.map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            throw new SyntaxError(`Invalid JSONL in ${sourceFile}`);
        }
    });
    const normalized = normalizeJsonlPayload(records, sourceFile);
    if (!normalized) {
        // If the file uses a recognized snapshot-patch format but has no completed turns yet
        // (e.g. user is still typing their first prompt), skip it silently rather than
        // treating it as an unrecognized format.
        const isKnownEmptyFormat = records.some((r) => isRecord(r) && r.kind === 0 && isRecord(r.v) && Array.isArray(r.v.requests));
        if (isKnownEmptyFormat) {
            throw new EmptySessionError(sourceFile);
        }
        throw new UnknownFormatError(sourceFile);
    }
    return normalized;
}
function createDefaultDeps() {
    return {
        readDir: async (directoryPath) => {
            const entries = await fs.readdir(directoryPath, { withFileTypes: true });
            return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        },
        readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
        showInformationMessage: async (message) => vscode.window.showInformationMessage(message),
        showErrorMessage: async (message) => vscode.window.showErrorMessage(message),
        logWarning: (message) => {
            console.warn(message);
        },
        vscodeVersion: vscode.version,
    };
}
function deriveChatSessionsPath(storageUriPath) {
    return path.join(path.dirname(storageUriPath), 'chatSessions');
}
function createSessionReader(overrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...overrides,
    };
    return {
        async readCopilotSessions(context) {
            if (!context.storageUri) {
                await deps.showInformationMessage('No workspace storage available for this workspace.');
                return [];
            }
            const sessionsDirectory = deriveChatSessionsPath(context.storageUri.fsPath);
            let files;
            try {
                files = await deps.readDir(sessionsDirectory);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (/no such file|cannot find|enoent/i.test(message)) {
                    await deps.showInformationMessage('No Copilot chat sessions found in this workspace. Start a Copilot chat first.');
                    return [];
                }
                throw error;
            }
            const sessionFiles = files.filter((file) => /\.jsonl?$/i.test(file));
            const sessions = [];
            let unknownFormatCount = 0;
            for (const fileName of sessionFiles) {
                const filePath = path.join(sessionsDirectory, fileName);
                const sourceFile = fileName.replace(/\.jsonl?$/i, '');
                try {
                    const content = await deps.readFile(filePath);
                    const session = fileName.toLowerCase().endsWith('.jsonl')
                        ? parseJsonl(content, fileName)
                        : parseJson(content, fileName);
                    sessions.push({ ...session, sourceFile });
                }
                catch (error) {
                    if (error instanceof EmptySessionError) {
                        deps.logWarning(`Skipped empty session (no completed turns yet): ${fileName}`);
                        continue;
                    }
                    if (error instanceof UnknownFormatError) {
                        unknownFormatCount++;
                        deps.logWarning(`Skipped unrecognized session format: ${fileName} (VS Code ${deps.vscodeVersion})`);
                        continue;
                    }
                    if (error instanceof SyntaxError) {
                        deps.logWarning(`Skipped corrupt session file: ${fileName}`);
                        continue;
                    }
                    throw error;
                }
            }
            if (!sessions.length && unknownFormatCount > 0) {
                await deps.showErrorMessage(`Unrecognized Copilot session format (VS Code ${deps.vscodeVersion}). Session Control may need an update.`);
                return [];
            }
            return sessions.sort((a, b) => Date.parse(b.lastMessageDate) - Date.parse(a.lastMessageDate));
        },
    };
}
const defaultSessionReader = createSessionReader();
async function readCopilotSessions(context) {
    return defaultSessionReader.readCopilotSessions(context);
}
//# sourceMappingURL=sessionReader.js.map