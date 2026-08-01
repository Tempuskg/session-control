---
id: card-ms66eb9r-21
title: Add backward-compatible session origin metadata
column: col-mqycuy1w-4
position: -26000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785446767801
dependsOn: [card-ms66eb9r-19]
---

## Description
Extend the saved session schema with optional origin metadata that distinguishes manual snapshots from auto-saves and identifies their source session and revision.

## Acceptance criteria
- [x] Origin metadata records save kind, source ID, source session ID, and source revision.
- [x] Existing saved sessions without origin metadata remain valid and readable.
- [x] Strict optional-property typing is preserved.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-4/item-1::add-backward-compatible-session-origin-metadata`
Source item: Phase 4 item 1 — Add backward-compatible origin metadata.

### 2026-07-30T18:52:44.230Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T18:52:44.464Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T21:11:02.442Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T21:22:41.110Z - Added backward-compatible session origin metadata
Added optional `SessionOrigin` metadata to the saved-session schema and runtime guard, with save kind, source ID, source session ID, and source revision. The session writer persists the object only when supplied, so legacy and manual saves continue to omit the optional property under strict optional-property typing.

Verification: focused ESLint, `npm run compile-tests`, `npm run compile`, `npm run lint`, focused schema/writer tests (18 passing), and session-store compatibility tests (14 passing). The supported `npm test` runner was attempted twice but could not launch because two existing VS Code setup processes hold the system-wide `vscode-updating` mutex; no test assertions ran in those attempts.

STATUS: DONE

### 2026-07-30T21:22:53.891Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T21:22:54.195Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
