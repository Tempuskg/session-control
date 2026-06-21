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
const sessionStore_1 = require("../../src/sessionStore");
function createSession(id, savedAt, title) {
    return {
        version: 1,
        id,
        title,
        savedAt,
        git: { branch: 'main', commit: 'abcdef123456', dirty: false },
        vscodeVersion: '1.115.0',
        totalTurns: 2,
        part: null,
        totalParts: null,
        previousPartFile: null,
        nextPartFile: null,
        turns: [
            {
                type: 'request',
                participant: 'copilot',
                prompt: 'Prompt',
                references: [],
                timestamp: savedAt,
            },
            {
                type: 'response',
                participant: 'copilot',
                content: 'Response',
                toolCalls: [],
                timestamp: savedAt,
            },
        ],
        markdownSummary: '# Chat: Summary',
    };
}
suite('sessionStore', () => {
    test('createSessionFileName uses timestamp and slugified title', () => {
        const fileName = (0, sessionStore_1.createSessionFileName)({
            savedAt: '2026-04-12T14:30:00.000Z',
            title: 'Fix Auth Bug!',
        });
        assert.equal(fileName, '2026-04-12T14-30-fix-auth-bug.json');
    });
    test('writeSession uses title-only filename when configured', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const session = createSession('title-only-a', '2026-04-12T10:00:00.000Z', 'Write Test');
            const fileName = await store.writeSession(storageDirectory, session, {
                includeTimestampInFileName: false,
            });
            assert.equal(fileName, 'write-test.json');
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('writeSession appends id suffix when title-only filename collides', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const first = createSession('duplicate-a', '2026-04-12T10:00:00.000Z', 'Duplicate Title');
            const second = createSession('duplicate-b', '2026-04-12T10:00:30.000Z', 'Duplicate Title');
            const firstFile = await store.writeSession(storageDirectory, first, {
                includeTimestampInFileName: false,
            });
            const secondFile = await store.writeSession(storageDirectory, second, {
                includeTimestampInFileName: false,
            });
            assert.equal(firstFile, 'duplicate-title.json');
            assert.equal(secondFile, 'duplicate-title-duplicate-b.json');
            const files = await fs.readdir(storageDirectory);
            assert.equal(files.includes('duplicate-title.json'), true);
            assert.equal(files.includes('duplicate-title-duplicate-b.json'), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('writeSessions preserves linked part filenames when title-only split names collide', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            await store.writeSession(storageDirectory, createSession('existing-a', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 1/2)'), {
                includeTimestampInFileName: false,
            });
            await store.writeSession(storageDirectory, createSession('existing-b', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 2/2)'), {
                includeTimestampInFileName: false,
            });
            const partOne = {
                ...createSession('split-session', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 1/2)'),
                part: 1,
                totalParts: 2,
                nextPartFile: 'placeholder-part-2.json',
            };
            const partTwo = {
                ...createSession('split-session', '2026-04-12T10:00:00.000Z', 'Status Plan (Part 2/2)'),
                part: 2,
                totalParts: 2,
                previousPartFile: 'placeholder-part-1.json',
            };
            const writtenFiles = await store.writeSessions(storageDirectory, [partOne, partTwo], {
                includeTimestampInFileName: false,
            });
            assert.equal(writtenFiles[0], 'status-plan-part-1-2-split-sessio.json');
            assert.equal(writtenFiles[1], 'status-plan-part-2-2-split-sessio.json');
            const restoredPartOne = await store.readSession(storageDirectory, writtenFiles[0]);
            const restoredPartTwo = await store.readSession(storageDirectory, writtenFiles[1]);
            assert.equal(restoredPartOne.nextPartFile, writtenFiles[1]);
            assert.equal(restoredPartTwo.previousPartFile, writtenFiles[0]);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('writeSession persists session atomically and readSession restores it', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const session = createSession('a', '2026-04-12T10:00:00.000Z', 'Write Test');
            const fileName = await store.writeSession(storageDirectory, session);
            const restored = await store.readSession(storageDirectory, fileName);
            assert.equal(restored.id, 'a');
            assert.equal(restored.title, 'Write Test');
            const files = await fs.readdir(storageDirectory);
            assert.equal(files.some((file) => file.endsWith('.tmp')), false);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('listSessions returns metadata sorted by newest first', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            await store.writeSession(storageDirectory, createSession('older', '2026-04-10T10:00:00.000Z', 'Older Session'));
            await store.writeSession(storageDirectory, createSession('newer', '2026-04-12T10:00:00.000Z', 'Newer Session'));
            const sessions = await store.listSessions(storageDirectory);
            assert.equal(sessions.length, 2);
            assert.equal(sessions[0]?.id, 'newer');
            assert.equal(sessions[1]?.id, 'older');
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('listSessions returns empty when directory does not exist', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const sessions = await store.listSessions(storageDirectory);
            assert.equal(sessions.length, 0);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('deleteSession removes an existing file and returns false when missing', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            const fileName = await store.writeSession(storageDirectory, createSession('delete-me', '2026-04-12T12:00:00.000Z', 'Delete me'));
            const firstDelete = await store.deleteSession(storageDirectory, fileName);
            const secondDelete = await store.deleteSession(storageDirectory, fileName);
            assert.equal(firstDelete, true);
            assert.equal(secondDelete, false);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('pruneSessions archives oldest sessions when action is archive', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            await store.writeSession(storageDirectory, createSession('a', '2026-04-10T10:00:00.000Z', 'A'));
            await store.writeSession(storageDirectory, createSession('b', '2026-04-11T10:00:00.000Z', 'B'));
            await store.writeSession(storageDirectory, createSession('c', '2026-04-12T10:00:00.000Z', 'C'));
            const result = await store.pruneSessions(storageDirectory, 2, 'archive');
            const remaining = await store.listSessions(storageDirectory);
            const archivedEntries = await fs.readdir(path.join(storageDirectory, '.archive'));
            assert.equal(result.archived, 1);
            assert.equal(result.deleted, 0);
            assert.equal(remaining.length, 2);
            assert.equal(remaining.some((session) => session.id === 'a'), false);
            assert.equal(archivedEntries.some((entry) => entry.endsWith('.json')), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('pruneSessions deletes oldest sessions when action is delete', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-session-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, sessionStore_1.createSessionStore)();
        try {
            await store.writeSession(storageDirectory, createSession('a', '2026-04-10T10:00:00.000Z', 'A'));
            await store.writeSession(storageDirectory, createSession('b', '2026-04-11T10:00:00.000Z', 'B'));
            await store.writeSession(storageDirectory, createSession('c', '2026-04-12T10:00:00.000Z', 'C'));
            const result = await store.pruneSessions(storageDirectory, 1, 'delete');
            const remaining = await store.listSessions(storageDirectory);
            assert.equal(result.archived, 0);
            assert.equal(result.deleted, 2);
            assert.equal(remaining.length, 1);
            assert.equal(remaining[0]?.id, 'c');
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=sessionStore.test.js.map