import * as vscode from 'vscode';

const DEFAULT_POLAR_API_BASE_URL = 'https://api.polar.sh';
const DEFAULT_POLAR_ORGANIZATION_ID = '9a3f3f03-1384-425b-8a7a-54866b7d634a';
const POLAR_VALIDATE_PATH = '/v1/customer-portal/license-keys/validate';
const SECRETS_KEY = 'session-control.pro.licenseKey';
const CACHE_STATE_KEY = 'session-control.pro.licenseCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface LicenseCache {
	valid: boolean;
	expiresAt: number;
}

function isLicenseCache(value: unknown): value is LicenseCache {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	return typeof record.valid === 'boolean' && typeof record.expiresAt === 'number';
}

function isPolarLegacyValidResponse(value: unknown): value is { valid: boolean } {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	return typeof (value as Record<string, unknown>).valid === 'boolean';
}

function isPolarValidatedLicenseKey(
	value: unknown,
): value is { status: 'granted' | 'revoked' | 'disabled' } {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const status = (value as Record<string, unknown>).status;
	return status === 'granted' || status === 'revoked' || status === 'disabled';
}

export interface ProLicenseManagerDeps {
	context: vscode.ExtensionContext;
	fetch?: typeof globalThis.fetch;
	getConfiguration?: (workspaceFolder?: vscode.WorkspaceFolder) => vscode.WorkspaceConfiguration;
}

export interface ProLicenseManager {
	hasProLicense: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<boolean>;
	promptEnterKey: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<boolean>;
	clearKey: () => Promise<void>;
	showLicenseStatus: (workspaceFolder?: vscode.WorkspaceFolder) => Promise<void>;
}

export function createProLicenseManager(deps: ProLicenseManagerDeps): ProLicenseManager {
	const fetcher = deps.fetch ?? globalThis.fetch;
	const getConfiguration = deps.getConfiguration
		?? ((workspaceFolder?: vscode.WorkspaceFolder) => vscode.workspace.getConfiguration(
			'session-control',
			workspaceFolder?.uri,
		));

	function getOrganizationId(workspaceFolder?: vscode.WorkspaceFolder): string {
		return getConfiguration(workspaceFolder)
			.get<string>('pro.polar.organizationId', DEFAULT_POLAR_ORGANIZATION_ID)
			.trim();
	}

	function getPolarApiBaseUrl(workspaceFolder?: vscode.WorkspaceFolder): string {
		const configured = getConfiguration(workspaceFolder)
			.get<string>('pro.polar.apiBaseUrl', DEFAULT_POLAR_API_BASE_URL)
			.trim();
		return configured ? configured.replace(/\/+$/, '') : DEFAULT_POLAR_API_BASE_URL;
	}

	function getValidateUrl(workspaceFolder?: vscode.WorkspaceFolder): string {
		return `${getPolarApiBaseUrl(workspaceFolder)}${POLAR_VALIDATE_PATH}`;
	}

	async function storeCache(valid: boolean): Promise<void> {
		const cache: LicenseCache = {
			valid,
			expiresAt: Date.now() + CACHE_TTL_MS,
		};
		await deps.context.globalState.update(CACHE_STATE_KEY, cache);
	}

	async function validateLicenseKey(
		key: string,
		workspaceFolder?: vscode.WorkspaceFolder,
	): Promise<boolean> {
		const organizationId = getOrganizationId(workspaceFolder);
		if (!organizationId) {
			return false;
		}

		try {
			const response = await fetcher(getValidateUrl(workspaceFolder), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					key,
					organization_id: organizationId,
				}),
			});

			if (!response.ok) {
				return false;
			}

			const data: unknown = await response.json();
			if (isPolarLegacyValidResponse(data)) {
				return data.valid;
			}

			return isPolarValidatedLicenseKey(data) ? data.status === 'granted' : false;
		} catch {
			return false;
		}
	}

	async function readFreshCachedValidity(): Promise<boolean | undefined> {
		const cached: unknown = deps.context.globalState.get(CACHE_STATE_KEY);
		if (!isLicenseCache(cached)) {
			return undefined;
		}

		if (cached.expiresAt <= Date.now()) {
			return undefined;
		}

		return cached.valid;
	}

	return {
		async hasProLicense(workspaceFolder?: vscode.WorkspaceFolder): Promise<boolean> {
			const key = await deps.context.secrets.get(SECRETS_KEY);
			if (!key) {
				return false;
			}

			const cached = await readFreshCachedValidity();
			if (cached !== undefined) {
				return cached;
			}

			const valid = await validateLicenseKey(key, workspaceFolder);
			await storeCache(valid);
			return valid;
		},

		async promptEnterKey(workspaceFolder?: vscode.WorkspaceFolder): Promise<boolean> {
			const key = await vscode.window.showInputBox({
				title: 'Session Control Pro - Enter License Key',
				placeHolder: 'XXXX-XXXX-XXXX-XXXX',
				ignoreFocusOut: true,
				password: true,
			});
			if (!key) {
				return false;
			}

			await deps.context.secrets.store(SECRETS_KEY, key);
			const valid = await validateLicenseKey(key, workspaceFolder);
			await storeCache(valid);

			if (valid) {
				void vscode.window.showInformationMessage('Session Control Pro license activated.');
			} else if (!getOrganizationId(workspaceFolder)) {
				void vscode.window.showErrorMessage(
					'Session Control Pro licensing is not configured. Set session-control.pro.polar.organizationId first.',
				);
			} else {
				void vscode.window.showErrorMessage(
					'License key not recognized. Check your Polar account or sandbox settings.',
				);
			}

			return valid;
		},

		async clearKey(): Promise<void> {
			await deps.context.secrets.delete(SECRETS_KEY);
			await deps.context.globalState.update(CACHE_STATE_KEY, undefined);
		},

		async showLicenseStatus(workspaceFolder?: vscode.WorkspaceFolder): Promise<void> {
			if (!getOrganizationId(workspaceFolder)) {
				await vscode.window.showInformationMessage(
					'Session Control Pro is not configured. Set session-control.pro.polar.organizationId to enable license validation.',
				);
				return;
			}

			const valid = await this.hasProLicense(workspaceFolder);
			await vscode.window.showInformationMessage(
				valid
					? 'Session Control Pro is active.'
					: 'Session Control Pro is not activated. Use "Enter Pro License Key" to activate.',
			);
		},
	};
}
