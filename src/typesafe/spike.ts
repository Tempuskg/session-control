import * as vscode from 'vscode';
import {
	APIConnectionError,
	APITimeoutError,
	APIUserAbortError,
	AuthenticationError,
	InternalServerError,
	RateLimitError,
	TypeSafeClient,
	choice,
	type TypeSafeClientConfig,
} from '@typesafe-ai/sdk';

export const TYPESAFE_SPIKE_ENV_VAR = 'SESSION_CONTROL_TYPESAFE_SPIKE';
export const TYPESAFE_SPIKE_COMMAND = 'session-control.devTypeSafeSpike';

/**
 * Outcome buckets for Phase 0 error-mapping evidence (see AGENTS.md TypeSafe plan, card
 * card-mug8ch4z-1): 401 -> unauthorized, 429 -> rate-limited, 529 (and other 5xx) -> overloaded,
 * request timeout -> timeout, DNS/TLS/socket failure -> connection, caller cancellation -> aborted.
 */
export type TypeSafeSpikeErrorKind =
	| 'unauthorized'
	| 'rate-limited'
	| 'overloaded'
	| 'timeout'
	| 'connection'
	| 'aborted'
	| 'other';

export interface TypeSafeSpikeSuccess {
	readonly outcome: 'success';
	readonly model: string;
	readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface TypeSafeSpikeFailure {
	readonly outcome: 'error';
	readonly kind: TypeSafeSpikeErrorKind;
	readonly message: string;
}

export type TypeSafeSpikeResult = TypeSafeSpikeSuccess | TypeSafeSpikeFailure;

export interface TypeSafeSpikeDeps {
	createClient: (config: TypeSafeClientConfig) => TypeSafeClient;
}

const defaultTypeSafeSpikeDeps: TypeSafeSpikeDeps = {
	createClient: (config) => new TypeSafeClient(config),
};

export function isTypeSafeSpikeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[TYPESAFE_SPIKE_ENV_VAR] === '1';
}

// `APITimeoutError` extends `APIConnectionError`, so it must be checked first.
export function mapTypeSafeSpikeError(error: unknown): TypeSafeSpikeErrorKind {
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
	return 'other';
}

export async function runTypeSafeSpike(
	token: vscode.CancellationToken,
	clientConfig: TypeSafeClientConfig,
	overrides: Partial<TypeSafeSpikeDeps> = {},
): Promise<TypeSafeSpikeResult> {
	const deps = { ...defaultTypeSafeSpikeDeps, ...overrides };
	const controller = new AbortController();
	if (token.isCancellationRequested) {
		controller.abort();
	}
	const subscription = token.onCancellationRequested(() => controller.abort());
	try {
		const client = deps.createClient(clientConfig);
		const result = await client.systemOne(
			{
				state: 'Session Control TypeSafe spike: verifying the extension-host integration path.',
				questions: {
					ready: choice('Is this integration path ready to report success?', {
						yes: 'The call reached the model and returned a typed answer.',
						no: 'The call did not behave as expected.',
					}),
				},
			},
			{ signal: controller.signal },
		);
		return {
			outcome: 'success',
			model: result.model,
			usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
		};
	} catch (error) {
		return {
			outcome: 'error',
			kind: mapTypeSafeSpikeError(error),
			message: error instanceof Error ? error.message : String(error),
		};
	} finally {
		subscription.dispose();
	}
}

export interface RunTypeSafeSpikeCommandDeps {
	getApiKey: () => Promise<string | undefined> | string | undefined;
	log: (message: string) => void;
	showInformationMessage: (message: string) => Thenable<string | undefined>;
	showWarningMessage: (message: string) => Thenable<string | undefined>;
	showErrorMessage: (message: string) => Thenable<string | undefined>;
}

export async function runTypeSafeSpikeCommand(deps: RunTypeSafeSpikeCommandDeps): Promise<void> {
	const apiKey = await deps.getApiKey();
	if (!apiKey) {
		deps.log('[typesafe-spike] No TYPESAFE_API_KEY set; aborting spike.');
		await deps.showWarningMessage('Set the TYPESAFE_API_KEY environment variable before running the TypeSafe spike.');
		return;
	}

	const cancellation = new vscode.CancellationTokenSource();
	try {
		const result = await runTypeSafeSpike(cancellation.token, { apiKey });
		if (result.outcome === 'success') {
			deps.log(
				`[typesafe-spike] success model=${result.model} inputTokens=${result.usage.inputTokens} ` +
					`outputTokens=${result.usage.outputTokens} node=${process.version}`,
			);
			await deps.showInformationMessage(`TypeSafe spike succeeded (model ${result.model}).`);
		} else {
			deps.log(`[typesafe-spike] error kind=${result.kind} message=${result.message} node=${process.version}`);
			await deps.showErrorMessage(`TypeSafe spike failed: ${result.kind} - ${result.message}`);
		}
	} finally {
		cancellation.dispose();
	}
}
