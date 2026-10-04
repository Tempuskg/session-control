import type * as vscode from 'vscode';
import type { EntryType, JsonValue } from '@typesafe-ai/sdk';

import { buildSessionEvidence, type AnalysisCandidateSession } from '../sessionAnalysis';
import type { SavedTurn } from '../types';
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
