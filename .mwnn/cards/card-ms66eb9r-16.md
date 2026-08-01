---
id: card-ms66eb9r-16
title: Preserve changed source paths during reconciliation
column: col-mqycuy1w-4
position: -16000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785423227997
dependsOn: [card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Carry the changed source URI from watcher events into reconciliation so the represented provider session is processed before any full-source fallback scan.

## Acceptance criteria
- [x] A changed URI that maps to a session selects that session rather than an unrelated newest session.
- [x] A full provider scan remains available when the URI cannot be mapped safely.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-3/item-2::preserve-changed-source-paths-during-reconciliation`
Source item: Phase 3 item 2 — Preserve changed source paths from watcher events.

### 2026-07-30T12:39:14.604Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:16.444Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T14:35:44.665Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T14:50:58.140Z - Codex implementation
Carried watcher source paths through debounce into reconciliation, added safe path-to-candidate matching, and restricted mapped events to the represented session while preserving the original full candidate scan for absent, unmatched, or ambiguous paths. Added focused regression coverage for mapped and fallback behavior.

Validation: `npm run compile-tests`, `npm run compile`, `npm run lint`, and `npx mocha --ui tdd dist-test\test\unit\autoSaveController.test.js` passed (4 tests). The supported `npm test` Extension Host runner was attempted three times but could not discover tests because a pre-existing VS Code installer process held the global `vscode-updating` mutex.

STATUS: DONE

### 2026-07-30T14:51:10.009Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T14:51:10.192Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
