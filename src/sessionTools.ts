import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	NO_ANALYSIS_MODEL_MESSAGE,
	createModelAnalyzeSessionsFlowDeps,
	getStoragePath,
	listSessionsAcrossWorkspaceFolders,
	runAnalyzeSessionsFlow,
	selectDefaultAnalysisModel,
	type WorkspaceSessionMeta,
} from './chatParticipant';
import {
	DEFAULT_RESUME_SETTINGS,
	loadReassembledSession,
	type ResumeOverflowStrategy,
} from './sessionLibrary';
import {
	LIST_SESSIONS_TOOL_NAME,
	RESUME_SESSION_TOOL_NAME,
	buildListSessionsToolText,
	buildResumeSessionToolText,
	type ListSessionsToolInput,
	type ResumeSessionToolInput,
	type SessionToolDeps as SharedSessionToolDeps,
} from './sessionToolText';
import type { AnalyzeSessionsFlowResult } from './analysisOrchestrator';
import { createAnalysisStore } from './analysisStore';
import { buildImplementationHandoffPrompt, createNeedsAnalysisSelection, createPresetAnalysisSelection } from './sessionAnalysis';
import type { AnalysisIndex, AnalysisSelection } from './types';
import type { JudgmentService } from './typesafe/judgmentService';

// Language-model tools for chat harnesses that block chat participants. They reuse
// the participant's /list and /resume logic and return plain text tool results.
export {
	LIST_SESSIONS_TOOL_NAME,
	RESUME_SESSION_TOOL_NAME,
	buildListSessionsToolText,
	buildResumeSessionToolText,
	resolveResumeToolSession,
	toSessionToolListEntry,
	type ListSessionsToolInput,
	type ResumeLimits,
	type ResumeSessionToolInput,
	type SessionToolListEntry,
} from './sessionToolText';
export const ANALYZE_SESSIONS_TOOL_NAME = 'session-control_analyzeSessions';
export const GET_IMPLEMENTATION_PROMPT_TOOL_NAME = 'session-control_getImplementationPrompt';

const MAX_RESUME_CANDIDATES = 5;

export type AnalyzeSessionsToolTimeframe = '24h' | '7d' | '30d';

export interface AnalyzeSessionsToolInput {
	timeframe?: AnalyzeSessionsToolTimeframe;
	onlyUnanalyzed?: boolean;
}

export interface AnalyzeSessionsToolDeps {
	listSessions: () => Promise<WorkspaceSessionMeta[]>;
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	selectChatModels: () => Promise<readonly vscode.LanguageModelChat[]>;
	runAnalysis: (
		selection: AnalysisSelection,
		workspaceFolders: readonly vscode.WorkspaceFolder[],
		sessions: WorkspaceSessionMeta[],
		model: vscode.LanguageModelChat,
		onMarkdown: (markdown: string) => void,
	) => Promise<AnalyzeSessionsFlowResult | undefined>;
	now?: () => Date;
}

export interface GetImplementationPromptToolInput {
	report?: string;
}

export interface ImplementationPromptToolDeps {
	getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	readIndex: (storageDirectory: string) => Promise<AnalysisIndex>;
	readReport: (storageDirectory: string, reportPath: string) => Promise<string>;
}

export type SessionToolDeps = SharedSessionToolDeps<WorkspaceSessionMeta>;

const TIMEFRAME_MODES = {
	'24h': 'last24Hours',
	'7d': 'last7Days',
	'30d': 'last30Days',
} as const;

/** A timeframe analyzes that window (optionally only unanalyzed sessions); no timeframe analyzes every session not yet analyzed. */
export function resolveAnalyzeToolSelection(input: AnalyzeSessionsToolInput, now: Date = new Date()): AnalysisSelection {
	const mode = typeof input.timeframe === 'string' ? TIMEFRAME_MODES[input.timeframe] : undefined;
	if (!mode) {
		return createNeedsAnalysisSelection();
	}

	return createPresetAnalysisSelection(mode, now, input.onlyUnanalyzed === true);
}

function stripMarkdown(markdown: string): string {
	return markdown.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
}

export async function buildAnalyzeSessionsToolText(
	input: AnalyzeSessionsToolInput,
	deps: AnalyzeSessionsToolDeps,
): Promise<string> {
	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		return 'Open a workspace folder before analyzing saved sessions.';
	}

	const sessions = await deps.listSessions();
	if (!sessions.length) {
		return 'No saved sessions found. Save chat sessions before running analysis.';
	}

	let models: readonly vscode.LanguageModelChat[] = [];
	try {
		models = await deps.selectChatModels();
	} catch {
		// Treated as no model available below.
	}
	// Tools get no chat request model, so use the first Copilot model that answers direct requests.
	const model = selectDefaultAnalysisModel(models);
	if (!model) {
		return NO_ANALYSIS_MODEL_MESSAGE;
	}

	const selection = resolveAnalyzeToolSelection(input, deps.now?.() ?? new Date());
	const notes: string[] = [];
	let result: AnalyzeSessionsFlowResult | undefined;
	try {
		result = await deps.runAnalysis(selection, workspaceFolders, sessions, model, (markdown) => {
			const note = stripMarkdown(markdown);
			if (note) {
				notes.push(note);
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `The analysis failed using ${model.name} (${model.vendor}): ${message}`;
	}

	if (!result) {
		return [`No analysis report was saved for ${selection.label}.`, ...notes].join('\n');
	}

	const { metadata, verification } = result;
	return JSON.stringify({
		status: metadata.analysisStatus,
		selection: selection.label,
		model: `${model.name} (${model.vendor})`,
		reportPath: metadata.analysisReportPath,
		reportFilePath: path.join(metadata.analysisStorageDirectory, metadata.analysisReportPath),
		verification: verification ?? null,
		summary: verification
			? `${verification.verified} of ${verification.total} recommendations verified, ${verification.unsupported} flagged as unsupported, ${verification.demoted} demoted.`
			: 'Report verification did not run, so recommendations are unverified.',
		hint: `Open the report file to read the recommendations, or call ${GET_IMPLEMENTATION_PROMPT_TOOL_NAME} to implement it yourself.`,
	}, null, 2);
}

interface ImplementationReportCandidate {
	storageDirectory: string;
	reportPath: string;
	reportFilePath: string;
	createdAt: string;
	selectionLabel: string;
	workspaceFolder: vscode.WorkspaceFolder;
}

export const NO_ANALYSIS_REPORT_MESSAGE = `No saved analysis report was found. Call ${ANALYZE_SESSIONS_TOOL_NAME} (or run @session-control /analyze) to create one first.`;

function normalizeReportPath(value: string): string {
	return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

async function listImplementationReportCandidates(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	deps: ImplementationPromptToolDeps,
): Promise<{ candidates: ImplementationReportCandidate[]; warnings: string[] }> {
	const candidates: ImplementationReportCandidate[] = [];
	const warnings: string[] = [];
	for (const workspaceFolder of workspaceFolders) {
		try {
			const storageDirectory = deps.getStoragePath(workspaceFolder);
			const index = await deps.readIndex(storageDirectory);
			for (const report of index.reports) {
				candidates.push({
					storageDirectory,
					reportPath: report.reportPath,
					reportFilePath: path.join(storageDirectory, report.reportPath),
					createdAt: report.createdAt,
					selectionLabel: report.selection.label,
					workspaceFolder,
				});
			}
		} catch (error) {
			warnings.push(`${workspaceFolder.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
	return { candidates, warnings };
}

/** Matches the report file path, its storage- or workspace-relative path, or its file name. */
function matchesReportQuery(candidate: ImplementationReportCandidate, query: string): boolean {
	const needle = normalizeReportPath(query);
	return [
		candidate.reportFilePath,
		candidate.reportPath,
		path.relative(candidate.workspaceFolder.uri.fsPath, candidate.reportFilePath),
		path.basename(candidate.reportPath),
	].some((form) => normalizeReportPath(form) === needle);
}

/** Without a report path, uses the newest readable report across the workspace folders. */
export async function buildImplementationPromptToolText(
	input: GetImplementationPromptToolInput,
	deps: ImplementationPromptToolDeps,
): Promise<string> {
	const workspaceFolders = deps.getWorkspaceFolders();
	if (!workspaceFolders?.length) {
		return 'Open a workspace folder before loading a saved analysis report.';
	}

	const query = typeof input.report === 'string' ? input.report.trim() : '';
	const { candidates, warnings } = await listImplementationReportCandidates(workspaceFolders, deps);
	if (!candidates.length) {
		return [NO_ANALYSIS_REPORT_MESSAGE, ...warnings].join('\n');
	}

	const matching = query ? candidates.filter((candidate) => matchesReportQuery(candidate, query)) : candidates;
	if (!matching.length) {
		return [
			`No saved analysis report matches '${query}'. Saved reports, newest first:`,
			...candidates.slice(0, MAX_RESUME_CANDIDATES).map((candidate) => `- ${candidate.reportFilePath} (${candidate.createdAt}, ${candidate.selectionLabel})`),
		].join('\n');
	}

	for (const candidate of matching) {
		let reportContent: string;
		try {
			reportContent = await deps.readReport(candidate.storageDirectory, candidate.reportPath);
		} catch (error) {
			warnings.push(`${candidate.reportFilePath}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}

		return [
			`Session Control analysis report ${candidate.reportFilePath} (created ${candidate.createdAt}, ${candidate.selectionLabel}).`,
			'You are the implementer: follow this implementation prompt yourself in the current workspace.',
			'',
			buildImplementationHandoffPrompt(candidate.reportFilePath, '', reportContent),
		].join('\n');
	}

	return [
		query ? `The saved analysis report matching '${query}' could not be read.` : 'No saved analysis report could be read.',
		...warnings,
	].join('\n');
}

function createDefaultImplementationPromptToolDeps(): ImplementationPromptToolDeps {
	const analysisStore = createAnalysisStore();
	return {
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		getStoragePath,
		readIndex: (storageDirectory) => analysisStore.readIndex(storageDirectory),
		readReport: (storageDirectory, reportPath) => analysisStore.readReport(storageDirectory, reportPath),
	};
}

function createDefaultAnalyzeSessionsToolDeps(
	token: vscode.CancellationToken,
	judgment?: JudgmentService,
	log?: (message: string) => void,
): AnalyzeSessionsToolDeps {
	return {
		listSessions: () => listSessionsAcrossWorkspaceFolders(vscode.workspace.workspaceFolders),
		getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
		selectChatModels: async () => vscode.lm.selectChatModels(),
		runAnalysis: (selection, workspaceFolders, sessions, model, onMarkdown) => runAnalyzeSessionsFlow(
			'',
			workspaceFolders,
			sessions,
			createModelAnalyzeSessionsFlowDeps(
				model,
				{ markdown: onMarkdown, streamModelOutput: false },
				token,
				selection,
				judgment,
				log,
			),
		),
	};
}

export interface RegisterSessionToolsOptions {
	deps?: SessionToolDeps;
	implementationPromptDeps?: ImplementationPromptToolDeps;
	judgment?: JudgmentService;
	log?: (message: string) => void;
}

function createDefaultSessionToolDeps(): SessionToolDeps {
	return {
		listSessions: () => listSessionsAcrossWorkspaceFolders(vscode.workspace.workspaceFolders),
		loadSession: (session) => loadReassembledSession(session.storageDirectory, session.fileName),
		getResumeLimits: (session) => {
			const config = vscode.workspace.getConfiguration('session-control', session.workspaceFolder.uri);
			return {
				maxTurns: config.get<number>('resume.maxTurns', DEFAULT_RESUME_SETTINGS.maxTurns),
				maxContextChars: config.get<number>('resume.maxContextChars', DEFAULT_RESUME_SETTINGS.maxContextChars),
				overflowStrategy: config.get<ResumeOverflowStrategy>('resume.overflowStrategy', DEFAULT_RESUME_SETTINGS.overflowStrategy),
			};
		},
	};
}

function textResult(text: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

export function registerSessionTools(
	context: vscode.ExtensionContext,
	options: RegisterSessionToolsOptions = {},
): void {
	const deps = options.deps ?? createDefaultSessionToolDeps();
	const listTool: vscode.LanguageModelTool<ListSessionsToolInput> = {
		prepareInvocation: () => ({ invocationMessage: 'Listing saved Session Control sessions' }),
		invoke: async (options) => {
			if (!vscode.workspace.workspaceFolders?.length) {
				return textResult('Open a workspace folder before listing saved sessions.');
			}
			return textResult(buildListSessionsToolText(await deps.listSessions(), options.input ?? {}));
		},
	};

	const resumeTool: vscode.LanguageModelTool<ResumeSessionToolInput> = {
		prepareInvocation: (options) => ({
			invocationMessage: `Loading saved session '${options.input?.session ?? ''}'`,
		}),
		invoke: async (options) => {
			if (!vscode.workspace.workspaceFolders?.length) {
				return textResult('Open a workspace folder before resuming a saved session.');
			}
			return textResult(await buildResumeSessionToolText(options.input ?? {}, deps));
		},
	};

	const analyzeTool: vscode.LanguageModelTool<AnalyzeSessionsToolInput> = {
		prepareInvocation: (invocation) => ({
			invocationMessage: invocation.input?.timeframe
				? `Analyzing saved sessions from the last ${invocation.input.timeframe}`
				: 'Analyzing saved sessions that need analysis',
		}),
		invoke: async (invocation, token) => textResult(await buildAnalyzeSessionsToolText(
			invocation.input ?? {},
			createDefaultAnalyzeSessionsToolDeps(token, options.judgment, options.log),
		)),
	};

	const implementationPromptDeps = options.implementationPromptDeps ?? createDefaultImplementationPromptToolDeps();
	// No provider picker: in agent mode the calling agent is the implementer.
	const implementationPromptTool: vscode.LanguageModelTool<GetImplementationPromptToolInput> = {
		prepareInvocation: (invocation) => ({
			invocationMessage: invocation.input?.report
				? `Loading the implementation prompt for '${invocation.input.report}'`
				: 'Loading the implementation prompt for the latest analysis report',
		}),
		invoke: async (invocation) => textResult(await buildImplementationPromptToolText(invocation.input ?? {}, implementationPromptDeps)),
	};

	context.subscriptions.push(
		vscode.lm.registerTool(LIST_SESSIONS_TOOL_NAME, listTool),
		vscode.lm.registerTool(RESUME_SESSION_TOOL_NAME, resumeTool),
		vscode.lm.registerTool(ANALYZE_SESSIONS_TOOL_NAME, analyzeTool),
		vscode.lm.registerTool(GET_IMPLEMENTATION_PROMPT_TOOL_NAME, implementationPromptTool),
	);
}
