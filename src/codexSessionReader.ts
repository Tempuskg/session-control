import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SourceChatSession, SavedTurn, ToolCall } from './types';

interface CodexSessionReaderDeps {
	listFiles(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	hash(value: string): string;
	showInformationMessage(message: string): Thenable<unknown>;
	logWarning(message: string): void;
}

export interface CodexSession extends SourceChatSession {
	provider: 'codex';
	sourceRevision: string;
}

interface PendingToolCall extends ToolCall {
	callId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toIsoTimestamp(value: unknown, fallback = new Date().toISOString()): string {
	if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
		return new Date(value).toISOString();
	}

	return fallback;
}

function normalizeTitle(value: string): string {
	const collapsed = value.replace(/\s+/g, ' ').trim();
	if (!collapsed) {
		return 'Untitled Codex Session';
	}

	if (collapsed.length <= 80) {
		return collapsed;
	}

	return `${collapsed.slice(0, 77).trimEnd()}...`;
}

function extractContentText(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}

	if (!Array.isArray(value)) {
		return undefined;
	}

	const parts = value
		.map((item) => {
			if (!isRecord(item)) {
				return undefined;
			}

			return typeof item.text === 'string' ? item.text.trim() : undefined;
		})
		.filter((item): item is string => Boolean(item));

	if (!parts.length) {
		return undefined;
	}

	return parts.join('\n').trim();
}

function stringifyUnknown(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}

	if (value === undefined) {
		return undefined;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function appendTurn(turns: SavedTurn[], turn: SavedTurn): void {
	const previous = turns[turns.length - 1];
	if (!previous) {
		turns.push(turn);
		return;
	}

	if (turn.type === 'request' && previous.type === 'request' && previous.prompt === turn.prompt) {
		return;
	}

	if (turn.type === 'response' && previous.type === 'response' && previous.content === turn.content) {
		return;
	}

	turns.push(turn);
}

function flushPendingToolCalls(pendingToolCalls: PendingToolCall[]): ToolCall[] {
	const toolCalls = pendingToolCalls.map((toolCall) => {
		const normalized: ToolCall = {
			name: toolCall.name,
		};

		if (toolCall.summary !== undefined) {
			normalized.summary = toolCall.summary;
		}

		if (toolCall.arguments !== undefined) {
			normalized.arguments = toolCall.arguments;
		}

		if (toolCall.output !== undefined) {
			normalized.output = toolCall.output;
		}

		return normalized;
	});

	pendingToolCalls.length = 0;
	return toolCalls;
}

function normalizeCodexRecords(
	records: unknown[],
	sourceFile: string,
	sourceRevision: string,
): CodexSession | null {
	const turns: SavedTurn[] = [];
	const pendingToolCalls: PendingToolCall[] = [];
	let sessionId = sourceFile;
	let sessionTimestamp: string | undefined;
	let sessionWorkingDirectory: string | undefined;

	for (const record of records) {
		if (!isRecord(record)) {
			continue;
		}

		if (record.type === 'session_meta' && isRecord(record.payload)) {
			sessionId = typeof record.payload.id === 'string' ? record.payload.id : sessionId;
			sessionTimestamp = typeof record.payload.timestamp === 'string' ? record.payload.timestamp : sessionTimestamp;
			const cwd = typeof record.payload.cwd === 'string' ? record.payload.cwd.trim() : undefined;
			if (cwd) {
				sessionWorkingDirectory = cwd;
			}
			continue;
		}

		const payload = isRecord(record.payload) ? record.payload : undefined;
		const timestamp = toIsoTimestamp(record.timestamp ?? payload?.timestamp, sessionTimestamp);

		if (record.type === 'event_msg' && payload?.type === 'user_message' && typeof payload.message === 'string') {
			appendTurn(turns, {
				type: 'request',
				participant: 'codex',
				prompt: payload.message.trim(),
				references: [],
				timestamp,
			});
			continue;
		}

		if (record.type === 'event_msg' && payload?.type === 'agent_message' && typeof payload.message === 'string') {
			appendTurn(turns, {
				type: 'response',
				participant: 'codex',
				content: payload.message.trim(),
				toolCalls: flushPendingToolCalls(pendingToolCalls),
				timestamp,
			});
			continue;
		}

		if (record.type !== 'response_item' || !payload || typeof payload.type !== 'string') {
			continue;
		}

		if (payload.type === 'function_call') {
			const toolCall: PendingToolCall = {
				name: typeof payload.name === 'string' ? payload.name : 'unknown',
			};
			if (typeof payload.call_id === 'string') {
				toolCall.callId = payload.call_id;
			}
			const argumentsText = stringifyUnknown(payload.arguments);
			if (argumentsText !== undefined) {
				toolCall.arguments = argumentsText;
			}
			pendingToolCalls.push(toolCall);
			continue;
		}

		if (payload.type === 'function_call_output') {
			const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
			const output = stringifyUnknown(payload.output);
			const existing = callId ? pendingToolCalls.find((toolCall) => toolCall.callId === callId) : undefined;

			if (existing) {
				if (output !== undefined) {
					existing.output = output;
				}
			} else {
				const toolCall: PendingToolCall = {
					name: 'unknown',
				};
				if (callId !== undefined) {
					toolCall.callId = callId;
				}
				if (output !== undefined) {
					toolCall.output = output;
				}
				pendingToolCalls.push(toolCall);
			}
			continue;
		}

		if (payload.type === 'message' && payload.role === 'assistant') {
			const text = extractContentText(payload.content);
			if (!text) {
				continue;
			}

			appendTurn(turns, {
				type: 'response',
				participant: 'codex',
				content: text,
				toolCalls: flushPendingToolCalls(pendingToolCalls),
				timestamp,
			});
		}

		if (payload.type === 'message' && payload.role === 'user') {
			const text = extractContentText(payload.content);
			if (!text) {
				continue;
			}

			appendTurn(turns, {
				type: 'request',
				participant: 'user',
				prompt: text,
				references: [],
				timestamp,
			});
		}
	}

	if (!turns.length) {
		return null;
	}

	const firstPrompt = turns.find((turn) => turn.type === 'request');
	const lastTurn = turns[turns.length - 1];

	return {
		provider: 'codex',
		id: sessionId,
		title: normalizeTitle(firstPrompt?.type === 'request' ? firstPrompt.prompt : sourceFile),
		lastMessageDate: lastTurn ? lastTurn.timestamp : toIsoTimestamp(sessionTimestamp),
		turns,
		sourceFile,
		sourceRevision,
		...(sessionWorkingDirectory ? { cwd: sessionWorkingDirectory } : {}),
	};
}

function createRevisionInput(content: string): string {
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
}

function normalizeCodexJsonl(
	content: string,
	sourceFile: string,
	hash: (value: string) => string,
): CodexSession | null {
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (!lines.length) {
		return null;
	}

	const records = lines.map((line) => {
		try {
			return JSON.parse(line);
		} catch {
			throw new SyntaxError(`Invalid Codex JSONL in ${sourceFile}`);
		}
	});

	return normalizeCodexRecords(
		records,
		sourceFile,
		`sha256:${hash(createRevisionInput(content))}`,
	);
}

function normalizeCodexJson(
	content: string,
	sourceFile: string,
	hash: (value: string) => string,
): CodexSession | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new SyntaxError(`Invalid Codex JSON in ${sourceFile}`);
	}

	const records = Array.isArray(parsed) ? parsed : [parsed];
	return normalizeCodexRecords(
		records,
		sourceFile,
		`sha256:${hash(createRevisionInput(content))}`,
	);
}

async function listFilesRecursive(directoryPath: string): Promise<string[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const absolutePath = path.join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listFilesRecursive(absolutePath));
			continue;
		}

		if (entry.isFile()) {
			files.push(absolutePath);
		}
	}

	return files;
}

function createDefaultDeps(): CodexSessionReaderDeps {
	return {
		listFiles: listFilesRecursive,
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		hash: (value) => createHash('sha256').update(value).digest('hex'),
		showInformationMessage: async (message: string) => vscode.window.showInformationMessage(message),
		logWarning: (message: string) => {
			console.warn(message);
		},
	};
}

export function deriveCodexSessionsPath(codexHomePath: string): string {
	return path.join(codexHomePath, 'sessions');
}

export function createCodexSessionReader(overrides: Partial<CodexSessionReaderDeps> = {}): {
	readCodexSessions(codexHomePath: string): Promise<CodexSession[]>;
} {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	return {
		async readCodexSessions(codexHomePath: string): Promise<CodexSession[]> {
			const sessionsDirectory = deriveCodexSessionsPath(codexHomePath);
			let files: string[];
			try {
				files = await deps.listFiles(sessionsDirectory);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (/no such file|cannot find|enoent/i.test(message)) {
					await deps.showInformationMessage(`No Codex sessions found in ${sessionsDirectory}.`);
					return [];
				}

				throw error;
			}

			const sessionFiles = files.filter((filePath) => /\.jsonl?$/i.test(filePath));
			const sessions: CodexSession[] = [];

			for (const filePath of sessionFiles) {
				const sourceFile = path.basename(filePath).replace(/\.jsonl?$/i, '');
				try {
					const content = await deps.readFile(filePath);
					if (!content.trim()) {
						deps.logWarning(`Skipped empty Codex session file: ${path.basename(filePath)}`);
						continue;
					}

					const session = filePath.toLowerCase().endsWith('.jsonl')
						? normalizeCodexJsonl(content, sourceFile, deps.hash)
						: normalizeCodexJson(content, sourceFile, deps.hash);
					if (!session) {
						deps.logWarning(`Skipped unreadable Codex session file: ${path.basename(filePath)}`);
						continue;
					}

					sessions.push(session);
				} catch (error) {
					if (error instanceof SyntaxError) {
						deps.logWarning(`Skipped corrupt Codex session file: ${path.basename(filePath)}`);
						continue;
					}

					throw error;
				}
			}

			if (!sessions.length) {
				await deps.showInformationMessage(`No usable Codex sessions found in ${sessionsDirectory}.`);
				return [];
			}

			return sessions.sort((left, right) => Date.parse(right.lastMessageDate) - Date.parse(left.lastMessageDate));
		},
	};
}

const defaultCodexSessionReader = createCodexSessionReader();

export async function readCodexSessions(codexHomePath: string): Promise<CodexSession[]> {
	return defaultCodexSessionReader.readCodexSessions(codexHomePath);
}
