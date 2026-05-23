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
	type AnalysisEvidenceDetailLevel,
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
	loadRecommendationBaseline: (
		workspaceFolders: readonly vscode.WorkspaceFolder[],
		candidates: AnalysisCandidateSession[],
	) => Promise<string>;
	splitIntoBatches: (candidates: AnalysisCandidateSession[], maxChars?: number) => AnalysisCandidateSession[][];
	buildPrompt: (
		selection: AnalysisSelection,
		candidates: AnalysisCandidateSession[],
		recommendationBaseline: string,
		detailLevel?: AnalysisEvidenceDetailLevel,
	) => string;
	buildSynthesisPrompt: (
		selection: AnalysisSelection,
		batchSummaries: string[],
		recommendationBaseline: string,
	) => string;
	runModelPrompt: (prompt: string, streamOutput: boolean) => Promise<string>;
	streamMarkdown: (markdown: string) => void;
	pickOwnerWorkspace: (workspaceFolders: readonly vscode.WorkspaceFolder[]) => vscode.WorkspaceFolder | undefined;
	getStoragePath: (workspaceFolder: vscode.WorkspaceFolder) => string;
	writeReport: (storageDirectory: string, input: AnalysisWriteReportInput) => Promise<PersistedAnalysisReport>;
	recordAnalysis: (storageDirectory: string, report: AnalysisReportReference, sessions: AnalysisRecordInput[]) => Promise<AnalysisIndex>;
	batchCharBudget: number;
}

const TOKEN_LIMIT_ERROR_PATTERN = /token limit|context length|too many tokens|maximum context|message exceeds/i;
const MAX_SYNTHESIS_SPLIT_DEPTH = 12;

interface CompletedAnalysisBatch {
	batchLabel: string;
	candidates: AnalysisCandidateSession[];
	summary: string;
}

interface BatchedSummaryResult {
	completedBatches: CompletedAnalysisBatch[];
	warnings: string[];
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

function isTokenLimitErrorMessage(message: string): boolean {
	return TOKEN_LIMIT_ERROR_PATTERN.test(message);
}

function splitItemsInHalf<T>(items: readonly T[]): [T[], T[]] {
	const midpoint = Math.ceil(items.length / 2);
	return [items.slice(0, midpoint), items.slice(midpoint)];
}

function getNextEvidenceDetailLevel(detailLevel: AnalysisEvidenceDetailLevel): AnalysisEvidenceDetailLevel | undefined {
	if (detailLevel === 'full') {
		return 'compact';
	}

	if (detailLevel === 'compact') {
		return 'summaryOnly';
	}

	return undefined;
}

function buildEvidenceRetryMessage(nextDetailLevel: AnalysisEvidenceDetailLevel, batchLabel?: string): string {
	const subject = batchLabel ? `Batch ${batchLabel}` : 'The saved session';
	if (nextDetailLevel === 'compact') {
		return `_${subject} exceeded the model token limit. Retrying with condensed session evidence..._\n\n`;
	}

	return `_${subject} still exceeded the model token limit with condensed evidence. Retrying with summary-only evidence..._\n\n`;
}

async function runAnalysisPromptWithSingleSessionFallbacks(
	selection: AnalysisSelection,
	candidates: AnalysisCandidateSession[],
	recommendationBaseline: string,
	deps: AnalyzeSessionsFlowDeps,
	streamOutput: boolean,
	extraInstruction?: string,
	batchLabel?: string,
): Promise<string> {
	let detailLevel: AnalysisEvidenceDetailLevel = 'full';

	while (true) {
		try {
			const prompt = [
				deps.buildPrompt(selection, candidates, recommendationBaseline, detailLevel),
				...(extraInstruction ? ['', extraInstruction] : []),
			].join('\n');
			return await deps.runModelPrompt(prompt, streamOutput);
		} catch (error) {
			const message = getErrorMessage(error);
			const nextDetailLevel: AnalysisEvidenceDetailLevel | undefined = candidates.length === 1 && isTokenLimitErrorMessage(message)
				? getNextEvidenceDetailLevel(detailLevel)
				: undefined;
			if (!nextDetailLevel) {
				throw error;
			}

			deps.streamMarkdown(buildEvidenceRetryMessage(nextDetailLevel, batchLabel));
			detailLevel = nextDetailLevel;
		}
	}
}

function buildPartialAnalysisContent(completedBatches: readonly CompletedAnalysisBatch[]): string {
	const lines = [
		'Partial analysis generated from the batches that completed successfully.',
		'',
	];

	for (const batch of completedBatches) {
		lines.push(`### Batch ${batch.batchLabel}`);
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

async function generateBatchSummaryWithRetries(
	selection: AnalysisSelection,
	batch: AnalysisCandidateSession[],
	recommendationBaseline: string,
	deps: AnalyzeSessionsFlowDeps,
	batchLabel: string,
): Promise<BatchedSummaryResult> {
	deps.streamMarkdown(`_Analyzing batch ${batchLabel}..._\n\n`);

	try {
		const summary = await runAnalysisPromptWithSingleSessionFallbacks(
			selection,
			batch,
			recommendationBaseline,
			deps,
			false,
			`This is batch ${batchLabel}. Produce a concise findings summary that will be synthesized with the other batches into one final report.`,
			batchLabel,
		);
		if (!summary.trim().length) {
			return {
				completedBatches: [],
				warnings: [`Batch ${batchLabel} returned no summary text.`],
			};
		}

		return {
			completedBatches: [{
				batchLabel,
				candidates: batch,
				summary,
			}],
			warnings: [],
		};
	} catch (error) {
		const message = getErrorMessage(error);
		if (isTokenLimitErrorMessage(message) && batch.length > 1) {
			const [firstHalf, secondHalf] = splitItemsInHalf(batch);
			deps.streamMarkdown(
				`_Batch ${batchLabel} exceeded the model token limit. Retrying as batches ${batchLabel}.1 and ${batchLabel}.2..._\n\n`,
			);

			const firstResult = await generateBatchSummaryWithRetries(
				selection,
				firstHalf,
				recommendationBaseline,
				deps,
				`${batchLabel}.1`,
			);
			const secondResult = await generateBatchSummaryWithRetries(
				selection,
				secondHalf,
				recommendationBaseline,
				deps,
				`${batchLabel}.2`,
			);

			return {
				completedBatches: [...firstResult.completedBatches, ...secondResult.completedBatches],
				warnings: [...firstResult.warnings, ...secondResult.warnings],
			};
		}

		return {
			completedBatches: [],
			warnings: [isTokenLimitErrorMessage(message)
				? `Batch ${batchLabel} exceeded the model token limit even after retrying with condensed evidence.`
				: `Batch ${batchLabel} failed: ${message}`],
		};
	}
}

async function synthesizeBatchSummariesWithRetries(
	selection: AnalysisSelection,
	batchSummaries: string[],
	recommendationBaseline: string,
	deps: AnalyzeSessionsFlowDeps,
	streamOutput: boolean,
	depth = 0,
): Promise<string> {
	try {
		return await deps.runModelPrompt(
			deps.buildSynthesisPrompt(selection, batchSummaries, recommendationBaseline),
			streamOutput,
		);
	} catch (error) {
		const message = getErrorMessage(error);
		if (!isTokenLimitErrorMessage(message) || batchSummaries.length <= 1 || depth >= MAX_SYNTHESIS_SPLIT_DEPTH) {
			throw error;
		}

		deps.streamMarkdown('_Final synthesis exceeded the model token limit. Retrying in smaller groups..._\n\n');
		const [firstHalf, secondHalf] = splitItemsInHalf(batchSummaries);
		const firstSummary = await synthesizeBatchSummariesWithRetries(
			selection,
			firstHalf,
			recommendationBaseline,
			deps,
			false,
			depth + 1,
		);
		const secondSummary = await synthesizeBatchSummariesWithRetries(
			selection,
			secondHalf,
			recommendationBaseline,
			deps,
			false,
			depth + 1,
		);

		return synthesizeBatchSummariesWithRetries(
			selection,
			[firstSummary, secondSummary],
			recommendationBaseline,
			deps,
			streamOutput,
			depth + 1,
		);
	}
}

async function generateSingleBatchAnalysis(
	selection: AnalysisSelection,
	filtered: AnalysisCandidateSession[],
	recommendationBaseline: string,
	deps: AnalyzeSessionsFlowDeps,
): Promise<AnalysisGenerationResult> {
	try {
		const content = await runAnalysisPromptWithSingleSessionFallbacks(
			selection,
			filtered,
			recommendationBaseline,
			deps,
			true,
		);
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
		const message = getErrorMessage(error);
		if (isTokenLimitErrorMessage(message) && filtered.length > 1) {
			deps.streamMarkdown('_Analysis prompt exceeded the model token limit. Retrying in smaller batches..._\n\n');
			const [firstHalf, secondHalf] = splitItemsInHalf(filtered);
			return generateBatchedAnalysis(selection, filtered, [firstHalf, secondHalf], recommendationBaseline, deps);
		}

		return {
			status: 'failed',
			content: '',
			warnings: [`Analysis failed: ${isTokenLimitErrorMessage(message) && filtered.length === 1
				? 'The saved session exceeds the model token limit even after retrying with condensed evidence.'
				: message}`],
			analyzedCandidates: [],
		};
	}
}

async function generateBatchedAnalysis(
	selection: AnalysisSelection,
	filtered: AnalysisCandidateSession[],
	batches: AnalysisCandidateSession[][],
	recommendationBaseline: string,
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

		const batchResult = await generateBatchSummaryWithRetries(
			selection,
			batch,
			recommendationBaseline,
			deps,
			String(index + 1),
		);
		completedBatches.push(...batchResult.completedBatches);
		warnings.push(...batchResult.warnings);
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
		content = await synthesizeBatchSummariesWithRetries(
			selection,
			completedBatches.map((batch) => batch.summary),
			recommendationBaseline,
			deps,
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
		loadRecommendationBaseline: async () => '',
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

	const recommendationBaseline = await deps.loadRecommendationBaseline(workspaceFolders, filtered);
	const effectiveBatchBudget = Math.max(4000, deps.batchCharBudget - recommendationBaseline.length);
	const batches = deps.splitIntoBatches(filtered, effectiveBatchBudget);
	const generation = batches.length <= 1
		? await generateSingleBatchAnalysis(selection, filtered, recommendationBaseline, deps)
		: await generateBatchedAnalysis(selection, filtered, batches, recommendationBaseline, deps);
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
