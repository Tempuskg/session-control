import {
	AnalysisImplementationResultMetadata,
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

export const ANALYSIS_PROMPT_VERSION = '1';
export const DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET = 48000;

const ANALYSIS_PROMPT_TEMPLATE = `Review my last interactions with AI from {user chosen timeframe}.
Look for any problems that I encountered, things that weren't working efficiently, and unnecessary tool calling.
Look for common mistakes AI was doing and other things that can be optimized.
Look thoroughly through all conversations and make a plan for how we can optimize our flow in the future, both within each repository and cross-repositories.
Also look for insights that would be useful for the coding agent to know beforehand, both before entering a repository and when working in multiple repositories at the same time.`;

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
		'6. Coding Agent Preload Insights',
	].join('\n');
}

export function buildAnalysisPrompt(selection: AnalysisSelection, candidates: AnalysisCandidateSession[]): string {
	const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
	const evidence = candidates.map((candidate) => buildSessionEvidence(candidate)).join('\n\n---\n\n');

	return [
		instruction,
		'',
		buildRequiredSections(),
		'',
		'Chats to analyze:',
		'',
		evidence,
	].join('\n');
}

export function buildAnalysisSynthesisPrompt(selection: AnalysisSelection, batchSummaries: string[]): string {
	const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
	return [
		instruction,
		'',
		'You are synthesizing batch-level findings from the same analysis request into one final report.',
		'Deduplicate repeated findings and keep repository-specific findings separate from cross-repository patterns.',
		'',
		buildRequiredSections(),
		'',
		'Batch findings:',
		'',
		batchSummaries.map((summary, index) => `## Batch ${index + 1}\n\n${summary}`).join('\n\n'),
	].join('\n');
}

export function buildImplementationPrompt(reportMarkdown: string, userPrompt: string): string {
	const normalizedPrompt = userPrompt.trim().length > 0
		? userPrompt.trim()
		: 'Implement the highest-priority recommendations from this analysis in the current repository.';

	return [
		'The user previously ran an analysis over saved chat sessions and now wants help implementing the recommendations.',
		'Use the analysis report below as the source of truth and stay in implementation mode for the current repository.',
		'Do not stop at planning or broad discovery when the next concrete edit or validation step is already clear.',
		'When the report includes multiple recommendations, prioritize the highest-impact changes that are feasible in the current repository.',
		'If the request is broad, start with the first actionable implementation slice, make the change, and validate it with the narrowest relevant test or command before expanding scope.',
		'If you cannot safely complete the next implementation step, explicitly say BLOCKED and name the blocker instead of giving another plan.',
		'Return markdown using exactly one of these shapes so the result can be parsed reliably:',
		'',
		'## Status',
		'COMPLETED',
		'',
		'## Summary',
		'<brief summary>',
		'',
		'## Files Changed',
		'- <file path or note>',
		'',
		'## Commands Run',
		'- <command or note>',
		'',
		'## Results',
		'- <test/build/result>',
		'',
		'## Unverified',
		'- <remaining risk or none>',
		'',
		'Or, if blocked:',
		'',
		'## Status',
		'BLOCKED',
		'',
		'## Summary',
		'<brief summary>',
		'',
		'## Blockers',
		'- <specific blocker>',
		'',
		'## Unverified',
		'- <remaining risk or none>',
		'',
		'Analysis report:',
		'',
		reportMarkdown.trim(),
		'',
		`User request: ${normalizedPrompt}`,
	].join('\n');
}

function parseImplementationSectionMap(markdown: string): Map<string, string> {
	const normalized = markdown.replace(/\r\n/g, '\n').trim();
	const headingPattern = /^##\s+(.+?)\s*$/gm;
	const matches = [...normalized.matchAll(headingPattern)];
	const sections = new Map<string, string>();

	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (!match || match.index === undefined) {
			continue;
		}

		const rawHeading = match[1];
		if (!rawHeading) {
			continue;
		}

		const contentStart = match.index + match[0].length;
		const nextMatch = matches[index + 1];
		const contentEnd = nextMatch?.index ?? normalized.length;
		sections.set(rawHeading.trim().toLowerCase(), normalized.slice(contentStart, contentEnd).trim());
	}

	return sections;
}

function parseImplementationItems(section: string | undefined): string[] {
	if (!section) {
		return [];
	}

	return section
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line) => {
			if (/^[-*+]\s+/.test(line)) {
				const value = line.replace(/^[-*+]\s+/, '').trim();
				return /^none$|^n\/a$/i.test(value) ? [] : [value];
			}

			return /^none$|^n\/a$/i.test(line) ? [] : [line];
		});
}

export function parseImplementationResponse(
	markdown: string,
	analysisReportPath: string,
	analysisStorageDirectory: string,
): AnalysisImplementationResultMetadata | undefined {
	const sections = parseImplementationSectionMap(markdown);
	const statusSection = sections.get('status');
	if (!statusSection) {
		return undefined;
	}

	const normalizedStatus = statusSection.split(/\s+/)[0]?.trim().toUpperCase();
	if (normalizedStatus !== 'COMPLETED' && normalizedStatus !== 'BLOCKED') {
		return undefined;
	}

	const summary = sections.get('summary')?.trim();
	if (!summary) {
		return undefined;
	}

	const metadata: AnalysisImplementationResultMetadata = {
		resultType: 'analysis-implementation',
		implementationStatus: normalizedStatus === 'COMPLETED' ? 'completed' : 'blocked',
		analysisReportPath,
		analysisStorageDirectory,
		summary,
		filesChanged: parseImplementationItems(sections.get('files changed')),
		commandsRun: parseImplementationItems(sections.get('commands run')),
		results: parseImplementationItems(sections.get('results')),
		blockers: parseImplementationItems(sections.get('blockers')),
		unverified: parseImplementationItems(sections.get('unverified')),
	};

	if (metadata.implementationStatus === 'blocked' && metadata.blockers.length === 0) {
		metadata.blockers.push('The model marked the implementation as blocked but did not provide a blocker list in the required format.');
	}

	return metadata;
}