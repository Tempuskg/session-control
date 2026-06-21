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
const sessionReader_1 = require("../../src/sessionReader");
async function setupWorkspaceStorageRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-reader-'));
    const storageUriPath = path.join(root, 'workspaceStorage', 'workspace-1', 'session-control');
    const sessionsDirectory = (0, sessionReader_1.deriveChatSessionsPath)(storageUriPath);
    await fs.mkdir(storageUriPath, { recursive: true });
    await fs.mkdir(sessionsDirectory, { recursive: true });
    return { root, storageUriPath, sessionsDirectory };
}
async function copyFixture(fixtureName, destinationDirectory) {
    const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
    const fixturePath = path.join(repositoryRoot, 'test', 'fixtures', 'session-reader', fixtureName);
    await fs.copyFile(fixturePath, path.join(destinationDirectory, fixtureName));
}
suite('sessionReader', () => {
    test('deriveChatSessionsPath maps workspace storage extension path to chatSessions', () => {
        const result = (0, sessionReader_1.deriveChatSessionsPath)(path.join('tmp', 'workspaceStorage', 'abc', 'session-control'));
        assert.equal(result.endsWith(path.join('workspaceStorage', 'abc', 'chatSessions')), true);
    });
    test('reads json/jsonl sessions, sorts by recency, and skips corrupt files', async () => {
        const warnings = [];
        const infoMessages = [];
        const errorMessages = [];
        const setup = await setupWorkspaceStorageRoot();
        try {
            await copyFixture('v1-session.json', setup.sessionsDirectory);
            await copyFixture('v2-session.json', setup.sessionsDirectory);
            await copyFixture('v3-session.json', setup.sessionsDirectory);
            await copyFixture('jsonl-session.jsonl', setup.sessionsDirectory);
            await copyFixture('snapshot-session.jsonl', setup.sessionsDirectory);
            await copyFixture('corrupt.json', setup.sessionsDirectory);
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async (message) => {
                    infoMessages.push(message);
                },
                showErrorMessage: async (message) => {
                    errorMessages.push(message);
                },
                logWarning: (message) => {
                    warnings.push(message);
                },
                vscodeVersion: '1.115.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            assert.equal(sessions.length, 5);
            assert.equal(sessions[0]?.id, 'session-snapshot');
            assert.equal(sessions[0]?.title, 'Snapshot patch session');
            assert.equal(sessions[0]?.turns.length, 2);
            assert.equal(sessions[0]?.turns[0]?.type, 'request');
            assert.equal((sessions[0]?.turns[0]).prompt, 'How do I fix the login bug?');
            assert.equal(sessions[0]?.turns[1]?.type, 'response');
            const responseTurn = sessions[0]?.turns[1];
            assert.ok(responseTurn.content.includes('null check'));
            assert.ok(responseTurn.content.includes('validated before use'));
            assert.equal(responseTurn.toolCalls.length, 1);
            assert.equal(sessions[1]?.id, 'session-v3');
            assert.equal(sessions[2]?.id, 'session-v2');
            assert.equal(sessions[3]?.id, 'session-jsonl');
            assert.equal(sessions[4]?.id, 'session-v1');
            assert.equal(warnings.some((message) => message.includes('corrupt.json')), true);
            assert.equal(infoMessages.length, 0);
            assert.equal(errorMessages.length, 0);
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
    test('returns empty and shows info message when chatSessions directory does not exist', async () => {
        const infoMessages = [];
        const setup = await setupWorkspaceStorageRoot();
        try {
            await fs.rm(setup.sessionsDirectory, { recursive: true, force: true });
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async (message) => {
                    infoMessages.push(message);
                },
                showErrorMessage: async () => undefined,
                logWarning: () => undefined,
                vscodeVersion: '1.115.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            assert.equal(sessions.length, 0);
            assert.equal(infoMessages[0], 'No Copilot chat sessions found in this workspace. Start a Copilot chat first.');
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
    test('returns empty and shows unknown format error', async () => {
        const errorMessages = [];
        const setup = await setupWorkspaceStorageRoot();
        try {
            await copyFixture('unknown-format.json', setup.sessionsDirectory);
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async () => undefined,
                showErrorMessage: async (message) => {
                    errorMessages.push(message);
                },
                logWarning: () => undefined,
                vscodeVersion: '1.115.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            assert.equal(sessions.length, 0);
            assert.equal(errorMessages[0], 'Unrecognized Copilot session format (VS Code 1.115.0). Session Control may need an update.');
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
    test('skips unknown format files when other valid sessions exist', async () => {
        const errorMessages = [];
        const warnings = [];
        const setup = await setupWorkspaceStorageRoot();
        try {
            await copyFixture('v1-session.json', setup.sessionsDirectory);
            await copyFixture('unknown-format.json', setup.sessionsDirectory);
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async () => undefined,
                showErrorMessage: async (message) => {
                    errorMessages.push(message);
                },
                logWarning: (message) => {
                    warnings.push(message);
                },
                vscodeVersion: '1.115.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            // Valid session should still be returned; unknown-format file should be skipped
            assert.equal(sessions.length, 1);
            // No error popup shown because at least one session loaded OK
            assert.equal(errorMessages.length, 0);
            // Warning logged for the skipped file
            assert.ok(warnings.some((w) => w.includes('unknown-format.json')));
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
    test('skips empty snapshot-patch session silently without showing unknown format error', async () => {
        const errorMessages = [];
        const warnings = [];
        const setup = await setupWorkspaceStorageRoot();
        try {
            // Empty snapshot session (kind:0 with no requests) — e.g. user started typing before any response
            await copyFixture('empty-snapshot-session.jsonl', setup.sessionsDirectory);
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async () => undefined,
                showErrorMessage: async (message) => {
                    errorMessages.push(message);
                },
                logWarning: (message) => {
                    warnings.push(message);
                },
                vscodeVersion: '1.117.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            // Empty session yields nothing — no sessions, but also no error popup
            assert.equal(sessions.length, 0);
            assert.equal(errorMessages.length, 0);
            // A warning is logged but the "unknown format" error is NOT shown
            assert.ok(warnings.some((w) => w.includes('empty-snapshot-session.jsonl')));
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
    test('empty snapshot-patch session alongside valid sessions returns the valid sessions without error', async () => {
        const errorMessages = [];
        const setup = await setupWorkspaceStorageRoot();
        try {
            await copyFixture('snapshot-session.jsonl', setup.sessionsDirectory);
            await copyFixture('empty-snapshot-session.jsonl', setup.sessionsDirectory);
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async () => undefined,
                showErrorMessage: async (message) => {
                    errorMessages.push(message);
                },
                logWarning: () => undefined,
                vscodeVersion: '1.117.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            assert.equal(sessions.length, 1);
            assert.equal(sessions[0]?.id, 'session-snapshot');
            assert.equal(errorMessages.length, 0);
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
    test('applies kind:1 scalar patches to resolve customTitle', async () => {
        const setup = await setupWorkspaceStorageRoot();
        try {
            // Simulate a session where customTitle starts null and is later patched via kind:1
            const snapshotRecord = {
                kind: 0,
                v: {
                    version: 3,
                    creationDate: 1776060000000,
                    customTitle: null,
                    sessionId: 'session-patch-title',
                    initialLocation: 'panel',
                    responderUsername: 'GitHub Copilot',
                    requests: [
                        {
                            requestId: 'req-1',
                            timestamp: 1776060001000,
                            agent: { name: 'copilot' },
                            modelId: 'copilot/auto',
                            responseId: 'resp-1',
                            contentReferences: [],
                            message: { text: 'Hello', parts: [{ text: 'Hello', kind: 'text' }] },
                            response: [{ value: 'Hi there.', supportThemeIcons: false, supportHtml: false }],
                        },
                    ],
                },
            };
            const patchRecord = { kind: 1, k: ['customTitle'], v: 'My Patched Title' };
            const jsonl = [JSON.stringify(snapshotRecord), JSON.stringify(patchRecord)].join('\n');
            await fs.writeFile(path.join(setup.sessionsDirectory, 'patch-title-session.jsonl'), jsonl, 'utf8');
            const reader = (0, sessionReader_1.createSessionReader)({
                showInformationMessage: async () => undefined,
                showErrorMessage: async () => undefined,
                logWarning: () => undefined,
                vscodeVersion: '1.115.0',
            });
            const sessions = await reader.readCopilotSessions({ storageUri: { fsPath: setup.storageUriPath } });
            assert.equal(sessions.length, 1);
            assert.equal(sessions[0]?.title, 'My Patched Title');
        }
        finally {
            await fs.rm(setup.root, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=sessionReader.test.js.map