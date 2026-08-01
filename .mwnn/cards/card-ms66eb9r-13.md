---
id: card-ms66eb9r-13
title: Verify and add Cursor CLI session discovery
column: col-mqycuy1w-4
position: -15000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785422519305
dependsOn: [card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Verify Cursor CLI's current on-disk session contract with a sanitized real-session fixture, then implement a dedicated locator or explicitly proven parser sharing without conflating Cursor IDE history.

## Acceptance criteria
- [x] A sanitized fixture records the verified Cursor CLI version, location, session identity, working directory, turns, and continuation behavior.
- [x] The implementation positively matches the project and rejects a second project's session.
- [x] Cursor IDE legacy input remains a separately identified compatibility source.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-2/item-4::verify-and-add-cursor-cli-session-discovery`
Source item: Phase 2 item 4 — Verify and implement Cursor CLI discovery separately from Cursor IDE legacy history.

### 2026-07-30T12:39:14.329Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:16.206Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T14:01:18.680Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T08:35:05.4288534-06:00 - Cursor CLI contract verified and discovery separated
Verified the current official Cursor CLI package (`2026.07.23-e383d2b`) in an isolated WSL temp directory and recorded its project-scoped `~/.cursor/projects/<slug>/agent-transcripts/<session>/<session>.jsonl` contract alongside a provenance-linked sanitized observed-session fixture. Added `src/cursorCliSessionReader.ts` as the dedicated `cursor-cli` locator/read surface while sharing only the fixture-proven JSONL parser. Auto-save now reads that CLI-only surface; legacy Cursor IDE `workspaceStorage/chatSessions` remains available through the separately named `cursor-vscode-legacy` compatibility reader.

Added focused tests for contract metadata, same-session continuation, positive current-project matching, second-project rejection, and legacy source separation. `npm run compile-tests`, `npm run compile`, `npm run lint`, and the cached VS Code 1.93 `npm test` run passed with 324 tests. The first `npm test` attempt did not start tests because the installed VS Code update mutex was held; rerunning with the repository's cached host passed.

STATUS: DONE

### 2026-07-30T14:35:43.545Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T14:35:43.749Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
