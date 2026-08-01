---
id: card-ms66eb9r-8
title: Keep extension auto-save wiring thin
column: col-mqycuy1w-4
position: -11000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785416482633
dependsOn: [card-ms66eb9r-7]
---

## Description
Reduce `src/extension.ts` to activation, configuration, controller lifecycle, and command wiring while orchestration remains in the controller modules.

## Acceptance criteria
- [x] `src/extension.ts` delegates auto-save orchestration to the controller.
- [x] Activation and configuration wiring remains behaviorally covered and easy to dispose.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-1/item-3::keep-extension-auto-save-wiring-thin`
Source item: Phase 1 item 3 — Keep activation/configuration wiring thin in `src/extension.ts`.

### 2026-07-30T12:24:50.297Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:24:50.539Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T12:34:23.715Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T06:48:45.498-06:00 - Thin auto-save lifecycle wiring completed
Moved initial controller synchronization plus workspace-folder and relevant configuration event handling into `createAutoSaveWorkspaceLifecycle`. Activation now registers one composite disposable while retaining status-bar and Session Explorer refresh callbacks, and disposal clears both event registrations and every managed workspace controller.

Added focused lifecycle coverage for activation sync, relevant and unrelated configuration changes, workspace-folder changes, listener disposal, controller disposal, and idempotent cleanup. `npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The cached VS Code 1.93 `npm test` host reported 303 passing tests, including the new coverage; its sole failure is the pre-existing Copilot CLI watcher regression owned by `card-ms66eb9r-4`.

STATUS: DONE

### 2026-07-30T12:49:21.921Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T12:49:22.103Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
