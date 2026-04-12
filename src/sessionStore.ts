import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ChatSession, SessionMeta, isChatSession } from './types';
import { formatTimestamp, slugify } from './utils';

interface SessionStoreDeps {
	mkdir(directoryPath: string): Promise<void>;
	readdir(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	unlink(filePath: string): Promise<void>;
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
	const timestamp = formatTimestamp(new Date(session.savedAt));
	const slug = slugify(session.title);
	return `${timestamp}-${slug}.json`;
}

export function createSessionStore(overrides: Partial<SessionStoreDeps> = {}) {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	async function ensureStorageDirectory(storageDirectory: string): Promise<void> {
		await deps.mkdir(storageDirectory);
	}

	async function writeSession(storageDirectory: string, session: ChatSession): Promise<string> {
		await ensureStorageDirectory(storageDirectory);

		const fileName = createSessionFileName(session);
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

	return {
		ensureStorageDirectory,
		writeSession,
		readSession,
		listSessions,
		deleteSession,
	};
}
