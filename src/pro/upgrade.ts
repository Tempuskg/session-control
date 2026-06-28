import * as vscode from 'vscode';
import { createProLicenseManager, type ProLicenseManager, type ProLicenseManagerDeps } from './licenseManager';

export const DEFAULT_PRO_UPGRADE_URL = 'https://github.com/tempuskg/session-control';
export const PRO_UPGRADE_PROMPT_LABEL = 'Learn More';
export const PRO_ACTIVATE_PROMPT_LABEL = 'Enter License Key';
export const ENTER_PRO_LICENSE_KEY_COMMAND = 'session-control.enterProLicenseKey';
export const CLEAR_PRO_LICENSE_KEY_COMMAND = 'session-control.clearProLicenseKey';
export const SHOW_PRO_LICENSE_STATUS_COMMAND = 'session-control.showProLicenseStatus';

interface ShowUpgradePromptDeps {
	showInformationMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
	openExternal: (target: vscode.Uri) => Thenable<boolean>;
	parseUri: (value: string) => vscode.Uri;
	upgradeUrl: string;
}

let activeLicenseManager: ProLicenseManager | undefined;

function getImplicitWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
		if (workspaceFolder) {
			return workspaceFolder;
		}
	}

	return vscode.workspace.workspaceFolders?.[0];
}

export function initializeProLicenseCommands(
	context: vscode.ExtensionContext,
	deps: Partial<ProLicenseManagerDeps> = {},
): readonly vscode.Disposable[] {
	activeLicenseManager = createProLicenseManager({
		context,
		...deps,
	});

	return [
		vscode.commands.registerCommand(ENTER_PRO_LICENSE_KEY_COMMAND, async () => {
			await activeLicenseManager?.promptEnterKey(getImplicitWorkspaceFolder());
		}),
		vscode.commands.registerCommand(CLEAR_PRO_LICENSE_KEY_COMMAND, async () => {
			const confirmation = await vscode.window.showWarningMessage(
				'Clear your Session Control Pro license key?',
				{ modal: true },
				'Clear',
			);
			if (confirmation === 'Clear') {
				await activeLicenseManager?.clearKey();
				await vscode.window.showInformationMessage('Session Control Pro license key cleared.');
			}
		}),
		vscode.commands.registerCommand(SHOW_PRO_LICENSE_STATUS_COMMAND, async () => {
			await activeLicenseManager?.showLicenseStatus(getImplicitWorkspaceFolder());
		}),
	];
}

export async function hasProLicense(workspaceFolder?: vscode.WorkspaceFolder): Promise<boolean> {
	return activeLicenseManager?.hasProLicense(workspaceFolder) ?? false;
}

export async function showUpgradePrompt(
	workspaceFolder?: vscode.WorkspaceFolder,
	deps: Partial<ShowUpgradePromptDeps> = {},
): Promise<void> {
	const showInformationMessage = deps.showInformationMessage
		?? ((message: string, ...items: string[]) => vscode.window.showInformationMessage(message, ...items));
	const openExternal = deps.openExternal ?? ((target: vscode.Uri) => vscode.env.openExternal(target));
	const parseUri = deps.parseUri ?? ((value: string) => vscode.Uri.parse(value));
	const upgradeUrl = deps.upgradeUrl ?? DEFAULT_PRO_UPGRADE_URL;

	const selection = await showInformationMessage(
		'Session Control Pro is not activated yet. Enter your license key to unlock paid features, or learn more.',
		PRO_ACTIVATE_PROMPT_LABEL,
		PRO_UPGRADE_PROMPT_LABEL,
	);

	if (selection === PRO_ACTIVATE_PROMPT_LABEL) {
		if (activeLicenseManager) {
			await activeLicenseManager.promptEnterKey(workspaceFolder);
			return;
		}
		await vscode.commands.executeCommand(ENTER_PRO_LICENSE_KEY_COMMAND);
		return;
	}

	if (selection === PRO_UPGRADE_PROMPT_LABEL) {
		await openExternal(parseUri(upgradeUrl));
	}
}
