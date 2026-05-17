import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAnalysisStore, createSessionAnalysisFingerprint } from './analysisStore';
import { createSessionStore } from './sessionStore';
import {
	ANALYSIS_PROMPT_VERSION,
	buildAnalysisPrompt,
	buildAnalysisSynthesisPrompt,
	createCustomRangeSelection,
	createNeedsAnalysisSelection,
	createPresetAnalysisSelection,
	DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET,
	filterCandidatesForAnalysis,
	parseAnalysisSelectionAlias,
	splitCandidatesIntoAnalysisBatches,
	type AnalysisCandidateSession,
} from './sessionAnalysis';
import { ChatSession, SavedTurn, SessionMeta } from './types';
import { fuzzyMatchSessions } from './utils';

const chatSessionStore = createSessionStore();
const analysisStore = createAnalysisStore();

const CHAT_PARTICIPANT_ID = 'session-control.resume';
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
		.getConfiguration('session-control', workspaceFolder.uri)
		.get<string>('storagePath', '.chat');

	if (!configured.trim()) {
		throw new Error('session-control.storagePath must not be empty.');
	}

	if (path.isAbsolute(configured)) {
		throw new Error('session-control.storagePath must be relative to the workspace folder.');
	}

	const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
	const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('session-control.storagePath must stay within the workspace folder.');
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
		return 'No saved sessions found. Use Command Palette: Session Control: Save Current Chat Session.';
	}

	return ['## Saved Sessions', '', ...sessions.map((session) => asMarkdownListItem(session))].join('\n');
}

function renderWorkspaceSessionListMarkdown(sessions: WorkspaceSessionMeta[]): string {
	if (!sessions.length) {
		return 'No saved sessions found. Use Command Palette: Session Control: Save Current Chat Session.';
	}

	return ['## Saved Sessions', '', ...sessions.map((session) => asWorkspaceMarkdownListItem(session))].join('\n');
}

function normalizeRelativePath(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

function normalizeDateInput(value: string, endOfDay: boolean): string {
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return `${trimmed}T${endOfDay ? '23:59:59.999Z' : '00:00:00.000Z'}`;
	}

	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error('Date input must be ISO-8601 or YYYY-MM-DD.');
	}

	return parsed.toISOString();
}

async function resolveAnalysisSelection(prompt: string): Promise<import('./types').AnalysisSelection | undefined> {
	const parsed = parseAnalysisSelectionAlias(prompt);
	if (parsed) {
		return parsed;
	}

	const pick = await vscode.window.showQuickPick(
		[
			{ label: 'Last 24 Hours', mode: 'last24Hours' as const },
			{ label: 'Last 7 Days', mode: 'last7Days' as const },
			{ label: 'Last 30 Days', mode: 'last30Days' as const },
			{ label: 'Custom Range', mode: 'customRange' as const },
			{ label: 'Needs Analysis', mode: 'needsAnalysis' as const },
		],
		{ title: 'Select saved-chat analysis scope' },
	);

	if (!pick) {
		return undefined;
	}

	if (pick.mode === 'last24Hours' || pick.mode === 'last7Days' || pick.mode === 'last30Days') {
		return createPresetAnalysisSelection(pick.mode);
	}

	if (pick.mode === 'needsAnalysis') {
		return createNeedsAnalysisSelection();
	}

	const startInput = await vscode.window.showInputBox({
		title: 'Analysis range start',
		prompt: 'Enter the start date as YYYY-MM-DD or ISO timestamp',
		value: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
	});
	if (!startInput) {
		return undefined;
	}

	const endInput = await vscode.window.showInputBox({
		title: 'Analysis range end',
		prompt: 'Enter the end date as YYYY-MM-DD or ISO timestamp',
		value: new Date().toISOString().slice(0, 10),
	});
	if (!endInput) {
		return undefined;
	}

	try {
		return createCustomRangeSelection(
			normalizeDateInput(startInput, false),
			normalizeDateInput(endInput, true),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await vscode.window.showWarningMessage(`Invalid custom analysis range: ${message}`);
		return undefined;
	}
}

async function createAnalysisCandidates(workspaceSessions: WorkspaceSessionMeta[]): Promise<AnalysisCandidateSession[]> {
	const seenRoots = new Set<string>();
	const candidates: AnalysisCandidateSession[] = [];

	for (const session of workspaceSessions) {
		const reassembled = await loadReassembledSession(session.storageDirectory, session.fileName);
		const rootKey = `${session.storageDirectory}::${reassembled.rootFileName}`;
		if (seenRoots.has(rootKey)) {
			continue;
		}

		seenRoots.add(rootKey);
		candidates.push({
			workspaceName: session.workspaceFolder.name,
			storageDirectory: session.storageDirectory,
			fileName: reassembled.rootFileName,
			rootFileName: reassembled.rootFileName,
			fingerprint: createSessionAnalysisFingerprint(reassembled.session),
			session: reassembled.session,
		});
	}

	return candidates.sort((a, b) => Date.parse(b.session.savedAt) - Date.parse(a.session.savedAt));
}

async function loadAnalyzedFingerprintSet(candidates: AnalysisCandidateSession[]): Promise<Set<string>> {
	const storageDirectories = [...new Set(candidates.map((candidate) => candidate.storageDirectory))];
	const indexes = await Promise.all(storageDirectories.map(async (storageDirectory) => ({
		storageDirectory,
		index: await analysisStore.readIndex(storageDirectory),
	})));

	const analyzed = new Set<string>();
	for (const item of indexes) {
		for (const entry of item.index.analyzedSessions) {
			analyzed.add(entry.fingerprint);
		}
	}

	return analyzed;
}

async function collectModelText(
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream | undefined,
	token: vscode.CancellationToken,
	prompt: string,
): Promise<string> {
	const modelResponse = await request.model.sendRequest(
		[vscode.LanguageModelChatMessage.User(prompt)],
		{},
		token,
	);

	let text = '';
	for await (const part of modelResponse.stream) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
			if (stream) {
				stream.markdown(part.value);
			}
		}
	}

	return text.trim();
}

function createStorageSpecificReportReference(
	report: import('./types').AnalysisReportReference,
	reportFilePath: string,
	storageDirectory: string,
): import('./types').AnalysisReportReference {
	return {
		...report,
		reportPath: normalizeRelativePath(path.relative(storageDirectory, reportFilePath)),
	};
}

async function runAnalyzeSessionsCommand(
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	workspaceSessions: WorkspaceSessionMeta[],
): Promise<{ metadata: { analysisReportPath: string; analysisStorageDirectory: string } } | undefined> {
	if (!workspaceSessions.length) {
		stream.markdown('No saved sessions found. Save chat sessions before running analysis.');
		return;
	}

	const selection = await resolveAnalysisSelection(request.prompt);
	if (!selection) {
		return;
	}

	const candidates = await createAnalysisCandidates(workspaceSessions);
	const analyzedFingerprints = await loadAnalyzedFingerprintSet(candidates);
	const filtered = filterCandidatesForAnalysis(candidates, selection, analyzedFingerprints);
	if (!filtered.length) {
		stream.markdown(selection.mode === 'needsAnalysis'
			? 'No saved sessions currently need analysis.'
			: `No saved sessions matched ${selection.label.toLowerCase()}.`);
		return;
	}

	const batches = splitCandidatesIntoAnalysisBatches(filtered, DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET);
	let finalMarkdown = '';
	if (batches.length === 1) {
		finalMarkdown = await collectModelText(request, stream, token, buildAnalysisPrompt(selection, filtered));
	} else {
		stream.markdown(`Analyzing ${filtered.length} saved sessions across ${batches.length} batches. Final synthesis will follow.\n\n`);
		const batchSummaries: string[] = [];
		for (let index = 0; index < batches.length; index += 1) {
			if (token.isCancellationRequested) {
				return;
			}

			const batch = batches[index];
			if (!batch) {
				continue;
			}

			stream.markdown(`_Analyzing batch ${index + 1} of ${batches.length}..._\n\n`);
			const batchPrompt = [
				buildAnalysisPrompt(selection, batch),
				'',
				`This is batch ${index + 1} of ${batches.length}. Produce a concise findings summary that will be synthesized with the other batches into one final report.`,
			].join('\n');
			batchSummaries.push(await collectModelText(request, undefined, token, batchPrompt));
		}

		stream.markdown('_Synthesizing final report..._\n\n');
		finalMarkdown = await collectModelText(request, stream, token, buildAnalysisSynthesisPrompt(selection, batchSummaries));
	}

	if (!finalMarkdown.trim().length) {
		stream.markdown('Analysis completed, but the model returned no report text.');
		return;
	}

	const ownerWorkspace = pickWorkspaceFolder() ?? workspaceFolders[0];
	if (!ownerWorkspace) {
		stream.markdown('Open a workspace folder before saving analysis reports.');
		return;
	}

	const ownerStorageDirectory = getStoragePath(ownerWorkspace);
	const persisted = await analysisStore.writeReport(ownerStorageDirectory, {
		selection,
		promptVersion: ANALYSIS_PROMPT_VERSION,
		contributingWorkspaces: [...new Set(filtered.map((candidate) => candidate.workspaceName))],
		analyzedFingerprints: filtered.map((candidate) => candidate.fingerprint),
		content: finalMarkdown,
	});

	const byStorageDirectory = new Map<string, AnalysisCandidateSession[]>();
	for (const candidate of filtered) {
		const existing = byStorageDirectory.get(candidate.storageDirectory);
		if (existing) {
			existing.push(candidate);
			continue;
		}

		byStorageDirectory.set(candidate.storageDirectory, [candidate]);
	}

	for (const [storageDirectory, sessions] of byStorageDirectory) {
		const reportReference = createStorageSpecificReportReference(
			persisted.report,
			persisted.reportFilePath,
			storageDirectory,
		);
		await analysisStore.recordAnalysis(
			storageDirectory,
			reportReference,
			sessions.map((candidate) => ({
				fingerprint: candidate.fingerprint,
				sessionId: candidate.session.id,
				title: candidate.session.title,
				savedAt: candidate.session.savedAt,
			})),
		);
	}

	stream.markdown(`\n\nSaved analysis report to **${persisted.report.reportPath}** in workspace **${ownerWorkspace.name}**.`);
	return {
		metadata: {
			analysisReportPath: persisted.report.reportPath,
			analysisStorageDirectory: ownerStorageDirectory,
		},
	};
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
			stream.markdown('Open a workspace folder before using @session-control.');
			return;
		}
		const workspaceSessions = await listSessionsAcrossWorkspaceFolders(workspaceFolders);
		const workspaceFolder = pickWorkspaceFolder() ?? workspaceFolders[0];

		if (request.command === 'list') {
			stream.markdown(renderWorkspaceSessionListMarkdown(workspaceSessions));
			return;
		}

		if (request.command === 'analyze') {
			return runAnalyzeSessionsCommand(request, stream, token, workspaceFolders, workspaceSessions);
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
					.getConfiguration('session-control', selection.session.workspaceFolder.uri)
					.get<number>('resume.maxTurns', 50);
				const maxContextChars = vscode.workspace
					.getConfiguration('session-control', selection.session.workspaceFolder.uri)
					.get<number>('resume.maxContextChars', 80000);
				const overflowStrategy = vscode.workspace
					.getConfiguration('session-control', selection.session.workspaceFolder.uri)
					.get<ResumeOverflowStrategy>('resume.overflowStrategy', 'summarize');
				const constrained = applyResumeOverflowStrategy(resumed.turns, maxTurns, maxContextChars, overflowStrategy);
				stream.markdown(
					[
						`Loaded **${resumed.title}** (${constrained.turns.length}/${resumed.turns.length} turns).`,
						'Reply in this thread with @session-control and your follow-up question to continue with this context.',
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

			stream.markdown(`No saved session matching '${request.prompt}'. Try @session-control /list.`);
			return;
		}

		const resumedSessionMeta = findResumedSessionMeta(chatContext.history);
		if (!resumedSessionMeta) {
			stream.markdown('Use @session-control /resume <session name> first, then ask your follow-up.');
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
			stream.markdown('Open a workspace folder before using @session-control.');
			return;
		}
		const maxTurns = vscode.workspace
			.getConfiguration('session-control', resumedWorkspaceFolder.uri)
			.get<number>('resume.maxTurns', 50);
		const maxContextChars = vscode.workspace
			.getConfiguration('session-control', resumedWorkspaceFolder.uri)
			.get<number>('resume.maxContextChars', 80000);
		const overflowStrategy = vscode.workspace
			.getConfiguration('session-control', resumedWorkspaceFolder.uri)
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
