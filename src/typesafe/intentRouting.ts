import type * as vscode from 'vscode';

import type { SessionMeta } from '../types';
import { fuzzyMatchSessions } from '../utils';
import { choice, type ChoiceQuestion, type JudgmentService, type Questions } from './judgmentService';

/**
 * Phase 2 of the TypeSafe plan: route `@session-control` prompts that have no slash
 * command. One fan-out request asks for the intent plus two speculative answers
 * (timeframe for /analyze, sessionRef for /resume) so a routed command never needs a
 * second round trip. Policy (thresholds, prompt rewriting) stays in code.
 */

export type RoutedCommand = 'resume' | 'list' | 'analyze' | 'implement';

export type IntentRoutingThreadContext = 'new' | 'resumed-session' | 'analysis-report';

export const INTENT_ROUTING_HIGH_CONFIDENCE = 0.8;
export const INTENT_ROUTING_MEDIUM_CONFIDENCE = 0.5;
export const INTENT_ROUTING_MAX_SESSION_CANDIDATES = 20;

const NO_SESSION_LABEL = 'none';
const SESSION_LABEL_PREFIX = 'session-';

const INTENT_CRITERIA = {
	resume: 'Continue, reopen, or pick up a previously saved chat session.',
	list: 'Show or browse the saved chat sessions.',
	analyze: 'Analyze or review saved chat sessions for lessons, friction, or AI instruction improvements.',
	implement: 'Implement, apply, or hand off the recommendations from an analysis report.',
	none: 'Anything else, including a follow-up question about the content of an already resumed session.',
} as const;

const TIMEFRAME_CRITERIA = {
	last24Hours: 'The last day or the last 24 hours.',
	last7Days: 'The last week or the last 7 days.',
	last30Days: 'The last month or the last 30 days.',
	needsAnalysis: 'Sessions that have not been analyzed yet.',
	unspecified: 'No timeframe is stated.',
} as const;

type Timeframe = keyof typeof TIMEFRAME_CRITERIA;

/** Analysis prompts recognized by `parseAnalysisSelectionAlias`. `unspecified` keeps the scope picker. */
const TIMEFRAME_PROMPTS: Record<Timeframe, string> = {
	last24Hours: 'last 24 hours',
	last7Days: 'last 7 days',
	last30Days: 'last 30 days',
	needsAnalysis: 'needs analysis',
	unspecified: '',
};

export interface RoutedIntent<T extends SessionMeta> {
	readonly command: RoutedCommand;
	/** Prompt to hand to the routed command handler. */
	readonly prompt: string;
	/** Session chosen by the `sessionRef` judgment, when the intent is `resume`. */
	readonly session?: T;
	/** Human-readable command, e.g. `/analyze last 7 days`. */
	readonly interpretation: string;
}

export type IntentRoutingDecision<T extends SessionMeta> =
	| { readonly kind: 'fallback' }
	| { readonly kind: 'run' | 'suggest'; readonly intent: RoutedIntent<T>; readonly confidence: number };

export interface IntentRoutingInput<T extends SessionMeta> {
	readonly prompt: string;
	readonly sessions: readonly T[];
	readonly judgment?: JudgmentService;
	readonly token?: vscode.CancellationToken;
	readonly threadContext?: IntentRoutingThreadContext;
	/** Receives one line per judged prompt: the intent, its confidence, and the decision. */
	readonly log?: (message: string) => void;
}

/** Metadata attached to a chat result so the followup provider can offer the routed command. */
export interface IntentRoutingSuggestionMetadata {
	readonly command: RoutedCommand;
	readonly prompt: string;
	readonly interpretation: string;
}

const FALLBACK = { kind: 'fallback' } as const;

function sessionDisplayTitle(session: SessionMeta): string {
	return 'displayTitle' in session && typeof session.displayTitle === 'string' && session.displayTitle.length > 0
		? session.displayTitle
		: session.title;
}

/** Top fuzzy matches for the prompt, or the most recent sessions when nothing matches. */
export function selectSessionRefCandidates<T extends SessionMeta>(prompt: string, sessions: readonly T[]): T[] {
	const scored = fuzzyMatchSessions(
		prompt,
		sessions.map((session) => ({ ...session, title: sessionDisplayTitle(session) })),
	);
	const findOriginal = (match: SessionMeta): T | undefined =>
		sessions.find((session) => session.fileName === match.fileName && session.savedAt === match.savedAt);
	const matched = scored
		.map((match) => findOriginal(match))
		.filter((session): session is T => Boolean(session));
	const ordered = matched.length
		? matched
		: [...sessions].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
	return ordered.slice(0, INTENT_ROUTING_MAX_SESSION_CANDIDATES);
}

export function buildIntentRoutingQuestions(candidates: readonly SessionMeta[]): Questions {
	const questions: Record<string, ChoiceQuestion> = {
		intent: choice(
			'Which Session Control action is the user asking for? Session Control saves, lists, resumes, and analyzes AI chat sessions.',
			INTENT_CRITERIA,
		),
		timeframe: choice(
			'If the user wants saved sessions analyzed, which sessions or timeframe do they mean?',
			TIMEFRAME_CRITERIA,
		),
	};
	if (candidates.length) {
		const criteria: Record<string, string> = {};
		candidates.forEach((session, index) => {
			const provider = session.provider ?? 'copilot';
			criteria[`${SESSION_LABEL_PREFIX}${index + 1}`] =
				`"${sessionDisplayTitle(session)}" (${provider} chat saved ${session.savedAt.slice(0, 10)})`;
		});
		criteria[NO_SESSION_LABEL] = 'None of the listed sessions matches what the user wants to resume.';
		questions.sessionRef = choice('If the user wants to resume a saved session, which one do they mean?', criteria);
	}
	return questions;
}

function readChoice(answer: unknown): { choice: string; confidence: number } | undefined {
	if (!answer || typeof answer !== 'object') {
		return undefined;
	}
	const candidate = answer as { choice?: unknown; confidence?: unknown };
	if (typeof candidate.choice !== 'string' || typeof candidate.confidence !== 'number' || Number.isNaN(candidate.confidence)) {
		return undefined;
	}
	return { choice: candidate.choice, confidence: candidate.confidence };
}

function isRoutedCommand(value: string): value is RoutedCommand {
	return value === 'resume' || value === 'list' || value === 'analyze' || value === 'implement';
}

function isTimeframe(value: string): value is Timeframe {
	return Object.prototype.hasOwnProperty.call(TIMEFRAME_CRITERIA, value);
}

function buildRoutedIntent<T extends SessionMeta>(
	command: RoutedCommand,
	prompt: string,
	answers: Record<string, unknown>,
	candidates: readonly T[],
): RoutedIntent<T> {
	if (command === 'analyze') {
		const timeframe = readChoice(answers.timeframe);
		const scope = timeframe && timeframe.confidence >= INTENT_ROUTING_MEDIUM_CONFIDENCE && isTimeframe(timeframe.choice)
			? TIMEFRAME_PROMPTS[timeframe.choice]
			: '';
		return { command, prompt: scope, interpretation: scope ? `/analyze ${scope}` : '/analyze' };
	}

	if (command === 'resume') {
		const sessionRef = readChoice(answers.sessionRef);
		const index = sessionRef && sessionRef.confidence >= INTENT_ROUTING_MEDIUM_CONFIDENCE
			&& sessionRef.choice.startsWith(SESSION_LABEL_PREFIX)
			? Number.parseInt(sessionRef.choice.slice(SESSION_LABEL_PREFIX.length), 10) - 1
			: -1;
		const session = index >= 0 ? candidates[index] : undefined;
		if (session) {
			const title = sessionDisplayTitle(session);
			return { command, prompt: title, session, interpretation: `/resume ${title}` };
		}
		return { command, prompt, interpretation: `/resume ${prompt}` };
	}

	if (command === 'list') {
		return { command, prompt: '', interpretation: '/list' };
	}

	return { command, prompt, interpretation: '/implement' };
}

/**
 * Decide how to handle a slash-less prompt. Returns `fallback` whenever TypeSafe is off,
 * unavailable, unsure, or answers `none`, so the caller keeps its existing behavior.
 */
export async function routeSlashlessPrompt<T extends SessionMeta>(
	input: IntentRoutingInput<T>,
): Promise<IntentRoutingDecision<T>> {
	const prompt = input.prompt.trim();
	const judgment = input.judgment;
	if (!prompt || !judgment || !judgment.isFeatureEnabled('routing')) {
		return FALLBACK;
	}

	const candidates = selectSessionRefCandidates(prompt, input.sessions);
	const answers = await judgment.ask(
		{ prompt, thread: input.threadContext ?? 'new' },
		buildIntentRoutingQuestions(candidates),
		input.token,
		'routing',
	);
	if (!answers || input.token?.isCancellationRequested) {
		return FALLBACK;
	}

	const intent = readChoice((answers as Record<string, unknown>).intent);
	if (!intent || !isRoutedCommand(intent.choice) || intent.confidence < INTENT_ROUTING_MEDIUM_CONFIDENCE) {
		input.log?.(`intent=${intent?.choice ?? 'invalid'} confidence=${intent?.confidence ?? 'n/a'} decision=fallback`);
		return FALLBACK;
	}

	const decision: IntentRoutingDecision<T> = {
		kind: intent.confidence >= INTENT_ROUTING_HIGH_CONFIDENCE ? 'run' : 'suggest',
		intent: buildRoutedIntent(intent.choice, prompt, answers as Record<string, unknown>, candidates),
		confidence: intent.confidence,
	};
	input.log?.(`intent=${intent.choice} confidence=${intent.confidence} decision=${decision.kind} interpretation=${decision.intent.interpretation}`);
	return decision;
}

export function toIntentRoutingSuggestionMetadata(intent: RoutedIntent<SessionMeta>): IntentRoutingSuggestionMetadata {
	return { command: intent.command, prompt: intent.prompt, interpretation: intent.interpretation };
}
