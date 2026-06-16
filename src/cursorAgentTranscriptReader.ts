import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SavedTurn, SourceChatSession, ToolCall } from './types';

type CursorSession = SourceChatSession & { provider: 'cursor' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function getDefaultCursorProjectsPath(): string {
	return path.join(os.homedir(), '.cursor', 'projects');
}

export function deriveCursorProjectSlug(workspaceFolderPath: string): string {
	const normalized = path.normalize(workspaceFolderPath);
	const windowsMatch = /^([A-Za-z]):\\?(.*)$/.exec(normalized);
	if (windowsMatch?.[1]) {
		const drive = windowsMatch[1].toLowerCase();
		const rest = (windowsMatch[2] ?? '')
			.replace(/[./\\]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
		return rest ? `${drive}-${rest}` : drive;
	}

	return normalized
		.replace(/^[/\\]+/, '')
		.replace(/[/\\:]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();
}

export function deriveCursorAgentTranscriptsPath(cursorProjectsPath: string, projectSlug: string): string {
	return path.join(cursorProjectsPath, projectSlug, 'agent-transcripts');
}

function normalizeTitle(value: string): string {
	const collapsed = value.replace(/\s+/g, ' ').trim();
	if (!collapsed) {
		return 'Untitled Cursor Session';
	}

	if (collapsed.length <= 80) {
		return collapsed;
	}

	return `${collapsed.slice(0, 77).trimEnd()}...`;
}

function stripUserPromptWrappers(text: string): string {
	const withoutTimestamp = text.replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/gi, '').trim();
	const queryMatch = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i.exec(withoutTimestamp);
	if (queryMatch?.[1]) {
		return queryMatch[1].trim();
	}

	return withoutTimestamp.trim();
}

function extractTextParts(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return [];
	}

	const parts: string[] = [];
	for (const item of content) {
		if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') {
			continue;
		}

		const trimmed = item.text.trim();
		if (trimmed) {
			parts.push(trimmed);
		}
	}

	return parts;
}

function extractToolCalls(content: unknown): ToolCall[] {
	if (!Array.isArray(content)) {
		return [];
	}

	const toolCalls: ToolCall[] = [];
	for (const item of content) {
		if (!isRecord(item) || item.type !== 'tool_use') {
			continue;
		}

		const toolCall: ToolCall = {
			name: typeof item.name === 'string' ? item.name : 'unknown',
		};

		if (item.input !== undefined) {
			try {
				toolCall.arguments = JSON.stringify(item.input);
			} catch {
				toolCall.arguments = String(item.input);
			}
		}

		toolCalls.push(toolCall);
	}

	return toolCalls;
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

export function normalizeCursorAgentTranscriptRecords(
	records: unknown[],
	sourceFile: string,
	baseTimestampMs: number,
): CursorSession | null {
	const turns: SavedTurn[] = [];
	let turnIndex = 0;

	for (const record of records) {
		if (!isRecord(record)) {
			continue;
		}

		if (record.type === 'turn_ended') {
			continue;
		}

		const role = typeof record.role === 'string' ? record.role : undefined;
		const message = isRecord(record.message) ? record.message : undefined;
		const content = message?.content;
		const timestamp = new Date(baseTimestampMs + turnIndex * 1000).toISOString();

		if (role === 'user') {
			const textParts = extractTextParts(content).map(stripUserPromptWrappers).filter(Boolean);
			const prompt = textParts.join('\n\n').trim();
			if (!prompt) {
				continue;
			}

			appendTurn(turns, {
				type: 'request',
				participant: 'user',
				prompt,
				references: [],
				timestamp,
			});
			turnIndex++;
			continue;
		}

		if (role === 'assistant') {
			const textParts = extractTextParts(content);
			const contentText = textParts.join('\n\n').trim();
			const toolCalls = extractToolCalls(content);
			if (!contentText && !toolCalls.length) {
				continue;
			}

			appendTurn(turns, {
				type: 'response',
				participant: 'cursor',
				content: contentText || `[${toolCalls.length} tool call(s)]`,
				toolCalls,
				timestamp,
			});
			turnIndex++;
		}
	}

	if (!turns.length) {
		return null;
	}

	const firstPrompt = turns.find((turn) => turn.type === 'request');
	const lastTurn = turns[turns.length - 1];

	return {
		provider: 'cursor',
		id: sourceFile,
		title: normalizeTitle(firstPrompt?.type === 'request' ? firstPrompt.prompt : sourceFile),
		lastMessageDate: lastTurn ? lastTurn.timestamp : new Date(baseTimestampMs).toISOString(),
		turns,
		sourceFile,
	};
}

export function normalizeCursorAgentTranscriptJsonl(
	content: string,
	sourceFile: string,
	baseTimestampMs: number,
): CursorSession | null {
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
			throw new SyntaxError(`Invalid Cursor agent transcript JSONL in ${sourceFile}`);
		}
	});

	return normalizeCursorAgentTranscriptRecords(records, sourceFile, baseTimestampMs);
}

async function listAgentTranscriptFiles(agentTranscriptsDirectory: string): Promise<string[]> {
	const entries = await fs.readdir(agentTranscriptsDirectory, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const candidate = path.join(agentTranscriptsDirectory, entry.name, `${entry.name}.jsonl`);
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile()) {
				files.push(candidate);
			}
		} catch {
			continue;
		}
	}

	return files;
}

export async function readCursorAgentTranscriptSessions(
	workspaceFolderPath: string,
	cursorProjectsPath: string,
	readFile: (filePath: string) => Promise<string>,
	logWarning: (message: string) => void,
): Promise<CursorSession[]> {
	const projectSlug = deriveCursorProjectSlug(workspaceFolderPath);
	const agentTranscriptsDirectory = deriveCursorAgentTranscriptsPath(cursorProjectsPath, projectSlug);

	let transcriptFiles: string[];
	try {
		transcriptFiles = await listAgentTranscriptFiles(agentTranscriptsDirectory);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/no such file|cannot find|enoent/i.test(message)) {
			return [];
		}

		throw error;
	}

	const sessions: CursorSession[] = [];

	for (const filePath of transcriptFiles) {
		const sourceFile = path.basename(filePath, '.jsonl');
		try {
			const [content, stat] = await Promise.all([
				readFile(filePath),
				fs.stat(filePath),
			]);
			if (!content.trim()) {
				logWarning(`Skipped empty Cursor agent transcript: ${sourceFile}`);
				continue;
			}

			const session = normalizeCursorAgentTranscriptJsonl(content, sourceFile, stat.mtimeMs);
			if (!session) {
				logWarning(`Skipped unreadable Cursor agent transcript: ${sourceFile}`);
				continue;
			}

			sessions.push(session);
		} catch (error) {
			if (error instanceof SyntaxError) {
				logWarning(`Skipped corrupt Cursor agent transcript: ${sourceFile}`);
				continue;
			}

			throw error;
		}
	}

	return sessions.sort(
		(a, b) => Date.parse(b.lastMessageDate) - Date.parse(a.lastMessageDate),
	);
}
