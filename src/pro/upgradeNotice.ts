import * as vscode from 'vscode';
import {
	ENTER_PRO_LICENSE_KEY_COMMAND,
	hasProLicense as defaultHasProLicense,
	PRO_ACTIVATE_PROMPT_LABEL,
	PRO_PURCHASE_URL,
	PRO_UPGRADE_PROMPT_LABEL,
} from './upgrade';

// `shown` is the one-time latch: once it is true the notice is spent for good, on
// every window and every workspace, and nothing in this module ever clears it.
export const PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY = 'session-control.pro.upgradeNotice.shown';
// Counts sessions the user saved on purpose. The notice is earned by real usage,
// so it stays silent until this reaches the threshold, and it is only ever checked
// right after a save — never on activation.
export const PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY = 'session-control.pro.upgradeNotice.savedSessionCount';
export const PRO_UPGRADE_NOTICE_SAVE_THRESHOLD = 3;

// Lead with the benefit, name the Pro capabilities, and reassure users that free
// features stay free. Keep the copy brief enough for a VS Code notification.
export const PRO_UPGRADE_NOTICE_MESSAGE =
	'Stop solving the same problem twice. Get Session Control Pro to search saved chats '
	+ 'across workspaces and turn past solutions into reusable knowledge for your team '
	+ 'and AI tools. Your free features stay free.';

export type ProUpgradeNoticeOutcome =
	/** The notice was already spent on an earlier activation. */
	| 'already-shown'
	/** The user is licensed, so the notice is retired without ever being shown. */
	| 'suppressed-licensed'
	/** Not enough saved sessions yet; the notice may show after a later save. */
	| 'below-threshold'
	/** The notice was displayed, and is now spent. */
	| 'shown';

export interface ShowProUpgradeNoticeDeps {
	hasProLicense: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<boolean>;
	showInformationMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
	openExternal: (target: vscode.Uri) => Thenable<boolean>;
	parseUri: (value: string) => vscode.Uri;
	executeCommand: (command: string) => Thenable<unknown>;
	upgradeUrl: string;
	saveThreshold: number;
}

function readSaveCount(state: vscode.Memento): number {
	const stored = state.get<number>(PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY);
	// A missing or corrupt count starts from zero rather than blocking the notice.
	return typeof stored === 'number' && Number.isInteger(stored) && stored > 0 ? stored : 0;
}

/**
 * Record one user-initiated session save toward the notice's usage threshold. Once the
 * notice is spent the count is no longer maintained.
 */
export async function recordProUpgradeNoticeSave(context: vscode.ExtensionContext): Promise<number> {
	const state = context.globalState;
	if (state.get<boolean>(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY) === true) {
		return readSaveCount(state);
	}

	const next = readSaveCount(state) + 1;
	await state.update(PRO_UPGRADE_NOTICE_SAVE_COUNT_STATE_KEY, next);
	return next;
}

/**
 * Show the Pro upgrade notice at most once per installation, and never again after
 * the user has seen it — whether they acted on it, dismissed it, or ignored it.
 * State lives in globalState, so the latch is shared by every workspace and window.
 * Call this only after a save, never from activation.
 */
export async function maybeShowProUpgradeNotice(
	context: vscode.ExtensionContext,
	workspaceFolder?: vscode.WorkspaceFolder,
	deps: Partial<ShowProUpgradeNoticeDeps> = {},
): Promise<ProUpgradeNoticeOutcome> {
	const state = context.globalState;
	if (state.get<boolean>(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY) === true) {
		return 'already-shown';
	}

	const checkProLicense = deps.hasProLicense ?? defaultHasProLicense;
	const showInformationMessage = deps.showInformationMessage
		?? ((message: string, ...items: string[]) => vscode.window.showInformationMessage(message, ...items));
	const openExternal = deps.openExternal ?? ((target: vscode.Uri) => vscode.env.openExternal(target));
	const parseUri = deps.parseUri ?? ((value: string) => vscode.Uri.parse(value));
	const executeCommand = deps.executeCommand
		?? ((command: string) => vscode.commands.executeCommand(command));
	const upgradeUrl = deps.upgradeUrl ?? PRO_PURCHASE_URL;
	const saveThreshold = deps.saveThreshold ?? PRO_UPGRADE_NOTICE_SAVE_THRESHOLD;

	// Check usage before the license so an early save does not trigger license work.
	if (readSaveCount(state) < saveThreshold) {
		return 'below-threshold';
	}

	if (await checkProLicense(workspaceFolder)) {
		// Nothing to upsell. Spend the notice so it cannot surface later if the
		// license lapses or validation is offline.
		await state.update(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY, true);
		return 'suppressed-licensed';
	}

	// Spend the notice before it is displayed. Whatever happens next — the user picks
	// an action, closes the notification, ignores it until it auto-hides, or the window
	// reloads mid-prompt — this activation was its only appearance.
	await state.update(PRO_UPGRADE_NOTICE_SHOWN_STATE_KEY, true);

	const selection = await showInformationMessage(
		PRO_UPGRADE_NOTICE_MESSAGE,
		PRO_UPGRADE_PROMPT_LABEL,
		PRO_ACTIVATE_PROMPT_LABEL,
	);

	if (selection === PRO_UPGRADE_PROMPT_LABEL) {
		await openExternal(parseUri(upgradeUrl));
	} else if (selection === PRO_ACTIVATE_PROMPT_LABEL) {
		await executeCommand(ENTER_PRO_LICENSE_KEY_COMMAND);
	}

	return 'shown';
}
