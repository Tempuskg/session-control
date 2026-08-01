export type AutoSaveSourceId =
	| 'copilot-vscode'
	| 'copilot-cli'
	| 'codex-cli'
	| 'claude-code-cli'
	| 'cursor-cli'
	| 'cursor-vscode-legacy';

export type AutoSaveSourceEventKind = 'create' | 'change';
export type AutoSaveSourceHealth = 'healthy' | 'degraded';
export type AutoSaveDiagnosticProvider =
	| 'copilot'
	| 'codex'
	| 'claude-code'
	| 'cursor';

export type AutoSaveSourceValidationStatus = 'validated' | 'rejected' | 'unsupported';
export type AutoSaveWorkspaceMode = 'single-root' | 'multi-root' | 'no-workspace';
export type AutoSaveHostKind = 'local' | 'remote';
export type AutoSaveWorkspaceProfileKind = 'default' | 'profile' | 'unknown';

export interface AutoSaveSourceValidationDiagnostic {
	status: AutoSaveSourceValidationStatus;
	reason: string;
	workspaceMode: AutoSaveWorkspaceMode;
	hostKind: AutoSaveHostKind;
	profileKind: AutoSaveWorkspaceProfileKind;
	supportedFormats: readonly string[];
	workspaceStorePath?: string;
}

export interface AutoSaveEventDiagnostic {
	at: string;
	kind: AutoSaveSourceEventKind;
	sourcePath?: string;
}

export interface AutoSaveScanDiagnostic {
	at: string;
	candidateCount?: number;
}

export interface AutoSaveSuccessDiagnostic {
	at: string;
	sourceSessionId: string;
	fileNames: readonly string[];
}

export interface AutoSaveSkipDiagnostic {
	at: string;
	reason: string;
}

export interface AutoSaveErrorDiagnostic {
	at: string;
	message: string;
}

export interface AutoSaveRetryDiagnostic {
	at: string;
	attempt: number;
	delayMs: number;
}

export interface AutoSaveSourceDiagnostic {
	sourceId: AutoSaveSourceId;
	resolvedPath: string;
	pathExists: boolean;
	health: AutoSaveSourceHealth;
	disabled: boolean;
	warningShown: boolean;
	validation?: AutoSaveSourceValidationDiagnostic;
	lastScan?: AutoSaveScanDiagnostic;
	lastEvent?: AutoSaveEventDiagnostic;
	lastSuccess?: AutoSaveSuccessDiagnostic;
	skipReason?: AutoSaveSkipDiagnostic;
	lastError?: AutoSaveErrorDiagnostic;
	lastRetry?: AutoSaveRetryDiagnostic;
}

export interface AutoSaveDiagnosticState {
	registerSource: (
		sourceId: AutoSaveSourceId,
		resolvedPath: string,
		pathExists: boolean,
		validation?: AutoSaveSourceValidationDiagnostic,
	) => void;
	recordEvent: (
		sourceId: AutoSaveSourceId,
		kind: AutoSaveSourceEventKind,
		sourcePath?: string,
	) => void;
	recordScan: (sourceId: AutoSaveSourceId, candidateCount?: number) => void;
	recordSuccess: (
		sourceId: AutoSaveSourceId,
		sourceSessionId: string,
		fileNames: readonly string[],
	) => void;
	recordSkip: (sourceId: AutoSaveSourceId, reason: string) => void;
	recordError: (sourceId: AutoSaveSourceId, error: unknown) => void;
	recordFailure: (
		sourceId: AutoSaveSourceId,
		error: unknown,
		warningShown: boolean,
	) => void;
	recordRetry: (
		sourceId: AutoSaveSourceId,
		attempt: number,
		delayMs: number,
	) => void;
	recordRecovery: (sourceId: AutoSaveSourceId) => void;
	getSource: (sourceId: AutoSaveSourceId) => AutoSaveSourceDiagnostic | undefined;
	getAll: () => AutoSaveSourceDiagnostic[];
}

interface AutoSaveDiagnosticStateDeps {
	now: () => string;
	onDidChange: () => void;
}

export interface AutoSaveDiagnosticReportInput {
	generatedAt: string;
	workspaceName: string;
	workspacePath: string;
	storagePath: string;
	enabled: boolean;
	selectedProviders: readonly AutoSaveDiagnosticProvider[];
	remoteName?: string;
	sources: readonly AutoSaveSourceDiagnostic[];
}

export interface AutoSaveLastSuccessSummary {
	provider: AutoSaveDiagnosticProvider;
	providerLabel: string;
	sourceId: AutoSaveSourceId;
	at: string;
}

export interface AutoSaveHealthSummary {
	healthySourceCount: number;
	attentionSourceCount: number;
	lastSuccess?: AutoSaveLastSuccessSummary;
}

function cloneDiagnostic(diagnostic: AutoSaveSourceDiagnostic): AutoSaveSourceDiagnostic {
	return {
		...diagnostic,
		...(diagnostic.validation
			? {
				validation: {
					...diagnostic.validation,
					supportedFormats: [...diagnostic.validation.supportedFormats],
				},
			}
			: {}),
		...(diagnostic.lastScan ? { lastScan: { ...diagnostic.lastScan } } : {}),
		...(diagnostic.lastEvent ? { lastEvent: { ...diagnostic.lastEvent } } : {}),
		...(diagnostic.lastSuccess
			? {
				lastSuccess: {
					...diagnostic.lastSuccess,
					fileNames: [...diagnostic.lastSuccess.fileNames],
				},
			}
			: {}),
		...(diagnostic.skipReason ? { skipReason: { ...diagnostic.skipReason } } : {}),
		...(diagnostic.lastError ? { lastError: { ...diagnostic.lastError } } : {}),
		...(diagnostic.lastRetry ? { lastRetry: { ...diagnostic.lastRetry } } : {}),
	};
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function recoverDiagnostic(
	current: AutoSaveSourceDiagnostic,
): AutoSaveSourceDiagnostic {
	const recovered = { ...current };
	delete recovered.lastError;
	delete recovered.lastRetry;
	return {
		...recovered,
		health: 'healthy',
		disabled: false,
		warningShown: false,
	};
}

export function createAutoSaveDiagnosticState(
	overrides: Partial<AutoSaveDiagnosticStateDeps> = {},
): AutoSaveDiagnosticState {
	const deps: AutoSaveDiagnosticStateDeps = {
		now: () => new Date().toISOString(),
		onDidChange: () => undefined,
		...overrides,
	};
	const diagnostics = new Map<AutoSaveSourceId, AutoSaveSourceDiagnostic>();

	const updateSource = (
		sourceId: AutoSaveSourceId,
		update: (current: AutoSaveSourceDiagnostic) => AutoSaveSourceDiagnostic,
	): void => {
		const current = diagnostics.get(sourceId);
		if (!current) {
			throw new Error(`Auto-save source "${sourceId}" must be registered before recording diagnostics.`);
		}

		diagnostics.set(sourceId, update(current));
		deps.onDidChange();
	};

	return {
		registerSource: (sourceId, resolvedPath, pathExists, validation) => {
			const current = diagnostics.get(sourceId);
			const effectiveValidation = validation ?? current?.validation;
			diagnostics.set(sourceId, {
				...(current ?? {}),
				sourceId,
				resolvedPath,
				pathExists,
				health: current?.disabled
					? 'degraded'
					: pathExists
						&& (
							effectiveValidation === undefined
							|| effectiveValidation.status === 'validated'
						)
						? 'healthy'
						: 'degraded',
				disabled: current?.disabled ?? false,
				warningShown: current?.warningShown ?? false,
				...(validation === undefined
					? {}
					: {
						validation: {
							...validation,
							supportedFormats: [...validation.supportedFormats],
						},
					}),
			});
			deps.onDidChange();
		},
		recordEvent: (sourceId, kind, sourcePath) => {
			updateSource(sourceId, (current) => ({
				...current,
				lastEvent: {
					at: deps.now(),
					kind,
					...(sourcePath === undefined ? {} : { sourcePath }),
				},
			}));
		},
		recordScan: (sourceId, candidateCount) => {
			updateSource(sourceId, (current) => ({
				...current,
				lastScan: {
					at: deps.now(),
					...(candidateCount === undefined ? {} : { candidateCount }),
				},
			}));
		},
		recordSuccess: (sourceId, sourceSessionId, fileNames) => {
			updateSource(sourceId, (current) => ({
				...recoverDiagnostic(current),
				lastSuccess: {
					at: deps.now(),
					sourceSessionId,
					fileNames: [...fileNames],
				},
			}));
		},
		recordSkip: (sourceId, reason) => {
			updateSource(sourceId, (current) => ({
				...current,
				skipReason: {
					at: deps.now(),
					reason,
				},
			}));
		},
		recordError: (sourceId, error) => {
			updateSource(sourceId, (current) => ({
				...current,
				health: 'degraded',
				lastError: {
					at: deps.now(),
					message: toErrorMessage(error),
				},
			}));
		},
		recordFailure: (sourceId, error, warningShown) => {
			updateSource(sourceId, (current) => ({
				...current,
				health: 'degraded',
				disabled: true,
				warningShown,
				lastError: {
					at: deps.now(),
					message: toErrorMessage(error),
				},
			}));
		},
		recordRetry: (sourceId, attempt, delayMs) => {
			updateSource(sourceId, (current) => ({
				...current,
				lastRetry: {
					at: deps.now(),
					attempt,
					delayMs,
				},
			}));
		},
		recordRecovery: (sourceId) => {
			updateSource(sourceId, recoverDiagnostic);
		},
		getSource: (sourceId) => {
			const diagnostic = diagnostics.get(sourceId);
			return diagnostic ? cloneDiagnostic(diagnostic) : undefined;
		},
		getAll: () => [...diagnostics.values()].map(cloneDiagnostic),
	};
}

const AUTO_SAVE_SOURCE_PROVIDERS: Readonly<
	Record<AutoSaveSourceId, AutoSaveDiagnosticProvider>
> = {
	'copilot-vscode': 'copilot',
	'copilot-cli': 'copilot',
	'codex-cli': 'codex',
	'claude-code-cli': 'claude-code',
	'cursor-cli': 'cursor',
	'cursor-vscode-legacy': 'cursor',
};

const AUTO_SAVE_PROVIDER_LABELS: Readonly<
	Record<AutoSaveDiagnosticProvider, string>
> = {
	copilot: 'Copilot',
	codex: 'Codex',
	'claude-code': 'Claude Code',
	cursor: 'Cursor',
};

function getMatchStrategy(sourceId: AutoSaveSourceId): string {
	switch (sourceId) {
		case 'codex-cli':
		case 'claude-code-cli':
			return 'Require a positive workspace cwd match, then prefer one exact changed transcript path; otherwise use filtered source scan order.';
		case 'copilot-cli':
			return 'Require CLI workspace metadata, then prefer one exact changed events path; otherwise use workspace-filtered source scan order.';
		case 'cursor-cli':
			return 'Use the workspace-derived Cursor project directory, then prefer one exact changed transcript path; otherwise use project scan order.';
		case 'copilot-vscode':
			return 'Use the validated workspace store, then prefer one exact changed transcript path; otherwise use workspace-store scan order.';
		case 'cursor-vscode-legacy':
			return 'Use the validated legacy workspace store and prefer one exact changed transcript path; otherwise use workspace-store scan order.';
	}
}

function getWatcherState(
	source: AutoSaveSourceDiagnostic,
	enabled: boolean,
): string {
	if (!enabled) {
		return 'inactive (auto-save disabled)';
	}

	if (
		source.validation
		&& source.validation.status !== 'validated'
	) {
		return `unavailable (${source.validation.status})`;
	}

	if (source.disabled) {
		return 'paused after source error; periodic retry scheduled';
	}

	return source.pathExists
		? 'watching'
		: 'waiting for source path with directory recovery';
}

function getProfileSummary(
	sources: readonly AutoSaveSourceDiagnostic[],
): string {
	const profiles = [
		...new Set(
			sources
				.map((source) => source.validation?.profileKind)
				.filter((profile): profile is AutoSaveWorkspaceProfileKind =>
					profile !== undefined),
		),
	];
	return profiles.length > 0 ? profiles.join(', ') : 'not observed';
}

export function summarizeAutoSaveHealth(
	sources: readonly AutoSaveSourceDiagnostic[],
): AutoSaveHealthSummary {
	let lastSuccess: AutoSaveLastSuccessSummary | undefined;
	for (const source of sources) {
		if (
			!source.lastSuccess
			|| (
				lastSuccess
				&& source.lastSuccess.at <= lastSuccess.at
			)
		) {
			continue;
		}

		const provider = AUTO_SAVE_SOURCE_PROVIDERS[source.sourceId];
		lastSuccess = {
			provider,
			providerLabel: AUTO_SAVE_PROVIDER_LABELS[provider],
			sourceId: source.sourceId,
			at: source.lastSuccess.at,
		};
	}

	const healthySourceCount = sources.filter(
		(source) => source.health === 'healthy',
	).length;
	const summary: AutoSaveHealthSummary = {
		healthySourceCount,
		attentionSourceCount: sources.length - healthySourceCount,
	};
	if (lastSuccess) {
		summary.lastSuccess = lastSuccess;
	}
	return summary;
}

export function buildAutoSaveStatusTooltip(
	workspaceName: string,
	enabled: boolean,
	sources: readonly AutoSaveSourceDiagnostic[],
): string {
	const summary = summarizeAutoSaveHealth(sources);
	const lastSuccess = summary.lastSuccess
		? `${summary.lastSuccess.providerLabel} at ${summary.lastSuccess.at}`
		: 'none recorded';

	return [
		`${workspaceName}: auto-save ${enabled ? 'enabled' : 'disabled'}`,
		`Healthy sources: ${summary.healthySourceCount}`,
		`Attention sources: ${summary.attentionSourceCount}`,
		`Last successful provider/time: ${lastSuccess}`,
		enabled ? 'Click to disable auto-save.' : 'Click to enable auto-save.',
	].join('\n');
}

function formatLastEvent(source: AutoSaveSourceDiagnostic): string {
	if (!source.lastEvent) {
		return 'none recorded';
	}

	return [
		`${source.lastEvent.kind} at ${source.lastEvent.at}`,
		...(source.lastEvent.sourcePath
			? [`source path=${source.lastEvent.sourcePath}`]
			: []),
	].join('; ');
}

function formatLastScan(source: AutoSaveSourceDiagnostic): string {
	return source.lastScan
		? `last at ${source.lastScan.at}`
		: 'none recorded';
}

function formatCandidateCount(source: AutoSaveSourceDiagnostic): string {
	return source.lastScan?.candidateCount === undefined
		? 'not recorded'
		: String(source.lastScan.candidateCount);
}

function formatLastSkip(source: AutoSaveSourceDiagnostic): string {
	return source.skipReason
		? `last at ${source.skipReason.at}; reason omitted from copyable report`
		: 'none recorded';
}

function formatLastSuccess(source: AutoSaveSourceDiagnostic): string {
	if (!source.lastSuccess) {
		return 'none recorded';
	}

	const provider = AUTO_SAVE_SOURCE_PROVIDERS[source.sourceId];
	return `last at ${source.lastSuccess.at}; provider=${AUTO_SAVE_PROVIDER_LABELS[provider]}; output files=${source.lastSuccess.fileNames.length}`;
}

function formatLastError(source: AutoSaveSourceDiagnostic): string {
	return source.lastError
		? `last at ${source.lastError.at}; details omitted from copyable report`
		: 'none recorded';
}

export function buildAutoSaveDiagnosticReport(
	input: AutoSaveDiagnosticReportInput,
): string {
	const lines = [
		'Session Control Auto-Save Diagnostic Report',
		`Generated: ${input.generatedAt}`,
		`Workspace: ${input.workspaceName}`,
		`Workspace path: ${input.workspacePath}`,
		`Storage path: ${input.storagePath}`,
		`Enablement: ${input.enabled ? 'enabled' : 'disabled'}`,
		`Selected providers: ${input.selectedProviders.length > 0
			? input.selectedProviders.join(', ')
			: 'none'}`,
		`Remote host: ${input.remoteName ? `remote (${input.remoteName})` : 'local'}`,
		'Remote limit: VS Code Copilot workspace-store monitoring requires a local file workspace and local file-backed extension storage.',
		`Profile detection: ${getProfileSummary(input.sources)}`,
		'Profile limit: Only the active profile storage URI is validated; other VS Code profiles are not scanned.',
		'Content policy: metadata only; prompt text, response text, session titles, skip reasons, error details, and saved filenames are omitted.',
		'',
		'Sources:',
	];

	if (input.sources.length === 0) {
		lines.push(
			'- none registered',
			'  Source path: unavailable',
			'  Match strategy: unavailable',
			'  Watcher state: inactive',
			'  Events: none recorded',
			'  Scans: none recorded',
			'  Candidates: not recorded',
			'  Skips: none recorded',
			'  Successes: none recorded',
			'  Errors: none recorded',
		);
		return lines.join('\n');
	}

	for (const source of input.sources) {
		const provider = AUTO_SAVE_SOURCE_PROVIDERS[source.sourceId];
		lines.push(
			`- ${source.sourceId} (${AUTO_SAVE_PROVIDER_LABELS[provider]})`,
			`  Source path: ${source.resolvedPath}`,
			`  Match strategy: ${getMatchStrategy(source.sourceId)}`,
			`  Watcher state: ${getWatcherState(source, input.enabled)}`,
			`  Health: ${source.health === 'healthy' ? 'healthy' : 'attention'}`,
			`  Events: ${formatLastEvent(source)}`,
			`  Scans: ${formatLastScan(source)}`,
			`  Candidates: ${formatCandidateCount(source)}`,
			`  Skips: ${formatLastSkip(source)}`,
			`  Successes: ${formatLastSuccess(source)}`,
			`  Errors: ${formatLastError(source)}`,
		);
		if (source.validation) {
			lines.push(
				`  Remote/profile validation: status=${source.validation.status}; workspace=${source.validation.workspaceMode}; host=${source.validation.hostKind}; profile=${source.validation.profileKind}; formats=${source.validation.supportedFormats.join(',')}`,
			);
		}
	}

	return lines.join('\n');
}
