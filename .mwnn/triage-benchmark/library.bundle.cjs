/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ([
/* 0 */
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";

module.exports = {
  ...__webpack_require__(1),
  ...__webpack_require__(11),
};


/***/ }),
/* 1 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET = exports.ANALYSIS_PROMPT_VERSION = void 0;
exports.leastDetailedEvidenceLevel = leastDetailedEvidenceLevel;
exports.createPresetAnalysisSelection = createPresetAnalysisSelection;
exports.createNeedsAnalysisSelection = createNeedsAnalysisSelection;
exports.createSingleSessionSelection = createSingleSessionSelection;
exports.createCustomRangeSelection = createCustomRangeSelection;
exports.parseAnalysisSelectionAlias = parseAnalysisSelectionAlias;
exports.filterCandidatesForAnalysis = filterCandidatesForAnalysis;
exports.buildSessionEvidence = buildSessionEvidence;
exports.splitCandidatesIntoAnalysisBatches = splitCandidatesIntoAnalysisBatches;
exports.buildAnalysisPrompt = buildAnalysisPrompt;
exports.buildAnalysisSynthesisPrompt = buildAnalysisSynthesisPrompt;
exports.buildImplementationHandoffPrompt = buildImplementationHandoffPrompt;
const reportVerification_1 = __webpack_require__(2);
const EVIDENCE_DETAIL_RANK = { full: 0, compact: 1, summaryOnly: 2 };
/** Returns the less detailed of two evidence levels. */
function leastDetailedEvidenceLevel(first, second) {
    return EVIDENCE_DETAIL_RANK[second] > EVIDENCE_DETAIL_RANK[first] ? second : first;
}
exports.ANALYSIS_PROMPT_VERSION = '5';
exports.DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET = 48000;
const SESSION_CONTROL_ANALYZE_PROMPT_PATTERN = /^(?:@?session-control\s+)?\/anal(?:y)?ze\b/i;
const ANALYSIS_COMPACT_SUMMARY_MAX_CHARS = 4000;
const ANALYSIS_SUMMARY_ONLY_SUMMARY_MAX_CHARS = 2500;
const ANALYSIS_COMPACT_TRANSCRIPT_MAX_CHARS = 5000;
const ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_MAX_CHARS = 1200;
const ANALYSIS_COMPACT_TURN_MAX_CHARS = 800;
const ANALYSIS_SUMMARY_ONLY_TURN_MAX_CHARS = 320;
const ANALYSIS_COMPACT_MAX_TOOL_CALL_LINES = 16;
const ANALYSIS_SUMMARY_ONLY_MAX_TOOL_CALL_LINES = 8;
const ANALYSIS_COMPACT_TOOL_CALL_LINE_MAX_CHARS = 260;
const ANALYSIS_SUMMARY_ONLY_TOOL_CALL_LINE_MAX_CHARS = 160;
const ANALYSIS_COMPACT_TRANSCRIPT_HEAD_TURNS = 2;
const ANALYSIS_COMPACT_TRANSCRIPT_TAIL_TURNS = 6;
const ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_TAIL_TURNS = 2;
const ANALYSIS_PROMPT_TEMPLATE = `Review my last interactions with AI from {user chosen timeframe}.
Look for any problems that I encountered, things that weren't working efficiently, and unnecessary tool calling.
Look for common mistakes AI was doing and other things that can be optimized.
Look thoroughly through all conversations and make a plan for how we can optimize our flow in the future, both within each repository and cross-repositories.
Also look for insights that would be useful for the coding agent to know beforehand, both before entering a repository and when working in multiple repositories at the same time.`;
function buildRecommendationScopeGuidance() {
    return [
        'Restrict all recommendations to AI-specific control files in the repository.',
        'Before recommending anything, compare it against the existing AI instruction and skill files provided below.',
        'Only list gaps that are not already covered there.',
        'If an instruction or skill already exists, omit it unless you are recommending a concrete improvement, consolidation, or removal.',
        'Prioritize AGENTS.md and .github/copilot-instructions.md when they exist.',
        'If present, CLAUDE.md, *.instructions.md, *.prompt.md, *.agent.md, SKILL.md, and similar repository-local AI instruction files are also in scope.',
        'Look for repeated workflows or recurring instructions that should be extracted into new reusable repository-local AI skills.',
        'When a new skill would help, recommend creating a specific skill file such as SKILL.md, *.instructions.md, *.prompt.md, or *.agent.md and explain what behavior it should capture.',
        'Do not recommend application source-code changes, test changes, build tooling changes, or general documentation edits unless the change is specifically to one of those AI control files.',
        'If the evidence does not support a concrete AI-control-file recommendation, say so instead of proposing general repository changes.',
        'For every recommendation, name the target AI control file and the instruction, prompt, or new skill content to create.',
    ].join('\n');
}
function buildExistingAiBaselineSection(existingAiFileBaseline) {
    if (!existingAiFileBaseline.trim()) {
        return [
            'Existing AI Instructions and Skills:',
            '',
            'No existing AI instruction or skill files were found in the analyzed workspaces.',
        ].join('\n');
    }
    return [
        'Existing AI Instructions and Skills:',
        '',
        existingAiFileBaseline,
    ].join('\n');
}
function truncateMiddle(value, maxChars) {
    if (value.length <= maxChars) {
        return value;
    }
    if (maxChars <= 3) {
        return '.'.repeat(Math.max(0, maxChars));
    }
    const marker = `\n...[${value.length - maxChars} chars omitted]...\n`;
    const availableChars = maxChars - marker.length;
    if (availableChars <= 8) {
        return `${value.slice(0, maxChars - 3)}...`;
    }
    const headChars = Math.ceil(availableChars / 2);
    const tailChars = Math.floor(availableChars / 2);
    const tail = tailChars > 0 ? value.slice(-tailChars) : '';
    return `${value.slice(0, headChars)}${marker}${tail}`;
}
function limitRenderedLines(lines, maxLines) {
    if (lines.length <= maxLines) {
        return lines;
    }
    const visibleSlots = Math.max(0, maxLines - 1);
    const headCount = Math.ceil(visibleSlots / 2);
    const tailCount = Math.floor(visibleSlots / 2);
    const omittedCount = lines.length - headCount - tailCount;
    return [
        ...lines.slice(0, headCount),
        `- ... ${omittedCount} additional tool call(s) omitted ...`,
        ...(tailCount > 0 ? lines.slice(lines.length - tailCount) : []),
    ];
}
function renderToolCallLine(toolCall, detailLevel) {
    const parts = [toolCall.name];
    if (toolCall.summary?.trim()) {
        parts.push(toolCall.summary.trim());
    }
    else if (detailLevel === 'full') {
        parts.push('no summary');
    }
    if (detailLevel === 'full') {
        parts.push(toolCall.arguments ?? 'no arguments captured');
    }
    const line = `- ${parts.join(' | ')}`;
    if (detailLevel === 'compact') {
        return truncateMiddle(line, ANALYSIS_COMPACT_TOOL_CALL_LINE_MAX_CHARS);
    }
    if (detailLevel === 'summaryOnly') {
        return truncateMiddle(line, ANALYSIS_SUMMARY_ONLY_TOOL_CALL_LINE_MAX_CHARS);
    }
    return line;
}
function renderToolCalls(session, detailLevel = 'full') {
    const lines = [];
    for (const turn of session.turns) {
        if (turn.type !== 'response' || turn.toolCalls.length === 0) {
            continue;
        }
        for (const toolCall of turn.toolCalls) {
            lines.push(renderToolCallLine(toolCall, detailLevel));
        }
    }
    if (detailLevel === 'compact') {
        return limitRenderedLines(lines, ANALYSIS_COMPACT_MAX_TOOL_CALL_LINES);
    }
    if (detailLevel === 'summaryOnly') {
        return limitRenderedLines(lines, ANALYSIS_SUMMARY_ONLY_MAX_TOOL_CALL_LINES);
    }
    return lines;
}
function renderTranscriptTurn(turn, detailLevel) {
    const maxChars = detailLevel === 'compact'
        ? ANALYSIS_COMPACT_TURN_MAX_CHARS
        : detailLevel === 'summaryOnly'
            ? ANALYSIS_SUMMARY_ONLY_TURN_MAX_CHARS
            : Number.MAX_SAFE_INTEGER;
    if (turn.type === 'request') {
        return `[${turn.timestamp}] User: ${truncateMiddle(turn.prompt, maxChars)}`;
    }
    const toolLines = turn.toolCalls.length
        ? `\nTool calls:\n${turn.toolCalls.map((toolCall) => renderToolCallLine(toolCall, detailLevel)).join('\n')}`
        : '';
    return `[${turn.timestamp}] Assistant: ${truncateMiddle(turn.content, maxChars)}${toolLines}`;
}
function selectTranscriptTurns(session, detailLevel) {
    if (detailLevel === 'full') {
        return {
            turns: session.turns,
            omittedTurns: 0,
        };
    }
    if (detailLevel === 'compact') {
        const maxTurns = ANALYSIS_COMPACT_TRANSCRIPT_HEAD_TURNS + ANALYSIS_COMPACT_TRANSCRIPT_TAIL_TURNS;
        if (session.turns.length <= maxTurns) {
            return {
                turns: session.turns,
                omittedTurns: 0,
            };
        }
        return {
            turns: [
                ...session.turns.slice(0, ANALYSIS_COMPACT_TRANSCRIPT_HEAD_TURNS),
                ...session.turns.slice(-ANALYSIS_COMPACT_TRANSCRIPT_TAIL_TURNS),
            ],
            omittedTurns: session.turns.length - maxTurns,
        };
    }
    const tailTurns = Math.min(ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_TAIL_TURNS, session.turns.length);
    return {
        turns: session.turns.slice(-tailTurns),
        omittedTurns: session.turns.length - tailTurns,
    };
}
function buildAnalysisTranscript(session, detailLevel) {
    const { turns, omittedTurns } = selectTranscriptTurns(session, detailLevel);
    const transcriptLines = turns.map((turn) => renderTranscriptTurn(turn, detailLevel));
    if (detailLevel === 'full') {
        return transcriptLines.join('\n\n');
    }
    const lines = [
        detailLevel === 'compact'
            ? 'This transcript was condensed because the saved session exceeded the model token limit.'
            : 'This transcript was heavily condensed because the saved session exceeded the model token limit. Prefer the saved summary and tool call summary above.',
        ...(omittedTurns > 0 ? [`${omittedTurns} turn(s) were omitted from the transcript.`] : []),
        ...transcriptLines,
    ];
    const maxChars = detailLevel === 'compact'
        ? ANALYSIS_COMPACT_TRANSCRIPT_MAX_CHARS
        : ANALYSIS_SUMMARY_ONLY_TRANSCRIPT_MAX_CHARS;
    return truncateMiddle(lines.join('\n\n'), maxChars);
}
function buildAnalysisSummary(summary, detailLevel) {
    if (detailLevel === 'compact') {
        return truncateMiddle(summary, ANALYSIS_COMPACT_SUMMARY_MAX_CHARS);
    }
    if (detailLevel === 'summaryOnly') {
        return truncateMiddle(summary, ANALYSIS_SUMMARY_ONLY_SUMMARY_MAX_CHARS);
    }
    return summary;
}
function buildEvidenceCompressionGuidance(detailLevel) {
    if (detailLevel === 'compact') {
        return 'Some saved-session evidence below was condensed to fit the model token limit. Prefer the saved summary and tool call summary when transcript snippets are abbreviated.';
    }
    if (detailLevel === 'summaryOnly') {
        return 'Some saved-session evidence below uses summary-only evidence because the full transcript exceeded the model token limit. Prefer the saved summary, tool call summary, and preserved recent turns.';
    }
    return undefined;
}
function createRangeSelection(mode, label, start, end, onlyUnanalyzed) {
    return {
        mode,
        label,
        range: {
            start: start.toISOString(),
            end: end.toISOString(),
        },
        onlyUnanalyzed,
    };
}
function createPresetAnalysisSelection(mode, now = new Date(), onlyUnanalyzed = false) {
    const end = new Date(now);
    const start = new Date(now);
    if (mode === 'last24Hours') {
        start.setTime(now.getTime() - (24 * 60 * 60 * 1000));
        return createRangeSelection(mode, 'Last 24 Hours', start, end, onlyUnanalyzed);
    }
    if (mode === 'last7Days') {
        start.setTime(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        return createRangeSelection(mode, 'Last 7 Days', start, end, onlyUnanalyzed);
    }
    start.setTime(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    return createRangeSelection(mode, 'Last 30 Days', start, end, onlyUnanalyzed);
}
function createNeedsAnalysisSelection() {
    return {
        mode: 'needsAnalysis',
        label: 'Needs Analysis',
        range: null,
        onlyUnanalyzed: true,
    };
}
function createSingleSessionSelection(session) {
    return {
        mode: 'singleSession',
        label: `Session: ${session.title}`,
        range: null,
        sessionId: session.id,
    };
}
function createCustomRangeSelection(startInput, endInput, onlyUnanalyzed = false) {
    const start = new Date(startInput);
    const end = new Date(endInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error('Custom analysis range must use valid date values.');
    }
    if (start.getTime() > end.getTime()) {
        throw new Error('Custom analysis range start must be before the end.');
    }
    return createRangeSelection('customRange', `${start.toISOString()} to ${end.toISOString()}`, start, end, onlyUnanalyzed);
}
function parseAnalysisSelectionAlias(prompt, now = new Date()) {
    const normalized = prompt.trim().toLowerCase();
    if (!normalized.length) {
        return undefined;
    }
    if (normalized === '24h' || normalized === '1d' || normalized === 'last 24 hours' || normalized === 'last24hours') {
        return createPresetAnalysisSelection('last24Hours', now);
    }
    if (normalized === '7d' || normalized === 'last 7 days' || normalized === 'last7days') {
        return createPresetAnalysisSelection('last7Days', now);
    }
    if (normalized === '30d' || normalized === 'last 30 days' || normalized === 'last30days') {
        return createPresetAnalysisSelection('last30Days', now);
    }
    if (normalized === 'unanalyzed' || normalized === 'needs analysis' || normalized === 'needs-analysis') {
        return createNeedsAnalysisSelection();
    }
    return undefined;
}
function filterCandidatesForAnalysis(candidates, selection, analyzedFingerprints) {
    // A single-session selection targets exactly the session the user clicked,
    // so it bypasses the range filter and the analyze-chat exclusion applied to
    // bulk selections.
    if (selection.mode === 'singleSession') {
        const matched = candidates.filter((candidate) => candidate.session.id === selection.sessionId);
        return selection.onlyUnanalyzed
            ? matched.filter((candidate) => !analyzedFingerprints.has(candidate.fingerprint))
            : matched;
    }
    const eligibleCandidates = candidates.filter((candidate) => !isSessionControlAnalyzeSession(candidate.session));
    const range = selection.range;
    const rangeFiltered = !range
        ? eligibleCandidates
        : eligibleCandidates.filter((candidate) => {
            const savedAt = Date.parse(candidate.session.savedAt);
            const startTime = Date.parse(range.start);
            const endTime = Date.parse(range.end);
            return savedAt >= startTime && savedAt <= endTime;
        });
    if (!selection.onlyUnanalyzed) {
        return rangeFiltered;
    }
    return rangeFiltered.filter((candidate) => !analyzedFingerprints.has(candidate.fingerprint));
}
function isSessionControlAnalyzeSession(session) {
    if (SESSION_CONTROL_ANALYZE_PROMPT_PATTERN.test(session.title.trim())) {
        return true;
    }
    for (const turn of session.turns) {
        if (turn.type !== 'request') {
            continue;
        }
        return SESSION_CONTROL_ANALYZE_PROMPT_PATTERN.test(turn.prompt.trim());
    }
    return false;
}
function buildSessionEvidence(candidate, detailLevel = 'full') {
    const gitSummary = candidate.session.git
        ? `${candidate.session.git.branch}@${candidate.session.git.commit.slice(0, 7)}${candidate.session.git.dirty ? ' dirty' : ''}`
        : 'n/a';
    const transcript = buildAnalysisTranscript(candidate.session, detailLevel);
    const toolSummary = renderToolCalls(candidate.session, detailLevel);
    const summaryHeading = detailLevel === 'full' ? '### Saved Summary' : '### Saved Summary (condensed due to size)';
    const toolSummaryHeading = detailLevel === 'full' ? '### Tool Call Summary' : '### Tool Call Summary (condensed due to size)';
    const transcriptHeading = detailLevel === 'full' ? '### Transcript' : '### Transcript (condensed due to size)';
    return [
        `## [${candidate.workspaceName}] ${candidate.session.title}`,
        '',
        `- Saved At: ${candidate.session.savedAt}`,
        `- Session ID: ${candidate.session.id}`,
        `- Root File: ${candidate.rootFileName}`,
        `- Git: ${gitSummary}`,
        `- Total Turns: ${candidate.session.totalTurns}`,
        `- Fingerprint: ${candidate.fingerprint}`,
        '',
        summaryHeading,
        '',
        buildAnalysisSummary(candidate.session.markdownSummary, detailLevel),
        '',
        toolSummaryHeading,
        '',
        toolSummary.length ? toolSummary.join('\n') : 'No tool calls recorded.',
        '',
        transcriptHeading,
        '',
        transcript,
    ].join('\n');
}
function splitCandidatesIntoAnalysisBatches(candidates, maxChars = exports.DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET, detailLevels) {
    if (candidates.length === 0) {
        return [];
    }
    const batches = [];
    let currentBatch = [];
    let currentChars = 0;
    for (const candidate of candidates) {
        const evidenceLength = buildSessionEvidence(candidate, detailLevels?.get(candidate.fingerprint) ?? 'full').length;
        const separatorLength = currentBatch.length === 0 ? 0 : 6;
        if (currentBatch.length > 0 && currentChars + evidenceLength + separatorLength > maxChars) {
            batches.push(currentBatch);
            currentBatch = [candidate];
            currentChars = evidenceLength;
            continue;
        }
        currentBatch.push(candidate);
        currentChars += evidenceLength + separatorLength;
    }
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    return batches;
}
function buildRequiredSections() {
    return [
        'Return markdown with these sections:',
        '1. Repository-Specific Findings',
        '2. Cross-Repository Findings',
        '3. Common AI Mistakes',
        '4. Unnecessary Tool Usage',
        '5. Workflow Optimizations',
        '6. Recommended AI Skills to Create',
        '7. Coding Agent Preload Insights',
    ].join('\n');
}
function buildAnalysisPrompt(selection, candidates, existingAiFileBaseline = '', detailLevel = 'full', detailLevels) {
    const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
    const candidateLevels = candidates.map((candidate) => leastDetailedEvidenceLevel(detailLevel, detailLevels?.get(candidate.fingerprint) ?? 'full'));
    const evidence = candidates
        .map((candidate, index) => buildSessionEvidence(candidate, candidateLevels[index]))
        .join('\n\n---\n\n');
    const compressionGuidance = buildEvidenceCompressionGuidance(candidateLevels.reduce(leastDetailedEvidenceLevel, detailLevel));
    return [
        instruction,
        '',
        buildRecommendationScopeGuidance(),
        ...(compressionGuidance ? ['', compressionGuidance] : []),
        '',
        buildRequiredSections(),
        '',
        buildExistingAiBaselineSection(existingAiFileBaseline),
        '',
        'Chats to analyze:',
        '',
        evidence,
    ].join('\n');
}
function buildAnalysisSynthesisPrompt(selection, batchSummaries, existingAiFileBaseline = '') {
    const instruction = ANALYSIS_PROMPT_TEMPLATE.replace('{user chosen timeframe}', selection.label);
    return [
        instruction,
        '',
        'You are synthesizing batch-level findings from the same analysis request into one final report.',
        'Deduplicate repeated findings and keep repository-specific findings separate from cross-repository patterns.',
        '',
        buildRecommendationScopeGuidance(),
        '',
        buildRequiredSections(),
        '',
        buildExistingAiBaselineSection(existingAiFileBaseline),
        '',
        'Batch findings:',
        '',
        batchSummaries.map((summary, index) => `## Batch ${index + 1}\n\n${summary}`).join('\n\n'),
    ].join('\n');
}
function buildVerifiedRecommendationLines(reportContent) {
    const verified = reportContent === undefined ? undefined : (0, reportVerification_1.extractVerifiedRecommendations)(reportContent);
    if (verified === undefined) {
        return [];
    }
    if (verified.length === 0) {
        return [
            'Report verification left no verified recommendations: every recommendation is flagged as unsupported, unverified, or demoted for targeting files outside AI control files.',
            'Do not implement any recommendation from this report. Report that nothing was verified and stop.',
        ];
    }
    return [
        'Report verification checked each recommendation against the cited session evidence and AGENTS.md rule 13.',
        'Implement only these verified recommendations. Skip any report item flagged with a ⚠️ note or listed under Demoted Recommendations:',
        ...verified.map((text, index) => `${index + 1}. ${text.replace(/\s+/g, ' ').trim()}`),
    ];
}
/**
 * `reportContent`, when given, filters the handoff to the recommendations the
 * report verification policy left actionable.
 */
function buildImplementationHandoffPrompt(reportFilePath, userPrompt, reportContent) {
    const normalizedPrompt = userPrompt.trim().length > 0
        ? userPrompt.trim()
        : 'Implement the highest-priority recommendations from the saved analysis report.';
    return [
        'Implement the AI-control-file recommendations from the latest Session Control analysis using full workspace access.',
        `Start by reading this saved analysis report: "${reportFilePath}"`,
        'Also read AGENTS.md, .github/copilot-instructions.md, CLAUDE.md when present, and any other repository-local AI control files relevant to the first actionable recommendation.',
        'If the saved report recommends creating a new reusable AI skill, create the repository-local skill file and any supporting instruction, prompt, or agent-definition files needed for that skill.',
        'This can include creating SKILL.md, *.instructions.md, *.prompt.md, or *.agent.md files when the report identifies them as the best next improvement.',
        'Do not expand into application source files, tests, build tooling, or general documentation unless the saved report specifically calls for updating an AI control file that governs those workflows.',
        'Inspect the current working tree first so you do not assume a clean baseline before editing or validating.',
        'Make the next concrete implementation change in the relevant AI control file or new AI skill file and validate it with focused checks before expanding scope.',
        ...buildVerifiedRecommendationLines(reportContent),
        `User request: ${normalizedPrompt}`,
    ].join('\n');
}


/***/ }),
/* 2 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SUPPORTED_THRESHOLD = exports.DEMOTED_RECOMMENDATIONS_HEADING = exports.REPORT_VERIFICATION_MARKER = exports.REPORT_VERIFICATION_QUESTIONS = exports.REPORT_TARGET_KIND_CRITERIA = exports.REPORT_VERIFICATION_QUESTION_SET_VERSION = void 0;
exports.extractReportRecommendations = extractReportRecommendations;
exports.buildRecommendationVerificationState = buildRecommendationVerificationState;
exports.verifyReportRecommendations = verifyReportRecommendations;
exports.isRecommendationUnsupported = isRecommendationUnsupported;
exports.isRecommendationDemoted = isRecommendationDemoted;
exports.isRecommendationVerified = isRecommendationVerified;
exports.summarizeReportVerification = summarizeReportVerification;
exports.applyReportVerificationPolicy = applyReportVerificationPolicy;
exports.extractVerifiedRecommendations = extractVerifiedRecommendations;
const judgmentService_1 = __webpack_require__(3);
exports.REPORT_VERIFICATION_QUESTION_SET_VERSION = 'report-verification-v1';
const MAX_RECOMMENDATION_TEXT_LENGTH = 2000;
const MAX_VERIFICATION_EVIDENCE_LENGTH = 12000;
const MAX_CONCURRENT_VERIFICATION_JUDGMENTS = 4;
exports.REPORT_TARGET_KIND_CRITERIA = {
    aiControlFile: 'A repository-local AI control file such as AGENTS.md, copilot-instructions.md, CLAUDE.md, *.instructions.md, *.prompt.md, *.agent.md, or SKILL.md.',
    sourceCode: 'Application source code or tests.',
    docs: 'General documentation such as README, CHANGELOG, or wiki pages that are not AI instructions.',
    build: 'Build, packaging, CI, or tooling configuration.',
    other: 'Anything else, or no concrete file target.',
};
exports.REPORT_VERIFICATION_QUESTIONS = {
    supported: (0, judgmentService_1.noul)('Is this recommendation supported by the cited chat session evidence, meaning the evidence shows the problem or pattern the recommendation claims?'),
    targetKind: (0, judgmentService_1.choice)('What kind of repository file would this recommendation change?', exports.REPORT_TARGET_KIND_CRITERIA),
};
/**
 * Report sections whose top-level list items are recommendations. Matches the
 * required sections in `buildRequiredSections` plus any heading that names
 * recommendations explicitly.
 */
const RECOMMENDATION_SECTION_PATTERNS = [
    /\brecommend/i,
    /\bworkflow optimi[sz]ations?\b/i,
    /\bai skills? to create\b/i,
    /\bpreload insights?\b/i,
];
/** Appended to a report once the verification policy has run; `/implement` handoffs key off it. */
exports.REPORT_VERIFICATION_MARKER = '<!-- session-control:report-verification v1 -->';
/** Section that collects recommendations targeting files other than AI control files (AGENTS.md rule 13). */
exports.DEMOTED_RECOMMENDATIONS_HEADING = 'Demoted Recommendations (outside AI control files)';
/** A recommendation counts as supported at or above this `supported` probability. */
exports.SUPPORTED_THRESHOLD = 0.5;
const VERIFICATION_NOTE_PREFIX = '> ⚠️';
const LIST_ITEM_PATTERN = /^( ?)(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const FENCE_PATTERN = /^\s*(?:```|~~~)/;
function normalizeHeadingTitle(title) {
    return title
        .replace(/\*\*|__/g, '')
        .replace(/^\s*\d{1,3}[.)]\s*/, '')
        .replace(/:\s*$/, '')
        .trim();
}
function parseHeading(line) {
    const atx = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx?.[1] && atx[2] !== undefined) {
        return { level: atx[1].length, title: normalizeHeadingTitle(atx[2]) };
    }
    // A standalone bold line such as `**5. Workflow Optimizations**` acts as a heading below any ATX level.
    const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__):?\s*$/.exec(line);
    if (bold?.[1]) {
        return { level: 7, title: normalizeHeadingTitle(bold[1]) };
    }
    return undefined;
}
function isRecommendationSection(title) {
    if (title === exports.DEMOTED_RECOMMENDATIONS_HEADING) {
        return false;
    }
    return RECOMMENDATION_SECTION_PATTERNS.some((pattern) => pattern.test(title));
}
/**
 * Splits an analysis report into recommendations: each top-level list item
 * under a recommendation section, with its nested bullets and continuation
 * lines. Deterministic, so the same report always yields the same list.
 */
function extractReportRecommendations(report) {
    const lines = report.split(/\r?\n/);
    const recommendations = [];
    let section;
    let current;
    let inFence = false;
    const flush = () => {
        if (!current) {
            return;
        }
        const text = current.lines.join('\n').trim();
        if (text) {
            recommendations.push({
                index: recommendations.length,
                section: current.section,
                text,
                startLine: current.startLine,
                endLine: current.endLine,
            });
        }
        current = undefined;
    };
    lines.forEach((line, lineIndex) => {
        if (FENCE_PATTERN.test(line)) {
            inFence = !inFence;
            if (current) {
                current.lines.push(line);
                current.endLine = lineIndex;
            }
            return;
        }
        if (inFence) {
            if (current) {
                current.lines.push(line);
                current.endLine = lineIndex;
            }
            return;
        }
        const heading = parseHeading(line);
        if (heading) {
            flush();
            if (!section || heading.level <= section.level || isRecommendationSection(heading.title)) {
                section = isRecommendationSection(heading.title) ? heading : undefined;
            }
            return;
        }
        if (!section) {
            return;
        }
        const item = LIST_ITEM_PATTERN.exec(line);
        if (item && item[2] !== undefined) {
            flush();
            current = { section: section.title, lines: [item[2]], startLine: lineIndex, endLine: lineIndex };
            return;
        }
        if (!current) {
            return;
        }
        if (line.trim() === '') {
            // Blank lines stay inside an item only when indented content follows.
            current.lines.push('');
            return;
        }
        if (/^\s/.test(line)) {
            current.lines.push(line.trim());
            current.endLine = lineIndex;
            return;
        }
        // Unindented prose ends the current item.
        flush();
    });
    flush();
    return recommendations;
}
function clip(text, limit) {
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
/** Judgment state for one recommendation: its text, section, and the session evidence it should cite. */
function buildRecommendationVerificationState(recommendation, evidence) {
    return {
        section: recommendation.section,
        recommendation: clip(recommendation.text, MAX_RECOMMENDATION_TEXT_LENGTH),
        evidence: clip(evidence, MAX_VERIFICATION_EVIDENCE_LENGTH),
    };
}
function isReportTargetKind(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exports.REPORT_TARGET_KIND_CRITERIA, value);
}
function readVerification(recommendation, answers) {
    const supported = answers.supported?.noul;
    const target = answers.targetKind;
    return {
        recommendation,
        ...(typeof supported === 'number' && Number.isFinite(supported) ? { supported } : {}),
        ...(target && isReportTargetKind(target.choice) && typeof target.confidence === 'number' && Number.isFinite(target.confidence)
            ? { targetKind: { kind: target.choice, confidence: target.confidence } }
            : {}),
    };
}
/**
 * Extracts the report's recommendations and asks `supported` and `targetKind`
 * for each. Returns the recommendations without judgments, and sends nothing,
 * when TypeSafe or the `reportVerification` feature is disabled.
 */
async function verifyReportRecommendations(report, evidence, deps) {
    const recommendations = extractReportRecommendations(report);
    const results = recommendations.map((recommendation) => ({ recommendation }));
    try {
        if (!deps.judgment.isFeatureEnabled('reportVerification')) {
            return results;
        }
    }
    catch {
        return results;
    }
    const queue = [...recommendations];
    const worker = async () => {
        for (let recommendation = queue.shift(); recommendation; recommendation = queue.shift()) {
            if (deps.token?.isCancellationRequested) {
                return;
            }
            try {
                const answers = await deps.judgment.ask(buildRecommendationVerificationState(recommendation, evidence), exports.REPORT_VERIFICATION_QUESTIONS, deps.token, 'reportVerification');
                if (answers) {
                    results[recommendation.index] = readVerification(recommendation, answers);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deps.log?.(`[report-verification] recommendation ${recommendation.index + 1}: ${message}`);
            }
        }
    };
    const workerCount = Math.min(MAX_CONCURRENT_VERIFICATION_JUDGMENTS, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const judged = results.filter((result) => result.supported !== undefined || result.targetKind !== undefined).length;
    deps.log?.(`[report-verification] judged ${judged} of ${recommendations.length} recommendations`);
    return results;
}
function isRecommendationUnsupported(result) {
    return result.supported !== undefined && result.supported < exports.SUPPORTED_THRESHOLD;
}
function isRecommendationDemoted(result) {
    return result.targetKind !== undefined && result.targetKind.kind !== 'aiControlFile';
}
/** Verified means supported by the evidence and targeting an AI control file. */
function isRecommendationVerified(result) {
    return result.supported !== undefined
        && result.supported >= exports.SUPPORTED_THRESHOLD
        && result.targetKind?.kind === 'aiControlFile';
}
function buildVerificationNotes(result) {
    const notes = [];
    if (result.supported === undefined || result.targetKind === undefined) {
        notes.push(`${VERIFICATION_NOTE_PREFIX} Not verified: no verification judgment was available for this recommendation.`);
    }
    if (isRecommendationUnsupported(result)) {
        const percent = Math.round((result.supported ?? 0) * 100);
        notes.push(`${VERIFICATION_NOTE_PREFIX} Unsupported: the cited session evidence does not support this recommendation (${percent}% support).`);
    }
    if (isRecommendationDemoted(result)) {
        notes.push(`${VERIFICATION_NOTE_PREFIX} Demoted: this targets ${result.targetKind?.kind} rather than an AI control file (AGENTS.md rule 13).`);
    }
    return notes.map((note) => `  ${note}`);
}
function summarizeReportVerification(results) {
    return {
        total: results.length,
        verified: results.filter(isRecommendationVerified).length,
        unsupported: results.filter(isRecommendationUnsupported).length,
        demoted: results.filter(isRecommendationDemoted).length,
    };
}
/**
 * Applies the step-24 policy to a report: flags unsupported or unjudged
 * recommendations with a `> ⚠️` note, moves recommendations that target
 * anything other than an AI control file into a trailing demoted section, and
 * appends `REPORT_VERIFICATION_MARKER`. Returns the report unchanged when no
 * recommendation was judged, so a disabled feature leaves reports as before.
 */
function applyReportVerificationPolicy(report, results) {
    const judged = results.some((result) => result.supported !== undefined || result.targetKind !== undefined);
    if (!judged) {
        return report;
    }
    const lines = report.split(/\r?\n/);
    const byStartLine = new Map(results.map((result) => [result.recommendation.startLine, result]));
    const output = [];
    const demoted = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const result = byStartLine.get(lineIndex);
        if (!result) {
            output.push(lines[lineIndex] ?? '');
            continue;
        }
        const { startLine, endLine } = result.recommendation;
        const block = [...lines.slice(startLine, endLine + 1), ...buildVerificationNotes(result)];
        if (isRecommendationDemoted(result)) {
            demoted.push(block);
        }
        else {
            output.push(...block);
        }
        lineIndex = endLine;
    }
    while (output.length > 0 && output[output.length - 1]?.trim() === '') {
        output.pop();
    }
    if (demoted.length > 0) {
        output.push('', `## ${exports.DEMOTED_RECOMMENDATIONS_HEADING}`, '');
        demoted.forEach((block, index) => {
            if (index > 0) {
                output.push('');
            }
            output.push(...block);
        });
    }
    output.push('', exports.REPORT_VERIFICATION_MARKER, '');
    return output.join('\n');
}
/**
 * Returns the recommendations a verified report leaves actionable: those
 * outside the demoted section with no `> ⚠️` note. Returns `undefined` for a
 * report the policy never ran on, so callers keep their unfiltered behavior.
 */
function extractVerifiedRecommendations(report) {
    if (!report.includes(exports.REPORT_VERIFICATION_MARKER)) {
        return undefined;
    }
    return extractReportRecommendations(report)
        .map((recommendation) => recommendation.text)
        .filter((text) => !text.split('\n').some((line) => line.startsWith(VERIFICATION_NOTE_PREFIX)));
}


/***/ }),
/* 3 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FakeJudgmentService = exports.TypeSafeJudgmentService = exports.DEFAULT_TYPESAFE_FEATURES = exports.DEFAULT_TYPESAFE_MODEL = exports.TYPESAFE_FEATURES = exports.setTypeSafeApiKey = exports.resolveTypeSafeApiKey = exports.registerTypeSafeApiKeyCommands = exports.clearTypeSafeApiKey = exports.TYPESAFE_API_KEY_SECRET = exports.TYPESAFE_API_KEY_ENV_VAR = exports.SET_TYPESAFE_API_KEY_COMMAND = exports.CLEAR_TYPESAFE_API_KEY_COMMAND = exports.score = exports.noul = exports.choice = exports.stripToolOutputFromState = exports.DENY_TYPESAFE_CONSENT = void 0;
exports.isTypeSafeFeature = isTypeSafeFeature;
exports.resolveTypeSafeFeatures = resolveTypeSafeFeatures;
exports.mapJudgmentError = mapJudgmentError;
exports.createJudgmentService = createJudgmentService;
exports.createFakeJudgmentService = createFakeJudgmentService;
const sdk_1 = __webpack_require__(4);
Object.defineProperty(exports, "choice", ({ enumerable: true, get: function () { return sdk_1.choice; } }));
Object.defineProperty(exports, "noul", ({ enumerable: true, get: function () { return sdk_1.noul; } }));
Object.defineProperty(exports, "score", ({ enumerable: true, get: function () { return sdk_1.score; } }));
const apiKey_1 = __webpack_require__(5);
Object.defineProperty(exports, "CLEAR_TYPESAFE_API_KEY_COMMAND", ({ enumerable: true, get: function () { return apiKey_1.CLEAR_TYPESAFE_API_KEY_COMMAND; } }));
Object.defineProperty(exports, "SET_TYPESAFE_API_KEY_COMMAND", ({ enumerable: true, get: function () { return apiKey_1.SET_TYPESAFE_API_KEY_COMMAND; } }));
Object.defineProperty(exports, "TYPESAFE_API_KEY_ENV_VAR", ({ enumerable: true, get: function () { return apiKey_1.TYPESAFE_API_KEY_ENV_VAR; } }));
Object.defineProperty(exports, "TYPESAFE_API_KEY_SECRET", ({ enumerable: true, get: function () { return apiKey_1.TYPESAFE_API_KEY_SECRET; } }));
Object.defineProperty(exports, "clearTypeSafeApiKey", ({ enumerable: true, get: function () { return apiKey_1.clearTypeSafeApiKey; } }));
Object.defineProperty(exports, "registerTypeSafeApiKeyCommands", ({ enumerable: true, get: function () { return apiKey_1.registerTypeSafeApiKeyCommands; } }));
Object.defineProperty(exports, "resolveTypeSafeApiKey", ({ enumerable: true, get: function () { return apiKey_1.resolveTypeSafeApiKey; } }));
Object.defineProperty(exports, "setTypeSafeApiKey", ({ enumerable: true, get: function () { return apiKey_1.setTypeSafeApiKey; } }));
const consent_1 = __webpack_require__(7);
Object.defineProperty(exports, "DENY_TYPESAFE_CONSENT", ({ enumerable: true, get: function () { return consent_1.DENY_TYPESAFE_CONSENT; } }));
Object.defineProperty(exports, "stripToolOutputFromState", ({ enumerable: true, get: function () { return consent_1.stripToolOutputFromState; } }));
exports.TYPESAFE_FEATURES = [
    'routing',
    'triage',
    'resumeSelection',
    'reportVerification',
];
exports.DEFAULT_TYPESAFE_MODEL = 'jev-latest';
exports.DEFAULT_TYPESAFE_FEATURES = Object.freeze({
    routing: true,
    triage: true,
    resumeSelection: true,
    reportVerification: true,
});
function isTypeSafeFeature(value) {
    return (value === 'routing' ||
        value === 'triage' ||
        value === 'resumeSelection' ||
        value === 'reportVerification');
}
function resolveTypeSafeFeatures(rawFeatures) {
    const result = { ...exports.DEFAULT_TYPESAFE_FEATURES };
    if (rawFeatures && typeof rawFeatures === 'object') {
        for (const key of exports.TYPESAFE_FEATURES) {
            if (typeof rawFeatures[key] === 'boolean') {
                result[key] = rawFeatures[key];
            }
        }
    }
    return result;
}
function mapJudgmentError(error) {
    if (error instanceof sdk_1.APIUserAbortError) {
        return 'aborted';
    }
    if (error instanceof sdk_1.AuthenticationError) {
        return 'unauthorized';
    }
    if (error instanceof sdk_1.RateLimitError) {
        return 'rate-limited';
    }
    if (error instanceof sdk_1.InternalServerError) {
        return 'overloaded';
    }
    if (error instanceof sdk_1.APITimeoutError) {
        return 'timeout';
    }
    if (error instanceof sdk_1.APIConnectionError) {
        return 'connection';
    }
    if (error instanceof sdk_1.APIError) {
        if (error.status === 401) {
            return 'unauthorized';
        }
        if (error.status === 429) {
            return 'rate-limited';
        }
        if (error.status === 529 || (error.status >= 500 && error.status < 600)) {
            return 'overloaded';
        }
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))) {
        return 'aborted';
    }
    return 'other';
}
function getVscode() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return __webpack_require__(6);
    }
    catch {
        return undefined;
    }
}
function getSessionControlConfiguration(deps) {
    if (deps?.getConfiguration) {
        try {
            return deps.getConfiguration();
        }
        catch {
            return undefined;
        }
    }
    const vs = getVscode();
    if (vs) {
        try {
            return vs.workspace.getConfiguration('session-control');
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function defaultIsEnabled(deps) {
    if (process.env.SESSION_CONTROL_TYPESAFE_ENABLED === '1' || process.env.SESSION_CONTROL_TYPESAFE_ENABLED === 'true') {
        return true;
    }
    if (process.env.SESSION_CONTROL_TYPESAFE_ENABLED === '0' || process.env.SESSION_CONTROL_TYPESAFE_ENABLED === 'false') {
        return false;
    }
    const config = getSessionControlConfiguration(deps);
    if (config) {
        try {
            return config.get('typesafe.enabled', false) ?? false;
        }
        catch {
            return false;
        }
    }
    return false;
}
function defaultGetModel(deps) {
    const envModel = process.env.SESSION_CONTROL_TYPESAFE_MODEL;
    if (envModel && envModel.trim().length > 0) {
        return envModel.trim();
    }
    const config = getSessionControlConfiguration(deps);
    if (config) {
        try {
            const model = config.get('typesafe.model', exports.DEFAULT_TYPESAFE_MODEL);
            if (model && model.trim().length > 0) {
                return model.trim();
            }
        }
        catch {
            // ignore
        }
    }
    return exports.DEFAULT_TYPESAFE_MODEL;
}
function defaultGetStripToolOutput(deps) {
    const config = getSessionControlConfiguration(deps);
    if (config) {
        try {
            return config.get('save.stripToolOutput', false) ?? false;
        }
        catch {
            return false;
        }
    }
    return false;
}
class TypeSafeJudgmentService {
    deps;
    _cachedClient;
    _cachedKey;
    _cachedBaseURL;
    _cachedModel;
    _isRePrompting = false;
    _activeRePromptPromise;
    constructor(deps = {}) {
        this.deps = {
            isEnabled: deps.isEnabled ?? (() => defaultIsEnabled(deps)),
            getApiKey: deps.getApiKey ?? (() => (0, apiKey_1.resolveTypeSafeApiKey)(deps.secrets)),
            getModel: deps.getModel ?? (() => defaultGetModel(deps)),
            getBaseURL: deps.getBaseURL ?? (() => undefined),
            createClient: deps.createClient ?? ((config) => new sdk_1.TypeSafeClient(config)),
            log: deps.log ?? (deps.outputChannel ? (msg) => deps.outputChannel?.appendLine(msg) : console.log),
            now: deps.now ?? Date.now,
            consent: deps.consent ?? consent_1.DENY_TYPESAFE_CONSENT,
            getStripToolOutput: deps.getStripToolOutput ?? (() => defaultGetStripToolOutput(deps)),
            ...(deps.secrets ? { secrets: deps.secrets } : {}),
            ...(deps.isFeatureEnabled ? { isFeatureEnabled: deps.isFeatureEnabled } : {}),
            ...(deps.getFeatures ? { getFeatures: deps.getFeatures } : {}),
            ...(deps.getConfiguration ? { getConfiguration: deps.getConfiguration } : {}),
            ...(deps.onUnauthorized ? { onUnauthorized: deps.onUnauthorized } : {}),
            ...(deps.showWarningMessage ? { showWarningMessage: deps.showWarningMessage } : {}),
            ...(deps.executeCommand ? { executeCommand: deps.executeCommand } : {}),
            ...(deps.retry ? { retry: deps.retry } : {}),
            ...(deps.timeout !== undefined ? { timeout: deps.timeout } : {}),
        };
    }
    isEnabled(feature) {
        if (feature !== undefined) {
            return this.isFeatureEnabled(feature);
        }
        return this.deps.isEnabled ? this.deps.isEnabled() : false;
    }
    isFeatureEnabled(feature) {
        if (!this.isEnabled()) {
            return false;
        }
        if (!isTypeSafeFeature(feature)) {
            return false;
        }
        if (this.deps.isFeatureEnabled) {
            return this.deps.isFeatureEnabled(feature);
        }
        if (this.deps.isEnabled && this.deps.isEnabled.length > 0) {
            return this.deps.isEnabled(feature);
        }
        if (this.deps.getFeatures) {
            const features = this.deps.getFeatures();
            const val = features?.[feature];
            if (typeof val === 'boolean') {
                return val;
            }
        }
        const config = getSessionControlConfiguration(this.deps);
        if (config) {
            try {
                const rawFeatures = config.get('typesafe.features');
                if (rawFeatures && typeof rawFeatures === 'object' && typeof rawFeatures[feature] === 'boolean') {
                    return rawFeatures[feature];
                }
            }
            catch {
                // ignore
            }
        }
        return exports.DEFAULT_TYPESAFE_FEATURES[feature];
    }
    get activeRePrompt() {
        return this._activeRePromptPromise;
    }
    log(message) {
        this.deps.log?.(message);
    }
    getClient(apiKey, baseURL, defaultModel) {
        if (this._cachedClient &&
            this._cachedKey === apiKey &&
            this._cachedBaseURL === baseURL &&
            this._cachedModel === defaultModel) {
            return this._cachedClient;
        }
        const createClient = this.deps.createClient ?? ((config) => new sdk_1.TypeSafeClient(config));
        const clientConfig = {
            apiKey,
            ...(baseURL !== undefined ? { baseURL } : {}),
            ...(defaultModel !== undefined ? { defaultModel } : {}),
            ...(this.deps.retry !== undefined ? { retry: this.deps.retry } : {}),
            ...(this.deps.timeout !== undefined ? { timeout: this.deps.timeout } : {}),
        };
        const client = createClient(clientConfig);
        this._cachedClient = client;
        this._cachedKey = apiKey;
        this._cachedBaseURL = baseURL;
        this._cachedModel = defaultModel;
        return client;
    }
    triggerKeyRePrompt() {
        if (this._isRePrompting) {
            return;
        }
        this._isRePrompting = true;
        const promise = (async () => {
            try {
                if (this.deps.onUnauthorized) {
                    await this.deps.onUnauthorized();
                    return;
                }
                const vs = getVscode();
                const showWarning = this.deps.showWarningMessage
                    ?? (vs ? ((msg, ...items) => vs.window.showWarningMessage(msg, ...items)) : undefined);
                const execCmd = this.deps.executeCommand
                    ?? (vs ? ((cmd, ...args) => vs.commands.executeCommand(cmd, ...args)) : undefined);
                if (!showWarning) {
                    return;
                }
                const choiceSelected = await showWarning('TypeSafe API key is invalid or unauthorized.', 'Update API Key');
                if (choiceSelected === 'Update API Key' && execCmd) {
                    await execCmd(apiKey_1.SET_TYPESAFE_API_KEY_COMMAND);
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.log(`[typesafe] key re-prompt handler failed: ${msg}`);
            }
            finally {
                this._isRePrompting = false;
                this._activeRePromptPromise = undefined;
            }
        })();
        this._activeRePromptPromise = promise;
    }
    async ask(state, questions, token, options) {
        const feature = typeof options === 'string' ? options : options?.feature;
        const cache = typeof options === 'object' ? options.cache : undefined;
        if (feature !== undefined) {
            if (!this.isFeatureEnabled(feature)) {
                return undefined;
            }
        }
        else if (!this.isEnabled()) {
            return undefined;
        }
        if (token?.isCancellationRequested) {
            return undefined;
        }
        if (cache) {
            try {
                const cached = await cache.store.getJudgment(cache.storageDirectory, cache.sessionFingerprint, cache.questionSetVersion);
                if (cached) {
                    this.log(`[typesafe] cache hit key=${cache.sessionFingerprint}:${cache.questionSetVersion}`);
                    return cached.answers;
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log(`[typesafe] cache read error: ${message}`);
            }
        }
        let apiKey;
        try {
            apiKey = this.deps.getApiKey ? await this.deps.getApiKey() : undefined;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[typesafe] error resolving API key: ${message}`);
            return undefined;
        }
        if (!apiKey) {
            return undefined;
        }
        let consented = false;
        try {
            consented = await (this.deps.consent ?? consent_1.DENY_TYPESAFE_CONSENT).ensureConsent();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[typesafe] error checking consent: ${message}`);
        }
        if (!consented || token?.isCancellationRequested) {
            return undefined;
        }
        let payloadState = state;
        try {
            if (this.deps.getStripToolOutput?.()) {
                payloadState = (0, consent_1.stripToolOutputFromState)(state);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[typesafe] error applying stripToolOutput: ${message}`);
            return undefined;
        }
        const baseURL = this.deps.getBaseURL ? this.deps.getBaseURL() : undefined;
        const model = this.deps.getModel ? this.deps.getModel() : undefined;
        let client;
        try {
            client = this.getClient(apiKey, baseURL, model);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[typesafe] error creating client: ${message}`);
            return undefined;
        }
        const controller = new AbortController();
        if (token?.isCancellationRequested) {
            controller.abort();
            return undefined;
        }
        const subscription = token?.onCancellationRequested(() => {
            controller.abort();
        });
        const startTime = (this.deps.now ?? Date.now)();
        try {
            const request = {
                state: payloadState,
                questions,
                ...(model !== undefined ? { model } : {}),
            };
            const options = {
                signal: controller.signal,
            };
            const result = await client.systemOne(request, options);
            const latencyMs = (this.deps.now ?? Date.now)() - startTime;
            this.log(`[typesafe] success model=${result.model} latency=${latencyMs}ms inputTokens=${result.usage.input_tokens} outputTokens=${result.usage.output_tokens}`);
            if (cache) {
                try {
                    await cache.store.saveJudgment(cache.storageDirectory, {
                        sessionFingerprint: cache.sessionFingerprint,
                        questionSetVersion: cache.questionSetVersion,
                        answers: result.answers,
                        ...(result.model !== undefined ? { model: result.model } : {}),
                        ...(result.usage !== undefined
                            ? {
                                usage: {
                                    input_tokens: result.usage.input_tokens,
                                    output_tokens: result.usage.output_tokens,
                                },
                            }
                            : {}),
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.log(`[typesafe] cache write error: ${message}`);
                }
            }
            return result.answers;
        }
        catch (error) {
            const latencyMs = (this.deps.now ?? Date.now)() - startTime;
            const kind = mapJudgmentError(error);
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[typesafe] error kind=${kind} latency=${latencyMs}ms message=${message}`);
            if (kind === 'unauthorized') {
                this.triggerKeyRePrompt();
            }
            return undefined;
        }
        finally {
            subscription?.dispose();
        }
    }
}
exports.TypeSafeJudgmentService = TypeSafeJudgmentService;
function createJudgmentService(overrides = {}) {
    return new TypeSafeJudgmentService(overrides);
}
class FakeJudgmentService {
    _enabled;
    _features;
    _answers;
    _error;
    _handler;
    calls = [];
    constructor(options = {}) {
        this._enabled = options.enabled ?? true;
        this._features = resolveTypeSafeFeatures(options.features);
        this._answers = options.answers;
        this._error = options.error;
        this._handler = options.handler;
    }
    isEnabled(feature) {
        if (feature !== undefined) {
            return this.isFeatureEnabled(feature);
        }
        return this._enabled;
    }
    isFeatureEnabled(feature) {
        if (!this._enabled) {
            return false;
        }
        if (!isTypeSafeFeature(feature)) {
            return false;
        }
        return this._features[feature] ?? true;
    }
    setEnabled(enabled) {
        this._enabled = enabled;
    }
    setFeatureEnabled(feature, enabled) {
        this._features[feature] = enabled;
    }
    setFeatures(features) {
        this._features = resolveTypeSafeFeatures(features);
    }
    setAnswers(answers) {
        this._answers = answers;
    }
    setError(error) {
        this._error = error;
    }
    setHandler(handler) {
        this._handler = handler;
    }
    clearCalls() {
        this.calls.length = 0;
    }
    async ask(state, questions, token, options) {
        this.calls.push({
            state,
            questions,
            ...(token ? { token } : {}),
            ...(options !== undefined ? { options } : {}),
        });
        const feature = typeof options === 'string' ? options : options?.feature;
        const cache = typeof options === 'object' ? options.cache : undefined;
        if (feature !== undefined) {
            if (!this.isFeatureEnabled(feature)) {
                return undefined;
            }
        }
        else if (!this._enabled) {
            return undefined;
        }
        if (token?.isCancellationRequested) {
            return undefined;
        }
        if (cache) {
            try {
                const cached = await cache.store.getJudgment(cache.storageDirectory, cache.sessionFingerprint, cache.questionSetVersion);
                if (cached) {
                    return cached.answers;
                }
            }
            catch {
                // ignore
            }
        }
        if (this._error) {
            return undefined;
        }
        let resultAnswers;
        if (this._handler) {
            resultAnswers = await this._handler(state, questions, token, options);
        }
        else if (this._answers) {
            resultAnswers = this._answers;
        }
        if (resultAnswers !== undefined && cache) {
            try {
                await cache.store.saveJudgment(cache.storageDirectory, {
                    sessionFingerprint: cache.sessionFingerprint,
                    questionSetVersion: cache.questionSetVersion,
                    answers: resultAnswers,
                });
            }
            catch {
                // ignore
            }
        }
        return resultAnswers;
    }
}
exports.FakeJudgmentService = FakeJudgmentService;
function createFakeJudgmentService(options = {}) {
    return new FakeJudgmentService(options);
}


/***/ }),
/* 4 */
/***/ ((__unused_webpack_module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const requestIdFrom = (headers) => headers.get("x-typesafe-request-id") ?? void 0;
/**
* A promise for the parsed result with access to the HTTP response.
*
* Non-2xx responses reject with an `APIError`, including through `asResponse()`.
*/
var APIPromise = class APIPromise extends Promise {
	#responsePromise;
	#parseResponse;
	#parsed;
	constructor(responsePromise, parseResponse) {
		super((resolve) => resolve(void 0));
		this.#responsePromise = responsePromise;
		this.#parseResponse = parseResponse;
	}
	/**
	* Resolves to the raw `Response` without parsing the body. SDK requests buffer the full
	* body under the request timeout before handoff; reading it afterwards is caller-owned.
	* The caller owns the body; don't also `await` the parsed result on the same promise.
	*/
	asResponse() {
		return this.#responsePromise;
	}
	/** Return the parsed result, HTTP response, and request ID. */
	async withResponse() {
		const [data, response] = await Promise.all([this.#parse(), this.#responsePromise]);
		return {
			data,
			response,
			requestId: requestIdFrom(response.headers)
		};
	}
	/** Transform the parsed result, sharing the HTTP response and a single body parse. */
	map(fn) {
		return new APIPromise(this.#responsePromise, () => this.#parse().then(fn));
	}
	#parse() {
		this.#parsed ??= this.#responsePromise.then(this.#parseResponse);
		return this.#parsed;
	}
	then(onfulfilled, onrejected) {
		return this.#parse().then(onfulfilled, onrejected);
	}
	catch(onrejected) {
		return this.#parse().catch(onrejected);
	}
	finally(onfinally) {
		return this.#parse().finally(onfinally);
	}
};
//#endregion
//#region src/env.ts
/** Environment variable names for client configuration. Explicit options take precedence. */
const ENV = {
	/** Required API key; used when `apiKey` is omitted. */
	apiKey: "TYPESAFE_API_KEY",
	/** API root; defaults to `https://api.typesafe.ai`. */
	baseURL: "TYPESAFE_BASE_URL",
	/** Default model name; defaults to `jev-latest`. */
	defaultModel: "TYPESAFE_DEFAULT_MODEL",
	/** Log level; defaults to `warn`. */
	logLevel: "TYPESAFE_LOG_LEVEL"
};
/** Read a trimmed environment value, returning `undefined` for missing or blank values. */
const readEnv = (name) => {
	if (typeof process === "undefined" || !process.env) return void 0;
	return process.env[name]?.trim() || void 0;
};
/** Return the explicit value, falling back to the environment. */
const fromCodeOrEnv = (fromCode, envVar) => fromCode ?? readEnv(envVar);
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
/** Default SDK retry policy. */
const DEFAULT_RETRY_POLICY = {
	maxRetries: 2,
	backoffInitialMs: 500,
	backoffMaxMs: 5e3,
	backoffJitter: .25,
	/** HTTP 408, 429, and 5xx responses. */
	httpStatuses: /* @__PURE__ */ new Set([
		408,
		429,
		...range(500, 600)
	]),
	respectRetryAfter: true,
	/** Maximum server retry delay before falling back to backoff. */
	maxRetryAfterMs: 6e4,
	apiConnectionError: true,
	apiTimeoutError: true
};
DEFAULT_RETRY_POLICY.maxRetries;
/** Whether the policy retries an HTTP status code. */
const isRetryableStatus = (status, policy = DEFAULT_RETRY_POLICY) => policy.httpStatuses.has(status);
/**
* Parse `retry-after-ms` or `Retry-After` into milliseconds, preferring `retry-after-ms`.
*
* Return `undefined` when neither header contains a valid delay.
*/
const parseRetryAfter = (headers, now = Date.now()) => {
	const ms = Number(headers.get("retry-after-ms"));
	if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
	const raw = headers.get("retry-after");
	if (raw === null) return void 0;
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1e3 : void 0;
	const date = Date.parse(raw);
	if (!Number.isNaN(date)) return Math.max(0, date - now);
};
/**
* Calculate the delay in milliseconds for a zero-based retry attempt.
*
* Use an allowed server delay; otherwise use capped exponential backoff with jitter.
*/
const retryDelayMs = (attempt, headers, policy = DEFAULT_RETRY_POLICY, random = Math.random) => {
	if (policy.respectRetryAfter && headers !== void 0) {
		const retryAfter = parseRetryAfter(headers);
		if (retryAfter !== void 0 && retryAfter <= policy.maxRetryAfterMs) return retryAfter;
	}
	const exponential = Math.min(policy.backoffInitialMs * 2 ** attempt, policy.backoffMaxMs);
	return Math.round(exponential * (1 - random() * policy.backoffJitter));
};
/** Wait `ms` milliseconds, rejecting with `signal.reason` on cancellation. */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
	if (signal?.aborted) return reject(signal.reason);
	const onAbort = () => {
		clearTimeout(timer);
		reject(signal?.reason);
	};
	const timer = setTimeout(() => {
		signal?.removeEventListener("abort", onAbort);
		resolve();
	}, ms);
	signal?.addEventListener("abort", onAbort, { once: true });
});
//#endregion
//#region src/errors.ts
/** Base class for SDK errors. */
var TypeSafeError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = new.target.name;
	}
};
const isRecord = (value) => typeof value === "object" && value !== null;
/** Extract a message from a text, error, or validation response body. */
const extractMessage = (body) => {
	if (typeof body === "string") return body || void 0;
	if (!isRecord(body)) return void 0;
	const { error, message, detail } = body;
	if (typeof error === "string") return error;
	if (isRecord(error) && typeof error.message === "string") return error.message;
	if (typeof message === "string") return message;
	if (typeof detail === "string") return detail;
	if (isRecord(detail) && typeof detail.message === "string") return detail.message;
	if (Array.isArray(detail)) return describeValidationErrors(detail);
};
/** Format validation errors as semicolon-separated `path: message` entries. */
const describeValidationErrors = (errors) => {
	const parts = errors.flatMap((e) => {
		if (!isRecord(e) || typeof e.msg !== "string") return [];
		const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== "body").join(".") : "";
		return [loc ? `${loc}: ${e.msg}` : e.msg];
	});
	return parts.length > 0 ? parts.join("; ") : void 0;
};
const MAX_RAW_BODY_IN_MESSAGE = 200;
/** An unsuccessful HTTP response from the API. */
var APIError = class APIError extends TypeSafeError {
	/** HTTP response status code. */
	status;
	/** HTTP response headers. */
	headers;
	/** Parsed JSON, response text, or `undefined` for an empty body. */
	body;
	/** Request ID from `x-typesafe-request-id`, or `undefined` when absent. */
	requestId;
	constructor(status, body, headers, message) {
		super(message ?? APIError.describe(status, body));
		this.status = status;
		this.body = body;
		this.headers = headers;
		this.requestId = requestIdFrom(headers);
	}
	static describe(status, body) {
		const detail = extractMessage(body);
		if (detail) return `${status} ${detail}`;
		if (body === void 0) return `${status} status code (no body)`;
		const raw = typeof body === "string" ? body : JSON.stringify(body);
		return `${status} ${raw.length > MAX_RAW_BODY_IN_MESSAGE ? `${raw.slice(0, MAX_RAW_BODY_IN_MESSAGE)}…` : raw}`;
	}
	/** Create the error subclass for an HTTP status code. */
	static fromResponse(status, body, headers) {
		if (status === 400) return new BadRequestError(status, body, headers);
		if (status === 401) return new AuthenticationError(status, body, headers);
		if (status === 403) return new PermissionDeniedError(status, body, headers);
		if (status === 404) return new NotFoundError(status, body, headers);
		if (status === 422) return new UnprocessableEntityError(status, body, headers);
		if (status === 429) return new RateLimitError(status, body, headers);
		if (status >= 500) return new InternalServerError(status, body, headers);
		return new APIError(status, body, headers);
	}
};
/** HTTP 400: the request is invalid. */
var BadRequestError = class extends APIError {};
/** HTTP 401: authentication failed. */
var AuthenticationError = class extends APIError {};
/** HTTP 403: access is denied. */
var PermissionDeniedError = class extends APIError {};
/** HTTP 404: the resource was not found. */
var NotFoundError = class extends APIError {};
/** HTTP 422: request validation failed. */
var UnprocessableEntityError = class extends APIError {};
/** HTTP 429: the rate limit was exceeded. */
var RateLimitError = class extends APIError {
	/** Server retry delay in milliseconds, or `undefined` when absent or invalid. */
	retryAfterMs = parseRetryAfter(this.headers);
};
/** HTTP 5xx: the server failed to handle the request. */
var InternalServerError = class extends APIError {};
/** The request or response-body delivery failed (DNS, TLS, connection closed, etc.). */
var APIConnectionError = class extends TypeSafeError {
	constructor(message = "Connection error.", options) {
		super(message, options);
	}
};
/** The full response did not arrive within the timeout. A kind of `APIConnectionError`. */
var APITimeoutError = class extends APIConnectionError {
	/** Configured timeout in milliseconds. */
	timeoutMs;
	constructor(timeoutMs, options) {
		super(`Request timed out after ${timeoutMs}ms.`, options);
		this.timeoutMs = timeoutMs;
	}
};
/** The caller cancelled the request through an `AbortSignal`. */
var APIUserAbortError = class extends TypeSafeError {
	constructor(message = "Request was aborted.", options) {
		super(message, options);
	}
};
//#endregion
//#region src/logging.ts
/** Supported log levels, from most to least verbose. */
const LOG_LEVELS = [
	"debug",
	"info",
	"warn",
	"error",
	"off"
];
const DEFAULT_LOG_LEVEL = "warn";
const isLogLevel = (value) => LOG_LEVELS.includes(value);
/** Validate a configured log level, throwing `TypeSafeError` for unknown values. */
const parseLogLevel = (value, source) => {
	if (isLogLevel(value)) return value;
	throw new TypeSafeError(`Invalid log level "${value}" from ${source}. Expected one of: ${LOG_LEVELS.join(", ")}.`);
};
const PREFIX = "[typesafe-sdk]";
/** Default console logger with the `[typesafe-sdk]` prefix. */
const consoleLogger = {
	debug: (message, ...args) => console.debug(`${PREFIX} ${message}`, ...args),
	info: (message, ...args) => console.info(`${PREFIX} ${message}`, ...args),
	warn: (message, ...args) => console.warn(`${PREFIX} ${message}`, ...args),
	error: (message, ...args) => console.error(`${PREFIX} ${message}`, ...args)
};
const RANK = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	off: 4
};
const drop = () => {};
/** Filter logger calls to the configured level and above. */
const withLevel = (sink, level) => {
	const enabled = (at) => RANK[at] >= RANK[level];
	return {
		debug: enabled("debug") ? (message, ...args) => sink.debug(message, ...args) : drop,
		info: enabled("info") ? (message, ...args) => sink.info(message, ...args) : drop,
		warn: enabled("warn") ? (message, ...args) => sink.warn(message, ...args) : drop,
		error: enabled("error") ? (message, ...args) => sink.error(message, ...args) : drop
	};
};
/** Credential headers that retain a key suffix for identification. */
const KEY_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key"
]);
/** Headers whose values are redacted in full. */
const OPAQUE_HEADERS = /* @__PURE__ */ new Set(["cookie", "set-cookie"]);
/** Mask a key, preserving its scheme and the last four characters of secrets longer than eight. */
const redactKey = (value) => {
	const [scheme, secret] = value.includes(" ") ? value.split(/\s+/, 2) : [void 0, value];
	const tail = secret && secret.length > 8 ? secret.slice(-4) : "";
	return `${scheme ? `${scheme} ` : ""}***${tail}`;
};
const redact = (name, value) => {
	const lower = name.toLowerCase();
	if (KEY_HEADERS.has(lower)) return redactKey(value);
	if (OPAQUE_HEADERS.has(lower)) return "***";
	return value;
};
/** Copy headers with known credential values redacted. */
const redactHeaders = (headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, redact(name, value)]));
//#endregion
//#region src/questions.ts
/**
* Create a yes/no question with optional descriptions for either outcome.
*
* @param instructions - The question as text, a JSON object or array; defaults to `null`.
* @param criteria - Optional descriptions of the yes and no outcomes.
*/
const noul = (instructions = null, criteria) => ({
	type: "noul",
	instructions,
	criteria
});
/**
* Create a score question using an ordered rubric.
*
* @param instructions - The question as text, a JSON object or array, or `null`.
* @param criteria - At least two descriptions indexed by score from zero; entries may be `null`.
*/
const score = (instructions, criteria) => {
	if (!Array.isArray(criteria)) throw new TypeSafeError("Score criteria must be a list of descriptions indexed by score from zero, not a map.");
	return {
		type: "score",
		instructions,
		criteria
	};
};
/**
* Create a question that selects between named alternatives.
*
* @param instructions - The question as text, a JSON object or array, or `null`.
* @param criteria - Labels mapped to descriptions, or `null` for undescribed labels.
*/
const choice = (instructions, criteria) => {
	if (Array.isArray(criteria)) throw new TypeSafeError("Choice criteria must be a map of labels to descriptions, not a list.");
	return {
		type: "choice",
		instructions,
		criteria
	};
};
/** Reject empty question sets and score questions without a list of at least two criteria. */
const validateQuestions = (questions) => {
	if (Object.keys(questions).length === 0) throw new TypeSafeError("At least one question is required.");
	for (const [name, question] of Object.entries(questions)) {
		if (question.type !== "score") continue;
		if (!Array.isArray(question.criteria)) throw new TypeSafeError(`Score question "${name}" has criteria that are not a list; score criteria must be a list of descriptions indexed by score from zero.`);
		if (question.criteria.length < 2) throw new TypeSafeError(`Score question "${name}" has ${question.criteria.length} criteria; at least two scores are required.`);
	}
};
//#endregion
//#region src/resources/models.ts
/** Access to the Models API resource. */
var Models = class {
	#transport;
	constructor(transport) {
		this.#transport = transport;
	}
	/** List the models available to the account. */
	list(options = {}) {
		return this.#transport.request("GET", "/v1/models", options).map(unwrapModels);
	}
};
const unwrapModels = (wire) => {
	if (Array.isArray(wire?.models)) return wire.models;
	throw new TypeSafeError("Unexpected response shape from GET /v1/models; expected { models: [...] }.");
};
//#endregion
//#region src/runtime.ts
const g = globalThis;
/** Whether browser page globals are present. */
const isBrowser = () => typeof g.window !== "undefined" && typeof g.window.document !== "undefined" && typeof g.navigator !== "undefined";
/** Runtime name, version, and platform for the `X-TypeSafe-Runtime` header. */
const describeRuntime = () => {
	const platform = g.process?.platform && g.process?.arch ? ` (${g.process.platform}; ${g.process.arch})` : "";
	if (g.Bun?.version) return `bun/${g.Bun.version}${platform}`;
	if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}${platform}`;
	if (g.EdgeRuntime !== void 0) return "vercel-edge";
	if (g.navigator?.userAgent === "Cloudflare-Workers") return "cloudflare-workers";
	if (g.process?.versions?.node) return `node/${g.process.versions.node}${platform}`;
	if (isBrowser()) return "browser";
	return "unknown";
};
//#endregion
//#region src/version.ts
const VERSION = "0.6.0";
const missingApiKey = () => {
	throw new TypeSafeError(`No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the ${ENV.apiKey} environment variable.`);
};
const missingFetch = () => {
	throw new TypeSafeError("No global `fetch` is available in this runtime. Pass a `fetch` implementation to the TypeSafeClient constructor.");
};
const refuseBrowser = () => {
	throw new TypeSafeError("TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true` if you understand the risk.");
};
/** Call global `fetch` with its required receiver in browsers. */
const defaultFetch = (input, init) => globalThis.fetch(input, init);
const assertNonNegativeInteger = (name, value) => {
	if (!Number.isInteger(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative integer, got ${String(value)}.`);
	return value;
};
const assertPositiveMs = (name, value) => {
	if (!Number.isFinite(value) || value <= 0) throw new TypeSafeError(`\`${name}\` must be a positive number of milliseconds, got ${String(value)}.`);
	return value;
};
const assertNonNegativeMs = (name, value) => {
	if (!Number.isFinite(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative number of milliseconds, got ${String(value)}.`);
	return value;
};
const assertFraction = (name, value) => {
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeSafeError(`\`${name}\` must be between 0 and 1, got ${String(value)}.`);
	return value;
};
const assertStatusSet = (name, statuses) => {
	for (const status of statuses) if (!Number.isInteger(status) || status < 100 || status > 999) throw new TypeSafeError(`\`${name}\` must contain HTTP status codes, got ${String(status)}.`);
	return statuses;
};
/** Merge and validate retry overrides, copying the status set to isolate later mutations. */
const resolveRetryPolicy = (base, overrides) => {
	const o = overrides ?? {};
	return {
		maxRetries: o.maxRetries === void 0 ? base.maxRetries : assertNonNegativeInteger("retry.maxRetries", o.maxRetries),
		backoffInitialMs: o.backoffInitialMs === void 0 ? base.backoffInitialMs : assertNonNegativeMs("retry.backoffInitialMs", o.backoffInitialMs),
		backoffMaxMs: o.backoffMaxMs === void 0 ? base.backoffMaxMs : assertNonNegativeMs("retry.backoffMaxMs", o.backoffMaxMs),
		backoffJitter: o.backoffJitter === void 0 ? base.backoffJitter : assertFraction("retry.backoffJitter", o.backoffJitter),
		httpStatuses: new Set(o.httpStatuses === void 0 ? base.httpStatuses : assertStatusSet("retry.httpStatuses", o.httpStatuses)),
		respectRetryAfter: o.respectRetryAfter ?? base.respectRetryAfter,
		maxRetryAfterMs: o.maxRetryAfterMs === void 0 ? base.maxRetryAfterMs : assertNonNegativeMs("retry.maxRetryAfterMs", o.maxRetryAfterMs),
		apiConnectionError: o.apiConnectionError ?? base.apiConnectionError,
		apiTimeoutError: o.apiTimeoutError ?? base.apiTimeoutError
	};
};
/** Whether the policy retries a connection error or timeout. */
const isRetryableError = (err, policy) => {
	if (err instanceof APITimeoutError) return policy.apiTimeoutError;
	if (err instanceof APIConnectionError) return policy.apiConnectionError;
	return false;
};
/** Resolve and validate the log level from configuration or the environment. */
const resolveLogLevel = (fromCode) => {
	if (fromCode !== void 0) return parseLogLevel(fromCode, "the `logLevel` option");
	const fromEnv = readEnv(ENV.logLevel);
	if (fromEnv !== void 0) return parseLogLevel(fromEnv, ENV.logLevel);
	return DEFAULT_LOG_LEVEL;
};
const stripTrailingSlashes = (url) => url.replace(/\/+$/, "");
/** Last value wins regardless of casing; undefined removes a protected header. */
const mergeHeaders = (...sources) => {
	const entries = /* @__PURE__ */ new Map();
	for (const source of sources) for (const [name, value] of Object.entries(source)) if (value === void 0) entries.delete(name.toLowerCase());
	else entries.set(name.toLowerCase(), [name, value]);
	return Object.fromEntries(entries.values());
};
/** Drain a clone so the original response retains its metadata and a readable, buffered body. */
const bufferResponse = async (response, signal) => {
	const reader = response.clone().body?.getReader();
	if (!reader) return;
	const cancel = () => {
		reader.cancel(signal.reason).catch(() => {});
		response.body?.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener("abort", cancel, { once: true });
	try {
		if (signal.aborted) cancel();
		signal.throwIfAborted();
		while (!(await reader.read()).done) signal.throwIfAborted();
		signal.throwIfAborted();
	} finally {
		signal.removeEventListener("abort", cancel);
		reader.releaseLock();
	}
};
/** Runtime description cached for the process lifetime. */
const RUNTIME = describeRuntime();
/** Client for the TypeSafe AI API. */
var TypeSafeClient = class {
	/** API key excluded from serialization and public properties. */
	#apiKey;
	/** API root with trailing slashes removed. */
	baseURL;
	/** Model used when a request omits `model`. */
	defaultModel;
	/** Configured log verbosity. */
	logLevel;
	/** The configured logger, filtered to `logLevel`. */
	logger;
	/** Retry settings with constructor overrides applied. */
	retry;
	/** Timeout per attempt in milliseconds. */
	timeout;
	/** Additional headers sent with each request. */
	defaultHeaders;
	/** HTTP fetch implementation. */
	fetch;
	/** The models available to the account. */
	models;
	#requestCount = 0;
	/**
	* Create a client for the TypeSafe AI API.
	*
	* Explicit options take precedence over environment variables, then SDK defaults.
	* Empty or whitespace-only environment values are ignored.
	*
	* @throws {TypeSafeError} The API key is missing, configuration is invalid, or the runtime is unsupported.
	*/
	constructor(config = {}) {
		if (isBrowser() && !config.dangerouslyAllowBrowser) refuseBrowser();
		this.#apiKey = fromCodeOrEnv(config.apiKey, ENV.apiKey) ?? missingApiKey();
		this.baseURL = stripTrailingSlashes(fromCodeOrEnv(config.baseURL, ENV.baseURL) ?? "https://api.typesafe.ai");
		this.defaultModel = fromCodeOrEnv(config.defaultModel, ENV.defaultModel) ?? "jev-latest";
		this.logLevel = resolveLogLevel(config.logLevel);
		this.logger = withLevel(config.logger ?? consoleLogger, this.logLevel);
		this.retry = resolveRetryPolicy(DEFAULT_RETRY_POLICY, config.retry);
		this.timeout = assertPositiveMs("timeout", config.timeout ?? 1e4);
		this.defaultHeaders = { ...config.defaultHeaders };
		if (config.fetch === void 0 && typeof globalThis.fetch !== "function") missingFetch();
		this.fetch = config.fetch ?? defaultFetch;
		const transport = {
			request: (method, path, options) => this.#request(method, path, options),
			defaultModel: this.defaultModel
		};
		this.models = new Models(transport);
	}
	/**
	* Answer named questions about text or structured state.
	*
	* @param request - State, questions, and an optional model override.
	* @param options - Per-call timeout, retry, headers, and cancellation settings.
	* @returns Answers typed by question name and criteria, with model and token usage.
	* @throws {TypeSafeError} Questions are empty, or score criteria are not a list of at least two entries.
	* @throws {APIError} The server returns a non-2xx response after retries.
	* @throws {APIConnectionError} The request cannot connect or times out after retries.
	* @throws {APIUserAbortError} The caller aborts the request.
	*
	* @example
	* ```ts
	* const { answers } = await client.systemOne({
	*   state: "I was charged twice. Please help.",
	*   questions: { billing: noul("Is this about billing?") },
	* });
	* console.log(answers.billing.noul);
	* ```
	*/
	systemOne(request, options = {}) {
		validateQuestions(request.questions);
		const body = {
			...request,
			model: request.model ?? this.defaultModel
		};
		return this.#request("POST", "/v1/systemone", {
			...options,
			body
		});
	}
	/** Send a request and parse its response body. */
	#request(method, path, options = {}) {
		const resolved = {
			method,
			path,
			body: options.body,
			headers: mergeHeaders(this.defaultHeaders, options.headers ?? {}),
			signal: options.signal,
			timeout: options.timeout === void 0 ? this.timeout : assertPositiveMs("timeout", options.timeout),
			retry: resolveRetryPolicy(this.retry, options.retry)
		};
		const tag = `#${++this.#requestCount} ${method} ${path}`;
		return new APIPromise(this.fetchWithRetries(tag, resolved), async (res) => {
			const parsed = await parseBody(res);
			this.logger.debug(`${tag} <- body`, parsed);
			return parsed;
		});
	}
	/** Retry eligible failures, logging attempt summaries at `info` and headers and bodies at `debug`. */
	async fetchWithRetries(tag, req) {
		const url = `${this.baseURL}${req.path}`;
		const headers = mergeHeaders(req.headers, {
			Authorization: `Bearer ${this.#apiKey}`,
			Accept: "application/json",
			"User-Agent": `typesafe-sdk/${VERSION}`,
			"X-TypeSafe-SDK": `typesafe-sdk/${VERSION}`,
			"X-TypeSafe-Runtime": RUNTIME,
			"Content-Type": req.body === void 0 ? void 0 : "application/json",
			"X-TypeSafe-Retry-Count": void 0
		});
		const body = req.body === void 0 ? void 0 : JSON.stringify(req.body);
		for (let attempt = 0;; attempt++) {
			const retriesLeft = req.retry.maxRetries - attempt;
			const attemptHeaders = attempt === 0 ? headers : {
				...headers,
				"X-TypeSafe-Retry-Count": String(attempt)
			};
			this.logger.debug(`${tag} -> ${url}`, {
				headers: redactHeaders(attemptHeaders),
				body: req.body
			});
			const started = Date.now();
			let res;
			try {
				res = await this.attempt(tag, url, {
					method: req.method,
					headers: attemptHeaders,
					body
				}, req);
			} catch (err) {
				if (err instanceof APIUserAbortError || retriesLeft <= 0) throw err;
				if (!isRetryableError(err, req.retry)) throw err;
				await this.backOff(tag, attempt, retriesLeft, err.message, void 0, req);
				continue;
			}
			const requestId = requestIdFrom(res.headers);
			this.logger.info(`${tag} <- ${res.status} in ${Date.now() - started}ms${requestId ? ` (request ${requestId})` : ""}`);
			if (res.ok) return res;
			const errorBody = await parseBody(res);
			this.logger.debug(`${tag} <- error body`, errorBody);
			const error = APIError.fromResponse(res.status, errorBody, res.headers);
			if (retriesLeft <= 0 || !isRetryableStatus(res.status, req.retry)) throw error;
			await this.backOff(tag, attempt, retriesLeft, `${res.status}`, res.headers, req);
		}
	}
	/**
	* One HTTP round trip, including body delivery, with a timeout. The caller's signal and our
	* timer both abort the same controller; we check which fired to choose the error class.
	*/
	async attempt(tag, url, init, { signal, timeout }) {
		const controller = new AbortController();
		const abortFromCaller = () => controller.abort(signal?.reason);
		if (signal?.aborted) abortFromCaller();
		signal?.addEventListener("abort", abortFromCaller, { once: true });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeout);
		const started = Date.now();
		const elapsed = () => `${Date.now() - started}ms`;
		try {
			const response = await this.fetch(url, {
				...init,
				signal: controller.signal
			});
			await bufferResponse(response, controller.signal);
			return response;
		} catch (err) {
			if (signal?.aborted) {
				this.logger.info(`${tag} aborted by caller after ${elapsed()}`);
				throw new APIUserAbortError(void 0, { cause: err });
			}
			if (timedOut) {
				this.logger.info(`${tag} timed out after ${elapsed()}`);
				throw new APITimeoutError(timeout, { cause: err });
			}
			this.logger.info(`${tag} connection error after ${elapsed()}`, err);
			throw new APIConnectionError(err instanceof Error ? `Connection error: ${err.message}` : void 0, { cause: err });
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abortFromCaller);
		}
	}
	/** Wait before retrying; caller cancellation throws `APIUserAbortError`. */
	async backOff(tag, attempt, retriesLeft, reason, headers, { retry, signal }) {
		const delay = retryDelayMs(attempt, headers, retry);
		const nth = attempt + 1;
		const total = attempt + retriesLeft;
		this.logger.info(`${tag} retrying in ${delay}ms (retry ${nth}/${total}) after ${reason}`);
		try {
			await sleep(delay, signal);
		} catch (err) {
			this.logger.info(`${tag} aborted by caller while waiting to retry`);
			throw new APIUserAbortError(void 0, { cause: err });
		}
	}
};
const parseBody = async (res) => {
	const text = await res.text();
	if (text.length === 0) return void 0;
	if ((res.headers.get("content-type") ?? "").includes("application/json")) try {
		return JSON.parse(text);
	} catch {
		return text;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
};
//#endregion
exports.APIConnectionError = APIConnectionError;
exports.APIError = APIError;
exports.APIPromise = APIPromise;
exports.APITimeoutError = APITimeoutError;
exports.APIUserAbortError = APIUserAbortError;
exports.AuthenticationError = AuthenticationError;
exports.BadRequestError = BadRequestError;
exports.ENV = ENV;
exports.InternalServerError = InternalServerError;
exports.LOG_LEVELS = LOG_LEVELS;
exports.NotFoundError = NotFoundError;
exports.PermissionDeniedError = PermissionDeniedError;
exports.RateLimitError = RateLimitError;
exports.TypeSafeClient = TypeSafeClient;
exports.TypeSafeError = TypeSafeError;
exports.UnprocessableEntityError = UnprocessableEntityError;
exports.VERSION = VERSION;
exports.choice = choice;
exports.noul = noul;
exports.score = score;

//# sourceMappingURL=index.cjs.map

/***/ }),
/* 5 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CLEAR_TYPESAFE_API_KEY_COMMAND = exports.SET_TYPESAFE_API_KEY_COMMAND = exports.TYPESAFE_API_KEY_ENV_VAR = exports.TYPESAFE_API_KEY_SECRET = void 0;
exports.resolveTypeSafeApiKey = resolveTypeSafeApiKey;
exports.setTypeSafeApiKey = setTypeSafeApiKey;
exports.clearTypeSafeApiKey = clearTypeSafeApiKey;
exports.registerTypeSafeApiKeyCommands = registerTypeSafeApiKeyCommands;
const vscode = __importStar(__webpack_require__(6));
exports.TYPESAFE_API_KEY_SECRET = 'session-control.typesafe.apiKey';
exports.TYPESAFE_API_KEY_ENV_VAR = 'TYPESAFE_API_KEY';
exports.SET_TYPESAFE_API_KEY_COMMAND = 'session-control.setTypeSafeApiKey';
exports.CLEAR_TYPESAFE_API_KEY_COMMAND = 'session-control.clearTypeSafeApiKey';
/**
 * Resolves the TypeSafe API key following the documented resolution order:
 * 1. VS Code SecretStorage (`session-control.typesafe.apiKey`)
 * 2. Environment variable (`TYPESAFE_API_KEY`)
 *
 * Keys are never written to settings, configuration, or logs.
 */
async function resolveTypeSafeApiKey(secrets, env = process.env) {
    if (secrets) {
        try {
            const secretKey = await secrets.get(exports.TYPESAFE_API_KEY_SECRET);
            if (typeof secretKey === 'string' && secretKey.trim().length > 0) {
                return secretKey.trim();
            }
        }
        catch {
            // Gracefully fall back to env var if secret retrieval fails
        }
    }
    const envKey = env[exports.TYPESAFE_API_KEY_ENV_VAR];
    if (typeof envKey === 'string' && envKey.trim().length > 0) {
        return envKey.trim();
    }
    return undefined;
}
/**
 * Prompts the user to enter their TypeSafe API key securely via an input box
 * with masked input (`password: true`), and stores it in SecretStorage.
 * The key is never logged or written to settings.
 */
async function setTypeSafeApiKey(deps) {
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
    await deps.secrets.store(exports.TYPESAFE_API_KEY_SECRET, trimmed);
    void showInfo('TypeSafe API key saved.');
    return true;
}
/**
 * Clears the stored TypeSafe API key from SecretStorage after confirmation.
 * The key is never logged or written to settings.
 */
async function clearTypeSafeApiKey(deps, options) {
    const showWarn = deps.showWarningMessage ?? vscode.window.showWarningMessage;
    const showInfo = deps.showInformationMessage ?? vscode.window.showInformationMessage;
    if (!options?.skipConfirmation) {
        const confirmation = await showWarn('Clear your stored TypeSafe API key?', { modal: true }, 'Clear');
        if (confirmation !== 'Clear') {
            return false;
        }
    }
    await deps.secrets.delete(exports.TYPESAFE_API_KEY_SECRET);
    void showInfo('TypeSafe API key cleared.');
    return true;
}
/**
 * Registers `session-control.setTypeSafeApiKey` and `session-control.clearTypeSafeApiKey` commands.
 */
function registerTypeSafeApiKeyCommands(context, deps) {
    const registerCommand = deps?.registerCommand ?? vscode.commands.registerCommand;
    const apiKeyDeps = {
        secrets: deps?.secrets ?? context.secrets,
        ...(deps?.showInputBox ? { showInputBox: deps.showInputBox } : {}),
        ...(deps?.showInformationMessage ? { showInformationMessage: deps.showInformationMessage } : {}),
        ...(deps?.showWarningMessage ? { showWarningMessage: deps.showWarningMessage } : {}),
    };
    return [
        registerCommand(exports.SET_TYPESAFE_API_KEY_COMMAND, async () => {
            await setTypeSafeApiKey(apiKeyDeps);
        }),
        registerCommand(exports.CLEAR_TYPESAFE_API_KEY_COMMAND, async () => {
            await clearTypeSafeApiKey(apiKeyDeps);
        }),
    ];
}


/***/ }),
/* 6 */
/***/ ((module) => {

"use strict";

// Source imports command registration helpers, but this standalone runner never calls them.
module.exports = {};


/***/ }),
/* 7 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DENY_TYPESAFE_CONSENT = exports.GlobalStateConsentGate = exports.TYPESAFE_CONSENT_DETAIL = exports.TYPESAFE_CONSENT_MESSAGE = exports.TYPESAFE_CONSENT_DECLINE = exports.TYPESAFE_CONSENT_ACCEPT = exports.TYPESAFE_CONSENT_VERSION = exports.TYPESAFE_CONSENT_STATE_KEY = void 0;
exports.createGlobalStateConsentGate = createGlobalStateConsentGate;
exports.createExtensionConsentGate = createExtensionConsentGate;
exports.stripToolOutputFromState = stripToolOutputFromState;
const sessionWriter_1 = __webpack_require__(8);
exports.TYPESAFE_CONSENT_STATE_KEY = 'session-control.typesafe.consent';
exports.TYPESAFE_CONSENT_VERSION = 1;
exports.TYPESAFE_CONSENT_ACCEPT = 'Allow TypeSafe';
exports.TYPESAFE_CONSENT_DECLINE = 'Not Now';
exports.TYPESAFE_CONSENT_MESSAGE = 'Allow Session Control to send session content to TypeSafe?';
exports.TYPESAFE_CONSENT_DETAIL = [
    'TypeSafe features (routing, triage, resume selection, report verification) send the relevant session content to api.typesafe.ai for a judgment:',
    '- chat prompts and responses from the session being routed, triaged, resumed, or verified',
    '- session titles, provider names, and saved analysis report text',
    '- tool call names and arguments; tool output is replaced with a length marker when "session-control.save.stripToolOutput" is enabled',
    '',
    'Your API key stays in VS Code SecretStorage. If you choose "Not Now", every feature keeps its existing non-TypeSafe behavior and you will be asked again next session.',
].join('\n');
function isConsentRecord(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.version === exports.TYPESAFE_CONSENT_VERSION &&
        typeof value.acceptedAt === 'string');
}
/**
 * Consent gate backed by `ExtensionContext.globalState`. Acceptance is persisted;
 * a decline only suppresses the prompt for the rest of the current session.
 */
class GlobalStateConsentGate {
    deps;
    declinedThisSession = false;
    pendingPrompt;
    constructor(deps) {
        this.deps = deps;
    }
    hasConsent() {
        try {
            return isConsentRecord(this.deps.globalState.get(exports.TYPESAFE_CONSENT_STATE_KEY));
        }
        catch {
            return false;
        }
    }
    ensureConsent() {
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
    async reset() {
        this.declinedThisSession = false;
        await this.deps.globalState.update(exports.TYPESAFE_CONSENT_STATE_KEY, undefined);
    }
    async prompt() {
        let selection;
        try {
            selection = await this.deps.showConsentPrompt(exports.TYPESAFE_CONSENT_MESSAGE, exports.TYPESAFE_CONSENT_DETAIL, exports.TYPESAFE_CONSENT_ACCEPT, exports.TYPESAFE_CONSENT_DECLINE);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.log?.(`[typesafe] consent prompt failed: ${message}`);
            return false;
        }
        if (selection !== exports.TYPESAFE_CONSENT_ACCEPT) {
            this.declinedThisSession = true;
            this.deps.log?.('[typesafe] consent declined; TypeSafe features stay on fallback behavior');
            return false;
        }
        const record = {
            version: exports.TYPESAFE_CONSENT_VERSION,
            acceptedAt: new Date((this.deps.now ?? Date.now)()).toISOString(),
        };
        try {
            await this.deps.globalState.update(exports.TYPESAFE_CONSENT_STATE_KEY, record);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.log?.(`[typesafe] failed to record consent: ${message}`);
            return false;
        }
        this.deps.log?.('[typesafe] consent recorded');
        return true;
    }
}
exports.GlobalStateConsentGate = GlobalStateConsentGate;
function createGlobalStateConsentGate(deps) {
    return new GlobalStateConsentGate(deps);
}
/** Builds the extension-host gate: a modal prompt whose acceptance lives in `context.globalState`. */
function createExtensionConsentGate(context, window, log) {
    return new GlobalStateConsentGate({
        globalState: context.globalState,
        showConsentPrompt: (message, detail, accept, decline) => window.showInformationMessage(message, { modal: true, detail }, accept, decline),
        ...(log ? { log } : {}),
    });
}
/** A gate that never grants consent; the judgment service uses it when none is supplied. */
exports.DENY_TYPESAFE_CONSENT = Object.freeze({
    hasConsent: () => false,
    ensureConsent: () => Promise.resolve(false),
});
/**
 * Applies the `save.stripToolOutput` privacy path to a TypeSafe state payload: every
 * `output` string inside a `toolCalls` array is replaced with the same length marker
 * used when saving sessions.
 */
function stripToolOutputFromState(state) {
    return stripValue(state);
}
function stripValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stripValue(item));
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === 'toolCalls' && Array.isArray(child)) {
            result[key] = child.map((toolCall) => stripToolCall(toolCall));
        }
        else {
            result[key] = stripValue(child);
        }
    }
    return result;
}
function stripToolCall(toolCall) {
    if (toolCall === null || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
        return stripValue(toolCall);
    }
    const { output, ...rest } = toolCall;
    const stripped = stripValue(rest);
    if (typeof output === 'string') {
        const replaced = (0, sessionWriter_1.replaceToolOutput)(output);
        if (replaced !== undefined) {
            stripped.output = replaced;
        }
    }
    else if (output !== undefined) {
        stripped.output = '[output stripped]';
    }
    return stripped;
}


/***/ }),
/* 8 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.replaceToolOutput = replaceToolOutput;
exports.createMarkdownSummary = createMarkdownSummary;
exports.createChatSession = createChatSession;
exports.applySaveBloatControls = applySaveBloatControls;
const crypto = __importStar(__webpack_require__(9));
const utils_1 = __webpack_require__(10);
const DEFAULT_SUMMARY_MAX_TURNS = 50;
const DEFAULT_SUMMARY_MAX_CHARS = 100 * 1024;
function toIsoTimestamp(value) {
    if (value && Number.isFinite(Date.parse(value))) {
        return new Date(value).toISOString();
    }
    return new Date().toISOString();
}
function sanitizeTitle(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function formatAssistantLabel(participant) {
    const normalized = participant.trim();
    if (!normalized) {
        return 'Assistant';
    }
    if (/^copilot$/i.test(normalized)) {
        return 'Copilot';
    }
    if (/^codex$/i.test(normalized)) {
        return 'Codex';
    }
    if (/^cursor$/i.test(normalized)) {
        return 'Cursor';
    }
    if (/^claude-code$/i.test(normalized)) {
        return 'Claude Code';
    }
    return normalized
        .split(/\s+/)
        .map((segment) => segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}` : segment)
        .join(' ');
}
function estimateSessionSizeBytes(session) {
    return Buffer.byteLength(JSON.stringify(session, null, 2), 'utf8');
}
function createFileName(savedAt, title) {
    return `${(0, utils_1.formatTimestamp)(new Date(savedAt))}-${(0, utils_1.slugify)(title)}.json`;
}
function replaceToolOutput(value) {
    if (!value) {
        return value;
    }
    return `[output stripped - ${value.length} chars]`;
}
function withStrippedToolOutput(turns) {
    return turns.map((turn) => {
        if (turn.type === 'request') {
            return turn;
        }
        return {
            ...turn,
            toolCalls: turn.toolCalls.map((toolCall) => {
                const replaced = replaceToolOutput(toolCall.output);
                const normalizedToolCall = {
                    name: toolCall.name,
                };
                if (toolCall.summary !== undefined) {
                    normalizedToolCall.summary = toolCall.summary;
                }
                if (toolCall.arguments !== undefined) {
                    normalizedToolCall.arguments = toolCall.arguments;
                }
                if (replaced !== undefined) {
                    normalizedToolCall.output = replaced;
                }
                return normalizedToolCall;
            }),
        };
    });
}
function withTurns(base, turns) {
    const updated = {
        ...base,
        turns,
        totalTurns: turns.length,
        markdownSummary: '',
    };
    updated.markdownSummary = createMarkdownSummary(updated);
    return updated;
}
function splitTurnsByEstimatedSize(base, maxFileSizeBytes) {
    if (base.turns.length === 0) {
        return [[]];
    }
    const chunks = [];
    let currentChunk = [];
    for (const turn of base.turns) {
        const candidate = [...currentChunk, turn];
        const candidateSession = withTurns(base, candidate);
        const candidateSize = estimateSessionSizeBytes(candidateSession);
        if (candidateSize <= maxFileSizeBytes || currentChunk.length === 0) {
            currentChunk = candidate;
            continue;
        }
        chunks.push(currentChunk);
        currentChunk = [turn];
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    return chunks;
}
function splitSession(base, maxFileSizeBytes) {
    const chunks = splitTurnsByEstimatedSize(base, maxFileSizeBytes);
    if (chunks.length <= 1) {
        return [withTurns(base, base.turns)];
    }
    const totalParts = chunks.length;
    const parts = chunks.map((chunk, index) => {
        const partNumber = index + 1;
        const partTitle = `${base.title} (Part ${partNumber}/${totalParts})`;
        const partSession = withTurns({ ...base, title: partTitle }, chunk);
        partSession.part = partNumber;
        partSession.totalParts = totalParts;
        return partSession;
    });
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (!part) {
            continue;
        }
        const previousPart = index > 0 ? parts[index - 1] : undefined;
        const nextPart = index + 1 < parts.length ? parts[index + 1] : undefined;
        part.previousPartFile = previousPart ? createFileName(previousPart.savedAt, previousPart.title) : null;
        part.nextPartFile = nextPart ? createFileName(nextPart.savedAt, nextPart.title) : null;
    }
    return parts;
}
function truncateOldest(base, maxFileSizeBytes) {
    let turns = [...base.turns];
    let truncatedCount = 0;
    while (turns.length > 1) {
        const candidate = withTurns(base, turns);
        if (estimateSessionSizeBytes(candidate) <= maxFileSizeBytes) {
            const warning = truncatedCount > 0 ? `Truncated ${truncatedCount} oldest turn(s) to fit save.maxFileSize.` : undefined;
            return {
                sessions: [candidate],
                ...(warning ? { warning } : {}),
            };
        }
        turns = turns.slice(1);
        truncatedCount += 1;
    }
    return {
        sessions: [withTurns(base, turns)],
        warning: `Session still exceeds save.maxFileSize after truncating ${truncatedCount} turn(s).`,
    };
}
function generateTitle(turns) {
    const firstRequest = turns.find((turn) => turn.type === 'request');
    if (!firstRequest) {
        return 'Untitled Session';
    }
    const clean = sanitizeTitle(firstRequest.prompt);
    if (!clean) {
        return 'Untitled Session';
    }
    if (clean.length <= 80) {
        return clean;
    }
    return `${clean.slice(0, 77).trimEnd()}...`;
}
function renderToolCalls(toolCalls) {
    if (!toolCalls.length) {
        return null;
    }
    const rendered = toolCalls
        .map((toolCall) => {
        const summary = toolCall.summary?.trim();
        return summary ? `${toolCall.name} (${summary})` : toolCall.name;
    })
        .join(', ');
    return `> **Tool calls:** ${rendered}`;
}
function renderTurn(index, turn) {
    const turnNumber = index + 1;
    if (turn.type === 'request') {
        const references = turn.references.length
            ? `\n\n- References:\n${turn.references.map((ref) => `  - ${ref}`).join('\n')}`
            : '';
        return `### Turn ${turnNumber} - User\n${turn.prompt}${references}`;
    }
    const toolCalls = renderToolCalls(turn.toolCalls);
    return `### Turn ${turnNumber} - ${formatAssistantLabel(turn.participant)}\n${turn.content}${toolCalls ? `\n\n${toolCalls}` : ''}`;
}
function capTurnsForSummary(turns, maxTurns) {
    if (turns.length <= maxTurns) {
        return { turns, omittedCount: 0 };
    }
    const omittedCount = turns.length - maxTurns;
    return {
        turns: turns.slice(0, maxTurns),
        omittedCount,
    };
}
function enforceSummaryCharLimit(summary, turns, maxChars) {
    if (summary.length <= maxChars) {
        return summary;
    }
    if (turns.length <= 20) {
        return `${summary.slice(0, Math.max(0, maxChars - 40))}\n\n... summary truncated ...`;
    }
    const firstTen = turns.slice(0, 10);
    const lastTen = turns.slice(-10);
    const omitted = Math.max(0, turns.length - 20);
    const compact = [
        ...firstTen.map((turn, index) => renderTurn(index, turn)),
        `... ${omitted} turns omitted ...`,
        ...lastTen.map((turn, index) => renderTurn(firstTen.length + index, turn)),
    ].join('\n\n');
    if (compact.length <= maxChars) {
        return compact;
    }
    return `${compact.slice(0, Math.max(0, maxChars - 40))}\n\n... summary truncated ...`;
}
function createMarkdownSummary(session, options = {}) {
    const maxTurns = options.summaryMaxTurns ?? DEFAULT_SUMMARY_MAX_TURNS;
    const maxChars = options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS;
    const capped = capTurnsForSummary(session.turns, maxTurns);
    const commitShort = session.git?.commit ? session.git.commit.slice(0, 7) : 'n/a';
    const branch = session.git?.branch ?? 'n/a';
    const sections = capped.turns.map((turn, index) => renderTurn(index, turn));
    const omittedNote = capped.omittedCount > 0
        ? `\n\n... ${capped.omittedCount} additional turns not shown in summary`
        : '';
    const base = [
        `# Chat: ${session.title}`,
        '',
        `**Branch:** ${branch} | **Commit:** ${commitShort} | **Saved:** ${session.savedAt}`,
        `**Turns:** ${session.totalTurns}`,
        '',
        '---',
        '',
        sections.join('\n\n'),
    ].join('\n') + omittedNote;
    return enforceSummaryCharLimit(base, capped.turns, maxChars);
}
function createChatSession(source, options = {}) {
    const savedAt = toIsoTimestamp(options.savedAt);
    const title = options.title ? sanitizeTitle(options.title) : generateTitle(source.turns);
    const chatSession = {
        version: 1,
        id: source.id || crypto.randomUUID(),
        title,
        savedAt,
        provider: source.provider,
        git: options.git ?? null,
        vscodeVersion: options.vscodeVersion ?? 'unknown',
        totalTurns: source.turns.length,
        part: null,
        totalParts: null,
        previousPartFile: null,
        nextPartFile: null,
        turns: source.turns,
        markdownSummary: '',
    };
    if (options.origin !== undefined) {
        chatSession.origin = options.origin;
    }
    chatSession.markdownSummary = createMarkdownSummary(chatSession, options);
    return chatSession;
}
function applySaveBloatControls(session, options) {
    const strippedTurns = options.stripToolOutput ? withStrippedToolOutput(session.turns) : session.turns;
    const normalized = withTurns(session, strippedTurns);
    if (estimateSessionSizeBytes(normalized) <= options.maxFileSizeBytes) {
        return { sessions: [normalized] };
    }
    if (options.overflowStrategy === 'warn') {
        return {
            sessions: [normalized],
            warning: 'Session exceeds save.maxFileSize and was saved as-is because save.overflowStrategy=warn.',
        };
    }
    if (options.overflowStrategy === 'truncateOldest') {
        return truncateOldest(normalized, options.maxFileSizeBytes);
    }
    const split = splitSession(normalized, options.maxFileSizeBytes);
    if (split.length > 1) {
        return {
            sessions: split,
            warning: `Session exceeded save.maxFileSize and was split into ${split.length} part files.`,
        };
    }
    return { sessions: split };
}


/***/ }),
/* 9 */
/***/ ((module) => {

"use strict";
module.exports = require("node:crypto");

/***/ }),
/* 10 */
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.slugify = slugify;
exports.formatTimestamp = formatTimestamp;
exports.parseFileSize = parseFileSize;
exports.fuzzyMatchSessions = fuzzyMatchSessions;
const DEFAULT_SLUG = 'session';
const MAX_SLUG_LENGTH = 80;
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalize(value) {
    return value.trim().toLowerCase();
}
function toAscii(value) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}
function clampSlugLength(value) {
    if (value.length <= MAX_SLUG_LENGTH) {
        return value;
    }
    return value.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}
function orderedCharacterMatch(query, target) {
    if (!query || !target) {
        return false;
    }
    let queryIndex = 0;
    for (const char of target) {
        if (char === query[queryIndex]) {
            queryIndex += 1;
        }
        if (queryIndex >= query.length) {
            return true;
        }
    }
    return false;
}
function wordBoundaryMatch(query, target) {
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return false;
    }
    return words.every((word) => {
        const pattern = new RegExp(`\\b${escapeRegExp(word)}`);
        return pattern.test(target);
    });
}
function scoreSession(query, session) {
    const title = normalize(session.title);
    const fileSlug = normalize(session.fileName.replace(/\.json$/i, ''));
    if (query === title || query === fileSlug) {
        return 100;
    }
    if (title.startsWith(query) || fileSlug.startsWith(query)) {
        return 80;
    }
    if (title.includes(query) || fileSlug.includes(query)) {
        return 60;
    }
    if (wordBoundaryMatch(query, title)) {
        return 40;
    }
    if (orderedCharacterMatch(query, title) || orderedCharacterMatch(query, fileSlug)) {
        return 20;
    }
    return 0;
}
function slugify(title) {
    const ascii = toAscii(title);
    const hyphenated = ascii
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!hyphenated) {
        return DEFAULT_SLUG;
    }
    return clampSlugLength(hyphenated);
}
function formatTimestamp(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}-${minutes}`;
}
function parseFileSize(size) {
    const match = /^\s*(\d+)\s*(kb|mb)\s*$/i.exec(size);
    if (!match) {
        throw new Error(`Invalid file size format: ${size}`);
    }
    const [, valueText, unitText] = match;
    if (!valueText || !unitText) {
        throw new Error(`Invalid file size format: ${size}`);
    }
    const value = Number.parseInt(valueText, 10);
    const unit = unitText.toLowerCase();
    if (value <= 0) {
        throw new Error(`File size must be greater than zero: ${size}`);
    }
    return unit === 'mb' ? value * 1024 * 1024 : value * 1024;
}
function fuzzyMatchSessions(query, sessions) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
        return [];
    }
    return sessions
        .map((session) => ({
        ...session,
        score: scoreSession(normalizedQuery, session),
    }))
        .filter((session) => session.score > 0)
        .sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return Date.parse(b.savedAt) - Date.parse(a.savedAt);
    });
}


/***/ }),
/* 11 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.UNTRIAGED_ANALYSIS_PRIORITY = exports.ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD = exports.ANALYSIS_TRIAGE_PRIORITY_WEIGHTS = exports.ANALYSIS_TRIAGE_QUESTIONS = exports.ANALYSIS_TRIAGE_QUESTION_SET_VERSION = void 0;
exports.buildAnalysisTriageState = buildAnalysisTriageState;
exports.triageAnalysisCandidates = triageAnalysisCandidates;
exports.computeAnalysisPriority = computeAnalysisPriority;
exports.summarizeAnalysisTriageSignals = summarizeAnalysisTriageSignals;
exports.isTrivialAnalysisCandidate = isTrivialAnalysisCandidate;
exports.planAnalysisFromTriage = planAnalysisFromTriage;
const sessionAnalysis_1 = __webpack_require__(1);
const judgmentService_1 = __webpack_require__(3);
exports.ANALYSIS_TRIAGE_QUESTION_SET_VERSION = 'analysis-triage-v1';
const MAX_EDGE_TURN_TEXT_LENGTH = 1200;
const MAX_CONCURRENT_TRIAGE_JUDGMENTS = 4;
exports.ANALYSIS_TRIAGE_QUESTIONS = {
    friction: (0, judgmentService_1.score)('How much friction did the user experience with the AI agent in this chat session?', [
        'Smooth: the agent did what was asked without corrections.',
        'Minor clarifications from the user.',
        'Some user corrections or redirections.',
        'Repeated user corrections, reverts, or restarts.',
    ]),
    toolFailureLoops: (0, judgmentService_1.score)('Did the agent get stuck in failing tool or command cycles in this chat session?', [
        'No failing tool or command cycles.',
        'An isolated tool or command failure.',
        'A few retries of failing tools or commands.',
        'Repeated failing tool or command cycles.',
    ]),
    instructionViolation: (0, judgmentService_1.noul)('Did the agent ignore stated repository instructions (such as AGENTS.md or copilot-instructions) or explicit user instructions in this chat session?'),
    controlFileLesson: (0, judgmentService_1.noul)('Would a change to an AI control file (such as AGENTS.md, copilot-instructions.md, a prompt, or a skill) plausibly prevent the issues seen in this chat session?'),
    trivial: (0, judgmentService_1.noul)('Is this chat session too short, trivial, or off-topic to be worth analyzing for AI workflow improvements?'),
};
function clip(text) {
    return text.length > MAX_EDGE_TURN_TEXT_LENGTH ? `${text.slice(0, MAX_EDGE_TURN_TEXT_LENGTH)}…` : text;
}
function toEdgeTurn(turn) {
    return turn.type === 'request'
        ? { role: 'user', text: clip(turn.prompt) }
        : { role: 'assistant', text: clip(turn.content), tools: turn.toolCalls.map((toolCall) => toolCall.name) };
}
/**
 * Builds compact triage state: the `summaryOnly` analysis evidence plus the
 * first and last turns, so triage stays cheap relative to full analysis.
 */
function buildAnalysisTriageState(candidate) {
    const turns = candidate.session.turns;
    const firstTurn = turns[0];
    const lastTurn = turns.length > 1 ? turns[turns.length - 1] : undefined;
    return {
        title: candidate.session.title,
        ...(candidate.session.provider ? { provider: candidate.session.provider } : {}),
        turnCount: turns.length,
        evidence: (0, sessionAnalysis_1.buildSessionEvidence)(candidate, 'summaryOnly'),
        ...(firstTurn ? { firstTurn: toEdgeTurn(firstTurn) } : {}),
        ...(lastTurn ? { lastTurn: toEdgeTurn(lastTurn) } : {}),
    };
}
/**
 * Asks the triage questions once per candidate. Returns an empty map without
 * sending anything when TypeSafe or the `triage` feature is disabled.
 */
async function triageAnalysisCandidates(candidates, deps) {
    const results = new Map();
    try {
        if (!deps.judgment.isFeatureEnabled('triage')) {
            return results;
        }
    }
    catch {
        return results;
    }
    const queue = [...candidates];
    const worker = async () => {
        for (let candidate = queue.shift(); candidate; candidate = queue.shift()) {
            if (deps.token?.isCancellationRequested) {
                return;
            }
            try {
                const cache = deps.getCacheTarget?.(candidate);
                const answers = await deps.judgment.ask(buildAnalysisTriageState(candidate), exports.ANALYSIS_TRIAGE_QUESTIONS, deps.token, cache ? { feature: 'triage', cache } : 'triage');
                if (answers) {
                    results.set(candidate.fingerprint, answers);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deps.log?.(`[analysis-triage] ${candidate.session.title}: ${message}`);
            }
        }
    };
    const workerCount = Math.min(MAX_CONCURRENT_TRIAGE_JUDGMENTS, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    deps.log?.(`[analysis-triage] judged ${results.size} of ${candidates.length} candidates`);
    return results;
}
/*
 * Triage policy. Weights and thresholds live here in code, not in the
 * questions, so the policy can change without invalidating cached answers.
 */
/** Weights for the composite priority; each signal is normalized to 0..1 first. */
exports.ANALYSIS_TRIAGE_PRIORITY_WEIGHTS = {
    friction: 0.35,
    toolFailureLoops: 0.25,
    instructionViolation: 0.2,
    controlFileLesson: 0.2,
};
/** `trivial` probability at or above which a candidate skips the LLM. */
exports.ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD = 0.7;
/** Priority for candidates without triage answers, so they are neither skipped nor favored. */
exports.UNTRIAGED_ANALYSIS_PRIORITY = 0.5;
/** Highest rubric level of the triage Score questions (four levels, 0 to 3). */
const MAX_TRIAGE_SCORE = 3;
const EVIDENCE_DETAIL_LEVELS = ['full', 'compact', 'summaryOnly'];
const EVIDENCE_SEPARATOR_LENGTH = 6;
function unit(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
/** Weighted sum of the normalized triage signals, from 0 (low signal) to 1. */
function computeAnalysisPriority(answers) {
    const weights = exports.ANALYSIS_TRIAGE_PRIORITY_WEIGHTS;
    return (weights.friction * unit(answers.friction?.score / MAX_TRIAGE_SCORE) +
        weights.toolFailureLoops * unit(answers.toolFailureLoops?.score / MAX_TRIAGE_SCORE) +
        weights.instructionViolation * unit(answers.instructionViolation?.noul) +
        weights.controlFileLesson * unit(answers.controlFileLesson?.noul));
}
function finiteOrUndefined(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Flattens triage answers into the persisted signal shape, omitting signals the judgment lacks. */
function summarizeAnalysisTriageSignals(answers) {
    const values = [
        ['friction', finiteOrUndefined(answers.friction?.score)],
        ['toolFailureLoops', finiteOrUndefined(answers.toolFailureLoops?.score)],
        ['instructionViolation', finiteOrUndefined(answers.instructionViolation?.noul)],
        ['controlFileLesson', finiteOrUndefined(answers.controlFileLesson?.noul)],
        ['trivial', finiteOrUndefined(answers.trivial?.noul)],
    ];
    return Object.fromEntries(values.filter(([, value]) => value !== undefined));
}
function isTrivialAnalysisCandidate(answers) {
    return unit(answers.trivial?.noul) >= exports.ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD;
}
/**
 * Applies the triage policy: skips trivial candidates, ranks the rest by
 * priority, and gives the richest evidence that still fits the batch budget to
 * the highest-ranked candidates. Detail never increases as rank decreases.
 */
function planAnalysisFromTriage(candidates, triage, batchCharBudget) {
    const skipped = [];
    const priorities = new Map();
    const ranked = [];
    candidates.forEach((candidate, index) => {
        const answers = triage.get(candidate.fingerprint);
        if (answers && isTrivialAnalysisCandidate(answers)) {
            skipped.push(candidate);
            return;
        }
        const priority = answers ? computeAnalysisPriority(answers) : exports.UNTRIAGED_ANALYSIS_PRIORITY;
        priorities.set(candidate.fingerprint, priority);
        ranked.push({ candidate, priority, index });
    });
    ranked.sort((left, right) => right.priority - left.priority || left.index - right.index);
    const detailLevels = new Map();
    let floor = 0;
    let usedChars = 0;
    for (const { candidate } of ranked) {
        const separator = usedChars === 0 ? 0 : EVIDENCE_SEPARATOR_LENGTH;
        let chosen = EVIDENCE_DETAIL_LEVELS.length - 1;
        let chosenLength;
        for (let level = floor; level < EVIDENCE_DETAIL_LEVELS.length; level += 1) {
            const length = (0, sessionAnalysis_1.buildSessionEvidence)(candidate, EVIDENCE_DETAIL_LEVELS[level]).length;
            if (usedChars + separator + length <= batchCharBudget) {
                chosen = level;
                chosenLength = length;
                break;
            }
        }
        floor = chosen;
        usedChars += separator + (chosenLength ?? 0);
        detailLevels.set(candidate.fingerprint, EVIDENCE_DETAIL_LEVELS[chosen] ?? 'summaryOnly');
    }
    return {
        analyzable: ranked.map((entry) => entry.candidate),
        skipped,
        priorities,
        detailLevels,
    };
}


/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(0);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;