---
id: card-ms66eb9r-22
title: Locate auto-saves by source session identity
column: col-mqycuy1w-4
position: -30000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785450441712
dependsOn: [card-ms66eb9r-21]
---

## Description
Implement lookup of existing auto-saved outputs by source ID and provider session identity so continued sessions update the correct snapshot.

## Acceptance criteria
- [x] Lookup matches only files marked as auto-saves with the same source and source session ID.
- [x] Manual snapshots with the same provider or session ID are excluded.
- [x] Existing `.chat` files can recover identity when workspace checkpoints are absent.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-4/item-2::locate-auto-saves-by-source-session-identity`
Source item: Phase 4 item 2 — Implement lookup by source/session identity.

### 2026-07-30T21:26:09.174Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T21:26:09.384Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T22:10:35.555Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T22:23:59.610Z - Added source-session auto-save lookup
Added exact auto-origin lookup in the configured `.chat` storage, wired empty controller checkpoints to recover matching source/session files, and marked new automatic saves with their source identity and revision. Manual and legacy snapshots with colliding provider or session IDs remain outside the lookup.

Verification: touched-source ESLint, `npm run compile-tests`, `npm run compile`, `npm run lint`, `git diff --check`, and a focused compiled-module identity/recovery smoke check passed. The supported `npm test` runner was attempted with both the installed and repository-cached VS Code hosts, but the machine-wide `vscode-updating` mutex prevented either host from launching; no assertions ran in those two attempts.

STATUS: DONE

### 2026-07-30T22:24:23.408Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T22:24:23.603Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
