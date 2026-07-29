import {
	AnalysisSelection,
	AnalysisSelectionMode,
	ChatSession,
	ToolCall,
} from './types';

export interface AnalysisCandidateSession {
	workspaceName: string;
	storageDirectory: string;
	fileName: string;
	rootFileName: string;
	fingerprint: string;
	session: ChatSession;
}

export type AnalysisEvidenceDetailLevel = 'full' | 'compact' | 'summaryOnly';

export const ANALYSIS_PROMPT_VERSION = '5';
export const DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET = 48000;
const SESSION_CONTROL_ANALYZE_PROMPT_PATTERN = /^(?:@?session-control\s+)?\/anal(?:y)?ze\b/i;
const ANALYSIS_COMPACT_SUMMARY_MAX_CHARS = 4000;
const ANALYSIS_SUMMARY_ONLY_SUMMARY_MAX_CHARS = 2500;
const ANALYSIS_COMPACT_TRANSCRIPT_MAX_CHARS = 5000;
const ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_MAX_CHARS = 1200;
const ANALYSIS_COMPACT_TURN_MAX_CHARS = 800;
const ANALYSIS_SUMMARY_ONLY_TURN_MAX_CHARS = 320;
const ANALYSIS_COMPACT_MAX_TOOL_CALL_LINES = 16;
const ANALYSIS_SUMMARY_ONLY_MAX_TOOL_CALL_LINES = 8;
const ANALYSIS_COMPACT_TOOL_CALL_LINE_MAX_CHARS = 260;
const ANALYSIS_SUMMARY_ONLY_TOOL_CALL_LINE_MAX_CHARS = 160;
const ANALYSIS_COMPACT_TRANSCRIPT_HEAD_TURNS = 2;
const ANALYSIS_COMPACT_TRANSCRIPT_TAIL_TURNS = 6;
const ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_TAIL_TURNS = 2;

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

function truncateMiddle(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}

	if (maxChars <= 3) {
		return '.'.repeat(Math.max(0, maxChars));
	}

	const marker = `\n...[${value.length - maxChars} chars omitted]...\n`;
	const availableChars = maxChars - marker.length;
	if (availableChars <= 8) {
		return `${value.slice(0, maxChars - 3)}...`;
	}

	const headChars = Math.ceil(availableChars / 2);
	const tailChars = Math.floor(availableChars / 2);
	const tail = tailChars > 0 ? value.slice(-tailChars) : '';
	return `${value.slice(0, headChars)}${marker}${tail}`;
}

function limitRenderedLines(lines: string[], maxLines: number): string[] {
	if (lines.length <= maxLines) {
		return lines;
	}

	const visibleSlots = Math.max(0, maxLines - 1);
	const headCount = Math.ceil(visibleSlots / 2);
	const tailCount = Math.floor(visibleSlots / 2);
	const omittedCount = lines.length - headCount - tailCount;

	return [
		...lines.slice(0, headCount),
		`- ... ${omittedCount} additional tool call(s) omitted ...`,
		...(tailCount > 0 ? lines.slice(lines.length - tailCount) : []),
	];
}

function renderToolCallLine(toolCall: ToolCall, detailLevel: AnalysisEvidenceDetailLevel): string {
	const parts = [toolCall.name];
	if (toolCall.summary?.trim()) {
		parts.push(toolCall.summary.trim());
	} else if (detailLevel === 'full') {
		parts.push('no summary');
	}

	if (detailLevel === 'full') {
		parts.push(toolCall.arguments ?? 'no arguments captured');
	}

	const line = `- ${parts.join(' | ')}`;
	if (detailLevel === 'compact') {
		return truncateMiddle(line, ANALYSIS_COMPACT_TOOL_CALL_LINE_MAX_CHARS);
	}

	if (detailLevel === 'summaryOnly') {
		return truncateMiddle(line, ANALYSIS_SUMMARY_ONLY_TOOL_CALL_LINE_MAX_CHARS);
	}

	return line;
}

function renderToolCalls(session: ChatSession, detailLevel: AnalysisEvidenceDetailLevel = 'full'): string[] {
	const lines: string[] = [];

	for (const turn of session.turns) {
		if (turn.type !== 'response' || turn.toolCalls.length === 0) {
			continue;
		}

		for (const toolCall of turn.toolCalls) {
			lines.push(renderToolCallLine(toolCall, detailLevel));
		}
	}

	if (detailLevel === 'compact') {
		return limitRenderedLines(lines, ANALYSIS_COMPACT_MAX_TOOL_CALL_LINES);
	}

	if (detailLevel === 'summaryOnly') {
		return limitRenderedLines(lines, ANALYSIS_SUMMARY_ONLY_MAX_TOOL_CALL_LINES);
	}

	return lines;
}

function renderTranscriptTurn(turn: ChatSession['turns'][number], detailLevel: AnalysisEvidenceDetailLevel): string {
	const maxChars = detailLevel === 'compact'
		? ANALYSIS_COMPACT_TURN_MAX_CHARS
		: detailLevel === 'summaryOnly'
			? ANALYSIS_SUMMARY_ONLY_TURN_MAX_CHARS
			: Number.MAX_SAFE_INTEGER;

	if (turn.type === 'request') {
		return `[${turn.timestamp}] User: ${truncateMiddle(turn.prompt, maxChars)}`;
	}

	const toolLines = turn.toolCalls.length
		? `\nTool calls:\n${turn.toolCalls.map((toolCall) => renderToolCallLine(toolCall, detailLevel)).join('\n')}`
		: '';
	return `[${turn.timestamp}] Assistant: ${truncateMiddle(turn.content, maxChars)}${toolLines}`;
}

function selectTranscriptTurns(session: ChatSession, detailLevel: AnalysisEvidenceDetailLevel): {
	turns: ChatSession['turns'];
	omittedTurns: number;
} {
	if (detailLevel === 'full') {
		return {
			turns: session.turns,
			omittedTurns: 0,
		};
	}

	if (detailLevel === 'compact') {
		const maxTurns = ANALYSIS_COMPACT_TRANSCRIPT_HEAD_TURNS + ANALYSIS_COMPACT_TRANSCRIPT_TAIL_TURNS;
		if (session.turns.length <= maxTurns) {
			return {
				turns: session.turns,
				omittedTurns: 0,
			};
		}

		return {
			turns: [
				...session.turns.slice(0, ANALYSIS_COMPACT_TRANSCRIPT_HEAD_TURNS),
				...session.turns.slice(-ANALYSIS_COMPACT_TRANSCRIPT_TAIL_TURNS),
			],
			omittedTurns: session.turns.length - maxTurns,
		};
	}

	const tailTurns = Math.min(ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_TAIL_TURNS, session.turns.length);
	return {
		turns: session.turns.slice(-tailTurns),
		omittedTurns: session.turns.length - tailTurns,
	};
}

function buildAnalysisTranscript(session: ChatSession, detailLevel: AnalysisEvidenceDetailLevel): string {
	const { turns, omittedTurns } = selectTranscriptTurns(session, detailLevel);
	const transcriptLines = turns.map((turn) => renderTranscriptTurn(turn, detailLevel));

	if (detailLevel === 'full') {
		return transcriptLines.join('\n\n');
	}

	const lines = [
		detailLevel === 'compact'
			? 'This transcript was condensed because the saved session exceeded the model token limit.'
			: 'This transcript was heavily condensed because the saved session exceeded the model token limit. Prefer the saved summary and tool call summary above.',
		...(omittedTurns > 0 ? [`${omittedTurns} turn(s) were omitted from the transcript.`] : []),
		...transcriptLines,
	];
	const maxChars = detailLevel === 'compact'
		? ANALYSIS_COMPACT_TRANSCRIPT_MAX_CHARS
		: ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_MAX_CHARS;

	return truncateMiddle(lines.join('\n\n'), maxChars);
}

function buildAnalysisSummary(summary: string, detailLevel: AnalysisEvidenceDetailLevel): string {
	if (detailLevel === 'compact') {
		return truncateMiddle(summary, ANALYSIS_COMPACT_SUMMARY_MAX_CHARS);
	}

	if (detailLevel === 'summaryOnly') {
		return truncateMiddle(summary, ANALYSIS_SUMMARY_ONLY_SUMMARY_MAX_CHARS);
	}

	return summary;
}

function buildEvidenceCompressionGuidance(detailLevel: AnalysisEvidenceDetailLevel): string | undefined {
	if (detailLevel === 'compact') {
		return 'Some saved-session evidence below was condensed to fit the model token limit. Prefer the saved summary and tool call summary when transcript snippets are abbreviated.';
	}

	if (detailLevel === 'summaryOnly') {
		return 'Some saved-session evidence below uses summary-only evidence because the full transcript exceeded the model token limit. Prefer the saved summary, tool call summary, and preserved recent turns.';
	}

	return undefined;
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

export function createSingleSessionSelection(session: { id: string; title: string }): AnalysisSelection {
	return {
		mode: 'singleSession',
		label: `Session: ${session.title}`,
		range: null,
		sessionId: session.id,
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
	// A single-session selection targets exactly the session the user clicked,
	// so it bypasses the range filter and the analyze-chat exclusion applied to
	// bulk selections.
	if (selection.mode === 'singleSession') {
		const matched = candidates.filter((candidate) => candidate.session.id === selection.sessionId);
		return selection.onlyUnanalyzed
			? matched.filter((candidate) => !analyzedFingerprints.has(candidate.fingerprint))
			: matched;
	}

	const eligibleCandidates = candidates.filter((candidate) => !isSessionControlAnalyzeSession(candidate.session));
	const range = selection.range;
	const rangeFiltered = !range
		? eligibleCandidates
		: eligibleCandidates.filter((candidate) => {
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

function isSessionControlAnalyzeSession(session: ChatSession): boolean {
	if (SESSION_CONTROL_ANALYZE_PROMPT_PATTERN.test(session.title.trim())) {
		return true;
	}

	for (const turn of session.turns) {
		if (turn.type !== 'request') {
			continue;
		}

		return SESSION_CONTROL_ANALYZE_PROMPT_PATTERN.test(turn.prompt.trim());
	}

	return false;
}

export function buildSessionEvidence(
	candidate: AnalysisCandidateSession,
	detailLevel: AnalysisEvidenceDetailLevel = 'full',
): string {
	const gitSummary = candidate.session.git
		? `${candidate.session.git.branch}@${candidate.session.git.commit.slice(0, 7)}${candidate.session.git.dirty ? ' dirty' : ''}`
		: 'n/a';
	const transcript = buildAnalysisTranscript(candidate.session, detailLevel);
	const toolSummary = renderToolCalls(candidate.session, detailLevel);
	const summaryHeading = detailLevel === 'full' ? '### Saved Summary' : '### Saved Summary (condensed due to size)';
	const toolSummaryHeading = detailLevel === 'full' ? '### Tool Call Summary' : '### Tool Call Summary (condensed due to size)';
	const transcriptHeading = detailLevel === 'full' ? '### Transcript' : '### Transcript (condensed due to size)';

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
		summaryHeading,
		'',
		buildAnalysisSummary(candidate.session.markdownSummary, detailLevel),
		'',
		toolSummaryHeading,
		'',
		toolSummary.length ? toolSummary.join('\n') : 'No tool calls recorded.',
		'',
		transcriptHeading,
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
	detailLevel: AnalysisEvidenceDetailLevel = 'full',
): string {
	const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
	const evidence = candidates.map((candidate) => buildSessionEvidence(candidate, detailLevel)).join('\n\n---\n\n');
	const compressionGuidance = buildEvidenceCompressionGuidance(detailLevel);

	return [
		instruction,
		'',
		buildRecommendationScopeGuidance(),
		...(compressionGuidance ? ['', compressionGuidance] : []),
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
