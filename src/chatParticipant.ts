import * as path from 'node:path';
import * as vscode from 'vscode';
import { createSessionStore } from './sessionStore';
import { ChatSession, SavedTurn, SessionMeta } from './types';
import { fuzzyMatchSessions } from './utils';

const chatSessionStore = createSessionStore();

const CHAT_PARTICIPANT_ID = 'chat-commit.resume';
const MIN_AUTO_SELECT_SCORE = 60;

export type ResumeOverflowStrategy = 'summarize' | 'truncate' | 'recent-only';
const SUMMARIZE_FALLBACK_NOTE = 'Summary generation failed - showing most recent turns only.';

export interface ResumeSelection {
	session?: SessionMeta;
	candidates?: SessionMeta[];
}

interface SessionReadDeps {
	readSession(storageDirectory: string, fileName: string): Promise<ChatSession>;
}

export interface ReassembledSessionResult {
	session: ChatSession;
	rootFileName: string;
	partFiles: string[];
}

interface WorkspaceSessionMeta extends SessionMeta {
	workspaceFolder: vscode.WorkspaceFolder;
	storageDirectory: string;
	displayTitle: string;
}

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('chat-commit', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	if (!configured.trim()) {
		throw new Error('chat-commit.storagePath must not be empty.');
	}

	if (path.isAbsolute(configured)) {
		throw new Error('chat-commit.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
	const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('chat-commit.storagePath must stay within the workspace folder.');
	}

	return resolved;
}

function pickWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		const fromActiveEditor = vscode.workspace.getWorkspaceFolder(activeUri);
		if (fromActiveEditor) {
			return fromActiveEditor;
		}
	}

	return vscode.workspace.workspaceFolders?.[0];
}

function asMarkdownListItem(session: SessionMeta): string {
	const commit = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
	const branch = session.git?.branch ?? 'n/a';
	return `- **${session.title}** | ${session.savedAt} | ${session.turnCount} turns | ${branch}@${commit}`;
}

function asWorkspaceMarkdownListItem(session: WorkspaceSessionMeta): string {
	const commit = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
	const branch = session.git?.branch ?? 'n/a';
	return `- **[${session.workspaceFolder.name}] ${session.title}** | ${session.savedAt} | ${session.turnCount} turns | ${branch}@${commit}`;
}

async function listSessionsAcrossWorkspaceFolders(
	workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
): Promise<WorkspaceSessionMeta[]> {
	if (!workspaceFolders?.length) {
		return [];
	}

	const results = await Promise.all(
		workspaceFolders.map(async (workspaceFolder) => {
			const storageDirectory = getStoragePath(workspaceFolder);
			const sessions = await chatSessionStore.listSessions(storageDirectory);
			return sessions.map((session) => ({
				...session,
				workspaceFolder,
				storageDirectory,
				displayTitle: `[${workspaceFolder.name}] ${session.title}`,
			}));
		}),
	);

	return results.flat().sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export function renderSessionListMarkdown(sessions: SessionMeta[]): string {
	if (!sessions.length) {
		return 'No saved sessions found. Use Command Palette: Chat Commit: Save Current Chat Session.';
	}

	return ['## Saved Sessions', '', ...sessions.map((session) => asMarkdownListItem(session))].join('\n');
}

function renderWorkspaceSessionListMarkdown(sessions: WorkspaceSessionMeta[]): string {
	if (!sessions.length) {
		return 'No saved sessions found. Use Command Palette: Chat Commit: Save Current Chat Session.';
	}

	return ['## Saved Sessions', '', ...sessions.map((session) => asWorkspaceMarkdownListItem(session))].join('\n');
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

function splitRecentAndOmittedTurns(turns: SavedTurn[], maxTurns: number): { recent: SavedTurn[]; omitted: SavedTurn[] } {
	const recent = turns.slice(Math.max(0, turns.length - maxTurns));
	const omitted = turns.slice(0, Math.max(0, turns.length - recent.length));
	return { recent, omitted };
}

function applyResumeOverflowStrategy(
	turns: SavedTurn[],
	maxTurns: number,
	maxContextChars: number,
	strategy: ResumeOverflowStrategy,
): { turns: SavedTurn[]; note?: string } {
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

function turnsToContextBlock(turns: SavedTurn[]): string {
	return turns
		.map((turn) => {
			if (turn.type === 'request') {
				return `User: ${turn.prompt}`;
			}

			return `Copilot: ${turn.content}`;
		})
		.join('\n\n');
}

function composeResumePrompt(turns: SavedTurn[], prompt: string, note?: string): string {
	const contextBlock = turnsToContextBlock(turns);
	const overflowNote = note ? `${note}\n\n` : '';

	return [
		'The following is a previous conversation that the user wants to continue.',
		'Use it as context for the next response.',
		'',
		overflowNote,
		contextBlock,
		'',
		`User follow-up: ${prompt}`,
	].join('\n');
}

function turnsToSummaryInput(omittedTurns: SavedTurn[]): string {
	return omittedTurns
		.map((turn) => (turn.type === 'request' ? `User: ${turn.prompt}` : `Assistant: ${turn.content}`))
		.join('\n\n');
}

export async function resolveSummarizeNoteWithFallback(
	omittedTurns: SavedTurn[],
	summarizer: (input: string) => Promise<string>,
): Promise<string | undefined> {
	if (!omittedTurns.length) {
		return undefined;
	}

	try {
		const summary = await summarizer(turnsToSummaryInput(omittedTurns));
		const trimmed = summary.trim();
		if (!trimmed) {
			return SUMMARIZE_FALLBACK_NOTE;
		}

		return `Summary of omitted context: ${trimmed}`;
	} catch {
		return SUMMARIZE_FALLBACK_NOTE;
	}
}

export function buildResumePrompt(
	session: ChatSession,
	prompt: string,
	maxTurns: number,
	maxContextChars: number,
 	overflowStrategy: ResumeOverflowStrategy = 'truncate',
): string {
	const constrained = applyResumeOverflowStrategy(
		session.turns,
		maxTurns,
		maxContextChars,
		overflowStrategy,
	);

	return composeResumePrompt(constrained.turns, prompt, constrained.note);
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
		readSession: (directory, fileName) => chatSessionStore.readSession(directory, fileName),
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

function findResumedSessionMeta(history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]): {
	fileName: string;
	storageDirectory: string;
} | null {
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const turn = history[index];
		if (!(turn instanceof vscode.ChatResponseTurn)) {
			continue;
		}

		if (turn.participant !== CHAT_PARTICIPANT_ID) {
			continue;
		}

		const metadata = turn.result.metadata as { resumedSessionFile?: string; storageDirectory?: string } | undefined;
		if (!metadata?.resumedSessionFile || !metadata.storageDirectory) {
			continue;
		}

		return {
			fileName: metadata.resumedSessionFile,
			storageDirectory: metadata.storageDirectory,
		};
	}

	return null;
}

function findWorkspaceFolderForStorageDirectory(storageDirectory: string): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.find((workspaceFolder) => {
		const relative = path.relative(workspaceFolder.uri.fsPath, storageDirectory);
		return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
	});
}

async function sendModelResponse(
	request: vscode.ChatRequest,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	session: ChatSession,
	prompt: string,
	maxTurns: number,
	maxContextChars: number,
 	overflowStrategy: ResumeOverflowStrategy,
): Promise<void> {
	const constrained = applyResumeOverflowStrategy(session.turns, maxTurns, maxContextChars, overflowStrategy);
	let overflowNote = constrained.note;

	if (overflowStrategy === 'summarize') {
		const split = splitRecentAndOmittedTurns(session.turns, maxTurns);
		overflowNote = await resolveSummarizeNoteWithFallback(split.omitted, async (input) => {
			const summaryRequest = await request.model.sendRequest(
				[
					vscode.LanguageModelChatMessage.User(
						`Summarize this prior conversation context in 3 concise bullet points:\n\n${input}`,
					),
				],
				{},
				token,
			);

			let summaryText = '';
			for await (const part of summaryRequest.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					summaryText += part.value;
				}
			}

			return summaryText;
		});

		if (overflowNote === SUMMARIZE_FALLBACK_NOTE) {
			response.markdown(`*${SUMMARIZE_FALLBACK_NOTE}*`);
		}
	}

	const messageText = composeResumePrompt(constrained.turns, prompt, overflowNote);

	const modelResponse = await request.model.sendRequest(
		[vscode.LanguageModelChatMessage.User(messageText)],
		{},
		token,
	);

	for await (const part of modelResponse.stream) {
		if (part instanceof vscode.LanguageModelTextPart) {
			response.markdown(part.value);
		}
	}
}

export function registerChatParticipant(context: vscode.ExtensionContext): void {
	const participant = vscode.chat.createChatParticipant(CHAT_PARTICIPANT_ID, async (request, chatContext, stream, token) => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			stream.markdown('Open a workspace folder before using @chat-commit.');
			return;
		}
		const workspaceSessions = await listSessionsAcrossWorkspaceFolders(workspaceFolders);
		const workspaceFolder = pickWorkspaceFolder() ?? workspaceFolders[0];

		if (request.command === 'list') {
			stream.markdown(renderWorkspaceSessionListMarkdown(workspaceSessions));
			return;
		}

		if (request.command === 'resume') {
			if (!workspaceSessions.length) {
				stream.markdown('No saved sessions found. Save a session before resuming.');
				return;
			}

			const selection = selectSessionForResume(request.prompt, workspaceSessions);
			if (selection.session) {
				const reassembled = await loadReassembledSession(selection.session.storageDirectory, selection.session.fileName);
				const resumed = reassembled.session;
				const maxTurns = vscode.workspace
					.getConfiguration('chat-commit', selection.session.workspaceFolder.uri)
					.get<number>('resume.maxTurns', 50);
				const maxContextChars = vscode.workspace
					.getConfiguration('chat-commit', selection.session.workspaceFolder.uri)
					.get<number>('resume.maxContextChars', 80000);
				const overflowStrategy = vscode.workspace
					.getConfiguration('chat-commit', selection.session.workspaceFolder.uri)
					.get<ResumeOverflowStrategy>('resume.overflowStrategy', 'summarize');
				const constrained = applyResumeOverflowStrategy(resumed.turns, maxTurns, maxContextChars, overflowStrategy);
				stream.markdown(
					[
						`Loaded **${resumed.title}** (${constrained.turns.length}/${resumed.turns.length} turns).`,
						'Reply in this thread with @chat-commit and your follow-up question to continue with this context.',
					].join('\n\n'),
				);

				return {
					metadata: {
						resumedSessionFile: reassembled.rootFileName,
						storageDirectory: selection.session.storageDirectory,
					},
				};
			}

			if (selection.candidates?.length) {
				stream.markdown(
					[
						'Multiple sessions match your query. Try a more specific title or pick one of these:',
						'',
						...selection.candidates.map((session) => asWorkspaceMarkdownListItem(session)),
					].join('\n'),
				);
				return;
			}

			stream.markdown(`No saved session matching '${request.prompt}'. Try @chat-commit /list.`);
			return;
		}

		const resumedSessionMeta = findResumedSessionMeta(chatContext.history);
		if (!resumedSessionMeta) {
			stream.markdown('Use @chat-commit /resume <session name> first, then ask your follow-up.');
			return;
		}

		const reassembled = await loadReassembledSession(
			resumedSessionMeta.storageDirectory,
			resumedSessionMeta.fileName,
		);
		const resumedSession = reassembled.session;
		const resumedWorkspaceFolder = findWorkspaceFolderForStorageDirectory(resumedSessionMeta.storageDirectory)
			?? workspaceFolder
			?? workspaceFolders[0];
		if (!resumedWorkspaceFolder) {
			stream.markdown('Open a workspace folder before using @chat-commit.');
			return;
		}
		const maxTurns = vscode.workspace
			.getConfiguration('chat-commit', resumedWorkspaceFolder.uri)
			.get<number>('resume.maxTurns', 50);
		const maxContextChars = vscode.workspace
			.getConfiguration('chat-commit', resumedWorkspaceFolder.uri)
			.get<number>('resume.maxContextChars', 80000);
		const overflowStrategy = vscode.workspace
			.getConfiguration('chat-commit', resumedWorkspaceFolder.uri)
			.get<ResumeOverflowStrategy>('resume.overflowStrategy', 'summarize');

		await sendModelResponse(request, stream, token, resumedSession, request.prompt, maxTurns, maxContextChars, overflowStrategy);
		return {
			metadata: {
				resumedSessionFile: reassembled.rootFileName,
				storageDirectory: resumedSessionMeta.storageDirectory,
			},
		};
	});

	context.subscriptions.push(participant);
}
