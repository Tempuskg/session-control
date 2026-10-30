import {
	buildResumeContextText,
	selectSessionForResume,
	type ReassembledSessionResult,
	type ResumeSettings,
	type RootSessionMeta,
} from './sessionLibrary';

// List and resume tool text shared by the VS Code language-model tools and the
// standalone MCP server. It must not import `vscode`.
export const LIST_SESSIONS_TOOL_NAME = 'session-control_listSessions';
export const RESUME_SESSION_TOOL_NAME = 'session-control_resumeSession';

/** Tool names quoted in hints, so each host can point at its own tool names. */
export interface SessionToolNames {
	list: string;
	resume: string;
}

export const DEFAULT_SESSION_TOOL_NAMES: Readonly<SessionToolNames> = {
	list: LIST_SESSIONS_TOOL_NAME,
	resume: RESUME_SESSION_TOOL_NAME,
};

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
const MAX_RESUME_CANDIDATES = 5;

export interface ListSessionsToolInput {
	query?: string;
	limit?: number;
}

export interface ResumeSessionToolInput {
	session?: string;
}

export interface SessionToolListEntry {
	id: string;
	title: string;
	date: string;
	branch: string | null;
	commit: string | null;
	turnCount: number;
	provider: string | null;
	workspaceFolder: string;
}

/** A listed session whose root carries a display name (a VS Code workspace folder or an MCP server root). */
export type NamedRootSessionMeta = RootSessionMeta<{ readonly name: string }>;

export type ResumeLimits = ResumeSettings;

export interface SessionToolDeps<TSession extends NamedRootSessionMeta = NamedRootSessionMeta> {
	listSessions: () => Promise<TSession[]>;
	loadSession: (session: TSession) => Promise<ReassembledSessionResult>;
	getResumeLimits: (session: TSession) => ResumeLimits;
}

export function toSessionToolListEntry(session: NamedRootSessionMeta): SessionToolListEntry {
	return {
		id: session.id,
		title: session.title,
		date: session.savedAt,
		branch: session.git?.branch ?? null,
		commit: session.git?.commit ? session.git.commit.slice(0, 7) : null,
		turnCount: session.turnCount,
		provider: session.provider ?? null,
		workspaceFolder: session.workspaceFolder.name,
	};
}

function normalizeLimit(limit: unknown): number {
	if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
		return DEFAULT_LIST_LIMIT;
	}

	return Math.min(Math.floor(limit), MAX_LIST_LIMIT);
}

export function buildListSessionsToolText(
	sessions: NamedRootSessionMeta[],
	input: ListSessionsToolInput = {},
	names: SessionToolNames = DEFAULT_SESSION_TOOL_NAMES,
): string {
	const query = typeof input.query === 'string' ? input.query.trim() : '';
	const matched = query
		? sessions.filter((session) => {
			const needle = query.toLowerCase();
			return session.title.toLowerCase().includes(needle)
				|| session.id.toLowerCase().includes(needle)
				|| (session.git?.branch ?? '').toLowerCase().includes(needle);
		})
		: sessions;
	if (!matched.length) {
		return query
			? `No saved sessions match '${query}'.`
			: 'No saved sessions found. Save one with Session Control: Save Session... first.';
	}

	const limit = normalizeLimit(input.limit);
	const entries = matched.slice(0, limit).map((session) => toSessionToolListEntry(session));
	return JSON.stringify({
		total: matched.length,
		returned: entries.length,
		sessions: entries,
		hint: `Call ${names.resume} with a session id to load one as context.`,
	}, null, 2);
}

export function resolveResumeToolSession<TSession extends NamedRootSessionMeta>(
	query: string,
	sessions: TSession[],
): { session?: TSession; candidates?: TSession[] } {
	const trimmed = query.trim();
	if (!trimmed) {
		return {};
	}

	const lowered = trimmed.toLowerCase();
	const exact = sessions.find((session) => session.id.toLowerCase() === lowered || session.fileName.toLowerCase() === lowered)
		?? sessions.find((session) => session.title.toLowerCase() === lowered);
	if (exact) {
		return { session: exact };
	}

	return selectSessionForResume(trimmed, sessions);
}

export async function buildResumeSessionToolText<TSession extends NamedRootSessionMeta>(
	input: ResumeSessionToolInput,
	deps: SessionToolDeps<TSession>,
	names: SessionToolNames = DEFAULT_SESSION_TOOL_NAMES,
): Promise<string> {
	const query = typeof input.session === 'string' ? input.session.trim() : '';
	if (!query) {
		return `Provide a saved session id or title. Call ${names.list} to see saved sessions.`;
	}

	const sessions = await deps.listSessions();
	if (!sessions.length) {
		return 'No saved sessions found. Save one with Session Control: Save Session... first.';
	}

	const selection = resolveResumeToolSession(query, sessions);
	if (!selection.session) {
		if (selection.candidates?.length) {
			return [
				`Multiple saved sessions match '${query}'. Call ${names.resume} again with one of these ids:`,
				JSON.stringify(selection.candidates.slice(0, MAX_RESUME_CANDIDATES).map((session) => toSessionToolListEntry(session)), null, 2),
			].join('\n');
		}

		return `No saved session matches '${query}'. Call ${names.list} to see saved sessions.`;
	}

	const reassembled = await deps.loadSession(selection.session);
	const resumed = reassembled.session;
	const limits = deps.getResumeLimits(selection.session);
	const context = buildResumeContextText(resumed, limits.maxTurns, limits.maxContextChars, limits.overflowStrategy);
	const entry = toSessionToolListEntry(selection.session);
	return [
		`Saved session "${resumed.title}" (id ${entry.id}, saved ${entry.date}, branch ${entry.branch ?? 'n/a'}).`,
		`Included ${context.includedTurns} of ${resumed.turns.length} turns within the resume limits.`,
		'The following is the previous conversation the user wants to continue. Use it as context for your next response.',
		'',
		context.text,
	].join('\n');
}
