---
id: card-ms66eb9r-25
title: Prove manual snapshots remain untouched
column: col-mqycuy1w-4
position: -33000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785453322965
dependsOn: [card-ms66eb9r-23]
---

## Description
Add focused evidence that auto-save lookup, replacement, cleanup, and pruning preserve independent manual snapshots.

## Acceptance criteria
- [x] A manual snapshot sharing a provider and session ID with an auto-save remains after auto-save replacement.
- [x] Split auto-save cleanup removes only matching auto-owned parts.
- [x] Focused writer/store tests cover preservation through successful and failed upserts.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-4/item-5::prove-manual-snapshots-remain-untouched`
Source item: Phase 4 item 5 — Prove that manual saves are preserved.

### 2026-07-30T22:50:22.445Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T22:50:23.162Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T23:02:32.696Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30 - Proved manual snapshot preservation
Extended the focused writer/store coverage so every split auto-save part retains automatic ownership, successful replacement deletes exactly the prior matching auto-owned parts, normal pruning keeps the colliding current manual snapshot, and a failed split publication leaves the independent manual snapshot byte-for-byte unchanged.

Verification: touched-test ESLint, `npm run compile-tests`, `npm run compile`, `npm test` (363 passing), `npm run lint`, and `git diff --check` passed.

STATUS: DONE

### 2026-07-30T23:09:07.419Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T23:09:07.695Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
