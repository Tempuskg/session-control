import type { EntryType } from '@typesafe-ai/sdk';
import type * as vscode from 'vscode';

import { replaceToolOutput } from '../sessionWriter';

export const TYPESAFE_CONSENT_STATE_KEY = 'session-control.typesafe.consent';
export const TYPESAFE_CONSENT_VERSION = 1;
export const TYPESAFE_CONSENT_ACCEPT = 'Allow TypeSafe';
export const TYPESAFE_CONSENT_DECLINE = 'Not Now';

export const TYPESAFE_CONSENT_MESSAGE = 'Allow Session Control to send session content to TypeSafe?';
export const TYPESAFE_CONSENT_DETAIL = [
	'TypeSafe features (routing, triage, resume selection, report verification) send the relevant session content to api.typesafe.ai for a judgment:',
	'- chat prompts and responses from the session being routed, triaged, resumed, or verified',
	'- session titles, provider names, and saved analysis report text',
	'- tool call names and arguments; tool output is replaced with a length marker when "session-control.save.stripToolOutput" is enabled',
	'',
	'Your API key stays in VS Code SecretStorage. If you choose "Not Now", every feature keeps its existing non-TypeSafe behavior and you will be asked again next session.',
].join('\n');

/** Persisted record of the user's acceptance. */
export interface TypeSafeConsentRecord {
	readonly version: number;
	readonly acceptedAt: string;
}

export interface MementoLike {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** Gate consulted by the judgment service before any network request. */
export interface TypeSafeConsentGate {
	hasConsent(): boolean;
	/** Resolves true only when consent is (or becomes) recorded; may prompt the user once. */
	ensureConsent(): Promise<boolean>;
}

export interface GlobalStateConsentGateDeps {
	readonly globalState: MementoLike;
	readonly showConsentPrompt: (message: string, detail: string, accept: string, decline: string) => Thenable<string | undefined> | Promise<string | undefined>;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

function isConsentRecord(value: unknown): value is TypeSafeConsentRecord {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { version?: unknown }).version === TYPESAFE_CONSENT_VERSION &&
		typeof (value as { acceptedAt?: unknown }).acceptedAt === 'string'
	);
}

/**
 * Consent gate backed by `ExtensionContext.globalState`. Acceptance is persisted;
 * a decline only suppresses the prompt for the rest of the current session.
 */
export class GlobalStateConsentGate implements TypeSafeConsentGate {
	private declinedThisSession = false;
	private pendingPrompt: Promise<boolean> | undefined;

	constructor(private readonly deps: GlobalStateConsentGateDeps) {}

	public hasConsent(): boolean {
		try {
			return isConsentRecord(this.deps.globalState.get<unknown>(TYPESAFE_CONSENT_STATE_KEY));
		} catch {
			return false;
		}
	}

	public ensureConsent(): Promise<boolean> {
		if (this.hasConsent()) {
			return Promise.resolve(true);
		}
		if (this.declinedThisSession) {
			return Promise.resolve(false);
		}
		// Concurrent callers share one prompt instead of stacking modals.
		this.pendingPrompt ??= this.prompt().finally(() => {
			this.pendingPrompt = undefined;
		});
		return this.pendingPrompt;
	}

	public async reset(): Promise<void> {
		this.declinedThisSession = false;
		await this.deps.globalState.update(TYPESAFE_CONSENT_STATE_KEY, undefined);
	}

	private async prompt(): Promise<boolean> {
		let selection: string | undefined;
		try {
			selection = await this.deps.showConsentPrompt(
				TYPESAFE_CONSENT_MESSAGE,
				TYPESAFE_CONSENT_DETAIL,
				TYPESAFE_CONSENT_ACCEPT,
				TYPESAFE_CONSENT_DECLINE,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.deps.log?.(`[typesafe] consent prompt failed: ${message}`);
			return false;
		}

		if (selection !== TYPESAFE_CONSENT_ACCEPT) {
			this.declinedThisSession = true;
			this.deps.log?.('[typesafe] consent declined; TypeSafe features stay on fallback behavior');
			return false;
		}

		const record: TypeSafeConsentRecord = {
			version: TYPESAFE_CONSENT_VERSION,
			acceptedAt: new Date((this.deps.now ?? Date.now)()).toISOString(),
		};
		try {
			await this.deps.globalState.update(TYPESAFE_CONSENT_STATE_KEY, record);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.deps.log?.(`[typesafe] failed to record consent: ${message}`);
			return false;
		}
		this.deps.log?.('[typesafe] consent recorded');
		return true;
	}
}

export function createGlobalStateConsentGate(deps: GlobalStateConsentGateDeps): GlobalStateConsentGate {
	return new GlobalStateConsentGate(deps);
}

/** Builds the extension-host gate: a modal prompt whose acceptance lives in `context.globalState`. */
export function createExtensionConsentGate(
	context: Pick<vscode.ExtensionContext, 'globalState'>,
	window: Pick<typeof vscode.window, 'showInformationMessage'>,
	log?: (message: string) => void,
): GlobalStateConsentGate {
	return new GlobalStateConsentGate({
		globalState: context.globalState,
		showConsentPrompt: (message, detail, accept, decline) =>
			window.showInformationMessage(message, { modal: true, detail }, accept, decline),
		...(log ? { log } : {}),
	});
}

/** A gate that never grants consent; the judgment service uses it when none is supplied. */
export const DENY_TYPESAFE_CONSENT: TypeSafeConsentGate = Object.freeze({
	hasConsent: () => false,
	ensureConsent: () => Promise.resolve(false),
});

type JsonLike = EntryType | number | boolean;

/**
 * Applies the `save.stripToolOutput` privacy path to a TypeSafe state payload: every
 * `output` string inside a `toolCalls` array is replaced with the same length marker
 * used when saving sessions.
 */
export function stripToolOutputFromState(state: EntryType): EntryType {
	return stripValue(state) as EntryType;
}

function stripValue(value: JsonLike): JsonLike {
	if (Array.isArray(value)) {
		return value.map((item) => stripValue(item as JsonLike)) as EntryType;
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}

	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === 'toolCalls' && Array.isArray(child)) {
			result[key] = child.map((toolCall) => stripToolCall(toolCall));
		} else {
			result[key] = stripValue(child as JsonLike);
		}
	}
	return result as EntryType;
}

function stripToolCall(toolCall: unknown): unknown {
	if (toolCall === null || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
		return stripValue(toolCall as JsonLike);
	}
	const { output, ...rest } = toolCall as Record<string, unknown>;
	const stripped = stripValue(rest as EntryType) as Record<string, unknown>;
	if (typeof output === 'string') {
		const replaced = replaceToolOutput(output);
		if (replaced !== undefined) {
			stripped.output = replaced;
		}
	} else if (output !== undefined) {
		stripped.output = '[output stripped]';
	}
	return stripped;
}
