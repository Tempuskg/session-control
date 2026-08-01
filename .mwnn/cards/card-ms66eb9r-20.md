---
id: card-ms66eb9r-20
title: Isolate source failures and retries
column: col-mqycuy1w-4
position: -18000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785426392096
dependsOn: [card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Track health, disablement, warnings, and retries per source so a transient provider failure never stops unrelated providers or workspaces.

## Acceptance criteria
- [x] A parse or path failure in one source does not stop another source from saving.
- [x] Actionable persistent failures warn once and retry periodically.
- [x] Successful recovery clears or updates only the affected source's diagnostic state.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-3/item-6::isolate-source-failures-and-retries`
Source item: Phase 3 item 6 — Isolate provider failures and retries.

### 2026-07-30T12:39:15.143Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:17.016Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T15:08:27.815Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T09:34:16.1053674-06:00 - Isolated source failures and retries
Replaced controller-wide disablement with per-source health, pause, warning, watcher, and retry state. Persistent read/save or watcher-path failures now warn once per failure episode, retry that source every 60 seconds, and leave unrelated sources and workspace controllers active. Recovery re-enables the affected source and clears only its error/retry diagnostic state.

Added focused parser-failure, watcher-path-failure, warn-once, periodic-retry, and source-scoped recovery coverage. `npm run compile-tests`, `npm run compile`, and `npm run lint` passed; the cached VS Code 1.93 extension-host run passed all 333 tests.

STATUS: DONE

### 2026-07-30T15:34:36.623Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T15:34:36.862Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
