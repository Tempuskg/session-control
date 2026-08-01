---
id: card-ms66eb9r-5
title: Implement observable auto-save diagnostic state
column: col-mqycuy1w-4
position: -7000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785380641386
dependsOn: [card-ms66eb9r-4]
---

## Description
Implement the source-level diagnostic state required to make future auto-save path, event, scan, skip, success, and error behavior observable.

## Acceptance criteria
- [x] Diagnostic state records resolved path, path existence, last scan, last event, last success, skip reason, and last error.
- [x] Diagnostic state is isolated per source so one source failure does not erase another source's health.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-0/item-5::implement-observable-auto-save-diagnostic-state`
Source item: Phase 0 item 5 — Implement the diagnostic state needed to make subsequent failures observable.

### 2026-07-30T02:41:48.376Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T02:41:48.653Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T02:41:48.848Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-30T02:49:59.106Z - Observable auto-save diagnostic state implemented
Added a typed per-source diagnostic registry in `src/autoSaveDiagnostics.ts` and wired the current auto-save watcher paths in `src/extension.ts` to record resolved paths, path existence, file events, scans, skip reasons, successful saves, and errors without replacing another source's state.

Added focused coverage in `test/unit/autoSaveDiagnostics.test.ts`. `npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The cached-host `npm test` run executed 299 tests: 298 passed, including both new diagnostic tests; the only failure was the intentionally red Copilot CLI watcher regression owned by completed prerequisite card `card-ms66eb9r-4`.

STATUS: DONE

### 2026-07-30T02:50:54.042Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T02:50:54.267Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
