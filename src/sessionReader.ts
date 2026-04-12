import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SavedTurn, ToolCall } from './types';

interface StorageUriLike {
	fsPath: string;
}

interface ExtensionContextLike {
	storageUri?: StorageUriLike | undefined;
}

interface SessionReaderDeps {
	readDir(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	showInformationMessage(message: string): Thenable<unknown>;
	showErrorMessage(message: string): Thenable<unknown>;
	logWarning(message: string): void;
	vscodeVersion: string;
}

export interface CopilotSession {
	id: string;
	title: string;
	lastMessageDate: string;
	turns: SavedTurn[];
	sourceFile: string;
}

class UnknownFormatError extends Error {
	constructor(fileName: string) {
		super(`Unknown session format: ${fileName}`);
		this.name = 'UnknownFormatError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toIsoTimestamp(value: unknown): string {
	if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
		return new Date(value).toISOString();
	}

	return new Date().toISOString();
}

function asToolCalls(value: unknown): ToolCall[] {
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

function normalizeTurn(raw: unknown): SavedTurn | null {
	if (!isRecord(raw)) {
		return null;
	}

	const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : undefined;
	const rawRole = typeof raw.role === 'string' ? raw.role.toLowerCase() : undefined;
	const participant = typeof raw.participant === 'string' ? raw.participant : 'copilot';
	const timestamp = toIsoTimestamp(raw.timestamp ?? raw.at ?? raw.createdAt);

	if (rawType === 'request' || rawRole === 'user') {
		const prompt = typeof raw.prompt === 'string'
			? raw.prompt
			: typeof raw.text === 'string'
				? raw.text
				: typeof raw.content === 'string'
					? raw.content
					: '';

		if (!prompt) {
			return null;
		}

		const references = Array.isArray(raw.references)
			? raw.references.filter((reference) => typeof reference === 'string')
			: [];

		return {
			type: 'request',
			participant,
			prompt,
			references,
			timestamp,
		};
	}

	if (rawType === 'response' || rawRole === 'assistant') {
		const content = typeof raw.content === 'string'
			? raw.content
			: typeof raw.text === 'string'
				? raw.text
				: '';

		if (!content) {
			return null;
		}

		return {
			type: 'response',
			participant,
			content,
			toolCalls: asToolCalls(raw.toolCalls ?? raw.calls),
			timestamp,
		};
	}

	return null;
}

function normalizeTurns(rawTurns: unknown): SavedTurn[] {
	if (!Array.isArray(rawTurns)) {
		return [];
	}

	return rawTurns
		.map((turn) => normalizeTurn(turn))
		.filter((turn): turn is SavedTurn => turn !== null);
}

function normalizeObjectPayload(payload: Record<string, unknown>, sourceFile: string): CopilotSession | null {
	if (Array.isArray(payload.turns) || Array.isArray(payload.messages)) {
		const turns = normalizeTurns(payload.turns ?? payload.messages);
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
			id,
			title,
			lastMessageDate,
			turns,
			sourceFile,
		};
	}

	if (isRecord(payload.session)) {
		const session = payload.session;
		const turns = normalizeTurns(session.turns ?? session.messages);
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
			id,
			title,
			lastMessageDate,
			turns,
			sourceFile,
		};
	}

	return null;
}

function normalizeJsonlPayload(records: unknown[], sourceFile: string): CopilotSession | null {
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
		id,
		title,
		lastMessageDate,
		turns,
		sourceFile,
	};
}

function parseJson(content: string, sourceFile: string): CopilotSession {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
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

function parseJsonl(content: string, sourceFile: string): CopilotSession {
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const records = lines.map((line) => {
		try {
			return JSON.parse(line);
		} catch {
			throw new SyntaxError(`Invalid JSONL in ${sourceFile}`);
		}
	});

	const normalized = normalizeJsonlPayload(records, sourceFile);
	if (!normalized) {
		throw new UnknownFormatError(sourceFile);
	}

	return normalized;
}

function createDefaultDeps(): SessionReaderDeps {
	return {
		readDir: async (directoryPath: string) => {
			const entries = await fs.readdir(directoryPath, { withFileTypes: true });
			return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
		},
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		showInformationMessage: async (message: string) => vscode.window.showInformationMessage(message),
		showErrorMessage: async (message: string) => vscode.window.showErrorMessage(message),
		logWarning: (message: string) => {
			console.warn(message);
		},
		vscodeVersion: vscode.version,
	};
}

export function deriveChatSessionsPath(storageUriPath: string): string {
	return path.join(path.dirname(storageUriPath), 'chatSessions');
}

export function createSessionReader(overrides: Partial<SessionReaderDeps> = {}): {
	readCopilotSessions(context: ExtensionContextLike): Promise<CopilotSession[]>;
} {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	return {
		async readCopilotSessions(context: ExtensionContextLike): Promise<CopilotSession[]> {
			if (!context.storageUri) {
				await deps.showInformationMessage('No workspace storage available for this workspace.');
				return [];
			}

			const sessionsDirectory = deriveChatSessionsPath(context.storageUri.fsPath);
			let files: string[];
			try {
				files = await deps.readDir(sessionsDirectory);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (/no such file|cannot find|enoent/i.test(message)) {
					await deps.showInformationMessage('No Copilot chat sessions found in this workspace. Start a Copilot chat first.');
					return [];
				}

				throw error;
			}

			const sessionFiles = files.filter((file) => /\.jsonl?$/i.test(file));
			const sessions: CopilotSession[] = [];

			for (const fileName of sessionFiles) {
				const filePath = path.join(sessionsDirectory, fileName);
				const sourceFile = fileName.replace(/\.jsonl?$/i, '');

				try {
					const content = await deps.readFile(filePath);
					const session = fileName.toLowerCase().endsWith('.jsonl')
						? parseJsonl(content, fileName)
						: parseJson(content, fileName);

					sessions.push({ ...session, sourceFile });
				} catch (error) {
					if (error instanceof UnknownFormatError) {
						await deps.showErrorMessage(
							`Unrecognized Copilot session format (VS Code ${deps.vscodeVersion}). Chat-Commit may need an update.`,
						);
						return [];
					}

					if (error instanceof SyntaxError) {
						deps.logWarning(`Skipped corrupt session file: ${fileName}`);
						continue;
					}

					throw error;
				}
			}

			return sessions.sort(
				(a, b) => Date.parse(b.lastMessageDate) - Date.parse(a.lastMessageDate),
			);
		},
	};
}

const defaultSessionReader = createSessionReader();

export async function readCopilotSessions(context: vscode.ExtensionContext): Promise<CopilotSession[]> {
	return defaultSessionReader.readCopilotSessions(context);
}
