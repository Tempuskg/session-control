import {
	AnalysisSelection,
	AnalysisSelectionMode,
	ChatSession,
} from './types';

export interface AnalysisCandidateSession {
	workspaceName: string;
	storageDirectory: string;
	fileName: string;
	rootFileName: string;
	fingerprint: string;
	session: ChatSession;
}

export const ANALYSIS_PROMPT_VERSION = '4';
export const DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET = 48000;

const ANALYSIS_PROMPT_TEMPLATE = `Review my last interactions with AI from {user chosen timeframe}.
Look for any problems that I encountered, things that weren't working efficiently, and unnecessary tool calling.
Look for common mistakes AI was doing and other things that can be optimized.
Look thoroughly through all conversations and make a plan for how we can optimize our flow in the future, both within each repository and cross-repositories.
Also look for insights that would be useful for the coding agent to know beforehand, both before entering a repository and when working in multiple repositories at the same time.`;

function buildRecommendationScopeGuidance(): string {
	return [
		'Restrict all recommendations to AI-specific control files in the repository.',
		'Before recommending anything, compare it against the existing AI instruction and skill files provided below.',
		'Only list gaps that are not already covered there.',
		'If an instruction or skill already exists, omit it unless you are recommending a concrete improvement, consolidation, or removal.',
		'Prioritize AGENTS.md and .github/copilot-instructions.md when they exist.',
		'If present, CLAUDE.md, *.instructions.md, *.prompt.md, *.agent.md, SKILL.md, and similar repository-local AI instruction files are also in scope.',
		'Look for repeated workflows or recurring instructions that should be extracted into new reusable repository-local AI skills.',
		'When a new skill would help, recommend creating a specific skill file such as SKILL.md, *.instructions.md, *.prompt.md, or *.agent.md and explain what behavior it should capture.',
		'Do not recommend application source-code changes, test changes, build tooling changes, or general documentation edits unless the change is specifically to one of those AI control files.',
		'If the evidence does not support a concrete AI-control-file recommendation, say so instead of proposing general repository changes.',
		'For every recommendation, name the target AI control file and the instruction, prompt, or new skill content to create.',
	].join('\n');
}

function buildExistingAiBaselineSection(existingAiFileBaseline: string): string {
	if (!existingAiFileBaseline.trim()) {
		return [
			'Existing AI Instructions and Skills:',
			'',
			'No existing AI instruction or skill files were found in the analyzed workspaces.',
		].join('\n');
	}

	return [
		'Existing AI Instructions and Skills:',
		'',
		existingAiFileBaseline,
	].join('\n');
}

function createRangeSelection(
	mode: AnalysisSelectionMode,
	label: string,
	start: Date,
	end: Date,
	onlyUnanalyzed: boolean,
): AnalysisSelection {
	return {
		mode,
		label,
		range: {
			start: start.toISOString(),
			end: end.toISOString(),
		},
		onlyUnanalyzed,
	};
}

export function createPresetAnalysisSelection(
	mode: Extract<AnalysisSelectionMode, 'last24Hours' | 'last7Days' | 'last30Days'>,
	now: Date = new Date(),
	onlyUnanalyzed = false,
): AnalysisSelection {
	const end = new Date(now);
	const start = new Date(now);

	if (mode === 'last24Hours') {
		start.setTime(now.getTime() - (24 * 60 * 60 * 1000));
		return createRangeSelection(mode, 'Last 24 Hours', start, end, onlyUnanalyzed);
	}

	if (mode === 'last7Days') {
		start.setTime(now.getTime() - (7 * 24 * 60 * 60 * 1000));
		return createRangeSelection(mode, 'Last 7 Days', start, end, onlyUnanalyzed);
	}

	start.setTime(now.getTime() - (30 * 24 * 60 * 60 * 1000));
	return createRangeSelection(mode, 'Last 30 Days', start, end, onlyUnanalyzed);
}

export function createNeedsAnalysisSelection(): AnalysisSelection {
	return {
		mode: 'needsAnalysis',
		label: 'Needs Analysis',
		range: null,
		onlyUnanalyzed: true,
	};
}

export function createCustomRangeSelection(startInput: string, endInput: string, onlyUnanalyzed = false): AnalysisSelection {
	const start = new Date(startInput);
	const end = new Date(endInput);

	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		throw new Error('Custom analysis range must use valid date values.');
	}

	if (start.getTime() > end.getTime()) {
		throw new Error('Custom analysis range start must be before the end.');
	}

	return createRangeSelection(
		'customRange',
		`${start.toISOString()} to ${end.toISOString()}`,
		start,
		end,
		onlyUnanalyzed,
	);
}

export function parseAnalysisSelectionAlias(prompt: string, now: Date = new Date()): AnalysisSelection | undefined {
	const normalized = prompt.trim().toLowerCase();
	if (!normalized.length) {
		return undefined;
	}

	if (normalized === '24h' || normalized === '1d' || normalized === 'last 24 hours' || normalized === 'last24hours') {
		return createPresetAnalysisSelection('last24Hours', now);
	}

	if (normalized === '7d' || normalized === 'last 7 days' || normalized === 'last7days') {
		return createPresetAnalysisSelection('last7Days', now);
	}

	if (normalized === '30d' || normalized === 'last 30 days' || normalized === 'last30days') {
		return createPresetAnalysisSelection('last30Days', now);
	}

	if (normalized === 'unanalyzed' || normalized === 'needs analysis' || normalized === 'needs-analysis') {
		return createNeedsAnalysisSelection();
	}

	return undefined;
}

export function filterCandidatesForAnalysis(
	candidates: AnalysisCandidateSession[],
	selection: AnalysisSelection,
	analyzedFingerprints: ReadonlySet<string>,
): AnalysisCandidateSession[] {
	const range = selection.range;
	const rangeFiltered = !range
		? candidates
		: candidates.filter((candidate) => {
			const savedAt = Date.parse(candidate.session.savedAt);
			const startTime = Date.parse(range.start);
			const endTime = Date.parse(range.end);
			return savedAt >= startTime && savedAt <= endTime;
		});

	if (!selection.onlyUnanalyzed) {
		return rangeFiltered;
	}

	return rangeFiltered.filter((candidate) => !analyzedFingerprints.has(candidate.fingerprint));
}

function renderToolCalls(session: ChatSession): string[] {
	const lines: string[] = [];

	for (const turn of session.turns) {
		if (turn.type !== 'response' || turn.toolCalls.length === 0) {
			continue;
		}

		for (const toolCall of turn.toolCalls) {
			lines.push(`- ${toolCall.name} | ${toolCall.summary ?? 'no summary'} | ${toolCall.arguments ?? 'no arguments captured'}`);
		}
	}

	return lines;
}

export function buildSessionEvidence(candidate: AnalysisCandidateSession): string {
	const gitSummary = candidate.session.git
		? `${candidate.session.git.branch}@${candidate.session.git.commit.slice(0, 7)}${candidate.session.git.dirty ? ' dirty' : ''}`
		: 'n/a';
	const transcript = candidate.session.turns.map((turn) => {
		if (turn.type === 'request') {
			return `[${turn.timestamp}] User: ${turn.prompt}`;
		}

		const toolLines = turn.toolCalls.length
			? `\nTool calls:\n${turn.toolCalls.map((toolCall) => `- ${toolCall.name} | ${toolCall.summary ?? 'no summary'} | ${toolCall.arguments ?? 'no arguments captured'}`).join('\n')}`
			: '';
		return `[${turn.timestamp}] Assistant: ${turn.content}${toolLines}`;
	}).join('\n\n');

	const toolSummary = renderToolCalls(candidate.session);

	return [
		`## [${candidate.workspaceName}] ${candidate.session.title}`,
		'',
		`- Saved At: ${candidate.session.savedAt}`,
		`- Session ID: ${candidate.session.id}`,
		`- Root File: ${candidate.rootFileName}`,
		`- Git: ${gitSummary}`,
		`- Total Turns: ${candidate.session.totalTurns}`,
		`- Fingerprint: ${candidate.fingerprint}`,
		'',
		'### Saved Summary',
		'',
		candidate.session.markdownSummary,
		'',
		'### Tool Call Summary',
		'',
		toolSummary.length ? toolSummary.join('\n') : 'No tool calls recorded.',
		'',
		'### Transcript',
		'',
		transcript,
	].join('\n');
}

export function splitCandidatesIntoAnalysisBatches(
	candidates: AnalysisCandidateSession[],
	maxChars: number = DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET,
): AnalysisCandidateSession[][] {
	if (candidates.length === 0) {
		return [];
	}

	const batches: AnalysisCandidateSession[][] = [];
	let currentBatch: AnalysisCandidateSession[] = [];
	let currentChars = 0;

	for (const candidate of candidates) {
		const evidenceLength = buildSessionEvidence(candidate).length;
		const separatorLength = currentBatch.length === 0 ? 0 : 6;
		if (currentBatch.length > 0 && currentChars + evidenceLength + separatorLength > maxChars) {
			batches.push(currentBatch);
			currentBatch = [candidate];
			currentChars = evidenceLength;
			continue;
		}

		currentBatch.push(candidate);
		currentChars += evidenceLength + separatorLength;
	}

	if (currentBatch.length > 0) {
		batches.push(currentBatch);
	}

	return batches;
}

function buildRequiredSections(): string {
	return [
		'Return markdown with these sections:',
		'1. Repository-Specific Findings',
		'2. Cross-Repository Findings',
		'3. Common AI Mistakes',
		'4. Unnecessary Tool Usage',
		'5. Workflow Optimizations',
		'6. Recommended AI Skills to Create',
		'7. Coding Agent Preload Insights',
	].join('\n');
}

export function buildAnalysisPrompt(
	selection: AnalysisSelection,
	candidates: AnalysisCandidateSession[],
	existingAiFileBaseline = '',
): string {
	const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
	const evidence = candidates.map((candidate) => buildSessionEvidence(candidate)).join('\n\n---\n\n');

	return [
		instruction,
		'',
		buildRecommendationScopeGuidance(),
		'',
		buildRequiredSections(),
		'',
		buildExistingAiBaselineSection(existingAiFileBaseline),
		'',
		'Chats to analyze:',
		'',
		evidence,
	].join('\n');
}

export function buildAnalysisSynthesisPrompt(
	selection: AnalysisSelection,
	batchSummaries: string[],
	existingAiFileBaseline = '',
): string {
	const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
	return [
		instruction,
		'',
		'You are synthesizing batch-level findings from the same analysis request into one final report.',
		'Deduplicate repeated findings and keep repository-specific findings separate from cross-repository patterns.',
		'',
		buildRecommendationScopeGuidance(),
		'',
		buildRequiredSections(),
		'',
		buildExistingAiBaselineSection(existingAiFileBaseline),
		'',
		'Batch findings:',
		'',
		batchSummaries.map((summary, index) => `## Batch ${index + 1}\n\n${summary}`).join('\n\n'),
	].join('\n');
}

export function buildImplementationHandoffPrompt(reportFilePath: string, userPrompt: string): string {
	const normalizedPrompt = userPrompt.trim().length > 0
		? userPrompt.trim()
		: 'Implement the highest-priority recommendations from the saved analysis report.';

	return [
		'Implement the AI-control-file recommendations from the latest Session Control analysis using full workspace access.',
		`Start by reading this saved analysis report: "${reportFilePath}"`,
		'Also read AGENTS.md, .github/copilot-instructions.md, CLAUDE.md when present, and any other repository-local AI control files relevant to the first actionable recommendation.',
		'If the saved report recommends creating a new reusable AI skill, create the repository-local skill file and any supporting instruction, prompt, or agent-definition files needed for that skill.',
		'This can include creating SKILL.md, *.instructions.md, *.prompt.md, or *.agent.md files when the report identifies them as the best next improvement.',
		'Do not expand into application source files, tests, build tooling, or general documentation unless the saved report specifically calls for updating an AI control file that governs those workflows.',
		'Inspect the current working tree first so you do not assume a clean baseline before editing or validating.',
		'Make the next concrete implementation change in the relevant AI control file or new AI skill file and validate it with focused checks before expanding scope.',
		`User request: ${normalizedPrompt}`,
	].join('\n');
}
