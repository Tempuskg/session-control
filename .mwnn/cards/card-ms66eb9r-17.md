---
id: card-ms66eb9r-17
title: Recover missing source directories with fallback scans
column: col-mqycuy1w-4
position: -21000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785432213298
dependsOn: [card-ms66eb9r-7, card-ms66eb9r-10, card-ms66eb9r-11, card-ms66eb9r-12, card-ms66eb9r-13]
---

## Description
Recover when provider source directories are absent during activation and add a conservative periodic reconciliation fallback for missed external-file events.

## Acceptance criteria
- [x] A source directory created after activation becomes discoverable without reloading the extension.
- [x] Enabled controllers run a low-frequency fallback scan with test-injected timing.
- [x] Controller disposal clears directory recovery and fallback timers.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-3/item-3::recover-missing-source-directories-with-fallback-scans`
Source item: Phase 3 item 3 — Add missing-directory recovery and a low-frequency fallback scan.

### 2026-07-30T14:42:00.513Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T14:42:01.913Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T16:44:16.502Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T17:06:51.595Z - Missing-directory recovery and fallback scans implemented
Added a 30-second missing-directory recovery loop that keeps watcher registration opportunistic, detects source directories created after activation, and immediately reconciles them without an extension reload. Added an independently injected maintenance scheduler and a five-minute controller-wide fallback reconciliation scan so missed external-file events are repaired without disturbing debounce and retry clocks.

Added focused coverage for late directory discovery, injected fallback timing, and disposal of both maintenance timer types. `npm run compile-tests`, `npm run compile`, the cached VS Code 1.93 `npm test` run (341 passing), `npm run lint`, scoped ESLint, and the scoped diff check passed. The first default-host `npm test` attempt did not launch because the installed VS Code updater mutex remained held; the repository-supported cached host completed cleanly.

STATUS: DONE

### 2026-07-30T17:07:08.371Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T17:07:08.637Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
