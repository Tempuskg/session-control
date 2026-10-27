import type * as vscode from 'vscode';
import type { EntryType, JsonValue } from '@typesafe-ai/sdk';

import {
	buildSessionEvidence,
	type AnalysisCandidateSession,
	type AnalysisEvidenceDetailLevel,
	type AnalysisEvidenceDetailLevels,
} from '../sessionAnalysis';
import type { AnalysisTriageSignals, SavedTurn } from '../types';
import {
	noul,
	score,
	type JudgmentAnswers,
	type JudgmentCacheTarget,
	type JudgmentService,
} from './judgmentService';

export const ANALYSIS_TRIAGE_QUESTION_SET_VERSION = 'analysis-triage-v1';

const MAX_EDGE_TURN_TEXT_LENGTH = 1200;
const MAX_CONCURRENT_TRIAGE_JUDGMENTS = 4;

export const ANALYSIS_TRIAGE_QUESTIONS = {
	friction: score(
		'How much friction did the user experience with the AI agent in this chat session?',
		[
			'Smooth: the agent did what was asked without corrections.',
			'Minor clarifications from the user.',
			'Some user corrections or redirections.',
			'Repeated user corrections, reverts, or restarts.',
		] as const,
	),
	toolFailureLoops: score(
		'Did the agent get stuck in failing tool or command cycles in this chat session?',
		[
			'No failing tool or command cycles.',
			'An isolated tool or command failure.',
			'A few retries of failing tools or commands.',
			'Repeated failing tool or command cycles.',
		] as const,
	),
	instructionViolation: noul(
		'Did the agent ignore stated repository instructions (such as AGENTS.md or copilot-instructions) or explicit user instructions in this chat session?',
	),
	controlFileLesson: noul(
		'Would a change to an AI control file (such as AGENTS.md, copilot-instructions.md, a prompt, or a skill) plausibly prevent the issues seen in this chat session?',
	),
	trivial: noul(
		'Is this chat session too short, trivial, or off-topic to be worth analyzing for AI workflow improvements?',
	),
} as const;

export type AnalysisTriageAnswers = JudgmentAnswers<typeof ANALYSIS_TRIAGE_QUESTIONS>;

/** Raw triage answers keyed by candidate fingerprint; candidates without a judgment are absent. */
export type AnalysisTriageResults = ReadonlyMap<string, AnalysisTriageAnswers>;

function clip(text: string): string {
	return text.length > MAX_EDGE_TURN_TEXT_LENGTH ? `${text.slice(0, MAX_EDGE_TURN_TEXT_LENGTH)}…` : text;
}

function toEdgeTurn(turn: SavedTurn): JsonValue {
	return turn.type === 'request'
		? { role: 'user', text: clip(turn.prompt) }
		: { role: 'assistant', text: clip(turn.content), tools: turn.toolCalls.map((toolCall) => toolCall.name) };
}

/**
 * Builds compact triage state: the `summaryOnly` analysis evidence plus the
 * first and last turns, so triage stays cheap relative to full analysis.
 */
export function buildAnalysisTriageState(candidate: AnalysisCandidateSession): EntryType {
	const turns = candidate.session.turns;
	const firstTurn = turns[0];
	const lastTurn = turns.length > 1 ? turns[turns.length - 1] : undefined;
	return {
		title: candidate.session.title,
		...(candidate.session.provider ? { provider: candidate.session.provider } : {}),
		turnCount: turns.length,
		evidence: buildSessionEvidence(candidate, 'summaryOnly'),
		...(firstTurn ? { firstTurn: toEdgeTurn(firstTurn) } : {}),
		...(lastTurn ? { lastTurn: toEdgeTurn(lastTurn) } : {}),
	};
}

export interface AnalysisTriageDeps {
	readonly judgment: JudgmentService;
	/** Persistent judgment cache so re-runs and policy changes do not re-query. */
	readonly getCacheTarget?: (candidate: AnalysisCandidateSession) => JudgmentCacheTarget | undefined;
	readonly token?: vscode.CancellationToken;
	readonly log?: (message: string) => void;
}

/**
 * Asks the triage questions once per candidate. Returns an empty map without
 * sending anything when TypeSafe or the `triage` feature is disabled.
 */
export async function triageAnalysisCandidates(
	candidates: readonly AnalysisCandidateSession[],
	deps: AnalysisTriageDeps,
): Promise<AnalysisTriageResults> {
	const results = new Map<string, AnalysisTriageAnswers>();
	try {
		if (!deps.judgment.isFeatureEnabled('triage')) {
			return results;
		}
	} catch {
		return results;
	}

	const queue = [...candidates];
	const worker = async (): Promise<void> => {
		for (let candidate = queue.shift(); candidate; candidate = queue.shift()) {
			if (deps.token?.isCancellationRequested) {
				return;
			}
			try {
				const cache = deps.getCacheTarget?.(candidate);
				const answers = await deps.judgment.ask(
					buildAnalysisTriageState(candidate),
					ANALYSIS_TRIAGE_QUESTIONS,
					deps.token,
					cache ? { feature: 'triage', cache } : 'triage',
				);
				if (answers) {
					results.set(candidate.fingerprint, answers);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.log?.(`[analysis-triage] ${candidate.session.title}: ${message}`);
			}
		}
	};

	const workerCount = Math.min(MAX_CONCURRENT_TRIAGE_JUDGMENTS, queue.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	deps.log?.(`[analysis-triage] judged ${results.size} of ${candidates.length} candidates`);
	return results;
}

/*
 * Triage policy. Weights and thresholds live here in code, not in the
 * questions, so the policy can change without invalidating cached answers.
 */

/** Weights for the composite priority; each signal is normalized to 0..1 first. */
export const ANALYSIS_TRIAGE_PRIORITY_WEIGHTS = {
	friction: 0.35,
	toolFailureLoops: 0.25,
	instructionViolation: 0.2,
	controlFileLesson: 0.2,
} as const;

/** `trivial` probability at or above which a candidate skips the LLM. */
export const ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD = 0.7;

/** Priority for candidates without triage answers, so they are neither skipped nor favored. */
export const UNTRIAGED_ANALYSIS_PRIORITY = 0.5;

/** Highest rubric level of the triage Score questions (four levels, 0 to 3). */
const MAX_TRIAGE_SCORE = 3;

const EVIDENCE_DETAIL_LEVELS: readonly AnalysisEvidenceDetailLevel[] = ['full', 'compact', 'summaryOnly'];
const EVIDENCE_SEPARATOR_LENGTH = 6;

function unit(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Weighted sum of the normalized triage signals, from 0 (low signal) to 1. */
export function computeAnalysisPriority(answers: AnalysisTriageAnswers): number {
	const weights = ANALYSIS_TRIAGE_PRIORITY_WEIGHTS;
	return (
		weights.friction * unit(answers.friction?.score / MAX_TRIAGE_SCORE) +
		weights.toolFailureLoops * unit(answers.toolFailureLoops?.score / MAX_TRIAGE_SCORE) +
		weights.instructionViolation * unit(answers.instructionViolation?.noul) +
		weights.controlFileLesson * unit(answers.controlFileLesson?.noul)
	);
}

function finiteOrUndefined(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Flattens triage answers into the persisted signal shape, omitting signals the judgment lacks. */
export function summarizeAnalysisTriageSignals(answers: AnalysisTriageAnswers): AnalysisTriageSignals {
	const values: [keyof AnalysisTriageSignals, number | undefined][] = [
		['friction', finiteOrUndefined(answers.friction?.score)],
		['toolFailureLoops', finiteOrUndefined(answers.toolFailureLoops?.score)],
		['instructionViolation', finiteOrUndefined(answers.instructionViolation?.noul)],
		['controlFileLesson', finiteOrUndefined(answers.controlFileLesson?.noul)],
		['trivial', finiteOrUndefined(answers.trivial?.noul)],
	];
	return Object.fromEntries(values.filter(([, value]) => value !== undefined)) as AnalysisTriageSignals;
}

export function isTrivialAnalysisCandidate(answers: AnalysisTriageAnswers): boolean {
	return unit(answers.trivial?.noul) >= ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD;
}

export interface AnalysisTriagePlan {
	/** Candidates to send to the LLM, highest priority first. */
	readonly analyzable: AnalysisCandidateSession[];
	/** Candidates skipped as trivial, in their original order. */
	readonly skipped: AnalysisCandidateSession[];
	readonly priorities: ReadonlyMap<string, number>;
	readonly detailLevels: AnalysisEvidenceDetailLevels;
}

/**
 * Applies the triage policy: skips trivial candidates, ranks the rest by
 * priority, and gives the richest evidence that still fits the batch budget to
 * the highest-ranked candidates. Detail never increases as rank decreases.
 */
export function planAnalysisFromTriage(
	candidates: readonly AnalysisCandidateSession[],
	triage: AnalysisTriageResults,
	batchCharBudget: number,
): AnalysisTriagePlan {
	const skipped: AnalysisCandidateSession[] = [];
	const priorities = new Map<string, number>();
	const ranked: { candidate: AnalysisCandidateSession; priority: number; index: number }[] = [];

	candidates.forEach((candidate, index) => {
		const answers = triage.get(candidate.fingerprint);
		if (answers && isTrivialAnalysisCandidate(answers)) {
			skipped.push(candidate);
			return;
		}
		const priority = answers ? computeAnalysisPriority(answers) : UNTRIAGED_ANALYSIS_PRIORITY;
		priorities.set(candidate.fingerprint, priority);
		ranked.push({ candidate, priority, index });
	});
	ranked.sort((left, right) => right.priority - left.priority || left.index - right.index);

	const detailLevels = new Map<string, AnalysisEvidenceDetailLevel>();
	let floor = 0;
	let usedChars = 0;
	for (const { candidate } of ranked) {
		const separator = usedChars === 0 ? 0 : EVIDENCE_SEPARATOR_LENGTH;
		let chosen = EVIDENCE_DETAIL_LEVELS.length - 1;
		let chosenLength: number | undefined;
		for (let level = floor; level < EVIDENCE_DETAIL_LEVELS.length; level += 1) {
			const length = buildSessionEvidence(candidate, EVIDENCE_DETAIL_LEVELS[level]).length;
			if (usedChars + separator + length <= batchCharBudget) {
				chosen = level;
				chosenLength = length;
				break;
			}
		}
		floor = chosen;
		usedChars += separator + (chosenLength ?? 0);
		detailLevels.set(candidate.fingerprint, EVIDENCE_DETAIL_LEVELS[chosen] ?? 'summaryOnly');
	}

	return {
		analyzable: ranked.map((entry) => entry.candidate),
		skipped,
		priorities,
		detailLevels,
	};
}
