---
id: card-ms66eb9r-7
title: Create per-workspace auto-save controllers
column: col-mqycuy1w-4
position: -9000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785414289702
dependsOn: [card-ms66eb9r-6]
---

## Description
Create and manage one auto-save controller for every open workspace folder whose resource-scoped auto-save setting is enabled.

## Acceptance criteria
- [x] Each enabled workspace folder receives its own controller and configured storage destination.
- [x] Folder and configuration changes add or dispose controllers without leaking timers or watchers.
- [x] Ambiguous multi-root sessions are skipped rather than assigned by active-editor guesswork.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-1/item-2::create-per-workspace-auto-save-controllers`
Source item: Phase 1 item 2 — Create one controller per enabled workspace folder.

### 2026-07-30T03:47:39.558Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T03:47:40.006Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T03:47:41.042Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T04:00:40.809Z - Per-workspace auto-save controllers implemented
Added a workspace manager that creates one controller per resource-enabled folder with that folder's resolved storage path, reconciles controller instances on folder and relevant configuration changes, and disposes replaced controllers so their owned watchers and timers are cleared. Activation now uses explicit workspace folders, skips ambiguous multi-root VS Code Copilot sessions without active-editor routing, and requires positive `cwd` ownership for multi-root Codex sessions.

`npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The cached-host `npm test` run reached 302 passing tests, including the new lifecycle and ambiguity coverage; its sole failure is the pre-existing Copilot CLI watcher regression owned by an earlier card.

STATUS: DONE

### 2026-07-30T04:00:55.394Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T04:00:55.577Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
