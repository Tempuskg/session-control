export interface GitContext {
	branch: string;
	commit: string;
	dirty: boolean;
}

export type SessionProviderId = 'copilot' | 'codex' | 'cursor' | 'claude-code';

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

export interface SourceChatSession {
	provider: SessionProviderId;
	id: string;
	title: string;
	lastMessageDate: string;
	turns: SavedTurn[];
	sourceFile: string;
	sourceRevision?: string;
	cwd?: string;
}

export type SessionSaveKind = 'manual' | 'auto';

export interface SessionOrigin {
	saveKind: SessionSaveKind;
	sourceId: string;
	sourceSessionId: string;
	sourceRevision: string;
}

export interface ChatSession {
	version: number;
	id: string;
	title: string;
	savedAt: string;
	provider?: SessionProviderId;
	origin?: SessionOrigin;
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
	provider?: SessionProviderId;
	turnCount: number;
	git: GitContext | null;
}

export type AnalysisSelectionMode = 'last24Hours' | 'last7Days' | 'last30Days' | 'customRange' | 'needsAnalysis' | 'singleSession';

export interface AnalysisTimeRange {
	start: string;
	end: string;
}

export interface AnalysisSelection {
	mode: AnalysisSelectionMode;
	label: string;
	range: AnalysisTimeRange | null;
	onlyUnanalyzed?: boolean;
	// Present when mode is 'singleSession': the id of the one targeted session.
	sessionId?: string;
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
	triage?: AnalysisReportTriageSummary;
}

/** Session counts for a report whose candidates went through TypeSafe triage. */
export interface AnalysisReportTriageSummary {
	/** Candidates that received triage answers. */
	triaged: number;
	/** Candidates sent to the LLM and covered by the report. */
	analyzed: number;
	/** Candidates triage flagged as low-signal and left out of the LLM. */
	skipped: number;
}

/** Normalized triage answers: scores are rubric levels 0 to 3, the rest are probabilities 0 to 1. */
export interface AnalysisTriageSignals {
	friction?: number;
	toolFailureLoops?: number;
	instructionViolation?: number;
	controlFileLesson?: number;
	trivial?: number;
}

export interface AnalysisTriageIndexEntry {
	fingerprint: string;
	sessionId: string;
	triagedAt: string;
	skipped: boolean;
	signals: AnalysisTriageSignals;
	rootFileName?: string;
	/** Composite priority from 0 to 1; absent for skipped sessions. */
	priority?: number;
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
	triagedSessions?: AnalysisTriageIndexEntry[];
}

export interface CachedJudgmentEntry<TAnswers = Record<string, unknown>> {
	key: string;
	sessionFingerprint: string;
	questionSetVersion: string;
	createdAt: string;
	answers: TAnswers;
	model?: string;
	usage?: {
		input_tokens: number;
		output_tokens: number;
	};
}

export interface JudgmentCache {
	version: number;
	updatedAt: string;
	judgments: Record<string, CachedJudgmentEntry>;
}

// Minimal read-only view of the harvest index written by Session Control Pro
// at <storageDirectory>/harvest/index.json. Only the fields the free
// extension consumes are validated; Pro owns the full schema and may include
// additional fields (fingerprint, bundlePath, backend, ...).
export interface HarvestIndexEntry {
	sessionId: string;
	harvestedAt: string;
}

export interface HarvestIndex {
	version: number;
	sessions: HarvestIndexEntry[];
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

export function isSessionProviderId(value: unknown): value is SessionProviderId {
	return value === 'copilot' || value === 'codex' || value === 'cursor' || value === 'claude-code';
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

export function isSessionOrigin(value: unknown): value is SessionOrigin {
	if (!isRecord(value)) {
		return false;
	}

	return (value.saveKind === 'manual' || value.saveKind === 'auto')
		&& typeof value.sourceId === 'string'
		&& typeof value.sourceSessionId === 'string'
		&& typeof value.sourceRevision === 'string';
}

function isAnalysisSelectionMode(value: unknown): value is AnalysisSelectionMode {
	return value === 'last24Hours'
		|| value === 'last7Days'
		|| value === 'last30Days'
		|| value === 'customRange'
		|| value === 'needsAnalysis'
		|| value === 'singleSession';
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
		&& (value.sessionId === undefined || typeof value.sessionId === 'string')
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
				&& value.warnings.every((warning) => typeof warning === 'string')))
		&& (value.triage === undefined || isAnalysisReportTriageSummary(value.triage));
}

function isAnalysisReportTriageSummary(value: unknown): value is AnalysisReportTriageSummary {
	return isRecord(value)
		&& typeof value.triaged === 'number'
		&& typeof value.analyzed === 'number'
		&& typeof value.skipped === 'number';
}

const ANALYSIS_TRIAGE_SIGNAL_KEYS = ['friction', 'toolFailureLoops', 'instructionViolation', 'controlFileLesson', 'trivial'] as const;

export function isAnalysisTriageIndexEntry(value: unknown): value is AnalysisTriageIndexEntry {
	if (!isRecord(value)) {
		return false;
	}

	const signals = value.signals;
	return typeof value.fingerprint === 'string'
		&& typeof value.sessionId === 'string'
		&& isIsoTimestamp(value.triagedAt)
		&& typeof value.skipped === 'boolean'
		&& isRecord(signals)
		&& ANALYSIS_TRIAGE_SIGNAL_KEYS.every((key) => signals[key] === undefined || typeof signals[key] === 'number')
		&& (value.rootFileName === undefined || typeof value.rootFileName === 'string')
		&& (value.priority === undefined || typeof value.priority === 'number');
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
		&& value.analyzedSessions.every((entry) => isAnalysisIndexEntry(entry))
		&& (value.triagedSessions === undefined
			|| (Array.isArray(value.triagedSessions)
				&& value.triagedSessions.every((entry) => isAnalysisTriageIndexEntry(entry))));
}

const RANGE_NULL_SELECTION_GUIDANCE = 'Single Session and Needs Analysis selections must use "range": null'
	+ ' (never {"start": null, "end": null}), and a singleSession selection must also include the selected "sessionId".'
	+ ' Date-filtered selections must use {"start": "<ISO timestamp>", "end": "<ISO timestamp>"}.';

/** Explains why a selection fails isAnalysisSelection, or returns undefined when it is valid. */
export function describeAnalysisSelectionProblem(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return 'selection must be an object.';
	}

	if (!isAnalysisSelectionMode(value.mode)) {
		return `selection.mode ${JSON.stringify(value.mode)} is not a supported mode `
			+ '(last24Hours, last7Days, last30Days, customRange, needsAnalysis, singleSession).';
	}

	if (typeof value.label !== 'string') {
		return 'selection.label must be a string.';
	}

	if (value.onlyUnanalyzed !== undefined && typeof value.onlyUnanalyzed !== 'boolean') {
		return 'selection.onlyUnanalyzed must be a boolean when present.';
	}

	if (value.sessionId !== undefined && typeof value.sessionId !== 'string') {
		return 'selection.sessionId must be a string when present.';
	}

	if (value.range !== null && !isAnalysisTimeRange(value.range)) {
		return `selection.range for mode "${value.mode}" must be null or an object with ISO timestamp "start" and "end" strings;`
			+ ` found ${JSON.stringify(value.range) ?? 'undefined'}. ${RANGE_NULL_SELECTION_GUIDANCE}`;
	}

	return undefined;
}

/** Names the first field that makes an analysis index fail isAnalysisIndex, or returns undefined when it is valid. */
export function describeAnalysisIndexProblem(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return 'the index must be a JSON object.';
	}

	if (typeof value.version !== 'number') {
		return '"version" must be a number.';
	}

	if (!isIsoTimestamp(value.updatedAt)) {
		return '"updatedAt" must be an ISO timestamp string.';
	}

	if (!Array.isArray(value.reports)) {
		return '"reports" must be an array.';
	}

	for (const [index, report] of value.reports.entries()) {
		if (isAnalysisReportReference(report)) {
			continue;
		}

		const id = isRecord(report) && typeof report.id === 'string' ? ` (id ${JSON.stringify(report.id)})` : '';
		const selectionProblem = isRecord(report) ? describeAnalysisSelectionProblem(report.selection) : undefined;
		return selectionProblem
			? `reports[${index}]${id}: ${selectionProblem}`
			: `reports[${index}]${id} does not match the analysis report reference schema.`;
	}

	if (!Array.isArray(value.analyzedSessions)) {
		return '"analyzedSessions" must be an array.';
	}

	const invalidEntry = value.analyzedSessions.findIndex((entry) => !isAnalysisIndexEntry(entry));
	if (invalidEntry !== -1) {
		return `analyzedSessions[${invalidEntry}] does not match the analyzed session entry schema.`;
	}

	if (value.triagedSessions !== undefined) {
		if (!Array.isArray(value.triagedSessions)) {
			return '"triagedSessions" must be an array when present.';
		}

		const invalidTriage = value.triagedSessions.findIndex((entry) => !isAnalysisTriageIndexEntry(entry));
		if (invalidTriage !== -1) {
			return `triagedSessions[${invalidTriage}] does not match the triaged session entry schema.`;
		}
	}

	return undefined;
}

export function isCachedJudgmentEntry(value: unknown): value is CachedJudgmentEntry {
	if (!isRecord(value)) {
		return false;
	}

	const usageValid = value.usage === undefined || (
		isRecord(value.usage)
		&& typeof value.usage.input_tokens === 'number'
		&& typeof value.usage.output_tokens === 'number'
	);

	return (
		typeof value.key === 'string'
		&& typeof value.sessionFingerprint === 'string'
		&& typeof value.questionSetVersion === 'string'
		&& isIsoTimestamp(value.createdAt)
		&& isRecord(value.answers)
		&& (value.model === undefined || typeof value.model === 'string')
		&& usageValid
	);
}

export function isJudgmentCache(value: unknown): value is JudgmentCache {
	if (!isRecord(value)) {
		return false;
	}

	if (typeof value.version !== 'number' || !isIsoTimestamp(value.updatedAt)) {
		return false;
	}

	if (!isRecord(value.judgments)) {
		return false;
	}

	return Object.values(value.judgments).every((entry) => isCachedJudgmentEntry(entry));
}

export function isHarvestIndexEntry(value: unknown): value is HarvestIndexEntry {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.sessionId === 'string'
		&& isIsoTimestamp(value.harvestedAt);
}

export function isHarvestIndex(value: unknown): value is HarvestIndex {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.version === 'number'
		&& Array.isArray(value.sessions)
		&& value.sessions.every((entry) => isHarvestIndexEntry(entry));
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
		|| (value.provider !== undefined && !isSessionProviderId(value.provider))
		|| (value.origin !== undefined && !isSessionOrigin(value.origin))
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
