import * as crypto from 'node:crypto';
import { CopilotSession } from './sessionReader';
import { ChatSession, GitContext, SavedTurn, ToolCall } from './types';

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

function toIsoTimestamp(value: string | undefined): string {
	if (value && Number.isFinite(Date.parse(value))) {
		return new Date(value).toISOString();
	}

	return new Date().toISOString();
}

function sanitizeTitle(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
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
