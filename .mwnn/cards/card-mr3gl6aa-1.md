---
id: card-mr3gl6aa-1
title: saved session from command save session from provider when I selected Claude the saved session didn't show up on the Session Control sidebar sessions
column: col-mqycuy1w-4
position: 3000
assignee: { kind: human }
createdAt: 1782993993490
updatedAt: 1783086911304
---

## Description
**Bug:** Running `Session Control: Save Session from Provider` (`session-control.saveSessionFromProvider`) and choosing the **Claude Code** provider completes the save flow (the "Saved chat session to ..." message appears), but the newly saved session does not appear in the Session Control sidebar (`session-control.sessionExplorer` tree view), even though the command triggers `sessionExplorerProvider.refresh()` after saving.

Saves from the Copilot provider show up as expected, so the defect is specific to the Claude Code path (`readClaudeCodeSessions` → `filterSessionsForWorkspace` → `runSaveSourceSessionFlow`).

Likely area to investigate: the sidebar lists files via `sessionStore.listSessions`, which reads each `.json` file, validates it with `isChatSession`, and **silently drops any file that fails to parse or validate** (`catch { return null; }`). If the Claude Code conversion produces a `ChatSession` whose serialized form fails `isChatSession` (e.g. a turn shape rejected by `isSavedTurn`, or a missing/invalid field such as `savedAt`, `totalTurns`, or `markdownSummary`), the file is written to the storage directory but invisibly excluded from the tree. Other possibilities to rule out: the file being written to a different storage directory than the one the explorer reads, or the file being pruned/archived immediately after save.

Scope of this card: diagnose the root cause, fix it so Claude Code sessions saved via the provider command appear in the sidebar, and make this class of failure observable instead of silent.

## Acceptance criteria
- [ ] Root cause is identified and recorded in this card's Activity section (which step drops the session: schema validation in `isChatSession`/`isSavedTurn`, storage directory mismatch, pruning, or something else).
- [ ] A unit test reproduces the bug before the fix: a session produced by the Claude Code provider save path (`readClaudeCodeSessions` output run through `runSaveSourceSessionFlow` / `createChatSession` and written by `sessionStore.writeSessions`) is returned by `sessionStore.listSessions` and appears in `listSessionExplorerGroups`.
- [ ] Manual verification: run `Session Control: Save Session from Provider`, pick **Claude Code**, complete the save — the session appears in the Session Control sidebar immediately (no manual Refresh, no window reload).
- [ ] Copilot and Codex provider saves still appear in the sidebar (no regression; existing save-flow and session-explorer tests pass).
- [ ] When `listSessions` skips a file because it fails to parse or validate, the skip is no longer fully silent: the file name and reason are logged to the "Session Control" output channel (or an equivalent diagnostic), so future occurrences are diagnosable.
- [ ] Repo validation passes (lint + full test suite) with the fix in place.

## Activity
### 2026-07-02T12:07:19.803Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-02T13:18:11.033Z - AI loop triage
The AI judged this card as needing a person and assigned it to Human.

### 2026-07-02T14:24:32.711Z - AI loop triage
The AI judged this card doable by an agent and assigned it to AI.
Why: The implementation involves diagnosing the bug, fixing the code, and adding tests, which an AI can handle autonomously.

### 2026-07-02T14:24:32.744Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-02T14:24:33.682Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-02T14:39:34.031Z - AI loop timed out
Gave up waiting for the dispatched agent to finish; the loop will not retry this card this run.

### 2026-07-02 - Claude Code completion note

**Root cause: the sidebar refresh was blocked by an awaited notification — not schema validation, storage-directory mismatch, or pruning.**

Diagnosis details (hypotheses ruled out with real data):
- Ran `isChatSession` over all 229 files in `e:\chat-commit\.chat` — **0 invalid**, including the Claude Code session saved via the provider command at 2026-07-02T14:26 (`fix-claude-code-provider-session-not-appearing-in-sidebar.json`, `provider: claude-code`). `sessionStore.listSessions` returns it, sorted first. Validation was not dropping it.
- Ran the full pipeline (`readClaudeCodeSessions` over the real `~/.claude/projects/e--chat-commit` transcripts → `createChatSession` → `applySaveBloatControls` → JSON round-trip → `isChatSession`) — 19/19 sessions valid.
- Save flow and explorer both resolve the same `.chat` directory from the same `storagePath` setting; no mismatch. Pruning never removes the newest `savedAt`, so the new file was not pruned.
- Actual defect: `runSaveSourceSessionFlow` did `await deps.showInformationMessage('Saved chat session to ...')`. VS Code only resolves that promise when the notification is dismissed — a toast dismissed with ESC or auto-hidden into the notification center may never resolve (microsoft/vscode#51608). The command handler therefore never returned, so `sessionExplorerProvider.refresh()` (and post-save pruning) never ran. The user sees the "Saved chat session to ..." toast, but the sidebar never refreshes. Copilot saves "appearing" was down to when other triggers happened to refresh the tree, not a provider difference.

Fix:
- `src/extension.ts` — `runSaveSourceSessionFlow` now fires informational toasts without awaiting them (`void deps.showInformationMessage(...)`), so the flow completes, pruning runs, and the caller's `refresh()` fires immediately after save. Exported `runSaveSourceSessionFlow` for the end-to-end test.
- `src/sessionStore.ts` — `listSessions` no longer swallows parse/validation failures silently: it logs `Skipped session file <name>: <reason>` via a new injectable `logWarning` dep (default `console.warn`).
- `src/extension.ts` `activate()` — the session explorer lists sessions through a store wired to the "Session Control" output channel, so skipped files are diagnosable (`[session-explorer] Skipped session file ...`).
- `CHANGELOG.md` — documented both fixes under Unreleased.

Tests added:
- `test/unit/extensionSaveFlow.test.ts` — "completes save and pruning without waiting on notification dismissal": stubs `showInformationMessage` with a never-resolving promise; before the fix the flow hangs (fails via 5s race), after the fix it resolves and prunes.
- `test/unit/extensionSaveFlow.test.ts` — "Claude Code provider save appears in listSessions and the session explorer": real JSONL fixture → `readClaudeCodeSessions` → `runSaveSourceSessionFlow` → `listSessions` → `listSessionExplorerGroups` (AC #2).
- `test/unit/sessionStore.test.ts` — "listSessions logs skipped files that fail to parse or validate".

Validation: `npm run lint` clean; full `npm test` suite passes (exit 0). Also drove the compiled flow outside the test host with never-resolving notifications: flow resolved, pruning ran, and the saved claude-code session was listed.

Remaining human step: the interactive manual check (run `Session Control: Save Session...`, pick Claude Code, confirm the session appears in the sidebar without manual refresh in the Development Host).
