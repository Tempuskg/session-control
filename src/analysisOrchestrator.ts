import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	type AnalysisRecordInput,
	type AnalysisWriteReportInput,
	type PersistedAnalysisReport,
} from './analysisStore';
import {
	ANALYSIS_PROMPT_VERSION,
	DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET,
	filterCandidatesForAnalysis,
	type AnalysisCandidateSession,
} from './sessionAnalysis';
import {
	type AnalysisIndex,
	type AnalysisReportReference,
	type AnalysisReportRepositorySummary,
	type AnalysisReportResultMetadata,
	type AnalysisReportStatus,
	type AnalysisSelection,
	type SessionMeta,
} from './types';

export interface WorkspaceSessionMeta extends SessionMeta {
	workspaceFolder: vscode.WorkspaceFolder;
	storageDirectory: string;
	displayTitle: string;
}

export interface AnalyzeSessionsFlowResult {
	metadata: AnalysisReportResultMetadata;
}

export interface AnalyzeSessionsFlowDeps {
	resolveSelection: (prompt: string) => Promise<AnalysisSelection | undefined>;
	createCandidates: (workspaceSessions: WorkspaceSessionMeta[]) => Promise<AnalysisCandidateSession[]>;
	loadAnalyzedFingerprints: (candidates: AnalysisCandidateSession[]) => Promise<Set<string>>;
	splitIntoBatches: (candidates: AnalysisCandidateSession[], maxChars?: number) => AnalysisCandidateSession[][];
	buildPrompt: (selection: AnalysisSelection, candidates: AnalysisCandidateSession[]) => string;
	buildSynthesisPrompt: (selection: AnalysisSelection, batchSummaries: string[]) => string;
	runModelPrompt: (prompt: string, streamOutput: boolean) => Promise<string>;
	streamMarkdown: (markdown: string) => void;
	pickOwnerWorkspace: (workspaceFolders: readonly vscode.WorkspaceFolder[]) => vscode.WorkspaceFolder | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	writeReport: (storageDirectory: string, input: AnalysisWriteReportInput) => Promise<PersistedAnalysisReport>;
	recordAnalysis: (storageDirectory: string, report: AnalysisReportReference, sessions: AnalysisRecordInput[]) => Promise<AnalysisIndex>;
	batchCharBudget: number;
}

interface CompletedAnalysisBatch {
	batchIndex: number;
	candidates: AnalysisCandidateSession[];
	summary: string;
}

interface AnalysisGenerationResult {
	status: AnalysisReportStatus | 'failed';
	content: string;
	warnings: string[];
	analyzedCandidates: AnalysisCandidateSession[];
}

function normalizeRelativePath(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

function createStorageSpecificReportReference(
	report: AnalysisReportReference,
	reportFilePath: string,
	storageDirectory: string,
): AnalysisReportReference {
	return {
		...report,
		reportPath: normalizeRelativePath(path.relative(storageDirectory, reportFilePath)),
	};
}

function summarizeRepositoriesForAnalysis(candidates: AnalysisCandidateSession[]): AnalysisReportRepositorySummary[] {
	const byWorkspace = new Map<string, AnalysisCandidateSession[]>();

	for (const candidate of candidates) {
		const existing = byWorkspace.get(candidate.workspaceName);
		if (existing) {
			existing.push(candidate);
			continue;
		}

		byWorkspace.set(candidate.workspaceName, [candidate]);
	}

	return [...byWorkspace.entries()].map(([workspaceName, workspaceCandidates]) => {
		const firstGit = workspaceCandidates[0]?.session.git ?? null;
		const branch = workspaceCandidates.every((candidate) => candidate.session.git?.branch === firstGit?.branch)
			? (firstGit?.branch ?? null)
			: null;
		const commit = workspaceCandidates.every((candidate) => candidate.session.git?.commit === firstGit?.commit)
			? (firstGit?.commit ?? null)
			: null;
		const dirty = workspaceCandidates.every((candidate) => candidate.session.git?.dirty === firstGit?.dirty)
			? (firstGit?.dirty ?? null)
			: null;

		return {
			workspaceName,
			branch,
			commit,
			dirty,
			sessionCount: workspaceCandidates.length,
		};
	});
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function buildPartialAnalysisContent(completedBatches: readonly CompletedAnalysisBatch[]): string {
	const lines = [
		'Partial analysis generated from the batches that completed successfully.',
		'',
	];

	for (const batch of completedBatches) {
		lines.push(`### Batch ${batch.batchIndex + 1}`);
		lines.push('');
		lines.push(batch.summary.trim());
		lines.push('');
	}

	return lines.join('\n').trim();
}

function buildFailedAnalysisMessage(warnings: readonly string[]): string {
	const lines = ['Analysis failed before a report could be saved.'];
	if (warnings.length > 0) {
		lines.push('');
		for (const warning of warnings) {
			lines.push(`- ${warning}`);
		}
	}

	return lines.join('\n');
}

async function generateSingleBatchAnalysis(
	selection: AnalysisSelection,
	filtered: AnalysisCandidateSession[],
	deps: AnalyzeSessionsFlowDeps,
): Promise<AnalysisGenerationResult> {
	try {
		const content = await deps.runModelPrompt(deps.buildPrompt(selection, filtered), true);
		if (!content.trim().length) {
			return {
				status: 'failed',
				content: '',
				warnings: ['The model returned no report text.'],
				analyzedCandidates: [],
			};
		}

		return {
			status: 'complete',
			content,
			warnings: [],
			analyzedCandidates: filtered,
		};
	} catch (error) {
		return {
			status: 'failed',
			content: '',
			warnings: [`Analysis failed: ${getErrorMessage(error)}`],
			analyzedCandidates: [],
		};
	}
}

async function generateBatchedAnalysis(
	selection: AnalysisSelection,
	filtered: AnalysisCandidateSession[],
	batches: AnalysisCandidateSession[][],
	deps: AnalyzeSessionsFlowDeps,
): Promise<AnalysisGenerationResult> {
	deps.streamMarkdown(`Analyzing ${filtered.length} saved sessions across ${batches.length} batches. Final synthesis will follow.\n\n`);

	const completedBatches: CompletedAnalysisBatch[] = [];
	const warnings: string[] = [];

	for (let index = 0; index < batches.length; index += 1) {
		const batch = batches[index];
		if (!batch) {
			continue;
		}

		deps.streamMarkdown(`_Analyzing batch ${index + 1} of ${batches.length}..._\n\n`);
		const batchPrompt = [
			deps.buildPrompt(selection, batch),
			'',
			`This is batch ${index + 1} of ${batches.length}. Produce a concise findings summary that will be synthesized with the other batches into one final report.`,
		].join('\n');

		try {
			const summary = await deps.runModelPrompt(batchPrompt, false);
			if (!summary.trim().length) {
				warnings.push(`Batch ${index + 1} of ${batches.length} returned no summary text.`);
				continue;
			}

			completedBatches.push({
				batchIndex: index,
				candidates: batch,
				summary,
			});
		} catch (error) {
			warnings.push(`Batch ${index + 1} of ${batches.length} failed: ${getErrorMessage(error)}`);
		}
	}

	if (!completedBatches.length) {
		return {
			status: 'failed',
			content: '',
			warnings,
			analyzedCandidates: [],
		};
	}

	deps.streamMarkdown('_Synthesizing final report..._\n\n');

	let content = '';
	let status: AnalysisReportStatus = warnings.length > 0 ? 'partial' : 'complete';
	try {
		content = await deps.runModelPrompt(
			deps.buildSynthesisPrompt(selection, completedBatches.map((batch) => batch.summary)),
			true,
		);
		if (!content.trim().length) {
			warnings.push('Final synthesis returned no report text.');
			status = 'partial';
			content = buildPartialAnalysisContent(completedBatches);
		}
	} catch (error) {
		warnings.push(`Final synthesis failed: ${getErrorMessage(error)}`);
		status = 'partial';
		content = buildPartialAnalysisContent(completedBatches);
	}

	return {
		status,
		content,
		warnings,
		analyzedCandidates: completedBatches.flatMap((batch) => batch.candidates),
	};
}

export async function runAnalyzeSessionsFlow(
	requestPrompt: string,
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	workspaceSessions: WorkspaceSessionMeta[],
	depsOverrides: Partial<AnalyzeSessionsFlowDeps> = {},
): Promise<AnalyzeSessionsFlowResult | undefined> {
	const deps = {
		batchCharBudget: DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET,
		...depsOverrides,
	} as AnalyzeSessionsFlowDeps;

	if (!workspaceSessions.length) {
		deps.streamMarkdown('No saved sessions found. Save chat sessions before running analysis.');
		return;
	}

	const selection = await deps.resolveSelection(requestPrompt);
	if (!selection) {
		return;
	}

	const candidates = await deps.createCandidates(workspaceSessions);
	const analyzedFingerprints = await deps.loadAnalyzedFingerprints(candidates);
	const filtered = filterCandidatesForAnalysis(candidates, selection, analyzedFingerprints);
	if (!filtered.length) {
		deps.streamMarkdown(selection.mode === 'needsAnalysis'
			? 'No saved sessions currently need analysis.'
			: `No saved sessions matched ${selection.label.toLowerCase()}.`);
		return;
	}

	const batches = deps.splitIntoBatches(filtered, deps.batchCharBudget);
	const generation = batches.length <= 1
		? await generateSingleBatchAnalysis(selection, filtered, deps)
		: await generateBatchedAnalysis(selection, filtered, batches, deps);
	if (generation.status === 'failed') {
		deps.streamMarkdown(`\n\n${buildFailedAnalysisMessage(generation.warnings)}`);
		return;
	}

	const ownerWorkspace = deps.pickOwnerWorkspace(workspaceFolders);
	if (!ownerWorkspace) {
		deps.streamMarkdown('Open a workspace folder before saving analysis reports.');
		return;
	}

	const ownerStorageDirectory = deps.getStoragePath(ownerWorkspace);
	const analyzedCandidates = generation.analyzedCandidates;
	const reportInput: AnalysisWriteReportInput = {
		selection,
		promptVersion: ANALYSIS_PROMPT_VERSION,
		contributingWorkspaces: [...new Set(analyzedCandidates.map((candidate) => candidate.workspaceName))],
		analyzedFingerprints: analyzedCandidates.map((candidate) => candidate.fingerprint),
		sessionCount: analyzedCandidates.length,
		ownerWorkspaceName: ownerWorkspace.name,
		repositories: summarizeRepositoriesForAnalysis(analyzedCandidates),
		sourceSessions: analyzedCandidates.map((candidate) => ({
			workspaceName: candidate.workspaceName,
			sessionId: candidate.session.id,
			title: candidate.session.title,
			savedAt: candidate.session.savedAt,
			rootFileName: candidate.rootFileName,
			fingerprint: candidate.fingerprint,
			git: candidate.session.git,
		})),
		status: generation.status,
		...(generation.warnings.length === 0 ? {} : { warnings: generation.warnings }),
		content: generation.content,
	};
	const persisted = await deps.writeReport(ownerStorageDirectory, reportInput);

	const byStorageDirectory = new Map<string, AnalysisCandidateSession[]>();
	for (const candidate of analyzedCandidates) {
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
		await deps.recordAnalysis(
			storageDirectory,
			reportReference,
			sessions.map((candidate) => ({
				fingerprint: candidate.fingerprint,
				sessionId: candidate.session.id,
				title: candidate.session.title,
				savedAt: candidate.session.savedAt,
				rootFileName: candidate.rootFileName,
				git: candidate.session.git,
			})),
		);
	}

	const savedLabel = generation.status === 'partial' ? 'Saved partial analysis report' : 'Saved analysis report';
	deps.streamMarkdown(
		`\n\n${savedLabel} to **${persisted.report.reportPath}** in workspace **${ownerWorkspace.name}**. Use **@session-control /implement** to open a coding-agent handoff prompt.`,
	);
	return {
		metadata: {
			resultType: 'analysis-report',
			analysisStatus: generation.status,
			analysisReportPath: persisted.report.reportPath,
			analysisStorageDirectory: ownerStorageDirectory,
		},
	};
}
