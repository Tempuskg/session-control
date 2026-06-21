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
exports.getDefaultCursorProjectsPath = void 0;
exports.getDefaultCursorUserDataPath = getDefaultCursorUserDataPath;
exports.deriveCursorWorkspaceStorageRoot = deriveCursorWorkspaceStorageRoot;
exports.deriveCursorChatSessionsPath = deriveCursorChatSessionsPath;
exports.resolveCursorWorkspaceStoragePath = resolveCursorWorkspaceStoragePath;
exports.createCursorSessionReader = createCursorSessionReader;
exports.readCursorSessions = readCursorSessions;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const sessionReader_1 = require("./sessionReader");
const cursorAgentTranscriptReader_1 = require("./cursorAgentTranscriptReader");
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function normalizeComparablePath(value) {
    const normalized = path.normalize(value);
    if (process.platform === 'win32') {
        return normalized.toLowerCase();
    }
    return normalized;
}
function pathsEqual(left, right) {
    return normalizeComparablePath(left) === normalizeComparablePath(right);
}
function folderUriToPath(folderUri) {
    try {
        return path.normalize(vscode.Uri.parse(folderUri).fsPath);
    }
    catch {
        return undefined;
    }
}
function getDefaultCursorUserDataPath() {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA?.trim();
        if (appData) {
            return path.join(appData, 'Cursor', 'User');
        }
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User');
    }
    return path.join(os.homedir(), '.config', 'Cursor', 'User');
}
var cursorAgentTranscriptReader_2 = require("./cursorAgentTranscriptReader");
Object.defineProperty(exports, "getDefaultCursorProjectsPath", { enumerable: true, get: function () { return cursorAgentTranscriptReader_2.getDefaultCursorProjectsPath; } });
function deriveCursorWorkspaceStorageRoot(cursorUserDataPath) {
    return path.join(cursorUserDataPath, 'workspaceStorage');
}
function deriveCursorChatSessionsPath(workspaceStorageHashPath) {
    return path.join(workspaceStorageHashPath, 'chatSessions');
}
async function workspaceJsonMatchesFolder(workspaceHashDirectory, workspaceFolderPath, readFile) {
    const workspaceJsonPath = path.join(workspaceHashDirectory, 'workspace.json');
    let content;
    try {
        content = await readFile(workspaceJsonPath);
    }
    catch {
        return false;
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        return false;
    }
    if (!isRecord(parsed) || typeof parsed.folder !== 'string') {
        return false;
    }
    const folderPath = folderUriToPath(parsed.folder);
    return folderPath !== undefined && pathsEqual(folderPath, workspaceFolderPath);
}
async function resolveCursorWorkspaceStoragePath(workspaceFolderPath, cursorUserDataPath, deps) {
    const workspaceStorageRoot = deriveCursorWorkspaceStorageRoot(cursorUserDataPath);
    let entries;
    try {
        entries = await deps.readDir(workspaceStorageRoot);
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        const workspaceHashDirectory = path.join(workspaceStorageRoot, entry);
        const matches = await workspaceJsonMatchesFolder(workspaceHashDirectory, workspaceFolderPath, deps.readFile);
        if (matches) {
            return workspaceHashDirectory;
        }
    }
    return undefined;
}
async function resolveCursorChatSessionsDirectory(workspaceFolderPath, cursorUserDataPath, context, deps) {
    if (context?.storageUri) {
        const extensionStoragePath = context.storageUri.fsPath;
        const workspaceHashDirectory = path.dirname(extensionStoragePath);
        const workspaceStorageRoot = deriveCursorWorkspaceStorageRoot(cursorUserDataPath);
        if (normalizeComparablePath(workspaceHashDirectory).startsWith(normalizeComparablePath(workspaceStorageRoot))) {
            const matches = await workspaceJsonMatchesFolder(workspaceHashDirectory, workspaceFolderPath, deps.readFile);
            if (matches) {
                return (0, sessionReader_1.deriveChatSessionsPath)(extensionStoragePath);
            }
        }
    }
    const workspaceStoragePath = await resolveCursorWorkspaceStoragePath(workspaceFolderPath, cursorUserDataPath, deps);
    if (!workspaceStoragePath) {
        return undefined;
    }
    return deriveCursorChatSessionsPath(workspaceStoragePath);
}
async function readWorkspaceChatSessions(sessionsDirectory, deps) {
    let files;
    try {
        const entries = await fs.readdir(sessionsDirectory, { withFileTypes: true });
        files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/no such file|cannot find|enoent/i.test(message)) {
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
                ? (0, sessionReader_1.parseWorkspaceSessionJsonl)(content, fileName, 'cursor')
                : (0, sessionReader_1.parseWorkspaceSessionJson)(content, fileName, 'cursor');
            sessions.push({ ...session, provider: 'cursor', sourceFile });
        }
        catch (error) {
            if (error instanceof sessionReader_1.EmptySessionError) {
                deps.logWarning(`Skipped empty Cursor session (no completed turns yet): ${fileName}`);
                continue;
            }
            if (error instanceof sessionReader_1.UnknownFormatError) {
                unknownFormatCount++;
                deps.logWarning(`Skipped unrecognized Cursor session format: ${fileName} (VS Code ${deps.vscodeVersion})`);
                continue;
            }
            if (error instanceof SyntaxError) {
                deps.logWarning(`Skipped corrupt Cursor session file: ${fileName}`);
                continue;
            }
            throw error;
        }
    }
    if (!sessions.length && unknownFormatCount > 0) {
        deps.logWarning(`Skipped ${unknownFormatCount} unrecognized Cursor chatSessions file(s) (VS Code ${deps.vscodeVersion}).`);
    }
    return sessions;
}
function createDefaultDeps() {
    return {
        readDir: async (directoryPath) => {
            const entries = await fs.readdir(directoryPath, { withFileTypes: true });
            return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        },
        readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
        showInformationMessage: async (message) => vscode.window.showInformationMessage(message),
        logWarning: (message) => {
            console.warn(message);
        },
        vscodeVersion: vscode.version,
    };
}
function createCursorSessionReader(overrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...overrides,
    };
    return {
        async readCursorSessions(workspaceFolder, options, context) {
            const agentSessions = await (0, cursorAgentTranscriptReader_1.readCursorAgentTranscriptSessions)(workspaceFolder.uri.fsPath, options.cursorProjectsPath, deps.readFile, deps.logWarning);
            const sessionsDirectory = await resolveCursorChatSessionsDirectory(workspaceFolder.uri.fsPath, options.cursorUserDataPath, context, deps);
            const workspaceChatSessions = sessionsDirectory
                ? await readWorkspaceChatSessions(sessionsDirectory, deps)
                : [];
            const sessions = [...agentSessions, ...workspaceChatSessions];
            if (!sessions.length) {
                await deps.showInformationMessage(`No Cursor agent transcripts found for ${workspaceFolder.name}. Open this project in Cursor and start an Agent chat first.`);
                return [];
            }
            return sessions.sort((a, b) => Date.parse(b.lastMessageDate) - Date.parse(a.lastMessageDate));
        },
    };
}
const defaultCursorSessionReader = createCursorSessionReader();
async function readCursorSessions(workspaceFolder, cursorUserDataPath, context, cursorProjectsPath = (0, cursorAgentTranscriptReader_1.getDefaultCursorProjectsPath)()) {
    return defaultCursorSessionReader.readCursorSessions(workspaceFolder, { cursorUserDataPath, cursorProjectsPath }, context);
}
//# sourceMappingURL=cursorSessionReader.js.map