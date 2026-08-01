---
id: card-ms66eb9r-28
title: Add auto-save diagnostics and health status
column: col-mqycuy1w-4
position: -24000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785445390237
dependsOn: [card-ms66eb9r-5, card-ms66eb9r-7, card-ms66eb9r-20]
---

## Description
Add a copyable `Session Control: Diagnose Auto-Save` report and a source-health status tooltip backed by per-workspace controller diagnostics.

## Acceptance criteria
- [x] The report includes workspace/storage paths, enablement, selected providers, source paths, match strategy, watcher state, events, scans, candidates, skips, successes, errors, and remote/profile limits.
- [x] Diagnostic output contains metadata only and never prompt or response content.
- [x] The status tooltip reports healthy/attention source counts plus the last successful provider and time.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-5/item-3::add-auto-save-diagnostics-and-health-status`
Source item: Phase 5 item 3 — Add the diagnostic command and source-health status tooltip.

### 2026-07-30T15:46:34.088Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T15:46:34.315Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T19:00:05.713Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T20:08:48.465Z - Implemented auto-save diagnostics and health status
Added per-workspace controller diagnostics, a clipboard-backed `Session Control: Diagnose Auto-Save` metadata report, and a live status tooltip with source health counts and the latest successful provider/time. Added report redaction, tooltip, and command-manifest coverage. Verified strict test compilation, extension compilation, lint, and 346 passing extension-host tests using the cached VS Code 1.93 host; the separate hands-on Development Host check was unavailable because Windows app-control approval timed out.

STATUS: DONE

### 2026-07-30T20:09:06.417Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T20:09:06.601Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
