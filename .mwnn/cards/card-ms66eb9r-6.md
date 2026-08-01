---
id: card-ms66eb9r-6
title: Extract provider-independent auto-save coordination
column: col-mqycuy1w-4
position: -8000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785383238768
dependsOn: [card-ms66eb9r-4, card-ms66eb9r-5]
---

## Description
Move watcher, debounce, reconciliation, health, and save coordination out of the `src/extension.ts` hotspot into a provider-independent auto-save controller.

## Acceptance criteria
- [x] The controller owns watcher, debounce, reconciliation, health, and save coordination.
- [x] Existing supported auto-save behavior remains covered by focused tests with no regression.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-1/item-1::extract-provider-independent-auto-save-coordination`
Source item: Phase 1 item 1 — Move watcher, debounce, reconciliation, health, and save coordination out of the `src/extension.ts` hotspot.

### 2026-07-30T03:04:20.073Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T03:04:20.308Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T03:04:21.133Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T03:16:35.578Z - Provider-independent auto-save controller extracted
Added `src/autoSaveController.ts` as the provider-independent owner of watcher lifecycle, per-source debounce, reconciliation checkpoints, diagnostic health, coordinated saves, prior-file cleanup, and disposal. Reduced `src/extension.ts` to provider/path/session adapters that construct controller sources and inject VS Code dependencies.

Added focused controller coverage in `test/unit/autoSaveController.test.ts`. `npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The repository-supported cached-host `npm test` run reported 300 passing tests, including the new controller tests and every existing supported auto-save case; its only failure remains the intentionally red Copilot CLI watcher regression from prerequisite card `card-ms66eb9r-4`, which is outside this extraction card.

STATUS: DONE

### 2026-07-30T03:16:48.926Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T03:16:49.120Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
