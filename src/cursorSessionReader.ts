import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	deriveChatSessionsPath,
	EmptySessionError,
	parseWorkspaceSessionJson,
	parseWorkspaceSessionJsonl,
	UnknownFormatError,
} from './sessionReader';
import {
	createCursorCliSessionReader,
	getDefaultCursorProjectsPath,
} from './cursorCliSessionReader';
import { SourceChatSession } from './types';

export const CURSOR_IDE_LEGACY_SOURCE_ID = 'cursor-vscode-legacy' as const;

interface StorageUriLike {
	fsPath: string;
}

interface ExtensionContextLike {
	storageUri?: StorageUriLike | undefined;
}

interface CursorSessionReaderOptions {
	cursorUserDataPath: string;
	cursorProjectsPath: string;
}

interface CursorSessionReaderDeps {
	readDir(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	showInformationMessage(message: string): Thenable<unknown>;
	logWarning(message: string): void;
	vscodeVersion: string;
}

export interface CursorSession extends SourceChatSession {
	provider: 'cursor';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function normalizeComparablePath(value: string): string {
	const normalized = path.normalize(value);
	if (process.platform === 'win32') {
		return normalized.toLowerCase();
	}

	return normalized;
}

function pathsEqual(left: string, right: string): boolean {
	return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function folderUriToPath(folderUri: string): string | undefined {
	try {
		return path.normalize(vscode.Uri.parse(folderUri).fsPath);
	} catch {
		return undefined;
	}
}

export function getDefaultCursorUserDataPath(): string {
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

export { getDefaultCursorProjectsPath } from './cursorCliSessionReader';

export function deriveCursorWorkspaceStorageRoot(cursorUserDataPath: string): string {
	return path.join(cursorUserDataPath, 'workspaceStorage');
}

export function deriveCursorChatSessionsPath(workspaceStorageHashPath: string): string {
	return path.join(workspaceStorageHashPath, 'chatSessions');
}

async function workspaceJsonMatchesFolder(
	workspaceHashDirectory: string,
	workspaceFolderPath: string,
	readFile: (filePath: string) => Promise<string>,
): Promise<boolean> {
	const workspaceJsonPath = path.join(workspaceHashDirectory, 'workspace.json');
	let content: string;
	try {
		content = await readFile(workspaceJsonPath);
	} catch {
		return false;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return false;
	}

	if (!isRecord(parsed) || typeof parsed.folder !== 'string') {
		return false;
	}

	const folderPath = folderUriToPath(parsed.folder);
	return folderPath !== undefined && pathsEqual(folderPath, workspaceFolderPath);
}

export async function resolveCursorWorkspaceStoragePath(
	workspaceFolderPath: string,
	cursorUserDataPath: string,
	deps: Pick<CursorSessionReaderDeps, 'readDir' | 'readFile'>,
): Promise<string | undefined> {
	const workspaceStorageRoot = deriveCursorWorkspaceStorageRoot(cursorUserDataPath);
	let entries: string[];
	try {
		entries = await deps.readDir(workspaceStorageRoot);
	} catch {
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

async function resolveCursorChatSessionsDirectory(
	workspaceFolderPath: string,
	cursorUserDataPath: string,
	context: ExtensionContextLike | undefined,
	deps: Pick<CursorSessionReaderDeps, 'readDir' | 'readFile'>,
): Promise<string | undefined> {
	if (context?.storageUri) {
		const extensionStoragePath = context.storageUri.fsPath;
		const workspaceHashDirectory = path.dirname(extensionStoragePath);
		const workspaceStorageRoot = deriveCursorWorkspaceStorageRoot(cursorUserDataPath);

		if (normalizeComparablePath(workspaceHashDirectory).startsWith(normalizeComparablePath(workspaceStorageRoot))) {
			const matches = await workspaceJsonMatchesFolder(workspaceHashDirectory, workspaceFolderPath, deps.readFile);
			if (matches) {
				return deriveChatSessionsPath(extensionStoragePath);
			}
		}
	}

	const workspaceStoragePath = await resolveCursorWorkspaceStoragePath(
		workspaceFolderPath,
		cursorUserDataPath,
		deps,
	);
	if (!workspaceStoragePath) {
		return undefined;
	}

	return deriveCursorChatSessionsPath(workspaceStoragePath);
}

async function readWorkspaceChatSessions(
	sessionsDirectory: string,
	deps: Pick<CursorSessionReaderDeps, 'readFile' | 'logWarning' | 'vscodeVersion'>,
): Promise<CursorSession[]> {
	let files: string[];
	try {
		const entries = await fs.readdir(sessionsDirectory, { withFileTypes: true });
		files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/no such file|cannot find|enoent/i.test(message)) {
			return [];
		}

		throw error;
	}

	const sessionFiles = files.filter((file) => /\.jsonl?$/i.test(file));
	const sessions: CursorSession[] = [];
	let unknownFormatCount = 0;

	for (const fileName of sessionFiles) {
		const filePath = path.join(sessionsDirectory, fileName);
		const sourceFile = fileName.replace(/\.jsonl?$/i, '');

		try {
			const content = await deps.readFile(filePath);
			const session = fileName.toLowerCase().endsWith('.jsonl')
				? parseWorkspaceSessionJsonl(content, fileName, 'cursor')
				: parseWorkspaceSessionJson(content, fileName, 'cursor');

			sessions.push({ ...session, provider: 'cursor', sourceFile });
		} catch (error) {
			if (error instanceof EmptySessionError) {
				deps.logWarning(`Skipped empty Cursor session (no completed turns yet): ${fileName}`);
				continue;
			}

			if (error instanceof UnknownFormatError) {
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
		deps.logWarning(
			`Skipped ${unknownFormatCount} unrecognized Cursor chatSessions file(s) (VS Code ${deps.vscodeVersion}).`,
		);
	}

	return sessions;
}

function createDefaultDeps(): CursorSessionReaderDeps {
	return {
		readDir: async (directoryPath: string) => {
			const entries = await fs.readdir(directoryPath, { withFileTypes: true });
			return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
		},
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		showInformationMessage: async (message: string) => vscode.window.showInformationMessage(message),
		logWarning: (message: string) => {
			console.warn(message);
		},
		vscodeVersion: vscode.version,
	};
}

export function createCursorSessionReader(overrides: Partial<CursorSessionReaderDeps> = {}): {
	readCursorSessions(
		workspaceFolder: vscode.WorkspaceFolder,
		options: CursorSessionReaderOptions,
		context?: ExtensionContextLike,
	): Promise<CursorSession[]>;
	readCursorIdeLegacySessions(
		workspaceFolder: vscode.WorkspaceFolder,
		cursorUserDataPath: string,
		context?: ExtensionContextLike,
	): Promise<CursorSession[]>;
} {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};
	const cursorCliSessionReader = createCursorCliSessionReader({
		readFile: deps.readFile,
		logWarning: deps.logWarning,
	});

	const readCursorIdeLegacySessions = async (
		workspaceFolder: vscode.WorkspaceFolder,
		cursorUserDataPath: string,
		context?: ExtensionContextLike,
	): Promise<CursorSession[]> => {
		const sessionsDirectory = await resolveCursorChatSessionsDirectory(
			workspaceFolder.uri.fsPath,
			cursorUserDataPath,
			context,
			deps,
		);

		return sessionsDirectory
			? readWorkspaceChatSessions(sessionsDirectory, deps)
			: [];
	};

	return {
		readCursorIdeLegacySessions,
		async readCursorSessions(
			workspaceFolder: vscode.WorkspaceFolder,
			options: CursorSessionReaderOptions,
			context?: ExtensionContextLike,
		): Promise<CursorSession[]> {
			const cursorCliSessions = await cursorCliSessionReader.readCursorCliSessions(
				workspaceFolder.uri.fsPath,
				options.cursorProjectsPath,
			);
			const cursorIdeLegacySessions = await readCursorIdeLegacySessions(
				workspaceFolder,
				options.cursorUserDataPath,
				context,
			);
			const sessions = [...cursorCliSessions, ...cursorIdeLegacySessions];

			if (!sessions.length) {
				await deps.showInformationMessage(
					`No Cursor agent transcripts found for ${workspaceFolder.name}. Open this project in Cursor and start an Agent chat first.`,
				);
				return [];
			}

			return sessions.sort(
				(a, b) => Date.parse(b.lastMessageDate) - Date.parse(a.lastMessageDate),
			);
		},
	};
}

const defaultCursorSessionReader = createCursorSessionReader();

export async function readCursorSessions(
	workspaceFolder: vscode.WorkspaceFolder,
	cursorUserDataPath: string,
	context?: vscode.ExtensionContext,
	cursorProjectsPath = getDefaultCursorProjectsPath(),
): Promise<CursorSession[]> {
	return defaultCursorSessionReader.readCursorSessions(
		workspaceFolder,
		{ cursorUserDataPath, cursorProjectsPath },
		context,
	);
}
