"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSessionProviderId = isSessionProviderId;
exports.isGitContext = isGitContext;
exports.isToolCall = isToolCall;
exports.isRequestTurn = isRequestTurn;
exports.isResponseTurn = isResponseTurn;
exports.isSavedTurn = isSavedTurn;
exports.isAnalysisTimeRange = isAnalysisTimeRange;
exports.isAnalysisSelection = isAnalysisSelection;
exports.isAnalysisReportRepositorySummary = isAnalysisReportRepositorySummary;
exports.isAnalysisReportSourceSession = isAnalysisReportSourceSession;
exports.isAnalysisReportReference = isAnalysisReportReference;
exports.isAnalysisIndexEntry = isAnalysisIndexEntry;
exports.isAnalysisIndex = isAnalysisIndex;
exports.isChatSession = isChatSession;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isIsoTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function isSessionProviderId(value) {
    return value === 'copilot' || value === 'codex' || value === 'cursor' || value === 'claude-code';
}
function isGitContext(value) {
    if (!isRecord(value)) {
        return false;
    }
    return (typeof value.branch === 'string'
        && typeof value.commit === 'string'
        && typeof value.dirty === 'boolean');
}
function isToolCall(value) {
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
function isRequestTurn(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (value.type !== 'request') {
        return false;
    }
    return (typeof value.participant === 'string'
        && typeof value.prompt === 'string'
        && Array.isArray(value.references)
        && value.references.every((reference) => typeof reference === 'string')
        && isIsoTimestamp(value.timestamp));
}
function isResponseTurn(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (value.type !== 'response') {
        return false;
    }
    return (typeof value.participant === 'string'
        && typeof value.content === 'string'
        && Array.isArray(value.toolCalls)
        && value.toolCalls.every((toolCall) => isToolCall(toolCall))
        && isIsoTimestamp(value.timestamp));
}
function isSavedTurn(value) {
    return isRequestTurn(value) || isResponseTurn(value);
}
function isAnalysisSelectionMode(value) {
    return value === 'last24Hours'
        || value === 'last7Days'
        || value === 'last30Days'
        || value === 'customRange'
        || value === 'needsAnalysis';
}
function isAnalysisReportStatus(value) {
    return value === 'complete' || value === 'partial';
}
function isAnalysisTimeRange(value) {
    if (!isRecord(value)) {
        return false;
    }
    return isIsoTimestamp(value.start) && isIsoTimestamp(value.end);
}
function isAnalysisSelection(value) {
    if (!isRecord(value)) {
        return false;
    }
    return isAnalysisSelectionMode(value.mode)
        && typeof value.label === 'string'
        && (value.onlyUnanalyzed === undefined || typeof value.onlyUnanalyzed === 'boolean')
        && (value.range === null || isAnalysisTimeRange(value.range));
}
function isAnalysisReportRepositorySummary(value) {
    if (!isRecord(value)) {
        return false;
    }
    return typeof value.workspaceName === 'string'
        && (value.branch === null || typeof value.branch === 'string')
        && (value.commit === null || typeof value.commit === 'string')
        && (value.dirty === null || typeof value.dirty === 'boolean')
        && typeof value.sessionCount === 'number';
}
function isAnalysisReportSourceSession(value) {
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
function isAnalysisReportReference(value) {
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
function isAnalysisIndexEntry(value) {
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
function isAnalysisIndex(value) {
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
function isChatSession(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (typeof value.version !== 'number'
        || typeof value.id !== 'string'
        || typeof value.title !== 'string'
        || !isIsoTimestamp(value.savedAt)
        || (value.provider !== undefined && !isSessionProviderId(value.provider))
        || typeof value.vscodeVersion !== 'string'
        || typeof value.totalTurns !== 'number'
        || !Array.isArray(value.turns)
        || typeof value.markdownSummary !== 'string') {
        return false;
    }
    if (value.git !== null && !isGitContext(value.git)) {
        return false;
    }
    if (!(typeof value.part === 'number' || value.part === null)
        || !(typeof value.totalParts === 'number' || value.totalParts === null)
        || !(typeof value.previousPartFile === 'string' || value.previousPartFile === null)
        || !(typeof value.nextPartFile === 'string' || value.nextPartFile === null)) {
        return false;
    }
    return value.turns.every((turn) => isSavedTurn(turn));
}
//# sourceMappingURL=types.js.map