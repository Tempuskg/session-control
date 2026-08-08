import * as vscode from 'vscode';
import { createProLicenseManager, type ProLicenseManager, type ProLicenseManagerDeps } from './licenseManager';

// The landing page carries the checkout links, so every in-editor purchase
// surface points here rather than at the source repository.
export const PRO_PURCHASE_URL = 'https://sessioncontrol.dev/#pro';
export const PRO_UPGRADE_PROMPT_LABEL = 'Get Pro';
export const PRO_ACTIVATE_PROMPT_LABEL = 'Enter License Key';
export const ENTER_PRO_LICENSE_KEY_COMMAND = 'session-control.enterProLicenseKey';
export const CLEAR_PRO_LICENSE_KEY_COMMAND = 'session-control.clearProLicenseKey';
export const SHOW_PRO_LICENSE_STATUS_COMMAND = 'session-control.showProLicenseStatus';
export const UPGRADE_TO_PRO_COMMAND = 'session-control.upgradeToPro';
// Menu `when` clauses read this; it stays false until a key validates.
export const PRO_LICENSE_CONTEXT_KEY = 'session-control.hasProLicense';

interface ShowUpgradePromptDeps {
	showInformationMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
	openExternal: (target: vscode.Uri) => Thenable<boolean>;
	parseUri: (value: string) => vscode.Uri;
	upgradeUrl: string;
}

interface OpenProPurchasePageDeps {
	openExternal: (target: vscode.Uri) => Thenable<boolean>;
	parseUri: (value: string) => vscode.Uri;
	purchaseUrl: string;
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

export async function openProPurchasePage(
	deps: Partial<OpenProPurchasePageDeps> = {},
): Promise<void> {
	const openExternal = deps.openExternal ?? ((target: vscode.Uri) => vscode.env.openExternal(target));
	const parseUri = deps.parseUri ?? ((value: string) => vscode.Uri.parse(value));
	await openExternal(parseUri(deps.purchaseUrl ?? PRO_PURCHASE_URL));
}

async function publishProLicenseContext(licensed: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', PRO_LICENSE_CONTEXT_KEY, licensed);
}

export function initializeProLicenseCommands(
	context: vscode.ExtensionContext,
	deps: Partial<ProLicenseManagerDeps> = {},
): readonly vscode.Disposable[] {
	activeLicenseManager = createProLicenseManager({
		context,
		...deps,
	});

	// Seed the context key so purchase menus are correct on the first palette open.
	void hasProLicense(getImplicitWorkspaceFolder());

	return [
		vscode.commands.registerCommand(UPGRADE_TO_PRO_COMMAND, async () => {
			await openProPurchasePage();
		}),
		vscode.commands.registerCommand(ENTER_PRO_LICENSE_KEY_COMMAND, async () => {
			await activeLicenseManager?.promptEnterKey(getImplicitWorkspaceFolder());
			await hasProLicense(getImplicitWorkspaceFolder());
		}),
		vscode.commands.registerCommand(CLEAR_PRO_LICENSE_KEY_COMMAND, async () => {
			const confirmation = await vscode.window.showWarningMessage(
				'Clear your Session Control Pro license key?',
				{ modal: true },
				'Clear',
			);
			if (confirmation === 'Clear') {
				await activeLicenseManager?.clearKey();
				await publishProLicenseContext(false);
				await vscode.window.showInformationMessage('Session Control Pro license key cleared.');
			}
		}),
		vscode.commands.registerCommand(SHOW_PRO_LICENSE_STATUS_COMMAND, async () => {
			await activeLicenseManager?.showLicenseStatus(getImplicitWorkspaceFolder());
		}),
	];
}

export async function hasProLicense(workspaceFolder?: vscode.WorkspaceFolder): Promise<boolean> {
	const licensed = await (activeLicenseManager?.hasProLicense(workspaceFolder) ?? Promise.resolve(false));
	await publishProLicenseContext(licensed);
	return licensed;
}

export async function showUpgradePrompt(
	workspaceFolder?: vscode.WorkspaceFolder,
	deps: Partial<ShowUpgradePromptDeps> = {},
): Promise<void> {
	const showInformationMessage = deps.showInformationMessage
		?? ((message: string, ...items: string[]) => vscode.window.showInformationMessage(message, ...items));
	const openExternal = deps.openExternal ?? ((target: vscode.Uri) => vscode.env.openExternal(target));
	const parseUri = deps.parseUri ?? ((value: string) => vscode.Uri.parse(value));
	const upgradeUrl = deps.upgradeUrl ?? PRO_PURCHASE_URL;

	const selection = await showInformationMessage(
		'Session Control Pro is not activated yet. Enter your license key to unlock paid features, or get Pro.',
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
