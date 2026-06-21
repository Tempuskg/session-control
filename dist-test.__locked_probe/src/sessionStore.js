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
exports.createSessionFileName = createSessionFileName;
exports.createSessionStore = createSessionStore;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const types_1 = require("./types");
const utils_1 = require("./utils");
function createDefaultDeps() {
    return {
        mkdir: async (directoryPath) => {
            await fs.mkdir(directoryPath, { recursive: true });
        },
        readdir: async (directoryPath) => {
            const entries = await fs.readdir(directoryPath, { withFileTypes: true });
            return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        },
        readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
        writeFile: async (filePath, content) => fs.writeFile(filePath, content, 'utf8'),
        exists: async (filePath) => {
            try {
                await fs.access(filePath);
                return true;
            }
            catch {
                return false;
            }
        },
        rename: async (fromPath, toPath) => fs.rename(fromPath, toPath),
        unlink: async (filePath) => fs.unlink(filePath),
    };
}
function createTempName(fileName) {
    const randomPart = Math.random().toString(16).slice(2);
    return `${fileName}.${randomPart}.tmp`;
}
function toSessionMeta(fileName, session) {
    return {
        id: session.id,
        title: session.title,
        savedAt: session.savedAt,
        fileName,
        ...(session.provider ? { provider: session.provider } : {}),
        turnCount: session.totalTurns,
        git: session.git,
    };
}
function createSessionFileName(session) {
    return createSessionFileNameWithOptions(session, { includeTimestampInFileName: true });
}
function createSessionFileNameWithOptions(session, options) {
    const timestamp = (0, utils_1.formatTimestamp)(new Date(session.savedAt));
    const slug = (0, utils_1.slugify)(session.title);
    if (options.includeTimestampInFileName) {
        return `${timestamp}-${slug}.json`;
    }
    return `${slug}.json`;
}
function createConflictResolvedFileName(session, options) {
    const timestamp = (0, utils_1.formatTimestamp)(new Date(session.savedAt));
    const slug = (0, utils_1.slugify)(session.title);
    const suffix = (0, utils_1.slugify)(session.id).slice(0, 12);
    if (options.includeTimestampInFileName) {
        return `${timestamp}-${slug}-${suffix}.json`;
    }
    return `${slug}-${suffix}.json`;
}
function stripJsonExtension(fileName) {
    return fileName.replace(/\.json$/i, '');
}
function resolveUniqueSessionFileName(session, options, reservedFileNames) {
    const preferredFileName = createSessionFileNameWithOptions(session, options);
    if (!reservedFileNames.has(preferredFileName.toLowerCase())) {
        return preferredFileName;
    }
    const conflictResolvedFileName = createConflictResolvedFileName(session, options);
    if (!reservedFileNames.has(conflictResolvedFileName.toLowerCase())) {
        return conflictResolvedFileName;
    }
    const baseName = stripJsonExtension(conflictResolvedFileName);
    let duplicateIndex = 2;
    while (true) {
        const candidate = `${baseName}-${duplicateIndex}.json`;
        if (!reservedFileNames.has(candidate.toLowerCase())) {
            return candidate;
        }
        duplicateIndex += 1;
    }
}
function createSessionStore(overrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...overrides,
    };
    async function ensureStorageDirectory(storageDirectory) {
        await deps.mkdir(storageDirectory);
    }
    async function writeSession(storageDirectory, session, options = { includeTimestampInFileName: true }) {
        const [fileName] = await writeSessions(storageDirectory, [session], options);
        if (!fileName) {
            throw new Error('Session write produced no file name.');
        }
        return fileName;
    }
    async function writeSessionToFile(storageDirectory, fileName, session) {
        await ensureStorageDirectory(storageDirectory);
        const filePath = path.join(storageDirectory, fileName);
        const tempPath = path.join(storageDirectory, createTempName(fileName));
        const content = JSON.stringify(session, null, 2);
        try {
            await deps.writeFile(tempPath, content);
            await deps.rename(tempPath, filePath);
        }
        catch (error) {
            await deps.unlink(tempPath).catch(() => undefined);
            throw error;
        }
    }
    async function writeSessions(storageDirectory, sessions, options = { includeTimestampInFileName: true }) {
        await ensureStorageDirectory(storageDirectory);
        const existingFiles = await deps.readdir(storageDirectory).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (/no such file|cannot find|enoent/i.test(message)) {
                return [];
            }
            throw error;
        });
        const reservedFileNames = new Set(existingFiles.map((fileName) => fileName.toLowerCase()));
        const fileNames = sessions.map((session) => {
            const fileName = resolveUniqueSessionFileName(session, options, reservedFileNames);
            reservedFileNames.add(fileName.toLowerCase());
            return fileName;
        });
        const sessionsToWrite = sessions.length > 1
            ? sessions.map((session, index) => ({
                ...session,
                previousPartFile: index > 0 ? (fileNames[index - 1] ?? null) : null,
                nextPartFile: index + 1 < fileNames.length ? (fileNames[index + 1] ?? null) : null,
            }))
            : [...sessions];
        for (let index = 0; index < sessionsToWrite.length; index += 1) {
            const session = sessionsToWrite[index];
            const fileName = fileNames[index];
            if (!session || !fileName) {
                continue;
            }
            await writeSessionToFile(storageDirectory, fileName, session);
        }
        return fileNames;
    }
    async function readSession(storageDirectory, fileName) {
        const filePath = path.join(storageDirectory, fileName);
        const content = await deps.readFile(filePath);
        const parsed = JSON.parse(content);
        if (!(0, types_1.isChatSession)(parsed)) {
            throw new Error(`Invalid session schema: ${fileName}`);
        }
        return parsed;
    }
    async function listSessions(storageDirectory) {
        let files;
        try {
            files = await deps.readdir(storageDirectory);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/no such file|cannot find|enoent/i.test(message)) {
                return [];
            }
            throw error;
        }
        const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));
        const sessions = await Promise.all(jsonFiles.map(async (fileName) => {
            try {
                const session = await readSession(storageDirectory, fileName);
                return toSessionMeta(fileName, session);
            }
            catch {
                return null;
            }
        }));
        return sessions
            .filter((session) => session !== null)
            .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    }
    async function deleteSession(storageDirectory, fileName) {
        const filePath = path.join(storageDirectory, fileName);
        try {
            await deps.unlink(filePath);
            return true;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/no such file|cannot find|enoent/i.test(message)) {
                return false;
            }
            throw error;
        }
    }
    async function pruneSessions(storageDirectory, maxSavedSessions, action) {
        if (maxSavedSessions <= 0) {
            return { archived: 0, deleted: 0 };
        }
        const sessions = await listSessions(storageDirectory);
        if (sessions.length <= maxSavedSessions) {
            return { archived: 0, deleted: 0 };
        }
        const toPrune = sessions.slice(maxSavedSessions);
        if (!toPrune.length) {
            return { archived: 0, deleted: 0 };
        }
        if (action === 'archive') {
            const archiveDirectory = path.join(storageDirectory, '.archive');
            await deps.mkdir(archiveDirectory);
            for (const session of toPrune) {
                await deps.rename(path.join(storageDirectory, session.fileName), path.join(archiveDirectory, session.fileName));
            }
            return { archived: toPrune.length, deleted: 0 };
        }
        for (const session of toPrune) {
            await deps.unlink(path.join(storageDirectory, session.fileName));
        }
        return { archived: 0, deleted: toPrune.length };
    }
    return {
        ensureStorageDirectory,
        writeSession,
        writeSessions,
        readSession,
        listSessions,
        deleteSession,
        pruneSessions,
    };
}
//# sourceMappingURL=sessionStore.js.map