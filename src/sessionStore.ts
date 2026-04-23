import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ChatSession, SessionMeta, isChatSession } from './types';
import { formatTimestamp, slugify } from './utils';

interface SessionStoreDeps {
	mkdir(directoryPath: string): Promise<void>;
	readdir(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;
	exists(filePath: string): Promise<boolean>;
	rename(fromPath: string, toPath: string): Promise<void>;
	unlink(filePath: string): Promise<void>;
}

export type SessionPruneAction = 'archive' | 'delete';

export interface SessionFileNameOptions {
	includeTimestampInFileName: boolean;
}

export interface SessionPruneResult {
	archived: number;
	deleted: number;
}

function createDefaultDeps(): SessionStoreDeps {
	return {
		mkdir: async (directoryPath: string) => {
			await fs.mkdir(directoryPath, { recursive: true });
		},
		readdir: async (directoryPath: string) => {
			const entries = await fs.readdir(directoryPath, { withFileTypes: true });
			return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
		},
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		writeFile: async (filePath: string, content: string) => fs.writeFile(filePath, content, 'utf8'),
		exists: async (filePath: string) => {
			try {
				await fs.access(filePath);
				return true;
			} catch {
				return false;
			}
		},
		rename: async (fromPath: string, toPath: string) => fs.rename(fromPath, toPath),
		unlink: async (filePath: string) => fs.unlink(filePath),
	};
}

function createTempName(fileName: string): string {
	const randomPart = Math.random().toString(16).slice(2);
	return `${fileName}.${randomPart}.tmp`;
}

function toSessionMeta(fileName: string, session: ChatSession): SessionMeta {
	return {
		id: session.id,
		title: session.title,
		savedAt: session.savedAt,
		fileName,
		turnCount: session.totalTurns,
		git: session.git,
	};
}

export function createSessionFileName(session: Pick<ChatSession, 'savedAt' | 'title'>): string {
	return createSessionFileNameWithOptions(session, { includeTimestampInFileName: true });
}

function createSessionFileNameWithOptions(
	session: Pick<ChatSession, 'savedAt' | 'title'>,
	options: SessionFileNameOptions,
): string {
	const timestamp = formatTimestamp(new Date(session.savedAt));
	const slug = slugify(session.title);

	if (options.includeTimestampInFileName) {
		return `${timestamp}-${slug}.json`;
	}

	return `${slug}.json`;
}

function createConflictResolvedFileName(
	session: Pick<ChatSession, 'savedAt' | 'title' | 'id'>,
	options: SessionFileNameOptions,
): string {
	const timestamp = formatTimestamp(new Date(session.savedAt));
	const slug = slugify(session.title);
	const suffix = slugify(session.id).slice(0, 12);

	if (options.includeTimestampInFileName) {
		return `${timestamp}-${slug}-${suffix}.json`;
	}

	return `${slug}-${suffix}.json`;
}

export function createSessionStore(overrides: Partial<SessionStoreDeps> = {}) {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	async function ensureStorageDirectory(storageDirectory: string): Promise<void> {
		await deps.mkdir(storageDirectory);
	}

	async function writeSession(
		storageDirectory: string,
		session: ChatSession,
		options: SessionFileNameOptions = { includeTimestampInFileName: true },
	): Promise<string> {
		await ensureStorageDirectory(storageDirectory);

		const preferredFileName = createSessionFileNameWithOptions(session, options);
		const preferredPath = path.join(storageDirectory, preferredFileName);
		const fileName = (await deps.exists(preferredPath))
			? createConflictResolvedFileName(session, options)
			: preferredFileName;
		const filePath = path.join(storageDirectory, fileName);
		const tempPath = path.join(storageDirectory, createTempName(fileName));
		const content = JSON.stringify(session, null, 2);

		try {
			await deps.writeFile(tempPath, content);
			await deps.rename(tempPath, filePath);
		} catch (error) {
			await deps.unlink(tempPath).catch(() => undefined);
			throw error;
		}

		return fileName;
	}

	async function readSession(storageDirectory: string, fileName: string): Promise<ChatSession> {
		const filePath = path.join(storageDirectory, fileName);
		const content = await deps.readFile(filePath);
		const parsed = JSON.parse(content) as unknown;

		if (!isChatSession(parsed)) {
			throw new Error(`Invalid session schema: ${fileName}`);
		}

		return parsed;
	}

	async function listSessions(storageDirectory: string): Promise<SessionMeta[]> {
		let files: string[];
		try {
			files = await deps.readdir(storageDirectory);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return [];
			}

			throw error;
		}

		const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));
		const sessions = await Promise.all(
			jsonFiles.map(async (fileName) => {
				try {
					const session = await readSession(storageDirectory, fileName);
					return toSessionMeta(fileName, session);
				} catch {
					return null;
				}
			}),
		);

		return sessions
			.filter((session): session is SessionMeta => session !== null)
			.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
	}

	async function deleteSession(storageDirectory: string, fileName: string): Promise<boolean> {
		const filePath = path.join(storageDirectory, fileName);
		try {
			await deps.unlink(filePath);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return false;
			}

			throw error;
		}
	}

	async function pruneSessions(
		storageDirectory: string,
		maxSavedSessions: number,
		action: SessionPruneAction,
	): Promise<SessionPruneResult> {
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
				await deps.rename(
					path.join(storageDirectory, session.fileName),
					path.join(archiveDirectory, session.fileName),
				);
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
		readSession,
		listSessions,
		deleteSession,
		pruneSessions,
	};
}
