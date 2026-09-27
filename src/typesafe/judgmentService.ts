import type * as vscode from 'vscode';
import {
	APIConnectionError,
	APIError,
	APITimeoutError,
	APIUserAbortError,
	AuthenticationError,
	InternalServerError,
	RateLimitError,
	TypeSafeClient,
	choice,
	noul,
	score,
	type ChoiceCriteria,
	type ChoiceQuestion,
	type ChoiceResponse,
	type EntryType,
	type NoulQuestion,
	type NoulResponse,
	type Question,
	type Questions,
	type RequestOptions,
	type ResultFor,
	type RetryPolicy,
	type ScoreCriteria,
	type ScoreQuestion,
	type ScoreResponse,
	type SystemOneRequest,
	type SystemOneResult,
	type TypeSafeClientConfig,
	type Usage,
} from '@typesafe-ai/sdk';

import {
	CLEAR_TYPESAFE_API_KEY_COMMAND,
	SET_TYPESAFE_API_KEY_COMMAND,
	TYPESAFE_API_KEY_ENV_VAR,
	TYPESAFE_API_KEY_SECRET,
	clearTypeSafeApiKey,
	registerTypeSafeApiKeyCommands,
	resolveTypeSafeApiKey,
	setTypeSafeApiKey,
	type ClearTypeSafeApiKeyOptions,
	type SecretStorageLike,
	type TypeSafeApiKeyDeps,
} from './apiKey';
import {
	DENY_TYPESAFE_CONSENT,
	stripToolOutputFromState,
	type TypeSafeConsentGate,
} from './consent';

export {
	DENY_TYPESAFE_CONSENT,
	stripToolOutputFromState,
	type TypeSafeConsentGate,
};

export {
	choice,
	noul,
	score,
	type ChoiceCriteria,
	type ChoiceQuestion,
	type ChoiceResponse,
	type EntryType,
	type NoulQuestion,
	type NoulResponse,
	type Question,
	type Questions,
	type RequestOptions,
	type ResultFor,
	type RetryPolicy,
	type ScoreCriteria,
	type ScoreQuestion,
	type ScoreResponse,
	type SystemOneRequest,
	type SystemOneResult,
	type TypeSafeClientConfig,
	type Usage,
	CLEAR_TYPESAFE_API_KEY_COMMAND,
	SET_TYPESAFE_API_KEY_COMMAND,
	TYPESAFE_API_KEY_ENV_VAR,
	TYPESAFE_API_KEY_SECRET,
	clearTypeSafeApiKey,
	registerTypeSafeApiKeyCommands,
	resolveTypeSafeApiKey,
	setTypeSafeApiKey,
	type ClearTypeSafeApiKeyOptions,
	type SecretStorageLike,
	type TypeSafeApiKeyDeps,
};

export type TypeSafeFeature =
	| 'routing'
	| 'triage'
	| 'resumeSelection'
	| 'reportVerification';

export const TYPESAFE_FEATURES: readonly TypeSafeFeature[] = [
	'routing',
	'triage',
	'resumeSelection',
	'reportVerification',
] as const;

export const DEFAULT_TYPESAFE_MODEL = 'jev-latest';

export const DEFAULT_TYPESAFE_FEATURES: Readonly<Record<TypeSafeFeature, boolean>> = Object.freeze({
	routing: true,
	triage: true,
	resumeSelection: true,
	reportVerification: true,
});

export function isTypeSafeFeature(value: unknown): value is TypeSafeFeature {
	return (
		value === 'routing' ||
		value === 'triage' ||
		value === 'resumeSelection' ||
		value === 'reportVerification'
	);
}

export function resolveTypeSafeFeatures(
	rawFeatures?: Record<string, unknown> | null,
): Record<TypeSafeFeature, boolean> {
	const result: Record<TypeSafeFeature, boolean> = { ...DEFAULT_TYPESAFE_FEATURES };
	if (rawFeatures && typeof rawFeatures === 'object') {
		for (const key of TYPESAFE_FEATURES) {
			if (typeof rawFeatures[key] === 'boolean') {
				result[key] = rawFeatures[key] as boolean;
			}
		}
	}
	return result;
}

export interface JudgmentCacheTarget {
	readonly store: {
		getJudgment<T = Record<string, unknown>>(
			storageDirectory: string,
			sessionFingerprint: string,
			questionSetVersion: string | number,
		): Promise<{ answers: T; key?: string } | undefined>;
		saveJudgment<T = Record<string, unknown>>(
			storageDirectory: string,
			input: {
				sessionFingerprint: string;
				questionSetVersion: string | number;
				answers: T;
				model?: string;
				usage?: { input_tokens: number; output_tokens: number };
			},
		): Promise<unknown>;
	};
	readonly storageDirectory: string;
	readonly sessionFingerprint: string;
	readonly questionSetVersion: string | number;
}

export interface JudgmentAskOptions {
	readonly feature?: TypeSafeFeature;
	readonly cache?: JudgmentCacheTarget;
}

export type JudgmentAnswers<Q extends Questions> = {
	readonly [K in keyof Q]: ResultFor<Q[K]>;
};

export type Answers<Q extends Questions> = JudgmentAnswers<Q>;

export interface JudgmentService {
	ask<Q extends Questions>(
		state: EntryType,
		questions: Q,
		token?: vscode.CancellationToken,
		options?: JudgmentAskOptions | TypeSafeFeature,
	): Promise<JudgmentAnswers<Q> | undefined>;
	isEnabled(feature?: TypeSafeFeature): boolean;
	isFeatureEnabled(feature: TypeSafeFeature): boolean;
}

export type JudgmentErrorKind =
	| 'unauthorized'
	| 'rate-limited'
	| 'overloaded'
	| 'timeout'
	| 'connection'
	| 'aborted'
	| 'other';

export function mapJudgmentError(error: unknown): JudgmentErrorKind {
	if (error instanceof APIUserAbortError) {
		return 'aborted';
	}
	if (error instanceof AuthenticationError) {
		return 'unauthorized';
	}
	if (error instanceof RateLimitError) {
		return 'rate-limited';
	}
	if (error instanceof InternalServerError) {
		return 'overloaded';
	}
	if (error instanceof APITimeoutError) {
		return 'timeout';
	}
	if (error instanceof APIConnectionError) {
		return 'connection';
	}
	if (error instanceof APIError) {
		if (error.status === 401) {
			return 'unauthorized';
		}
		if (error.status === 429) {
			return 'rate-limited';
		}
		if (error.status === 529 || (error.status >= 500 && error.status < 600)) {
			return 'overloaded';
		}
	}
	if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))) {
		return 'aborted';
	}
	return 'other';
}

export interface TypeSafeClientLike {
	systemOne<const Q extends Questions>(
		request: SystemOneRequest<Q>,
		options?: RequestOptions,
	): Promise<SystemOneResult<Q>>;
}

export interface TypeSafeWorkspaceConfigurationLike {
	get<T>(section: string, defaultValue?: T): T | undefined;
}

export interface TypeSafeJudgmentServiceDeps {
	readonly isEnabled?: (feature?: TypeSafeFeature) => boolean;
	readonly isFeatureEnabled?: (feature: TypeSafeFeature) => boolean;
	readonly getFeatures?: () => Partial<Record<TypeSafeFeature, boolean>> | undefined;
	readonly getApiKey?: () => Promise<string | undefined> | string | undefined;
	readonly secrets?: SecretStorageLike | { get(key: string): Promise<string | undefined> | Thenable<string | undefined> };
	readonly getModel?: () => string | undefined;
	readonly getBaseURL?: () => string | undefined;
	readonly createClient?: (config: TypeSafeClientConfig) => TypeSafeClientLike;
	readonly log?: (message: string) => void;
	readonly outputChannel?: { appendLine(value: string): void };
	readonly now?: () => number;
	readonly onUnauthorized?: () => Promise<void> | void;
	readonly showWarningMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
	readonly executeCommand?: (command: string, ...args: unknown[]) => Thenable<unknown>;
	readonly retry?: Partial<RetryPolicy>;
	readonly timeout?: number;
	readonly getConfiguration?: () => TypeSafeWorkspaceConfigurationLike | undefined;
	/** Requests are only sent once this gate reports recorded consent; defaults to deny. */
	readonly consent?: TypeSafeConsentGate;
	/** Defaults to `session-control.save.stripToolOutput`. */
	readonly getStripToolOutput?: () => boolean;
}

function getVscode(): typeof import('vscode') | undefined {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require('vscode');
	} catch {
		return undefined;
	}
}

function getSessionControlConfiguration(
	deps?: Partial<TypeSafeJudgmentServiceDeps>,
): TypeSafeWorkspaceConfigurationLike | undefined {
	if (deps?.getConfiguration) {
		try {
			return deps.getConfiguration();
		} catch {
			return undefined;
		}
	}
	const vs = getVscode();
	if (vs) {
		try {
			return vs.workspace.getConfiguration('session-control');
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function defaultIsEnabled(deps?: Partial<TypeSafeJudgmentServiceDeps>): boolean {
	if (process.env.SESSION_CONTROL_TYPESAFE_ENABLED === '1' || process.env.SESSION_CONTROL_TYPESAFE_ENABLED === 'true') {
		return true;
	}
	if (process.env.SESSION_CONTROL_TYPESAFE_ENABLED === '0' || process.env.SESSION_CONTROL_TYPESAFE_ENABLED === 'false') {
		return false;
	}
	const config = getSessionControlConfiguration(deps);
	if (config) {
		try {
			return config.get<boolean>('typesafe.enabled', false) ?? false;
		} catch {
			return false;
		}
	}
	return false;
}

function defaultGetModel(deps?: Partial<TypeSafeJudgmentServiceDeps>): string {
	const envModel = process.env.SESSION_CONTROL_TYPESAFE_MODEL;
	if (envModel && envModel.trim().length > 0) {
		return envModel.trim();
	}
	const config = getSessionControlConfiguration(deps);
	if (config) {
		try {
			const model = config.get<string>('typesafe.model', DEFAULT_TYPESAFE_MODEL);
			if (model && model.trim().length > 0) {
				return model.trim();
			}
		} catch {
			// ignore
		}
	}
	return DEFAULT_TYPESAFE_MODEL;
}

function defaultGetStripToolOutput(deps?: Partial<TypeSafeJudgmentServiceDeps>): boolean {
	const config = getSessionControlConfiguration(deps);
	if (config) {
		try {
			return config.get<boolean>('save.stripToolOutput', false) ?? false;
		} catch {
			return false;
		}
	}
	return false;
}

export class TypeSafeJudgmentService implements JudgmentService {
	private readonly deps: TypeSafeJudgmentServiceDeps;
	private _cachedClient: TypeSafeClientLike | undefined;
	private _cachedKey: string | undefined;
	private _cachedBaseURL: string | undefined;
	private _cachedModel: string | undefined;
	private _isRePrompting = false;
	private _activeRePromptPromise: Promise<void> | undefined;

	constructor(deps: Partial<TypeSafeJudgmentServiceDeps> = {}) {
		this.deps = {
			isEnabled: deps.isEnabled ?? (() => defaultIsEnabled(deps)),
			getApiKey: deps.getApiKey ?? (() => resolveTypeSafeApiKey(deps.secrets)),
			getModel: deps.getModel ?? (() => defaultGetModel(deps)),
			getBaseURL: deps.getBaseURL ?? (() => undefined),
			createClient: deps.createClient ?? ((config) => new TypeSafeClient(config)),
			log: deps.log ?? (deps.outputChannel ? (msg) => deps.outputChannel?.appendLine(msg) : console.log),
			now: deps.now ?? Date.now,
			consent: deps.consent ?? DENY_TYPESAFE_CONSENT,
			getStripToolOutput: deps.getStripToolOutput ?? (() => defaultGetStripToolOutput(deps)),
			...(deps.secrets ? { secrets: deps.secrets } : {}),
			...(deps.isFeatureEnabled ? { isFeatureEnabled: deps.isFeatureEnabled } : {}),
			...(deps.getFeatures ? { getFeatures: deps.getFeatures } : {}),
			...(deps.getConfiguration ? { getConfiguration: deps.getConfiguration } : {}),
			...(deps.onUnauthorized ? { onUnauthorized: deps.onUnauthorized } : {}),
			...(deps.showWarningMessage ? { showWarningMessage: deps.showWarningMessage } : {}),
			...(deps.executeCommand ? { executeCommand: deps.executeCommand } : {}),
			...(deps.retry ? { retry: deps.retry } : {}),
			...(deps.timeout !== undefined ? { timeout: deps.timeout } : {}),
		};
	}

	public isEnabled(feature?: TypeSafeFeature): boolean {
		if (feature !== undefined) {
			return this.isFeatureEnabled(feature);
		}
		return this.deps.isEnabled ? this.deps.isEnabled() : false;
	}

	public isFeatureEnabled(feature: TypeSafeFeature): boolean {
		if (!this.isEnabled()) {
			return false;
		}
		if (!isTypeSafeFeature(feature)) {
			return false;
		}
		if (this.deps.isFeatureEnabled) {
			return this.deps.isFeatureEnabled(feature);
		}
		if (this.deps.isEnabled && this.deps.isEnabled.length > 0) {
			return this.deps.isEnabled(feature);
		}
		if (this.deps.getFeatures) {
			const features = this.deps.getFeatures();
			const val = features?.[feature];
			if (typeof val === 'boolean') {
				return val;
			}
		}
		const config = getSessionControlConfiguration(this.deps);
		if (config) {
			try {
				const rawFeatures = config.get<Record<string, unknown>>('typesafe.features');
				if (rawFeatures && typeof rawFeatures === 'object' && typeof rawFeatures[feature] === 'boolean') {
					return rawFeatures[feature] as boolean;
				}
			} catch {
				// ignore
			}
		}
		return DEFAULT_TYPESAFE_FEATURES[feature];
	}

	public get activeRePrompt(): Promise<void> | undefined {
		return this._activeRePromptPromise;
	}

	private log(message: string): void {
		this.deps.log?.(message);
	}

	private getClient(apiKey: string, baseURL?: string, defaultModel?: string): TypeSafeClientLike {
		if (
			this._cachedClient &&
			this._cachedKey === apiKey &&
			this._cachedBaseURL === baseURL &&
			this._cachedModel === defaultModel
		) {
			return this._cachedClient;
		}

		const createClient = this.deps.createClient ?? ((config) => new TypeSafeClient(config));
		const clientConfig: TypeSafeClientConfig = {
			apiKey,
			...(baseURL !== undefined ? { baseURL } : {}),
			...(defaultModel !== undefined ? { defaultModel } : {}),
			...(this.deps.retry !== undefined ? { retry: this.deps.retry } : {}),
			...(this.deps.timeout !== undefined ? { timeout: this.deps.timeout } : {}),
		};

		const client = createClient(clientConfig);
		this._cachedClient = client;
		this._cachedKey = apiKey;
		this._cachedBaseURL = baseURL;
		this._cachedModel = defaultModel;
		return client;
	}

	private triggerKeyRePrompt(): void {
		if (this._isRePrompting) {
			return;
		}
		this._isRePrompting = true;
		const promise = (async () => {
			try {
				if (this.deps.onUnauthorized) {
					await this.deps.onUnauthorized();
					return;
				}

				const vs = getVscode();
				const showWarning = this.deps.showWarningMessage
					?? (vs ? ((msg: string, ...items: string[]) => vs.window.showWarningMessage(msg, ...items)) : undefined);
				const execCmd = this.deps.executeCommand
					?? (vs ? ((cmd: string, ...args: unknown[]) => vs.commands.executeCommand(cmd, ...args)) : undefined);

				if (!showWarning) {
					return;
				}

				const choiceSelected = await showWarning(
					'TypeSafe API key is invalid or unauthorized.',
					'Update API Key',
				);
				if (choiceSelected === 'Update API Key' && execCmd) {
					await execCmd(SET_TYPESAFE_API_KEY_COMMAND);
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				this.log(`[typesafe] key re-prompt handler failed: ${msg}`);
			} finally {
				this._isRePrompting = false;
				this._activeRePromptPromise = undefined;
			}
		})();
		this._activeRePromptPromise = promise;
	}

	public async ask<Q extends Questions>(
		state: EntryType,
		questions: Q,
		token?: vscode.CancellationToken,
		options?: JudgmentAskOptions | TypeSafeFeature,
	): Promise<JudgmentAnswers<Q> | undefined> {
		const feature = typeof options === 'string' ? options : options?.feature;
		const cache = typeof options === 'object' ? options.cache : undefined;
		if (feature !== undefined) {
			if (!this.isFeatureEnabled(feature)) {
				return undefined;
			}
		} else if (!this.isEnabled()) {
			return undefined;
		}

		if (token?.isCancellationRequested) {
			return undefined;
		}

		if (cache) {
			try {
				const cached = await cache.store.getJudgment<JudgmentAnswers<Q>>(
					cache.storageDirectory,
					cache.sessionFingerprint,
					cache.questionSetVersion,
				);
				if (cached) {
					this.log(`[typesafe] cache hit key=${cache.sessionFingerprint}:${cache.questionSetVersion}`);
					return cached.answers;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.log(`[typesafe] cache read error: ${message}`);
			}
		}

		let apiKey: string | undefined;
		try {
			apiKey = this.deps.getApiKey ? await this.deps.getApiKey() : undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`[typesafe] error resolving API key: ${message}`);
			return undefined;
		}

		if (!apiKey) {
			return undefined;
		}

		let consented = false;
		try {
			consented = await (this.deps.consent ?? DENY_TYPESAFE_CONSENT).ensureConsent();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`[typesafe] error checking consent: ${message}`);
		}
		if (!consented || token?.isCancellationRequested) {
			return undefined;
		}

		let payloadState: EntryType = state;
		try {
			if (this.deps.getStripToolOutput?.()) {
				payloadState = stripToolOutputFromState(state);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`[typesafe] error applying stripToolOutput: ${message}`);
			return undefined;
		}

		const baseURL = this.deps.getBaseURL ? this.deps.getBaseURL() : undefined;
		const model = this.deps.getModel ? this.deps.getModel() : undefined;

		let client: TypeSafeClientLike;
		try {
			client = this.getClient(apiKey, baseURL, model);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`[typesafe] error creating client: ${message}`);
			return undefined;
		}

		const controller = new AbortController();
		if (token?.isCancellationRequested) {
			controller.abort();
			return undefined;
		}

		const subscription = token?.onCancellationRequested(() => {
			controller.abort();
		});

		const startTime = (this.deps.now ?? Date.now)();
		try {
			const request: SystemOneRequest<Q> = {
				state: payloadState,
				questions,
				...(model !== undefined ? { model } : {}),
			};
			const options: RequestOptions = {
				signal: controller.signal,
			};
			const result = await client.systemOne(request, options);
			const latencyMs = (this.deps.now ?? Date.now)() - startTime;
			this.log(
				`[typesafe] success model=${result.model} latency=${latencyMs}ms inputTokens=${result.usage.input_tokens} outputTokens=${result.usage.output_tokens}`,
			);
			if (cache) {
				try {
					await cache.store.saveJudgment(cache.storageDirectory, {
						sessionFingerprint: cache.sessionFingerprint,
						questionSetVersion: cache.questionSetVersion,
						answers: result.answers,
						...(result.model !== undefined ? { model: result.model } : {}),
						...(result.usage !== undefined
							? {
									usage: {
										input_tokens: result.usage.input_tokens,
										output_tokens: result.usage.output_tokens,
									},
							  }
							: {}),
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.log(`[typesafe] cache write error: ${message}`);
				}
			}
			return result.answers;
		} catch (error) {
			const latencyMs = (this.deps.now ?? Date.now)() - startTime;
			const kind = mapJudgmentError(error);
			const message = error instanceof Error ? error.message : String(error);
			this.log(`[typesafe] error kind=${kind} latency=${latencyMs}ms message=${message}`);

			if (kind === 'unauthorized') {
				this.triggerKeyRePrompt();
			}

			return undefined;
		} finally {
			subscription?.dispose();
		}
	}
}

export function createJudgmentService(overrides: Partial<TypeSafeJudgmentServiceDeps> = {}): JudgmentService {
	return new TypeSafeJudgmentService(overrides);
}

export interface FakeJudgmentServiceOptions {
	readonly enabled?: boolean;
	readonly features?: Partial<Record<TypeSafeFeature, boolean>>;
	readonly answers?: Record<string, unknown>;
	readonly error?: Error;
	readonly handler?: <Q extends Questions>(
		state: EntryType,
		questions: Q,
		token?: vscode.CancellationToken,
		options?: JudgmentAskOptions | TypeSafeFeature,
	) => Promise<JudgmentAnswers<Q> | undefined> | JudgmentAnswers<Q> | undefined;
}

export interface FakeJudgmentCall {
	readonly state: EntryType;
	readonly questions: Questions;
	readonly token?: vscode.CancellationToken;
	readonly options?: JudgmentAskOptions | TypeSafeFeature;
}

export class FakeJudgmentService implements JudgmentService {
	private _enabled: boolean;
	private _features: Record<TypeSafeFeature, boolean>;
	private _answers: Record<string, unknown> | undefined;
	private _error: Error | undefined;
	private _handler:
		| (<Q extends Questions>(
				state: EntryType,
				questions: Q,
				token?: vscode.CancellationToken,
				options?: JudgmentAskOptions | TypeSafeFeature,
		  ) => Promise<JudgmentAnswers<Q> | undefined> | JudgmentAnswers<Q> | undefined)
		| undefined;
	public readonly calls: FakeJudgmentCall[] = [];

	constructor(options: FakeJudgmentServiceOptions = {}) {
		this._enabled = options.enabled ?? true;
		this._features = resolveTypeSafeFeatures(options.features as Record<string, unknown> | undefined);
		this._answers = options.answers;
		this._error = options.error;
		this._handler = options.handler;
	}

	public isEnabled(feature?: TypeSafeFeature): boolean {
		if (feature !== undefined) {
			return this.isFeatureEnabled(feature);
		}
		return this._enabled;
	}

	public isFeatureEnabled(feature: TypeSafeFeature): boolean {
		if (!this._enabled) {
			return false;
		}
		if (!isTypeSafeFeature(feature)) {
			return false;
		}
		return this._features[feature] ?? true;
	}

	public setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	public setFeatureEnabled(feature: TypeSafeFeature, enabled: boolean): void {
		this._features[feature] = enabled;
	}

	public setFeatures(features: Partial<Record<TypeSafeFeature, boolean>>): void {
		this._features = resolveTypeSafeFeatures(features as Record<string, unknown>);
	}

	public setAnswers(answers: Record<string, unknown> | undefined): void {
		this._answers = answers;
	}

	public setError(error: Error | undefined): void {
		this._error = error;
	}

	public setHandler(
		handler:
			| (<Q extends Questions>(
					state: EntryType,
					questions: Q,
					token?: vscode.CancellationToken,
					options?: JudgmentAskOptions | TypeSafeFeature,
			  ) => Promise<JudgmentAnswers<Q> | undefined> | JudgmentAnswers<Q> | undefined)
			| undefined,
	): void {
		this._handler = handler;
	}

	public clearCalls(): void {
		this.calls.length = 0;
	}

	public async ask<Q extends Questions>(
		state: EntryType,
		questions: Q,
		token?: vscode.CancellationToken,
		options?: JudgmentAskOptions | TypeSafeFeature,
	): Promise<JudgmentAnswers<Q> | undefined> {
		this.calls.push({
			state,
			questions,
			...(token ? { token } : {}),
			...(options !== undefined ? { options } : {}),
		});

		const feature = typeof options === 'string' ? options : options?.feature;
		const cache = typeof options === 'object' ? options.cache : undefined;

		if (feature !== undefined) {
			if (!this.isFeatureEnabled(feature)) {
				return undefined;
			}
		} else if (!this._enabled) {
			return undefined;
		}

		if (token?.isCancellationRequested) {
			return undefined;
		}

		if (cache) {
			try {
				const cached = await cache.store.getJudgment<JudgmentAnswers<Q>>(
					cache.storageDirectory,
					cache.sessionFingerprint,
					cache.questionSetVersion,
				);
				if (cached) {
					return cached.answers;
				}
			} catch {
				// ignore
			}
		}

		if (this._error) {
			return undefined;
		}

		let resultAnswers: JudgmentAnswers<Q> | undefined;
		if (this._handler) {
			resultAnswers = await this._handler(state, questions, token, options);
		} else if (this._answers) {
			resultAnswers = this._answers as JudgmentAnswers<Q>;
		}

		if (resultAnswers !== undefined && cache) {
			try {
				await cache.store.saveJudgment(cache.storageDirectory, {
					sessionFingerprint: cache.sessionFingerprint,
					questionSetVersion: cache.questionSetVersion,
					answers: resultAnswers,
				});
			} catch {
				// ignore
			}
		}

		return resultAnswers;
	}
}

export function createFakeJudgmentService(options: FakeJudgmentServiceOptions = {}): FakeJudgmentService {
	return new FakeJudgmentService(options);
}
