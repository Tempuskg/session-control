---
id: card-ms66eb9r-14
title: Preserve manual provider imports
column: col-mqycuy1w-4
position: -19000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785429466061
dependsOn: [card-ms66eb9r-10, card-ms66eb9r-11, card-ms66eb9r-12, card-ms66eb9r-13]
---

## Description
Keep existing manual provider save/import flows working while auto-save source adapters gain stricter project matching and source-specific behavior.

## Acceptance criteria
- [x] Existing Copilot, Codex, Claude Code, and Cursor manual import flows retain their supported behavior.
- [x] Auto-save-only fail-closed filtering does not silently narrow an interactive import that already requires user selection.
- [x] Focused provider import regression tests pass.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-2/item-5::preserve-manual-provider-imports`
Source item: Phase 2 item 5 — Preserve existing manual provider imports.

### 2026-07-30T14:42:00.003Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T14:42:01.411Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T15:34:37.697Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T09:56:28.574-06:00 - Codex completed manual provider import compatibility
Made workspace filtering modes explicit so interactive Codex and Claude Code imports retain ambiguous sessions for user selection while unattended auto-save remains fail-closed. Added focused Copilot, Codex, Claude Code, and Cursor loader regressions, including Cursor CLI and IDE legacy coverage.

Validation: `npm run compile-tests`, `npm run compile`, `npm test` (337 passing with the isolated VS Code Insiders test host), and `npm run lint`.

STATUS: DONE

### 2026-07-30T15:57:32.443Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T15:57:32.773Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
