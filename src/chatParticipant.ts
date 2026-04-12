import * as path from 'node:path';
import * as vscode from 'vscode';
import { createSessionStore } from './sessionStore';
import { ChatSession, SavedTurn, SessionMeta } from './types';
import { fuzzyMatchSessions } from './utils';

const chatSessionStore = createSessionStore();

const CHAT_PARTICIPANT_ID = 'chat-commit.resume';
const MIN_AUTO_SELECT_SCORE = 60;

export interface ResumeSelection {
	session?: SessionMeta;
	candidates?: SessionMeta[];
}

function getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration('chat-commit', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	return path.join(workspaceFolder.uri.fsPath, configured);
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

export function renderSessionListMarkdown(sessions: SessionMeta[]): string {
	if (!sessions.length) {
		return 'No saved sessions found. Use Command Palette: Chat Commit: Save Current Chat Session.';
	}

	return ['## Saved Sessions', '', ...sessions.map((session) => asMarkdownListItem(session))].join('\n');
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

export function buildResumePrompt(
	session: ChatSession,
	prompt: string,
	maxTurns: number,
	maxContextChars: number,
): string {
	const trimmedTurns = trimTurnsForResume(session.turns, maxTurns, maxContextChars);
	const contextBlock = turnsToContextBlock(trimmedTurns);

	return [
		'The following is a previous conversation that the user wants to continue.',
		'Use it as context for the next response.',
		'',
		contextBlock,
		'',
		`User follow-up: ${prompt}`,
	].join('\n');
}

export function selectSessionForResume(query: string, sessions: SessionMeta[]): ResumeSelection {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) {
		return {};
	}

	const scored = fuzzyMatchSessions(normalizedQuery, sessions);
	if (!scored.length) {
		return {};
	}

	const best = scored[0];
	if (best && best.score >= MIN_AUTO_SELECT_SCORE) {
		return { session: best };
	}

	return {
		candidates: scored.slice(0, 5),
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

async function sendModelResponse(
	request: vscode.ChatRequest,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	session: ChatSession,
	prompt: string,
	maxTurns: number,
	maxContextChars: number,
): Promise<void> {
	const messageText = buildResumePrompt(session, prompt, maxTurns, maxContextChars);

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
		const workspaceFolder = pickWorkspaceFolder();
		if (!workspaceFolder) {
			stream.markdown('Open a workspace folder before using @chat-commit.');
			return;
		}

		const storageDirectory = getStoragePath(workspaceFolder);
		const sessions = await chatSessionStore.listSessions(storageDirectory);

		if (request.command === 'list') {
			stream.markdown(renderSessionListMarkdown(sessions));
			return;
		}

		if (request.command === 'resume') {
			if (!sessions.length) {
				stream.markdown('No saved sessions found. Save a session before resuming.');
				return;
			}

			const selection = selectSessionForResume(request.prompt, sessions);
			if (selection.session) {
				const resumed = await chatSessionStore.readSession(storageDirectory, selection.session.fileName);
				const maxTurns = vscode.workspace
					.getConfiguration('chat-commit', workspaceFolder.uri)
					.get<number>('resume.maxTurns', 50);
				const maxContextChars = vscode.workspace
					.getConfiguration('chat-commit', workspaceFolder.uri)
					.get<number>('resume.maxContextChars', 80000);
				const trimmed = trimTurnsForResume(resumed.turns, maxTurns, maxContextChars);
				stream.markdown(
					[
						`Loaded **${resumed.title}** (${trimmed.length}/${resumed.turns.length} turns).`,
						'Reply in this thread with @chat-commit and your follow-up question to continue with this context.',
					].join('\n\n'),
				);

				return {
					metadata: {
						resumedSessionFile: selection.session.fileName,
						storageDirectory,
					},
				};
			}

			if (selection.candidates?.length) {
				stream.markdown(
					[
						'Multiple sessions match your query. Try a more specific title or pick one of these:',
						'',
						...selection.candidates.map((session) => asMarkdownListItem(session)),
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

		const resumedSession = await chatSessionStore.readSession(
			resumedSessionMeta.storageDirectory,
			resumedSessionMeta.fileName,
		);
		const maxTurns = vscode.workspace
			.getConfiguration('chat-commit', workspaceFolder.uri)
			.get<number>('resume.maxTurns', 50);
		const maxContextChars = vscode.workspace
			.getConfiguration('chat-commit', workspaceFolder.uri)
			.get<number>('resume.maxContextChars', 80000);

		await sendModelResponse(request, stream, token, resumedSession, request.prompt, maxTurns, maxContextChars);
		return {
			metadata: {
				resumedSessionFile: resumedSessionMeta.fileName,
				storageDirectory: resumedSessionMeta.storageDirectory,
			},
		};
	});

	context.subscriptions.push(participant);
}
