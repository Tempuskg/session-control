import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	deriveCursorAgentTranscriptsPath,
	deriveCursorProjectSlug,
	getDefaultCursorProjectsPath,
	readCursorAgentTranscriptSessions,
} from './cursorAgentTranscriptReader';
import { SourceChatSession } from './types';

export const CURSOR_CLI_SOURCE_ID = 'cursor-cli' as const;

export interface CursorCliSessionLocation {
	sourceId: typeof CURSOR_CLI_SOURCE_ID;
	workspaceFolderPath: string;
	projectSlug: string;
	projectDirectory: string;
	agentTranscriptsDirectory: string;
}

export interface CursorCliSession extends SourceChatSession {
	provider: 'cursor';
	cwd: string;
}

interface CursorCliSessionReaderDeps {
	readFile(filePath: string): Promise<string>;
	logWarning(message: string): void;
}

function createDefaultDeps(): CursorCliSessionReaderDeps {
	return {
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		logWarning: (message: string) => {
			console.warn(message);
		},
	};
}

export function resolveCursorCliSessionLocation(
	workspaceFolderPath: string,
	cursorProjectsPath = getDefaultCursorProjectsPath(),
): CursorCliSessionLocation {
	const resolvedWorkspacePath = path.resolve(workspaceFolderPath);
	const projectSlug = deriveCursorProjectSlug(resolvedWorkspacePath);
	const projectDirectory = path.join(cursorProjectsPath, projectSlug);

	return {
		sourceId: CURSOR_CLI_SOURCE_ID,
		workspaceFolderPath: resolvedWorkspacePath,
		projectSlug,
		projectDirectory,
		agentTranscriptsDirectory: deriveCursorAgentTranscriptsPath(
			cursorProjectsPath,
			projectSlug,
		),
	};
}

export function createCursorCliSessionReader(
	overrides: Partial<CursorCliSessionReaderDeps> = {},
): {
	readCursorCliSessions(
		workspaceFolderPath: string,
		cursorProjectsPath?: string,
	): Promise<CursorCliSession[]>;
} {
	const deps: CursorCliSessionReaderDeps = {
		...createDefaultDeps(),
		...overrides,
	};

	return {
		async readCursorCliSessions(
			workspaceFolderPath: string,
			cursorProjectsPath = getDefaultCursorProjectsPath(),
		): Promise<CursorCliSession[]> {
			const location = resolveCursorCliSessionLocation(
				workspaceFolderPath,
				cursorProjectsPath,
			);
			const sessions = await readCursorAgentTranscriptSessions(
				location.workspaceFolderPath,
				cursorProjectsPath,
				deps.readFile,
				deps.logWarning,
			);

			return sessions.map((session) => ({
				...session,
				cwd: location.workspaceFolderPath,
			}));
		},
	};
}

const defaultCursorCliSessionReader = createCursorCliSessionReader();

export async function readCursorCliSessions(
	workspaceFolderPath: string,
	cursorProjectsPath = getDefaultCursorProjectsPath(),
): Promise<CursorCliSession[]> {
	return defaultCursorCliSessionReader.readCursorCliSessions(
		workspaceFolderPath,
		cursorProjectsPath,
	);
}

export { getDefaultCursorProjectsPath } from './cursorAgentTranscriptReader';
