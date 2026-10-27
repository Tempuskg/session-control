import type * as vscode from 'vscode';
import type { EntryType } from '@typesafe-ai/sdk';

import { choice, noul, type JudgmentAnswers, type JudgmentService } from './judgmentService';

export const REPORT_VERIFICATION_QUESTION_SET_VERSION = 'report-verification-v1';

const MAX_RECOMMENDATION_TEXT_LENGTH = 2000;
const MAX_VERIFICATION_EVIDENCE_LENGTH = 12000;
const MAX_CONCURRENT_VERIFICATION_JUDGMENTS = 4;

export const REPORT_TARGET_KIND_CRITERIA = {
	aiControlFile: 'A repository-local AI control file such as AGENTS.md, copilot-instructions.md, CLAUDE.md, *.instructions.md, *.prompt.md, *.agent.md, or SKILL.md.',
	sourceCode: 'Application source code or tests.',
	docs: 'General documentation such as README, CHANGELOG, or wiki pages that are not AI instructions.',
	build: 'Build, packaging, CI, or tooling configuration.',
	other: 'Anything else, or no concrete file target.',
} as const;

export type ReportTargetKind = keyof typeof REPORT_TARGET_KIND_CRITERIA;

export const REPORT_VERIFICATION_QUESTIONS = {
	supported: noul(
		'Is this recommendation supported by the cited chat session evidence, meaning the evidence shows the problem or pattern the recommendation claims?',
	),
	targetKind: choice('What kind of repository file would this recommendation change?', REPORT_TARGET_KIND_CRITERIA),
} as const;

export type ReportVerificationAnswers = JudgmentAnswers<typeof REPORT_VERIFICATION_QUESTIONS>;

/**
 * Report sections whose top-level list items are recommendations. Matches the
 * required sections in `buildRequiredSections` plus any heading that names
 * recommendations explicitly.
 */
const RECOMMENDATION_SECTION_PATTERNS: readonly RegExp[] = [
	/\brecommend/i,
	/\bworkflow optimi[sz]ations?\b/i,
	/\bai skills? to create\b/i,
	/\bpreload insights?\b/i,
];

export interface ReportRecommendation {
	/** Zero-based order of the recommendation in the report. */
	readonly index: number;
	/** Normalized title of the section the recommendation appears under. */
	readonly section: string;
	/** Recommendation text with list markers removed and continuation lines joined. */
	readonly text: string;
	/** Zero-based report line range [startLine, endLine] the recommendation occupies. */
	readonly startLine: number;
	readonly endLine: number;
}

interface ReportHeading {
	readonly level: number;
	readonly title: string;
}

/** Appended to a report once the verification policy has run; `/implement` handoffs key off it. */
export const REPORT_VERIFICATION_MARKER = '<!-- session-control:report-verification v1 -->';
/** Section that collects recommendations targeting files other than AI control files (AGENTS.md rule 13). */
export const DEMOTED_RECOMMENDATIONS_HEADING = 'Demoted Recommendations (outside AI control files)';
/** A recommendation counts as supported at or above this `supported` probability. */
export const SUPPORTED_THRESHOLD = 0.5;
const VERIFICATION_NOTE_PREFIX = '> ⚠️';

const LIST_ITEM_PATTERN = /^( ?)(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const FENCE_PATTERN = /^\s*(?:```|~~~)/;

function normalizeHeadingTitle(title: string): string {
	return title
		.replace(/\*\*|__/g, '')
		.replace(/^\s*\d{1,3}[.)]\s*/, '')
		.replace(/:\s*$/, '')
		.trim();
}

function parseHeading(line: string): ReportHeading | undefined {
	const atx = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
	if (atx?.[1] && atx[2] !== undefined) {
		return { level: atx[1].length, title: normalizeHeadingTitle(atx[2]) };
	}
	// A standalone bold line such as `**5. Workflow Optimizations**` acts as a heading below any ATX level.
	const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__):?\s*$/.exec(line);
	if (bold?.[1]) {
		return { level: 7, title: normalizeHeadingTitle(bold[1]) };
	}
	return undefined;
}

function isRecommendationSection(title: string): boolean {
	if (title === DEMOTED_RECOMMENDATIONS_HEADING) {
		return false;
	}
	return RECOMMENDATION_SECTION_PATTERNS.some((pattern) => pattern.test(title));
}

/**
 * Splits an analysis report into recommendations: each top-level list item
 * under a recommendation section, with its nested bullets and continuation
 * lines. Deterministic, so the same report always yields the same list.
 */
export function extractReportRecommendations(report: string): ReportRecommendation[] {
	const lines = report.split(/\r?\n/);
	const recommendations: ReportRecommendation[] = [];
	let section: ReportHeading | undefined;
	let current: { section: string; lines: string[]; startLine: number; endLine: number } | undefined;
	let inFence = false;

	const flush = (): void => {
		if (!current) {
			return;
		}
		const text = current.lines.join('\n').trim();
		if (text) {
			recommendations.push({
				index: recommendations.length,
				section: current.section,
				text,
				startLine: current.startLine,
				endLine: current.endLine,
			});
		}
		current = undefined;
	};

	lines.forEach((line, lineIndex) => {
		if (FENCE_PATTERN.test(line)) {
			inFence = !inFence;
			if (current) {
				current.lines.push(line);
				current.endLine = lineIndex;
			}
			return;
		}
		if (inFence) {
			if (current) {
				current.lines.push(line);
				current.endLine = lineIndex;
			}
			return;
		}

		const heading = parseHeading(line);
		if (heading) {
			flush();
			if (!section || heading.level <= section.level || isRecommendationSection(heading.title)) {
				section = isRecommendationSection(heading.title) ? heading : undefined;
			}
			return;
		}

		if (!section) {
			return;
		}

		const item = LIST_ITEM_PATTERN.exec(line);
		if (item && item[2] !== undefined) {
			flush();
			current = { section: section.title, lines: [item[2]], startLine: lineIndex, endLine: lineIndex };
			return;
		}

		if (!current) {
			return;
		}
		if (line.trim() === '') {
			// Blank lines stay inside an item only when indented content follows.
			current.lines.push('');
			return;
		}
		if (/^\s/.test(line)) {
			current.lines.push(line.trim());
			current.endLine = lineIndex;
			return;
		}
		// Unindented prose ends the current item.
		flush();
	});
	flush();

	return recommendations;
}

function clip(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Judgment state for one recommendation: its text, section, and the session evidence it should cite. */
export function buildRecommendationVerificationState(recommendation: ReportRecommendation, evidence: string): EntryType {
	return {
		section: recommendation.section,
		recommendation: clip(recommendation.text, MAX_RECOMMENDATION_TEXT_LENGTH),
		evidence: clip(evidence, MAX_VERIFICATION_EVIDENCE_LENGTH),
	};
}

export interface VerifiedReportRecommendation {
	readonly recommendation: ReportRecommendation;
	/** Probability (0..1) that the recommendation is backed by the cited evidence; absent without a judgment. */
	readonly supported?: number;
	readonly targetKind?: { readonly kind: ReportTargetKind; readonly confidence: number };
}

export interface ReportVerificationDeps {
	readonly judgment: JudgmentService;
	readonly token?: vscode.CancellationToken;
	readonly log?: (message: string) => void;
}

function isReportTargetKind(value: unknown): value is ReportTargetKind {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REPORT_TARGET_KIND_CRITERIA, value);
}

function readVerification(recommendation: ReportRecommendation, answers: ReportVerificationAnswers): VerifiedReportRecommendation {
	const supported = (answers.supported as { noul?: unknown } | undefined)?.noul;
	const target = answers.targetKind as { choice?: unknown; confidence?: unknown } | undefined;
	return {
		recommendation,
		...(typeof supported === 'number' && Number.isFinite(supported) ? { supported } : {}),
		...(target && isReportTargetKind(target.choice) && typeof target.confidence === 'number' && Number.isFinite(target.confidence)
			? { targetKind: { kind: target.choice, confidence: target.confidence } }
			: {}),
	};
}

/**
 * Extracts the report's recommendations and asks `supported` and `targetKind`
 * for each. Returns the recommendations without judgments, and sends nothing,
 * when TypeSafe or the `reportVerification` feature is disabled.
 */
export async function verifyReportRecommendations(
	report: string,
	evidence: string,
	deps: ReportVerificationDeps,
): Promise<VerifiedReportRecommendation[]> {
	const recommendations = extractReportRecommendations(report);
	const results: VerifiedReportRecommendation[] = recommendations.map((recommendation) => ({ recommendation }));
	try {
		if (!deps.judgment.isFeatureEnabled('reportVerification')) {
			return results;
		}
	} catch {
		return results;
	}

	const queue = [...recommendations];
	const worker = async (): Promise<void> => {
		for (let recommendation = queue.shift(); recommendation; recommendation = queue.shift()) {
			if (deps.token?.isCancellationRequested) {
				return;
			}
			try {
				const answers = await deps.judgment.ask(
					buildRecommendationVerificationState(recommendation, evidence),
					REPORT_VERIFICATION_QUESTIONS,
					deps.token,
					'reportVerification',
				);
				if (answers) {
					results[recommendation.index] = readVerification(recommendation, answers);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.log?.(`[report-verification] recommendation ${recommendation.index + 1}: ${message}`);
			}
		}
	};

	const workerCount = Math.min(MAX_CONCURRENT_VERIFICATION_JUDGMENTS, queue.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	const judged = results.filter((result) => result.supported !== undefined || result.targetKind !== undefined).length;
	deps.log?.(`[report-verification] judged ${judged} of ${recommendations.length} recommendations`);
	return results;
}

export function isRecommendationUnsupported(result: VerifiedReportRecommendation): boolean {
	return result.supported !== undefined && result.supported < SUPPORTED_THRESHOLD;
}

export function isRecommendationDemoted(result: VerifiedReportRecommendation): boolean {
	return result.targetKind !== undefined && result.targetKind.kind !== 'aiControlFile';
}

/** Verified means supported by the evidence and targeting an AI control file. */
export function isRecommendationVerified(result: VerifiedReportRecommendation): boolean {
	return result.supported !== undefined
		&& result.supported >= SUPPORTED_THRESHOLD
		&& result.targetKind?.kind === 'aiControlFile';
}

function buildVerificationNotes(result: VerifiedReportRecommendation): string[] {
	const notes: string[] = [];
	if (result.supported === undefined || result.targetKind === undefined) {
		notes.push(`${VERIFICATION_NOTE_PREFIX} Not verified: no verification judgment was available for this recommendation.`);
	}
	if (isRecommendationUnsupported(result)) {
		const percent = Math.round((result.supported ?? 0) * 100);
		notes.push(`${VERIFICATION_NOTE_PREFIX} Unsupported: the cited session evidence does not support this recommendation (${percent}% support).`);
	}
	if (isRecommendationDemoted(result)) {
		notes.push(`${VERIFICATION_NOTE_PREFIX} Demoted: this targets ${result.targetKind?.kind} rather than an AI control file (AGENTS.md rule 13).`);
	}
	return notes.map((note) => `  ${note}`);
}

export interface ReportVerificationSummary {
	readonly total: number;
	readonly verified: number;
	readonly unsupported: number;
	readonly demoted: number;
}

export function summarizeReportVerification(results: readonly VerifiedReportRecommendation[]): ReportVerificationSummary {
	return {
		total: results.length,
		verified: results.filter(isRecommendationVerified).length,
		unsupported: results.filter(isRecommendationUnsupported).length,
		demoted: results.filter(isRecommendationDemoted).length,
	};
}

/**
 * Applies the step-24 policy to a report: flags unsupported or unjudged
 * recommendations with a `> ⚠️` note, moves recommendations that target
 * anything other than an AI control file into a trailing demoted section, and
 * appends `REPORT_VERIFICATION_MARKER`. Returns the report unchanged when no
 * recommendation was judged, so a disabled feature leaves reports as before.
 */
export function applyReportVerificationPolicy(report: string, results: readonly VerifiedReportRecommendation[]): string {
	const judged = results.some((result) => result.supported !== undefined || result.targetKind !== undefined);
	if (!judged) {
		return report;
	}

	const lines = report.split(/\r?\n/);
	const byStartLine = new Map(results.map((result) => [result.recommendation.startLine, result]));
	const output: string[] = [];
	const demoted: string[][] = [];
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const result = byStartLine.get(lineIndex);
		if (!result) {
			output.push(lines[lineIndex] ?? '');
			continue;
		}
		const { startLine, endLine } = result.recommendation;
		const block = [...lines.slice(startLine, endLine + 1), ...buildVerificationNotes(result)];
		if (isRecommendationDemoted(result)) {
			demoted.push(block);
		} else {
			output.push(...block);
		}
		lineIndex = endLine;
	}

	while (output.length > 0 && output[output.length - 1]?.trim() === '') {
		output.pop();
	}
	if (demoted.length > 0) {
		output.push('', `## ${DEMOTED_RECOMMENDATIONS_HEADING}`, '');
		demoted.forEach((block, index) => {
			if (index > 0) {
				output.push('');
			}
			output.push(...block);
		});
	}
	output.push('', REPORT_VERIFICATION_MARKER, '');
	return output.join('\n');
}

/**
 * Returns the recommendations a verified report leaves actionable: those
 * outside the demoted section with no `> ⚠️` note. Returns `undefined` for a
 * report the policy never ran on, so callers keep their unfiltered behavior.
 */
export function extractVerifiedRecommendations(report: string): string[] | undefined {
	if (!report.includes(REPORT_VERIFICATION_MARKER)) {
		return undefined;
	}
	return extractReportRecommendations(report)
		.map((recommendation) => recommendation.text)
		.filter((text) => !text.split('\n').some((line) => line.startsWith(VERIFICATION_NOTE_PREFIX)));
}
