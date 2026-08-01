---
id: card-ms66eb9r-23
title: Atomically replace auto-saved file sets
column: col-mqycuy1w-4
position: -31000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785451807092
dependsOn: [card-ms66eb9r-22]
---

## Description
Upsert one current auto-saved single or split file set per logical source session without exposing half-written snapshots.

## Acceptance criteria
- [x] New single or split parts are written through temporary files and rename where supported.
- [x] Previous matching auto-saved parts are removed only after every new part is durable.
- [x] Manual snapshots are never overwritten or deleted by replacement.
- [x] Normal pruning runs only after a successful upsert.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-4/item-3::atomically-replace-auto-saved-file-sets`
Source item: Phase 4 item 3 — Atomically replace the previous auto-saved single or split file set.

### 2026-07-30T22:30:37.527Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T22:30:37.784Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T22:30:38.721Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T22:46:09.997Z - Implemented atomic auto-save replacement
Added a store-owned auto-save upsert that stages the complete single or split set in temporary files, publishes each file by rename, rolls back partial publication failures, and retires only revalidated automatic saves with the same source/session identity. Automatic saves now use this upsert before the existing prune step; manual snapshots remain reserved and untouched.

Verification: touched-source ESLint, `npm run compile-tests`, `npm run compile`, `npm test` (361 passing), `npm run lint`, and `git diff --check` passed.

STATUS: DONE

### 2026-07-30T22:46:22.529Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T22:46:22.764Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
