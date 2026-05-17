export interface GitContext {
	branch: string;
	commit: string;
	dirty: boolean;
}

export interface ToolCall {
	name: string;
	summary?: string;
	arguments?: string;
	output?: string;
}

export interface RequestTurn {
	type: 'request';
	participant: string;
	prompt: string;
	references: string[];
	timestamp: string;
}

export interface ResponseTurn {
	type: 'response';
	participant: string;
	content: string;
	toolCalls: ToolCall[];
	timestamp: string;
}

export type SavedTurn = RequestTurn | ResponseTurn;

export interface ChatSession {
	version: number;
	id: string;
	title: string;
	savedAt: string;
	git: GitContext | null;
	vscodeVersion: string;
	totalTurns: number;
	part: number | null;
	totalParts: number | null;
	previousPartFile: string | null;
	nextPartFile: string | null;
	turns: SavedTurn[];
	markdownSummary: string;
}

export interface SessionMeta {
	id: string;
	title: string;
	savedAt: string;
	fileName: string;
	turnCount: number;
	git: GitContext | null;
}

export type AnalysisSelectionMode = 'last24Hours' | 'last7Days' | 'last30Days' | 'customRange' | 'needsAnalysis';

export interface AnalysisTimeRange {
	start: string;
	end: string;
}

export interface AnalysisSelection {
	mode: AnalysisSelectionMode;
	label: string;
	range: AnalysisTimeRange | null;
	onlyUnanalyzed?: boolean;
}

export type AnalysisReportStatus = 'complete' | 'partial';

export interface AnalysisReportResultMetadata {
	resultType: 'analysis-report';
	analysisStatus: AnalysisReportStatus;
	analysisReportPath: string;
	analysisStorageDirectory: string;
}

export interface AnalysisReportRepositorySummary {
	workspaceName: string;
	branch: string | null;
	commit: string | null;
	dirty: boolean | null;
	sessionCount: number;
}

export interface AnalysisReportSourceSession {
	workspaceName: string;
	sessionId: string;
	title: string;
	savedAt: string;
	rootFileName: string;
	fingerprint: string;
	git: GitContext | null;
}

export interface AnalysisReportReference {
	id: string;
	createdAt: string;
	selection: AnalysisSelection;
	promptVersion: string;
	reportPath: string;
	contributingWorkspaces: string[];
	analyzedFingerprints: string[];
	sessionCount?: number;
	ownerWorkspaceName?: string;
	repositories?: AnalysisReportRepositorySummary[];
	sourceSessions?: AnalysisReportSourceSession[];
	status?: AnalysisReportStatus;
	warnings?: string[];
}

export interface AnalysisIndexEntry {
	fingerprint: string;
	sessionId: string;
	title: string;
	savedAt: string;
	analyzedAt: string;
	reportPath: string;
	rootFileName?: string;
	reportId?: string;
	git?: GitContext | null;
}

export interface AnalysisIndex {
	version: number;
	updatedAt: string;
	reports: AnalysisReportReference[];
	analyzedSessions: AnalysisIndexEntry[];
}

export interface ScoredSession extends SessionMeta {
	score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isGitContext(value: unknown): value is GitContext {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.branch === 'string'
		&& typeof value.commit === 'string'
		&& typeof value.dirty === 'boolean'
	);
}

export function isToolCall(value: unknown): value is ToolCall {
	if (!isRecord(value)) {
		return false;
	}

	if (typeof value.name !== 'string') {
		return false;
	}

	if (value.summary !== undefined && typeof value.summary !== 'string') {
		return false;
	}

	if (value.arguments !== undefined && typeof value.arguments !== 'string') {
		return false;
	}

	if (value.output !== undefined && typeof value.output !== 'string') {
		return false;
	}

	return true;
}

export function isRequestTurn(value: unknown): value is RequestTurn {
	if (!isRecord(value)) {
		return false;
	}

	if (value.type !== 'request') {
		return false;
	}

	return (
		typeof value.participant === 'string'
		&& typeof value.prompt === 'string'
		&& Array.isArray(value.references)
		&& value.references.every((reference) => typeof reference === 'string')
		&& isIsoTimestamp(value.timestamp)
	);
}

export function isResponseTurn(value: unknown): value is ResponseTurn {
	if (!isRecord(value)) {
		return false;
	}

	if (value.type !== 'response') {
		return false;
	}

	return (
		typeof value.participant === 'string'
		&& typeof value.content === 'string'
		&& Array.isArray(value.toolCalls)
		&& value.toolCalls.every((toolCall) => isToolCall(toolCall))
		&& isIsoTimestamp(value.timestamp)
	);
}

export function isSavedTurn(value: unknown): value is SavedTurn {
	return isRequestTurn(value) || isResponseTurn(value);
}

function isAnalysisSelectionMode(value: unknown): value is AnalysisSelectionMode {
	return value === 'last24Hours'
		|| value === 'last7Days'
		|| value === 'last30Days'
		|| value === 'customRange'
		|| value === 'needsAnalysis';
}

function isAnalysisReportStatus(value: unknown): value is AnalysisReportStatus {
	return value === 'complete' || value === 'partial';
}

export function isAnalysisTimeRange(value: unknown): value is AnalysisTimeRange {
	if (!isRecord(value)) {
		return false;
	}

	return isIsoTimestamp(value.start) && isIsoTimestamp(value.end);
}

export function isAnalysisSelection(value: unknown): value is AnalysisSelection {
	if (!isRecord(value)) {
		return false;
	}

	return isAnalysisSelectionMode(value.mode)
		&& typeof value.label === 'string'
		&& (value.onlyUnanalyzed === undefined || typeof value.onlyUnanalyzed === 'boolean')
		&& (value.range === null || isAnalysisTimeRange(value.range));
}

export function isAnalysisReportRepositorySummary(value: unknown): value is AnalysisReportRepositorySummary {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.workspaceName === 'string'
		&& (value.branch === null || typeof value.branch === 'string')
		&& (value.commit === null || typeof value.commit === 'string')
		&& (value.dirty === null || typeof value.dirty === 'boolean')
		&& typeof value.sessionCount === 'number';
}

export function isAnalysisReportSourceSession(value: unknown): value is AnalysisReportSourceSession {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.workspaceName === 'string'
		&& typeof value.sessionId === 'string'
		&& typeof value.title === 'string'
		&& isIsoTimestamp(value.savedAt)
		&& typeof value.rootFileName === 'string'
		&& typeof value.fingerprint === 'string'
		&& (value.git === null || isGitContext(value.git));
}

export function isAnalysisReportReference(value: unknown): value is AnalysisReportReference {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.id === 'string'
		&& isIsoTimestamp(value.createdAt)
		&& isAnalysisSelection(value.selection)
		&& typeof value.promptVersion === 'string'
		&& typeof value.reportPath === 'string'
		&& Array.isArray(value.contributingWorkspaces)
		&& value.contributingWorkspaces.every((workspace) => typeof workspace === 'string')
		&& Array.isArray(value.analyzedFingerprints)
		&& value.analyzedFingerprints.every((fingerprint) => typeof fingerprint === 'string')
		&& (value.sessionCount === undefined || typeof value.sessionCount === 'number')
		&& (value.ownerWorkspaceName === undefined || typeof value.ownerWorkspaceName === 'string')
		&& (value.repositories === undefined
			|| (Array.isArray(value.repositories)
				&& value.repositories.every((repository) => isAnalysisReportRepositorySummary(repository))))
		&& (value.sourceSessions === undefined
			|| (Array.isArray(value.sourceSessions)
				&& value.sourceSessions.every((session) => isAnalysisReportSourceSession(session))))
		&& (value.status === undefined || isAnalysisReportStatus(value.status))
		&& (value.warnings === undefined
			|| (Array.isArray(value.warnings)
				&& value.warnings.every((warning) => typeof warning === 'string')));
}

export function isAnalysisIndexEntry(value: unknown): value is AnalysisIndexEntry {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.fingerprint === 'string'
		&& typeof value.sessionId === 'string'
		&& typeof value.title === 'string'
		&& isIsoTimestamp(value.savedAt)
		&& isIsoTimestamp(value.analyzedAt)
		&& typeof value.reportPath === 'string'
		&& (value.rootFileName === undefined || typeof value.rootFileName === 'string')
		&& (value.reportId === undefined || typeof value.reportId === 'string')
		&& (value.git === undefined || value.git === null || isGitContext(value.git));
}

export function isAnalysisIndex(value: unknown): value is AnalysisIndex {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.version === 'number'
		&& isIsoTimestamp(value.updatedAt)
		&& Array.isArray(value.reports)
		&& value.reports.every((report) => isAnalysisReportReference(report))
		&& Array.isArray(value.analyzedSessions)
		&& value.analyzedSessions.every((entry) => isAnalysisIndexEntry(entry));
}

export function isChatSession(value: unknown): value is ChatSession {
	if (!isRecord(value)) {
		return false;
	}

	if (
		typeof value.version !== 'number'
		|| typeof value.id !== 'string'
		|| typeof value.title !== 'string'
		|| !isIsoTimestamp(value.savedAt)
		|| typeof value.vscodeVersion !== 'string'
		|| typeof value.totalTurns !== 'number'
		|| !Array.isArray(value.turns)
		|| typeof value.markdownSummary !== 'string'
	) {
		return false;
	}

	if (value.git !== null && !isGitContext(value.git)) {
		return false;
	}

	if (
		!(typeof value.part === 'number' || value.part === null)
		|| !(typeof value.totalParts === 'number' || value.totalParts === null)
		|| !(typeof value.previousPartFile === 'string' || value.previousPartFile === null)
		|| !(typeof value.nextPartFile === 'string' || value.nextPartFile === null)
	) {
		return false;
	}

	return value.turns.every((turn) => isSavedTurn(turn));
}
