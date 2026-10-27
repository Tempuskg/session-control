import type * as vscode from 'vscode';
import type { EntryType, JsonValue } from '@typesafe-ai/sdk';

import type { SavedTurn } from '../types';
import { score, type JudgmentService, type Questions, type ScoreQuestion } from './judgmentService';

/*
 * Relevance-selected resume context. One fan-out request scores every omitted
 * turn against the resume prompt, following the line-by-line search cookbook:
 * the turns travel once in the state and each question points at one turn.
 */

export const MAX_RELEVANCE_SCORED_TURNS = 60;

const MAX_TURN_TEXT_LENGTH = 1200;
const MAX_RELEVANCE_SCORE = 3;
const TURN_KEY_PREFIX = 'turn_';

const RELEVANCE_CRITERIA = [
	'Unrelated to the follow-up.',
	'Tangential background for the follow-up.',
	'Relevant context for the follow-up.',
	'Essential context for answering the follow-up.',
] as const;

export interface ResumeRelevanceInput {
	readonly omittedTurns: readonly SavedTurn[];
	readonly prompt: string;
	readonly judgment: JudgmentService | undefined;
	readonly token?: vscode.CancellationToken;
	readonly log?: (message: string) => void;
}

function clip(text: string): string {
	return text.length > MAX_TURN_TEXT_LENGTH ? `${text.slice(0, MAX_TURN_TEXT_LENGTH)}…` : text;
}

function turnText(turn: SavedTurn): string {
	return turn.type === 'request' ? turn.prompt : turn.content;
}

export function buildResumeRelevanceState(
	prompt: string,
	scoredTurns: readonly { index: number; turn: SavedTurn }[],
): EntryType {
	const turns: JsonValue[] = scoredTurns.map(({ index, turn }) => ({
		id: `${TURN_KEY_PREFIX}${index}`,
		role: turn.type === 'request' ? 'user' : 'assistant',
		text: clip(turnText(turn)),
	}));
	return { followUp: prompt, turns };
}

export function buildResumeRelevanceQuestions(indices: readonly number[]): Questions {
	const questions: Record<string, ScoreQuestion> = {};
	for (const index of indices) {
		questions[`${TURN_KEY_PREFIX}${index}`] = score(
			`How relevant is the earlier conversation turn with id "${TURN_KEY_PREFIX}${index}" to answering the user's follow-up?`,
			RELEVANCE_CRITERIA,
		);
	}
	return questions;
}

/**
 * Scores each omitted turn's relevance to the resume prompt from zero to one,
 * aligned with `omittedTurns`. Only the most recent `MAX_RELEVANCE_SCORED_TURNS`
 * are sent; older turns score zero. Returns undefined when TypeSafe or the
 * `resumeSelection` feature is off, the request fails, or no score comes back,
 * so the caller keeps its fallback strategy.
 */
export async function scoreResumeTurnRelevance(input: ResumeRelevanceInput): Promise<number[] | undefined> {
	const prompt = input.prompt.trim();
	const judgment = input.judgment;
	if (!input.omittedTurns.length || !prompt || !judgment) {
		return undefined;
	}

	try {
		if (!judgment.isFeatureEnabled('resumeSelection')) {
			return undefined;
		}

		const firstScored = Math.max(0, input.omittedTurns.length - MAX_RELEVANCE_SCORED_TURNS);
		const scoredTurns = input.omittedTurns
			.map((turn, index) => ({ index, turn }))
			.slice(firstScored);
		const answers = await judgment.ask(
			buildResumeRelevanceState(prompt, scoredTurns),
			buildResumeRelevanceQuestions(scoredTurns.map(({ index }) => index)),
			input.token,
			'resumeSelection',
		);
		if (!answers || input.token?.isCancellationRequested) {
			return undefined;
		}

		const results = answers as Record<string, { score?: unknown } | undefined>;
		let answered = 0;
		const scores = input.omittedTurns.map((_turn, index) => {
			const value = results[`${TURN_KEY_PREFIX}${index}`]?.score;
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return 0;
			}
			answered += 1;
			return Math.min(1, Math.max(0, value / MAX_RELEVANCE_SCORE));
		});
		input.log?.(`[resume-relevance] scored ${answered} of ${input.omittedTurns.length} omitted turns`);
		return answered > 0 ? scores : undefined;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.log?.(`[resume-relevance] ${message}`);
		return undefined;
	}
}
