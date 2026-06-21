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
const sessionStore_1 = require("../../src/sessionStore");
const sessionWriter_1 = require("../../src/sessionWriter");
const types_1 = require("../../src/types");
function createCopilotSession() {
    return {
        provider: 'copilot',
        id: 'session-roundtrip',
        title: 'Initial Session Title',
        lastMessageDate: '2026-04-12T12:05:00.000Z',
        sourceFile: 'session-roundtrip',
        turns: [
            {
                type: 'request',
                participant: 'copilot',
                prompt: 'Please summarize the auth bug investigation.',
                references: ['src/auth.ts'],
                timestamp: '2026-04-12T12:00:00.000Z',
            },
            {
                type: 'response',
                participant: 'copilot',
                content: 'The bug appears to be a missing token refresh path.',
                toolCalls: [],
                timestamp: '2026-04-12T12:01:00.000Z',
            },
        ],
    };
}
suite('extension save flow', () => {
    test('runSaveSessionFlow saves and round-trips a valid chat session', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-extension-save-flow-'));
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const storageDirectory = path.join(workspaceRoot, '.chat');
        const infoMessages = [];
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            await fs.mkdir(workspaceRoot, { recursive: true });
            const workspaceFolder = {
                uri: vscode.Uri.file(workspaceRoot),
                name: 'workspace',
                index: 0,
            };
            const fileName = await (0, extension_1.runSaveSessionFlow)({}, workspaceFolder, storageDirectory, {
                readCopilotSessions: async () => [createCopilotSession()],
                selectSession: async (sessions) => sessions[0],
                promptTitle: async () => 'Auth Bug Investigation',
                getGitContext: async () => ({
                    branch: 'main',
                    commit: 'abcdef1234567890',
                    dirty: false,
                }),
                showInformationMessage: async (message) => {
                    infoMessages.push(message);
                    return undefined;
                },
            });
            assert.ok(fileName);
            const restored = await store.readSession(storageDirectory, fileName);
            assert.equal((0, types_1.isChatSession)(restored), true);
            assert.equal(restored.title, 'Auth Bug Investigation');
            assert.equal(restored.provider, 'copilot');
            assert.equal(restored.git?.branch, 'main');
            assert.equal(restored.git?.commit, 'abcdef1234567890');
            assert.equal(restored.totalTurns, 2);
            assert.equal(restored.turns.length, 2);
            assert.equal(infoMessages.some((message) => message.includes(fileName)), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('runSaveSessionFlow writes split sessions and emits warning', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-extension-save-flow-split-'));
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const storageDirectory = path.join(workspaceRoot, '.chat');
        const infoMessages = [];
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            await fs.mkdir(workspaceRoot, { recursive: true });
            const workspaceFolder = {
                uri: vscode.Uri.file(workspaceRoot),
                name: 'workspace',
                index: 0,
            };
            const base = (0, sessionWriter_1.createChatSession)(createCopilotSession(), {
                title: 'Auth Bug Investigation',
                savedAt: '2026-04-12T12:00:00.000Z',
                vscodeVersion: '1.115.0',
            });
            const partOne = { ...base, title: 'Auth Bug Investigation (Part 1/2)', part: 1, totalParts: 2 };
            const partTwo = { ...base, title: 'Auth Bug Investigation (Part 2/2)', part: 2, totalParts: 2 };
            await (0, extension_1.runSaveSessionFlow)({}, workspaceFolder, storageDirectory, {
                readCopilotSessions: async () => [createCopilotSession()],
                selectSession: async (sessions) => sessions[0],
                promptTitle: async () => 'Auth Bug Investigation',
                applySaveBloatControls: () => ({
                    sessions: [partOne, partTwo],
                    warning: 'Session exceeded save.maxFileSize and was split into 2 part files.',
                }),
                showInformationMessage: async (message) => {
                    infoMessages.push(message);
                    return undefined;
                },
            });
            const written = await store.listSessions(storageDirectory);
            assert.equal(written.length, 2);
            assert.equal(infoMessages.some((message) => message.includes('split into 2 part files')), true);
            assert.equal(infoMessages.some((message) => message.includes('Saved 2 session part files')), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('runSaveSessionFlow triggers pruning notifications when limits are exceeded', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-extension-save-flow-prune-'));
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const storageDirectory = path.join(workspaceRoot, '.chat');
        const infoMessages = [];
        try {
            await fs.mkdir(workspaceRoot, { recursive: true });
            const workspaceFolder = {
                uri: vscode.Uri.file(workspaceRoot),
                name: 'workspace',
                index: 0,
            };
            await (0, extension_1.runSaveSessionFlow)({}, workspaceFolder, storageDirectory, {
                readCopilotSessions: async () => [createCopilotSession()],
                selectSession: async (sessions) => sessions[0],
                promptTitle: async () => 'Auth Bug Investigation',
                getPruneConfiguration: () => ({ maxSavedSessions: 1, pruneAction: 'archive' }),
                pruneSessions: async () => ({ archived: 1, deleted: 0 }),
                showInformationMessage: async (message) => {
                    infoMessages.push(message);
                    return undefined;
                },
            });
            assert.equal(infoMessages.some((message) => message.includes('Archived 1 old session file(s)')), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('runSaveSessionFlow adds the storage folder to .gitignore when configured', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-extension-save-flow-gitignore-'));
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const storageDirectory = path.join(workspaceRoot, '.chat');
        try {
            await fs.mkdir(workspaceRoot, { recursive: true });
            const workspaceFolder = {
                uri: vscode.Uri.file(workspaceRoot),
                name: 'workspace',
                index: 0,
            };
            await (0, extension_1.runSaveSessionFlow)({}, workspaceFolder, storageDirectory, {
                readCopilotSessions: async () => [createCopilotSession()],
                selectSession: async (sessions) => sessions[0],
                promptTitle: async () => 'Auth Bug Investigation',
                getIncludeInGitignore: () => true,
                showInformationMessage: async () => undefined,
            });
            const gitignore = await fs.readFile(path.join(workspaceRoot, '.gitignore'), 'utf8');
            assert.equal(gitignore.includes('.chat/'), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=extensionSaveFlow.test.js.map