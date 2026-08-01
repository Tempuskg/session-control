---
id: card-ms66eb9r-19
title: Replace turn-count dedupe with semantic revisions
column: col-mqycuy1w-4
position: -22000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785437562634
dependsOn: [card-ms66eb9r-10, card-ms66eb9r-11, card-ms66eb9r-12, card-ms66eb9r-13]
---

## Description
Replace turn-count change detection with deterministic revisions over normalized session identity and semantic content.

## Acceptance criteria
- [x] Revisions include provider/source identity, session ID, title, text, references, and retained tool-call content.
- [x] Volatile generated timestamps are excluded from the revision.
- [x] Same-turn content changes update the snapshot, while a touched but semantically unchanged source does not write.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-3/item-5::replace-turn-count-dedupe-with-semantic-revisions`
Source item: Phase 3 item 5 — Replace turn-count dedupe with semantic source revisions.

### 2026-07-30T14:42:00.793Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T14:42:02.224Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T17:07:09.536Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T17:35:44.907Z - Implemented semantic auto-save revisions
Replaced turn-count checkpoints with deterministic revisions over normalized source/provider identity, session identity, title, request/response text, references, and retained tool-call fields. Generated session and turn timestamps are excluded. Added controller and Extension Host coverage proving timestamp-only touches do not write while same-turn content changes do.

Verification: `npx eslint src/autoSaveController.ts src/extension.ts`, `npm run compile-tests`, `npm run compile`, `npm test` (342 passing), and `npm run lint`.

STATUS: DONE

### 2026-07-30T17:35:58.929Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T17:35:59.109Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
