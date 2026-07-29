---
id: card-ms1vnak3-1
title: add an analyze button to saved sessions view. When clicked analyzes just that session
column: col-mqycuy1w-4
position: -1000
assignee: { kind: human }
createdAt: 1785075136563
updatedAt: 1785088196591
---

## Description
Add a per-session "Analyze" action to the Session Explorer tree view (`session-control.sessionExplorer`). Each saved-session row already exposes inline actions (Open, Delete) via the `view/item/context` menu in `package.json`, keyed on `viewItem == session-control.session`. This slice adds a third inline button that runs the existing saved-chat analysis pipeline scoped to only the clicked session, instead of the current time-range-based selection (`AnalysisSelectionMode` in `src/types.ts` supports only `last24Hours`/`last7Days`/`last30Days`/`customRange`/`needsAnalysis`).

Scope of work:
- Register a new command (e.g. `session-control.analyzeSessionFromExplorer`) that accepts the `SessionExplorerSessionItem` passed by the tree view, and contribute it to `package.json` (`commands` + `view/item/context` with `group: "inline"`, restricted to the session explorer view and session context value).
- Extend the analysis selection model to represent a single-session scope (new `AnalysisSelectionMode` value or equivalent), so reports, the analysis index, and the "analyzed" badge in the explorer keep working, and so `resolveAnalysisSelection` / persisted `AnalysisSelection` parsing tolerates the new mode.
- Reuse `runAnalyzeSavedChatsCommand` / `runAnalyzeSessionsFlow` behavior — provider picking (host chat model or Codex/Claude Code/Cursor agent handoff), progress notification, cancellation, and report writing — but restrict the analyzed session set to exactly the clicked session.
- After a successful run, refresh the Session Explorer so the session's `analyzed` badge and tooltip update.

Out of scope: multi-select analysis, changes to the analysis report format, and any Pro/harvest features.

## Acceptance criteria
- [x] `package.json` contributes a `session-control.analyzeSessionFromExplorer` command and a `view/item/context` menu entry with `group: "inline"`, shown only when `view == session-control.sessionExplorer && viewItem == session-control.session` (not on workspace rows).
- [x] Clicking the button on a session row runs analysis using only that session: the resulting analysis index entry and report metadata reference exactly one session, and its fingerprint matches the clicked session.
- [x] The single-session flow reuses the existing provider selection: with a host chat model it runs the language-model flow with a cancellable progress notification; with no model but an installed agent (or Cursor) it dispatches the agent handoff prompt scoped to that one session.
- [x] `AnalysisSelection` gains a single-session representation whose `label` identifies the session, and existing persisted selections (all current modes) still parse without error.
- [x] After a successful run the Session Explorer refreshes and the analyzed session row shows the `analyzed` badge with an updated `Analyzed:` tooltip timestamp.
- [x] Error paths match existing behavior: no workspace folder, missing session file, no available model/agent, and user cancellation each surface the appropriate information/warning message and write no report.
- [x] Unit tests cover the new command: invocation with a valid `SessionExplorerSessionItem` analyzes only that session, invocation with `undefined` (command palette) is handled gracefully, and the explorer refresh is triggered on success.
- [x] `npm test` (existing suite plus new tests) passes and `npm run compile`/lint report no new errors.

## Activity
### 2026-07-26T15:13:50.585Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-26T15:20:53.500Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-26T15:35:00.000Z - Implementation completed (Claude Code)
Implemented the per-session Analyze inline action end to end:
- `package.json`: added the `session-control.analyzeSessionFromExplorer` command (`Analyze This Session`, `$(search-sparkle)` icon), a `view/item/context` entry with `group: "inline"` gated on `view == session-control.sessionExplorer && viewItem == session-control.session`, and a `commandPalette` entry with `when: "false"` so the item-scoped command stays out of the palette.
- `src/types.ts`: added `singleSession` to `AnalysisSelectionMode` and an optional `sessionId` to `AnalysisSelection`; `isAnalysisSelectionMode`/`isAnalysisSelection` accept the new mode while all previous persisted modes still parse.
- `src/sessionAnalysis.ts`: added `createSingleSessionSelection` (label `Session: <title>`, pins the session id) and taught `filterCandidatesForAnalysis` to match exactly the pinned session id for `singleSession` selections (explicit clicks also re-analyze already-analyzed and `/analyze`-titled sessions).
- `src/extension.ts`: added exported `runAnalyzeSessionFromExplorerCommand` which delegates to `runAnalyzeSavedChatsCommand` with the session list scoped to the clicked `SessionExplorerSessionItem` and a fixed single-session selection (scoping deps win over overrides); handles `undefined` items with an info message. Added an optional `onReportSaved` hook to `AnalyzeSavedChatsCommandDeps`, invoked only after a report is persisted; the command registration wires it to `sessionExplorerProvider.refresh()` so the `analyzed` badge/tooltip update. Provider picking, progress/cancellation, agent/Cursor handoff, and all error paths are the existing shared flow.
- Tests: new `test/unit/extensionAnalyzeSessionFromExplorer.test.ts` (6 tests: single-session scoping + refresh ordering, real-file end-to-end persistence asserting one index entry/report with the clicked session's fingerprint, agent handoff scoped to one session, no refresh without a saved report, undefined item, no workspace folder) and 3 new tests in `test/unit/sessionAnalysis.test.ts` (selection factory, single-session filtering, guard parsing for every mode). CHANGELOG updated under [Unreleased].
- Validation: `npm run compile` clean, `npm run lint` clean, `npm test` 285 passing / 0 failing. Not verified: visual placement of the inline button in a live Development Host (non-interactive session; covered by declarative `package.json` contribution mirroring the existing Open/Delete entries).
STATUS: DONE
