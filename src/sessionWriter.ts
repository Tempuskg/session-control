import * as crypto from 'node:crypto';
import { CopilotSession } from './sessionReader';
import { ChatSession, GitContext, SavedTurn, ToolCall } from './types';
import { formatTimestamp, slugify } from './utils';

const DEFAULT_SUMMARY_MAX_TURNS = 50;
const DEFAULT_SUMMARY_MAX_CHARS = 100 * 1024;

export interface SessionWriterOptions {
	title?: string;
	git?: GitContext | null;
	savedAt?: string;
	vscodeVersion?: string;
	summaryMaxTurns?: number;
	summaryMaxChars?: number;
}

export type SaveOverflowStrategy = 'split' | 'truncateOldest' | 'warn';

export interface SaveBloatOptions {
	maxFileSizeBytes: number;
	overflowStrategy: SaveOverflowStrategy;
	stripToolOutput: boolean;
}

export interface SaveBloatResult {
	sessions: ChatSession[];
	warning?: string;
}

function toIsoTimestamp(value: string | undefined): string {
	if (value && Number.isFinite(Date.parse(value))) {
		return new Date(value).toISOString();
	}

	return new Date().toISOString();
}

function sanitizeTitle(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function estimateSessionSizeBytes(session: ChatSession): number {
	return Buffer.byteLength(JSON.stringify(session, null, 2), 'utf8');
}

function createFileName(savedAt: string, title: string): string {
	return `${formatTimestamp(new Date(savedAt))}-${slugify(title)}.json`;
}

function replaceToolOutput(value: string | undefined): string | undefined {
	if (!value) {
		return value;
	}

	return `[output stripped - ${value.length} chars]`;
}

function withStrippedToolOutput(turns: SavedTurn[]): SavedTurn[] {
	return turns.map((turn) => {
		if (turn.type === 'request') {
			return turn;
		}

		return {
			...turn,
			toolCalls: turn.toolCalls.map((toolCall) => {
				const replaced = replaceToolOutput(toolCall.output);
				const normalizedToolCall: ToolCall = {
					name: toolCall.name,
				};

				if (toolCall.summary !== undefined) {
					normalizedToolCall.summary = toolCall.summary;
				}

				if (toolCall.arguments !== undefined) {
					normalizedToolCall.arguments = toolCall.arguments;
				}

				if (replaced !== undefined) {
					normalizedToolCall.output = replaced;
				}

				return normalizedToolCall;
			}),
		};
	});
}

function withTurns(base: ChatSession, turns: SavedTurn[]): ChatSession {
	const updated: ChatSession = {
		...base,
		turns,
		totalTurns: turns.length,
		markdownSummary: '',
	};

	updated.markdownSummary = createMarkdownSummary(updated);
	return updated;
}

function splitTurnsByEstimatedSize(base: ChatSession, maxFileSizeBytes: number): SavedTurn[][] {
	if (base.turns.length === 0) {
		return [[]];
	}

	const chunks: SavedTurn[][] = [];
	let currentChunk: SavedTurn[] = [];

	for (const turn of base.turns) {
		const candidate = [...currentChunk, turn];
		const candidateSession = withTurns(base, candidate);
		const candidateSize = estimateSessionSizeBytes(candidateSession);

		if (candidateSize <= maxFileSizeBytes || currentChunk.length === 0) {
			currentChunk = candidate;
			continue;
		}

		chunks.push(currentChunk);
		currentChunk = [turn];
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}

	return chunks;
}

function splitSession(base: ChatSession, maxFileSizeBytes: number): ChatSession[] {
	const chunks = splitTurnsByEstimatedSize(base, maxFileSizeBytes);
	if (chunks.length <= 1) {
		return [withTurns(base, base.turns)];
	}

	const totalParts = chunks.length;
	const parts = chunks.map((chunk, index) => {
		const partNumber = index + 1;
		const partTitle = `${base.title} (Part ${partNumber}/${totalParts})`;
		const partSession = withTurns({ ...base, title: partTitle }, chunk);
		partSession.part = partNumber;
		partSession.totalParts = totalParts;
		return partSession;
	});

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (!part) {
			continue;
		}

		const previousPart = index > 0 ? parts[index - 1] : undefined;
		const nextPart = index + 1 < parts.length ? parts[index + 1] : undefined;

		part.previousPartFile = previousPart ? createFileName(previousPart.savedAt, previousPart.title) : null;
		part.nextPartFile = nextPart ? createFileName(nextPart.savedAt, nextPart.title) : null;
	}

	return parts;
}

function truncateOldest(base: ChatSession, maxFileSizeBytes: number): SaveBloatResult {
	let turns = [...base.turns];
	let truncatedCount = 0;

	while (turns.length > 1) {
		const candidate = withTurns(base, turns);
		if (estimateSessionSizeBytes(candidate) <= maxFileSizeBytes) {
			const warning = truncatedCount > 0 ? `Truncated ${truncatedCount} oldest turn(s) to fit save.maxFileSize.` : undefined;
			return {
				sessions: [candidate],
				...(warning ? { warning } : {}),
			};
		}

		turns = turns.slice(1);
		truncatedCount += 1;
	}

	return {
		sessions: [withTurns(base, turns)],
		warning: `Session still exceeds save.maxFileSize after truncating ${truncatedCount} turn(s).`,
	};
}

function generateTitle(turns: SavedTurn[]): string {
	const firstRequest = turns.find((turn) => turn.type === 'request');
	if (!firstRequest) {
		return 'Untitled Session';
	}

	const clean = sanitizeTitle(firstRequest.prompt);
	if (!clean) {
		return 'Untitled Session';
	}

	if (clean.length <= 80) {
		return clean;
	}

	return `${clean.slice(0, 77).trimEnd()}...`;
}

function renderToolCalls(toolCalls: ToolCall[]): string | null {
	if (!toolCalls.length) {
		return null;
	}

	const rendered = toolCalls
		.map((toolCall) => {
			const summary = toolCall.summary?.trim();
			return summary ? `${toolCall.name} (${summary})` : toolCall.name;
		})
		.join(', ');

	return `> **Tool calls:** ${rendered}`;
}

function renderTurn(index: number, turn: SavedTurn): string {
	const turnNumber = index + 1;

	if (turn.type === 'request') {
		const references = turn.references.length
			? `\n\n- References:\n${turn.references.map((ref) => `  - ${ref}`).join('\n')}`
			: '';

		return `### Turn ${turnNumber} - User\n${turn.prompt}${references}`;
	}

	const toolCalls = renderToolCalls(turn.toolCalls);
	return `### Turn ${turnNumber} - Copilot\n${turn.content}${toolCalls ? `\n\n${toolCalls}` : ''}`;
}

function capTurnsForSummary(turns: SavedTurn[], maxTurns: number): { turns: SavedTurn[]; omittedCount: number } {
	if (turns.length <= maxTurns) {
		return { turns, omittedCount: 0 };
	}

	const omittedCount = turns.length - maxTurns;
	return {
		turns: turns.slice(0, maxTurns),
		omittedCount,
	};
}

function enforceSummaryCharLimit(summary: string, turns: SavedTurn[], maxChars: number): string {
	if (summary.length <= maxChars) {
		return summary;
	}

	if (turns.length <= 20) {
		return `${summary.slice(0, Math.max(0, maxChars - 40))}\n\n... summary truncated ...`;
	}

	const firstTen = turns.slice(0, 10);
	const lastTen = turns.slice(-10);
	const omitted = Math.max(0, turns.length - 20);

	const compact = [
		...firstTen.map((turn, index) => renderTurn(index, turn)),
		`... ${omitted} turns omitted ...`,
		...lastTen.map((turn, index) => renderTurn(firstTen.length + index, turn)),
	].join('\n\n');

	if (compact.length <= maxChars) {
		return compact;
	}

	return `${compact.slice(0, Math.max(0, maxChars - 40))}\n\n... summary truncated ...`;
}

export function createMarkdownSummary(session: ChatSession, options: SessionWriterOptions = {}): string {
	const maxTurns = options.summaryMaxTurns ?? DEFAULT_SUMMARY_MAX_TURNS;
	const maxChars = options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS;

	const capped = capTurnsForSummary(session.turns, maxTurns);
	const commitShort = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
	const branch = session.git?.branch ?? 'n/a';

	const sections = capped.turns.map((turn, index) => renderTurn(index, turn));
	const omittedNote = capped.omittedCount > 0
		? `\n\n... ${capped.omittedCount} additional turns not shown in summary`
		: '';

	const base = [
		`# Chat: ${session.title}`,
		'',
		`**Branch:** ${branch} | **Commit:** ${commitShort} | **Saved:** ${session.savedAt}`,
		`**Turns:** ${session.totalTurns}`,
		'',
		'---',
		'',
		sections.join('\n\n'),
	].join('\n') + omittedNote;

	return enforceSummaryCharLimit(base, capped.turns, maxChars);
}

export function createChatSession(
	source: CopilotSession,
	options: SessionWriterOptions = {},
): ChatSession {
	const savedAt = toIsoTimestamp(options.savedAt);
	const title = options.title ? sanitizeTitle(options.title) : generateTitle(source.turns);

	const chatSession: ChatSession = {
		version: 1,
		id: source.id || crypto.randomUUID(),
		title,
		savedAt,
		git: options.git ?? null,
		vscodeVersion: options.vscodeVersion ?? 'unknown',
		totalTurns: source.turns.length,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns: source.turns,
		markdownSummary: '',
	};

	chatSession.markdownSummary = createMarkdownSummary(chatSession, options);
	return chatSession;
}

export function applySaveBloatControls(
	session: ChatSession,
	options: SaveBloatOptions,
): SaveBloatResult {
	const strippedTurns = options.stripToolOutput ? withStrippedToolOutput(session.turns) : session.turns;
	const normalized = withTurns(session, strippedTurns);

	if (estimateSessionSizeBytes(normalized) <= options.maxFileSizeBytes) {
		return { sessions: [normalized] };
	}

	if (options.overflowStrategy === 'warn') {
		return {
			sessions: [normalized],
			warning: 'Session exceeds save.maxFileSize and was saved as-is because save.overflowStrategy=warn.',
		};
	}

	if (options.overflowStrategy === 'truncateOldest') {
		return truncateOldest(normalized, options.maxFileSizeBytes);
	}

	const split = splitSession(normalized, options.maxFileSizeBytes);
	if (split.length > 1) {
		return {
			sessions: split,
			warning: `Session exceeded save.maxFileSize and was split into ${split.length} part files.`,
		};
	}

	return { sessions: split };
}
