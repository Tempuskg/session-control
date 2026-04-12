export interface GitContext {
	branch: string;
	commit: string;
	dirty: boolean;
}

export interface ToolCall {
	name: string;
	summary?: string;
	arguments?: string;
	output?: string;
}

export interface RequestTurn {
	type: 'request';
	participant: string;
	prompt: string;
	references: string[];
	timestamp: string;
}

export interface ResponseTurn {
	type: 'response';
	participant: string;
	content: string;
	toolCalls: ToolCall[];
	timestamp: string;
}

export type SavedTurn = RequestTurn | ResponseTurn;

export interface ChatSession {
	version: number;
	id: string;
	title: string;
	savedAt: string;
	git: GitContext | null;
	vscodeVersion: string;
	totalTurns: number;
	part: number | null;
	totalParts: number | null;
	previousPartFile: string | null;
	nextPartFile: string | null;
	turns: SavedTurn[];
	markdownSummary: string;
}

export interface SessionMeta {
	id: string;
	title: string;
	savedAt: string;
	fileName: string;
	turnCount: number;
	git: GitContext | null;
}

export interface ScoredSession extends SessionMeta {
	score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isGitContext(value: unknown): value is GitContext {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.branch === 'string'
		&& typeof value.commit === 'string'
		&& typeof value.dirty === 'boolean'
	);
}

export function isToolCall(value: unknown): value is ToolCall {
	if (!isRecord(value)) {
		return false;
	}

	if (typeof value.name !== 'string') {
		return false;
	}

	if (value.summary !== undefined && typeof value.summary !== 'string') {
		return false;
	}

	if (value.arguments !== undefined && typeof value.arguments !== 'string') {
		return false;
	}

	if (value.output !== undefined && typeof value.output !== 'string') {
		return false;
	}

	return true;
}

export function isRequestTurn(value: unknown): value is RequestTurn {
	if (!isRecord(value)) {
		return false;
	}

	if (value.type !== 'request') {
		return false;
	}

	return (
		typeof value.participant === 'string'
		&& typeof value.prompt === 'string'
		&& Array.isArray(value.references)
		&& value.references.every((reference) => typeof reference === 'string')
		&& isIsoTimestamp(value.timestamp)
	);
}

export function isResponseTurn(value: unknown): value is ResponseTurn {
	if (!isRecord(value)) {
		return false;
	}

	if (value.type !== 'response') {
		return false;
	}

	return (
		typeof value.participant === 'string'
		&& typeof value.content === 'string'
		&& Array.isArray(value.toolCalls)
		&& value.toolCalls.every((toolCall) => isToolCall(toolCall))
		&& isIsoTimestamp(value.timestamp)
	);
}

export function isSavedTurn(value: unknown): value is SavedTurn {
	return isRequestTurn(value) || isResponseTurn(value);
}

export function isChatSession(value: unknown): value is ChatSession {
	if (!isRecord(value)) {
		return false;
	}

	if (
		typeof value.version !== 'number'
		|| typeof value.id !== 'string'
		|| typeof value.title !== 'string'
		|| !isIsoTimestamp(value.savedAt)
		|| typeof value.vscodeVersion !== 'string'
		|| typeof value.totalTurns !== 'number'
		|| !Array.isArray(value.turns)
		|| typeof value.markdownSummary !== 'string'
	) {
		return false;
	}

	if (value.git !== null && !isGitContext(value.git)) {
		return false;
	}

	if (
		!(typeof value.part === 'number' || value.part === null)
		|| !(typeof value.totalParts === 'number' || value.totalParts === null)
		|| !(typeof value.previousPartFile === 'string' || value.previousPartFile === null)
		|| !(typeof value.nextPartFile === 'string' || value.nextPartFile === null)
	) {
		return false;
	}

	return value.turns.every((turn) => isSavedTurn(turn));
}
