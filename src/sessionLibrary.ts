import * as path from 'node:path';
import { formatResumeProviderLabel } from './resumeTarget';
import { createSessionStore } from './sessionStore';
import type { ChatSession, SavedTurn, SessionMeta, SessionProviderId } from './types';
import { fuzzyMatchSessions } from './utils';

// Saved-session listing and resume logic shared by the chat participant, the
// language-model tools, and the standalone MCP server. It must not import `vscode`:
// callers pass workspace roots and resume settings in as plain values.

const sessionStore = createSessionStore();

const MIN_AUTO_SELECT_SCORE = 60;

export const DEFAULT_STORAGE_PATH = '.chat';

export type ResumeOverflowStrategy = 'summarize' | 'truncate' | 'recent-only' | 'relevant';
/** Strategy used when `relevant` has no relevance scores (TypeSafe off or failed). */
export const RELEVANT_FALLBACK_STRATEGY: ResumeOverflowStrategy = 'summarize';
/** Scores omitted turns against the resume prompt from zero to one; undefined means unavailable. */
export type TurnRelevanceScorer = (omittedTurns: SavedTurn[], prompt: string) => Promise<readonly number[] | undefined>;

export const SUMMARIZE_FALLBACK_NOTE = 'Summary generation failed - showing most recent turns only.';

export interface SessionReadDeps {
	readSession(storageDirectory: string, fileName: string): Promise<ChatSession>;
}

export interface ReassembledSessionResult {
	session: ChatSession;
	rootFileName: string;
	partFiles: string[];
}

/** The `session-control.resume.*` settings that shape resume context. */
export interface ResumeSettings {
	maxTurns: number;
	maxContextChars: number;
	overflowStrategy: ResumeOverflowStrategy;
}

export const DEFAULT_RESUME_SETTINGS: Readonly<ResumeSettings> = {
	maxTurns: 50,
	maxContextChars: 80000,
	overflowStrategy: 'summarize',
};

/** A workspace root whose saved sessions are listed; `root` is carried through to each listed session. */
export interface SessionRoot<TRoot> {
	root: TRoot;
	name: string;
	storageDirectory: string;
}

export interface RootSessionMeta<TRoot> extends SessionMeta {
	workspaceFolder: TRoot;
	storageDirectory: string;
	displayTitle: string;
}

/** Resolves the configured `session-control.storagePath` against a workspace root, rejecting paths that leave it. */
export function resolveStorageDirectory(workspaceRoot: string, configured: string = DEFAULT_STORAGE_PATH): string {
	if (!configured.trim()) {
		throw new Error('session-control.storagePath must not be empty.');
	}

	if (path.isAbsolute(configured)) {
		throw new Error('session-control.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceRoot, configured);
	const relative = path.relative(workspaceRoot, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('session-control.storagePath must stay within the workspace folder.');
	}

	return resolved;
}

export async function listSessionsAcrossRoots<TRoot>(
	roots: readonly SessionRoot<TRoot>[],
): Promise<RootSessionMeta<TRoot>[]> {
	const results = await Promise.all(
		roots.map(async ({ root, name, storageDirectory }) => {
			const sessions = await sessionStore.listSessions(storageDirectory);
			return sessions.map((session) => ({
				...session,
				workspaceFolder: root,
				storageDirectory,
				displayTitle: `[${name}] ${session.title}`,
			}));
		}),
	);

	return results.flat().sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export function formatProviderLabel(provider: SessionProviderId | string): string {
	return formatResumeProviderLabel(provider) ?? (provider.trim() || 'Assistant');
}

export function trimTurnsForResume(turns: SavedTurn[], maxTurns: number, maxContextChars: number): SavedTurn[] {
	if (maxTurns <= 0 || maxContextChars <= 0) {
		return [];
	}

	const byTurnBudget = turns.slice(Math.max(0, turns.length - maxTurns));
	const selected: SavedTurn[] = [];
	let charCount = 0;

	for (let index = byTurnBudget.length - 1; index >= 0; index -= 1) {
		const turn = byTurnBudget[index];
		if (!turn) {
			continue;
		}

		const turnText = turn.type === 'request' ? turn.prompt : turn.content;
		const projected = charCount + turnText.length;
		if (projected > maxContextChars && selected.length > 0) {
			break;
		}

		if (projected <= maxContextChars || selected.length === 0) {
			selected.unshift(turn);
			charCount = projected;
		}
	}

	return selected;
}

function summarizeTurns(omittedTurns: SavedTurn[]): string {
	if (!omittedTurns.length) {
		return '';
	}

	const requestCount = omittedTurns.filter((turn) => turn.type === 'request').length;
	const responseCount = omittedTurns.length - requestCount;
	const first = omittedTurns[0];
	const last = omittedTurns[omittedTurns.length - 1];
	const firstSnippet = first
		? (first.type === 'request' ? first.prompt : first.content).slice(0, 100)
		: '';
	const lastSnippet = last
		? (last.type === 'request' ? last.prompt : last.content).slice(0, 100)
		: '';

	return [
		`Summary of omitted context: ${omittedTurns.length} earlier turns (${requestCount} user, ${responseCount} assistant).`,
		`Earliest omitted snippet: ${firstSnippet}`,
		`Latest omitted snippet: ${lastSnippet}`,
	].join(' ');
}

export function splitRecentAndOmittedTurns(turns: SavedTurn[], maxTurns: number): { recent: SavedTurn[]; omitted: SavedTurn[] } {
	const recent = turns.slice(Math.max(0, turns.length - maxTurns));
	const omitted = turns.slice(0, Math.max(0, turns.length - recent.length));
	return { recent, omitted };
}

function turnCharLength(turn: SavedTurn): number {
	return (turn.type === 'request' ? turn.prompt : turn.content).length;
}

// Keeps the last `maxTurns` (trimmed to the budget), then spends the remaining
// `maxContextChars` on the most relevant omitted turns, emitted in turn order.
function selectRelevantTurns(
	turns: SavedTurn[],
	maxTurns: number,
	maxContextChars: number,
	relevanceScores: readonly number[],
): { turns: SavedTurn[]; note?: string } {
	const split = splitRecentAndOmittedTurns(turns, maxTurns);
	const recent = trimTurnsForResume(split.recent, split.recent.length || maxTurns, maxContextChars);
	let remaining = maxContextChars - recent.reduce((total, turn) => total + turnCharLength(turn), 0);

	const ranked = split.omitted
		.map((turn, index) => ({ turn, index, relevance: relevanceScores[index] ?? 0 }))
		.filter((entry) => entry.relevance > 0)
		.sort((left, right) => right.relevance - left.relevance || right.index - left.index);
	const chosen = new Set<number>();
	for (const entry of ranked) {
		const length = turnCharLength(entry.turn);
		if (length <= remaining) {
			chosen.add(entry.index);
			remaining -= length;
		}
	}

	const selected = split.omitted.filter((_turn, index) => chosen.has(index));
	const omittedCount = split.omitted.length;
	const note = omittedCount > 0
		? `Included ${selected.length} of ${omittedCount} earlier turns selected by relevance to the follow-up; the rest were omitted.`
		: undefined;
	return {
		turns: [...selected, ...recent],
		...(note ? { note } : {}),
	};
}

export function applyResumeOverflowStrategy(
	turns: SavedTurn[],
	maxTurns: number,
	maxContextChars: number,
	strategy: ResumeOverflowStrategy,
	relevanceScores?: readonly number[],
): { turns: SavedTurn[]; note?: string } {
	if (strategy === 'relevant') {
		if (relevanceScores && maxTurns > 0 && maxContextChars > 0) {
			return selectRelevantTurns(turns, maxTurns, maxContextChars, relevanceScores);
		}
		return applyResumeOverflowStrategy(turns, maxTurns, maxContextChars, RELEVANT_FALLBACK_STRATEGY);
	}

	if (strategy === 'recent-only') {
		const split = splitRecentAndOmittedTurns(turns, maxTurns);
		const recent = split.recent;
		const omitted = split.omitted.length;
		const constrained = trimTurnsForResume(recent, recent.length || maxTurns, maxContextChars);
		const note = omitted > 0 ? `Earlier turns omitted (${omitted} total).` : undefined;
		return {
			turns: constrained,
			...(note ? { note } : {}),
		};
	}

	if (strategy === 'summarize') {
		const split = splitRecentAndOmittedTurns(turns, maxTurns);
		const recent = split.recent;
		const omittedTurns = split.omitted;
		const constrained = trimTurnsForResume(recent, recent.length || maxTurns, maxContextChars);
		const summary = summarizeTurns(omittedTurns);
		return {
			turns: constrained,
			...(summary ? { note: summary } : {}),
		};
	}

	return {
		turns: trimTurnsForResume(turns, maxTurns, maxContextChars),
	};
}

export interface ResolvedResumeOverflow {
	turns: SavedTurn[];
	note?: string;
	/** The strategy actually applied; `relevant` falls back when no scores are available. */
	strategy: ResumeOverflowStrategy;
}

/**
 * Applies the overflow strategy, scoring omitted turns first for `relevant`.
 * Without a scorer, or when it returns nothing or throws, `relevant` falls back
 * to `RELEVANT_FALLBACK_STRATEGY`.
 */
export async function resolveResumeOverflow(
	turns: SavedTurn[],
	prompt: string,
	maxTurns: number,
	maxContextChars: number,
	strategy: ResumeOverflowStrategy,
	scorer?: TurnRelevanceScorer,
): Promise<ResolvedResumeOverflow> {
	if (strategy === 'relevant') {
		const omitted = splitRecentAndOmittedTurns(turns, maxTurns).omitted;
		let scores: readonly number[] | undefined;
		if (scorer && omitted.length > 0) {
			try {
				scores = await scorer(omitted, prompt);
			} catch {
				scores = undefined;
			}
		}
		if (scores || (scorer && omitted.length === 0)) {
			return { ...applyResumeOverflowStrategy(turns, maxTurns, maxContextChars, 'relevant', scores ?? []), strategy };
		}
		return {
			...applyResumeOverflowStrategy(turns, maxTurns, maxContextChars, RELEVANT_FALLBACK_STRATEGY),
			strategy: RELEVANT_FALLBACK_STRATEGY,
		};
	}

	return { ...applyResumeOverflowStrategy(turns, maxTurns, maxContextChars, strategy), strategy };
}

export function turnsToContextBlock(turns: SavedTurn[]): string {
	return turns
		.map((turn) => {
			if (turn.type === 'request') {
				return `User: ${turn.prompt}`;
			}

			return `${formatProviderLabel(turn.participant)}: ${turn.content}`;
		})
		.join('\n\n');
}

// Resume context without the participant's follow-up line, for callers such as the
// language-model tools that hand the transcript back to an agent as a tool result.
export function buildResumeContextText(
	session: ChatSession,
	maxTurns: number,
	maxContextChars: number,
	overflowStrategy: ResumeOverflowStrategy,
): { text: string; includedTurns: number } {
	const constrained = applyResumeOverflowStrategy(session.turns, maxTurns, maxContextChars, overflowStrategy);
	const overflowNote = constrained.note ? [constrained.note, ''] : [];
	return {
		text: [...overflowNote, turnsToContextBlock(constrained.turns)].join('\n'),
		includedTurns: constrained.turns.length,
	};
}

export function selectSessionForResume<T extends SessionMeta>(query: string, sessions: T[]): { session?: T; candidates?: T[] } {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) {
		return {};
	}

	const scored = fuzzyMatchSessions(
		normalizedQuery,
		sessions.map((session) => {
			const displayTitle = 'displayTitle' in session && typeof session.displayTitle === 'string'
				? session.displayTitle
				: session.title;
			return {
				...session,
				title: displayTitle,
			};
		}),
	);
	if (!scored.length) {
		return {};
	}

	const findOriginal = (scoredSession: SessionMeta): T | undefined =>
		sessions.find((session) => session.fileName === scoredSession.fileName && session.savedAt === scoredSession.savedAt);

	if (scored.length === 1) {
		const single = scored[0];
		if (!single) {
			return {};
		}

		const onlyMatch = findOriginal(single);
		return onlyMatch ? { session: onlyMatch } : {};
	}

	const best = scored[0];
	if (best && best.score >= MIN_AUTO_SELECT_SCORE) {
		const match = findOriginal(best);
		return match ? { session: match } : {};
	}

	return {
		candidates: scored.slice(0, 5).map((session) => findOriginal(session)).filter((session): session is T => Boolean(session)),
	};
}

function mergeSessionParts(parts: ChatSession[]): ChatSession {
	const first = parts[0];
	if (!first) {
		throw new Error('Cannot merge empty session parts.');
	}

	const mergedTurns = parts.flatMap((part) => part.turns);
	const merged: ChatSession = {
		...first,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns: mergedTurns,
		totalTurns: mergedTurns.length,
	};

	return merged;
}

export async function loadReassembledSession(
	storageDirectory: string,
	startFileName: string,
	depsOverrides: Partial<SessionReadDeps> = {},
): Promise<ReassembledSessionResult> {
	const deps: SessionReadDeps = {
		readSession: (directory, fileName) => sessionStore.readSession(directory, fileName),
		...depsOverrides,
	};

	const cache = new Map<string, ChatSession>();

	const readPart = async (fileName: string): Promise<ChatSession> => {
		const cached = cache.get(fileName);
		if (cached) {
			return cached;
		}

		const loaded = await deps.readSession(storageDirectory, fileName);
		cache.set(fileName, loaded);
		return loaded;
	};

	const visitedBackward = new Set<string>();
	let rootFileName = startFileName;
	let cursor = await readPart(startFileName);

	while (cursor.previousPartFile) {
		if (visitedBackward.has(rootFileName)) {
			throw new Error('Detected cyclic previousPartFile chain while loading session parts.');
		}

		visitedBackward.add(rootFileName);
		rootFileName = cursor.previousPartFile;
		cursor = await readPart(rootFileName);
	}

	const partFiles: string[] = [];
	const parts: ChatSession[] = [];
	const visitedForward = new Set<string>();
	let nextFileName: string | null = rootFileName;

	while (nextFileName) {
		if (visitedForward.has(nextFileName)) {
			throw new Error('Detected cyclic nextPartFile chain while loading session parts.');
		}

		visitedForward.add(nextFileName);
		partFiles.push(nextFileName);
		const part = await readPart(nextFileName);
		parts.push(part);
		nextFileName = part.nextPartFile;
	}

	return {
		session: mergeSessionParts(parts),
		rootFileName,
		partFiles,
	};
}
