---
id: card-ms66eb9r-24
title: Persist and rebuild auto-save checkpoints
column: col-mqycuy1w-4
position: -32000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785452607556
dependsOn: [card-ms66eb9r-23]
---

## Description
Persist lightweight auto-save checkpoints in workspace state and rebuild them from self-identifying `.chat` outputs after extension reloads or state loss.

## Acceptance criteria
- [x] Workspace checkpoints accelerate unchanged-revision comparisons.
- [x] Missing or cleared workspace state is rebuilt from matching auto-saved files.
- [x] Reloading and continuing a provider session updates one snapshot without creating a duplicate.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-4/item-4::persist-and-rebuild-auto-save-checkpoints`
Source item: Phase 4 item 4 — Persist/rebuild checkpoints across extension reloads.

### 2026-07-30T22:50:22.108Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T22:50:22.920Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T22:50:24.262Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30 - Implemented durable auto-save checkpoints
Added versioned checkpoint persistence in VS Code workspace state, scoped by workspace folder and storage directory. The controller now validates restored checkpoint filenames, uses valid revision hashes as the unchanged fast path, and rebuilds missing or stale cache entries from self-identifying auto-save origin metadata in `.chat` files. Added controller and real session-store regressions proving state-loss recovery and reload continuation leave one current snapshot.

Verification: touched-source ESLint, `npm run compile-tests`, `npm run compile`, `npm test` (363 passing), `npm run lint`, and `git diff --check` passed.

STATUS: DONE

### 2026-07-30T23:02:31.662Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T23:02:31.885Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
