import * as vscode from 'vscode';

export const TYPESAFE_API_KEY_SECRET = 'session-control.typesafe.apiKey';
export const TYPESAFE_API_KEY_ENV_VAR = 'TYPESAFE_API_KEY';
export const SET_TYPESAFE_API_KEY_COMMAND = 'session-control.setTypeSafeApiKey';
export const CLEAR_TYPESAFE_API_KEY_COMMAND = 'session-control.clearTypeSafeApiKey';

export interface SecretStorageLike {
	get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
	store(key: string, value: string): Thenable<void> | Promise<void>;
	delete(key: string): Thenable<void> | Promise<void>;
}

/**
 * Resolves the TypeSafe API key following the documented resolution order:
 * 1. VS Code SecretStorage (`session-control.typesafe.apiKey`)
 * 2. Environment variable (`TYPESAFE_API_KEY`)
 *
 * Keys are never written to settings, configuration, or logs.
 */
export async function resolveTypeSafeApiKey(
	secrets?: SecretStorageLike | { get(key: string): Promise<string | undefined> | Thenable<string | undefined> },
	env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	if (secrets) {
		try {
			const secretKey = await secrets.get(TYPESAFE_API_KEY_SECRET);
			if (typeof secretKey === 'string' && secretKey.trim().length > 0) {
				return secretKey.trim();
			}
		} catch {
			// Gracefully fall back to env var if secret retrieval fails
		}
	}

	const envKey = env[TYPESAFE_API_KEY_ENV_VAR];
	if (typeof envKey === 'string' && envKey.trim().length > 0) {
		return envKey.trim();
	}

	return undefined;
}

export interface TypeSafeApiKeyDeps {
	readonly secrets: SecretStorageLike;
	readonly showInputBox?: (options: vscode.InputBoxOptions) => Thenable<string | undefined>;
	readonly showInformationMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
	readonly showWarningMessage?: (
		message: string,
		options?: vscode.MessageOptions | string,
		...items: string[]
	) => Thenable<string | undefined>;
}

export interface ClearTypeSafeApiKeyOptions {
	readonly skipConfirmation?: boolean;
}

export interface RegisterTypeSafeApiKeyCommandsDeps extends Partial<TypeSafeApiKeyDeps> {
	registerCommand?: typeof vscode.commands.registerCommand;
}

/**
 * Prompts the user to enter their TypeSafe API key securely via an input box
 * with masked input (`password: true`), and stores it in SecretStorage.
 * The key is never logged or written to settings.
 */
export async function setTypeSafeApiKey(deps: TypeSafeApiKeyDeps): Promise<boolean> {
	const showInputBox = deps.showInputBox ?? vscode.window.showInputBox;
	const showInfo = deps.showInformationMessage ?? vscode.window.showInformationMessage;

	const key = await showInputBox({
		title: 'Session Control - Set TypeSafe API Key',
		prompt: 'Enter your TypeSafe API key (stored securely in VS Code SecretStorage)',
		placeHolder: 'ts_live_...',
		ignoreFocusOut: true,
		password: true,
	});

	if (key === undefined) {
		return false;
	}

	const trimmed = key.trim();
	if (trimmed.length === 0) {
		const showWarn = deps.showWarningMessage ?? vscode.window.showWarningMessage;
		await showWarn('No TypeSafe API key was entered. Stored key was not changed.');
		return false;
	}

	await deps.secrets.store(TYPESAFE_API_KEY_SECRET, trimmed);
	void showInfo('TypeSafe API key saved.');
	return true;
}

/**
 * Clears the stored TypeSafe API key from SecretStorage after confirmation.
 * The key is never logged or written to settings.
 */
export async function clearTypeSafeApiKey(
	deps: TypeSafeApiKeyDeps,
	options?: ClearTypeSafeApiKeyOptions,
): Promise<boolean> {
	const showWarn = deps.showWarningMessage ?? vscode.window.showWarningMessage;
	const showInfo = deps.showInformationMessage ?? vscode.window.showInformationMessage;

	if (!options?.skipConfirmation) {
		const confirmation = await showWarn(
			'Clear your stored TypeSafe API key?',
			{ modal: true },
			'Clear',
		);
		if (confirmation !== 'Clear') {
			return false;
		}
	}

	await deps.secrets.delete(TYPESAFE_API_KEY_SECRET);
	void showInfo('TypeSafe API key cleared.');
	return true;
}

/**
 * Registers `session-control.setTypeSafeApiKey` and `session-control.clearTypeSafeApiKey` commands.
 */
export function registerTypeSafeApiKeyCommands(
	context: vscode.ExtensionContext,
	deps?: RegisterTypeSafeApiKeyCommandsDeps,
): readonly vscode.Disposable[] {
	const registerCommand = deps?.registerCommand ?? vscode.commands.registerCommand;
	const apiKeyDeps: TypeSafeApiKeyDeps = {
		secrets: deps?.secrets ?? context.secrets,
		...(deps?.showInputBox ? { showInputBox: deps.showInputBox } : {}),
		...(deps?.showInformationMessage ? { showInformationMessage: deps.showInformationMessage } : {}),
		...(deps?.showWarningMessage ? { showWarningMessage: deps.showWarningMessage } : {}),
	};

	return [
		registerCommand(SET_TYPESAFE_API_KEY_COMMAND, async () => {
			await setTypeSafeApiKey(apiKeyDeps);
		}),
		registerCommand(CLEAR_TYPESAFE_API_KEY_COMMAND, async () => {
			await clearTypeSafeApiKey(apiKeyDeps);
		}),
	];
}
