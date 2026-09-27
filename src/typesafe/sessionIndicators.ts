import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EntryType, JsonValue } from '@typesafe-ai/sdk';

import { isChatSession, type ChatSession } from '../types';
import type { TypeSafeConsentGate } from './consent';
import {
	noul,
	type JudgmentAnswers,
	type JudgmentCacheTarget,
	type JudgmentService,
} from './judgmentService';

export const SESSION_INDICATORS_ENABLED_SETTING = 'typesafe.sessionIndicators.enabled';
export const SESSION_INDICATORS_KNOWLEDGE_THRESHOLD_SETTING = 'typesafe.sessionIndicators.knowledgeThreshold';
export const SESSION_INDICATORS_SKILL_THRESHOLD_SETTING = 'typesafe.sessionIndicators.skillThreshold';
export const DEFAULT_SESSION_INDICATOR_THRESHOLD = 0.7;
export const SESSION_INDICATOR_QUESTION_SET_VERSION = 'session-indicators-v1';

const MAX_STATE_TURNS = 80;
const MAX_TURN_TEXT_LENGTH = 2000;
const MAX_CONCURRENT_JUDGMENTS = 2;

export const SESSION_INDICATOR_QUESTIONS = {
	knowledgeHarvest: noul(
		'Does this chat session contain durable project knowledge worth harvesting into a wiki or docs, such as design decisions, root causes, conventions, or non-obvious how-it-works explanations?',
	),
	aiSkill: noul(
		'Does this chat session show a repeatable, multi-step workflow that should be captured as a reusable AI skill or instruction file, such as a release process, a validation sequence, or a recurring investigation recipe?',
	),
} as const;

export type SessionIndicatorAnswers = JudgmentAnswers<typeof SESSION_INDICATOR_QUESTIONS>;

export type SessionIndicatorState = 'none' | 'knowledge' | 'skill' | 'both';

export interface SessionIndicatorThresholds {
	readonly knowledgeHarvest: number;
	readonly aiSkill: number;
}

export interface SessionIndicatorSignal {
	/** Jev's probability of a yes answer, from zero to one. */
	readonly score: number;
	readonly threshold: number;
	readonly flagged: boolean;
}

export interface SessionIndicatorJudgment {
	readonly knowledgeHarvest: SessionIndicatorSignal;
	readonly aiSkill: SessionIndicatorSignal;
}

export interface SessionIndicatorPresentation {
	readonly state: Exclude<SessionIndicatorState, 'none'>;
	readonly badge: string;
	readonly color: string;
	readonly tooltip: string;
}

function clampThreshold(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_SESSION_INDICATOR_THRESHOLD;
	}
	return Math.min(1, Math.max(0, value));
}

export function resolveSessionIndicatorThresholds(
	raw: { knowledgeHarvest?: unknown; aiSkill?: unknown } = {},
): SessionIndicatorThresholds {
	return {
		knowledgeHarvest: clampThreshold(raw.knowledgeHarvest),
		aiSkill: clampThreshold(raw.aiSkill),
	};
}

function toSignal(score: unknown, threshold: number): SessionIndicatorSignal {
	const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
	return { score: value, threshold, flagged: value >= threshold };
}

export function toSessionIndicatorJudgment(
	answers: SessionIndicatorAnswers,
	thresholds: SessionIndicatorThresholds,
): SessionIndicatorJudgment {
	return {
		knowledgeHarvest: toSignal(answers.knowledgeHarvest?.noul, thresholds.knowledgeHarvest),
		aiSkill: toSignal(answers.aiSkill?.noul, thresholds.aiSkill),
	};
}

export function resolveSessionIndicatorState(judgment: SessionIndicatorJudgment | undefined): SessionIndicatorState {
	const knowledge = judgment?.knowledgeHarvest.flagged ?? false;
	const skill = judgment?.aiSkill.flagged ?? false;
	if (knowledge && skill) {
		return 'both';
	}
	if (knowledge) {
		return 'knowledge';
	}
	return skill ? 'skill' : 'none';
}

function formatScore(signal: SessionIndicatorSignal): string {
	return `score ${signal.score.toFixed(2)}, threshold ${signal.threshold.toFixed(2)}`;
}

// Mirrors the analyzed + harvested -> single `library` icon rule: a session
// flagged for both signals gets one combined glyph, never two side by side.
// Each state has its own glyph shape so it is distinguishable without color.
export function describeSessionIndicator(
	judgment: SessionIndicatorJudgment | undefined,
): SessionIndicatorPresentation | undefined {
	const state = resolveSessionIndicatorState(judgment);
	if (state === 'none' || !judgment) {
		return undefined;
	}

	const knowledgeLine = `Jev: knowledge worth harvesting into the wiki/docs (${formatScore(judgment.knowledgeHarvest)})`;
	const skillLine = `Jev: repeatable workflow that should become an AI skill (${formatScore(judgment.aiSkill)})`;
	if (state === 'both') {
		return { state, badge: '★', color: 'charts.purple', tooltip: `${knowledgeLine}\n${skillLine}` };
	}
	if (state === 'knowledge') {
		return { state, badge: '◆', color: 'charts.blue', tooltip: knowledgeLine };
	}
	return { state, badge: '▲', color: 'charts.yellow', tooltip: skillLine };
}

function clip(text: string): string {
	return text.length > MAX_TURN_TEXT_LENGTH ? `${text.slice(0, MAX_TURN_TEXT_LENGTH)}…` : text;
}

/**
 * Builds the Jev state for a session. Tool output is never included: only tool
 * names are sent, and the judgment service strips any remaining output too.
 */
export function buildSessionIndicatorState(session: ChatSession): EntryType {
	const turns: JsonValue[] = session.turns.slice(-MAX_STATE_TURNS).map((turn) => (turn.type === 'request'
		? { role: 'user', text: clip(turn.prompt) }
		: {
				role: 'assistant',
				text: clip(turn.content),
				tools: turn.toolCalls.map((toolCall) => toolCall.name),
		  }));
	return {
		title: session.title,
		...(session.provider ? { provider: session.provider } : {}),
		turns,
	};
}

export function createSessionIndicatorCacheKey(sessionId: string, content: string): string {
	return `${sessionId}:${createHash('sha256').update(content).digest('hex')}`;
}

/** Wraps a consent gate so background indicator judgments never pop the consent modal. */
export function createPassiveConsentGate(gate: TypeSafeConsentGate): TypeSafeConsentGate {
	return {
		hasConsent: () => gate.hasConsent(),
		ensureConsent: () => Promise.resolve(gate.hasConsent()),
	};
}

export interface SessionIndicatorServiceDeps {
	readonly judgment: JudgmentService;
	/** The indicators setting; the service also requires TypeSafe itself to be enabled. */
	readonly isIndicatorsEnabled: () => boolean;
	readonly getThresholds: () => SessionIndicatorThresholds;
	readonly readFile: (fsPath: string) => Promise<string>;
	/** Optional persistent cache so judgments survive a window reload. */
	readonly getCacheTarget?: (storageDirectory: string, fingerprint: string) => JudgmentCacheTarget | undefined;
	readonly log?: (message: string) => void;
}

export class SessionIndicatorService {
	// Raw answers keyed by session id + content hash. `undefined` records a
	// failed or declined judgment so a tree refresh does not retry it.
	private readonly cache = new Map<string, SessionIndicatorAnswers | undefined>();
	private readonly inflight = new Map<string, Promise<SessionIndicatorAnswers | undefined>>();
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	constructor(private readonly deps: SessionIndicatorServiceDeps) {}

	public isEnabled(): boolean {
		try {
			return this.deps.isIndicatorsEnabled() && this.deps.judgment.isEnabled();
		} catch {
			return false;
		}
	}

	/** Drops failed/declined entries so they are retried; successful judgments stay cached. */
	public forgetFailures(): void {
		for (const [key, value] of this.cache) {
			if (value === undefined) {
				this.cache.delete(key);
			}
		}
	}

	public async getJudgment(
		fsPath: string,
		token?: vscode.CancellationToken,
	): Promise<SessionIndicatorJudgment | undefined> {
		try {
			if (!this.isEnabled()) {
				return undefined;
			}
			const answers = await this.getAnswers(fsPath, token);
			return answers ? toSessionIndicatorJudgment(answers, this.deps.getThresholds()) : undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.deps.log?.(`[session-indicators] ${path.basename(fsPath)}: ${message}`);
			return undefined;
		}
	}

	private async getAnswers(
		fsPath: string,
		token?: vscode.CancellationToken,
	): Promise<SessionIndicatorAnswers | undefined> {
		const content = await this.deps.readFile(fsPath);
		const parsed = JSON.parse(content) as unknown;
		if (!isChatSession(parsed)) {
			return undefined;
		}

		const key = createSessionIndicatorCacheKey(parsed.id, content);
		if (this.cache.has(key)) {
			return this.cache.get(key);
		}
		const pending = this.inflight.get(key);
		if (pending) {
			return pending;
		}

		const request = this.runLimited(() => this.deps.judgment.ask(
			buildSessionIndicatorState(parsed),
			SESSION_INDICATOR_QUESTIONS,
			token,
			this.createAskOptions(fsPath, key),
		)).then(
			(answers) => answers,
			() => undefined,
		);
		this.inflight.set(key, request);
		try {
			const answers = await request;
			if (!token?.isCancellationRequested) {
				this.cache.set(key, answers);
			}
			return answers;
		} finally {
			this.inflight.delete(key);
		}
	}

	private createAskOptions(fsPath: string, fingerprint: string): { cache: JudgmentCacheTarget } | undefined {
		const target = this.deps.getCacheTarget?.(path.dirname(fsPath), fingerprint);
		return target ? { cache: target } : undefined;
	}

	private async runLimited<T>(run: () => Promise<T>): Promise<T> {
		if (this.active >= MAX_CONCURRENT_JUDGMENTS) {
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		}
		this.active++;
		try {
			return await run();
		} finally {
			this.active--;
			this.waiting.shift()?.();
		}
	}
}

export function createSessionIndicatorService(
	deps: Omit<SessionIndicatorServiceDeps, 'readFile'> & Partial<Pick<SessionIndicatorServiceDeps, 'readFile'>>,
): SessionIndicatorService {
	return new SessionIndicatorService({
		...deps,
		readFile: deps.readFile ?? ((fsPath) => fs.readFile(fsPath, 'utf8')),
	});
}

/**
 * Decorates Saved Sessions tree items (via their `resourceUri`) with one Jev
 * indicator badge, leaving each item's session-type `iconPath` untouched.
 * Only URIs the Session Explorer has listed are decorated.
 */
export class SessionIndicatorDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[]>();
	readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;
	private readonly tracked = new Map<string, vscode.Uri>();

	constructor(private readonly service: SessionIndicatorService) {}

	public track(uris: readonly vscode.Uri[]): void {
		const added: vscode.Uri[] = [];
		for (const uri of uris) {
			const key = uri.toString();
			if (!this.tracked.has(key)) {
				this.tracked.set(key, uri);
				added.push(uri);
			}
		}
		if (added.length > 0) {
			this.onDidChangeEmitter.fire(added);
		}
	}

	/** Re-requests every tracked decoration, e.g. after a settings or consent change. */
	public refresh(): void {
		this.service.forgetFailures();
		if (this.tracked.size > 0) {
			this.onDidChangeEmitter.fire([...this.tracked.values()]);
		}
	}

	public async provideFileDecoration(
		uri: vscode.Uri,
		token: vscode.CancellationToken,
	): Promise<vscode.FileDecoration | undefined> {
		if (!this.tracked.has(uri.toString()) || !this.service.isEnabled()) {
			return undefined;
		}
		const presentation = describeSessionIndicator(await this.service.getJudgment(uri.fsPath, token));
		if (!presentation) {
			return undefined;
		}
		const decoration = new vscode.FileDecoration(
			presentation.badge,
			presentation.tooltip,
			new vscode.ThemeColor(presentation.color),
		);
		decoration.propagate = false;
		return decoration;
	}

	public dispose(): void {
		this.onDidChangeEmitter.dispose();
	}
}
