---
id: card-ms66eb9r-30
title: Keep auto-save privacy choices explicit
column: col-mqycuy1w-4
position: -28000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785449118788
dependsOn: [card-ms66eb9r-26]
---

## Description
Keep auto-save opt-in and add a privacy-aware enable action that explains storage sensitivity and offers a project gitignore choice.

## Acceptance criteria
- [x] Migration and first-run behavior never silently enable auto-save.
- [x] The enable action explains that saved prompts, paths, file content, and tool output may be sensitive.
- [x] The user can choose whether to add the configured in-workspace storage folder to `.gitignore`.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-5/item-5::keep-auto-save-privacy-choices-explicit`
Source item: Phase 5 item 5 — Keep privacy and gitignore choices explicit.

### 2026-07-30T19:10:49.285Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T19:10:49.834Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T21:40:21.895Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T15:49:54.8563734-06:00 - Made auto-save privacy choices explicit
Kept the manifest default and disabled-workspace migration behavior opt-in. Enabling auto-save now shows a modal warning that saved prompts, workspace paths, file content, and tool output may be sensitive; cancellation leaves auto-save off, while the two explicit choices either add the configured in-workspace storage folder to `.gitignore` or keep it trackable before enabling. Added focused command-flow coverage and an Unreleased changelog entry.

Validation passed: `npm run compile-tests`, `npm run compile`, the cached VS Code 1.93 `npm test` run (356 passing), `npm run lint`, and scoped `git diff --check`. The initial default `npm test` launch was blocked by the desktop VS Code updater mutex, then passed against the repository's cached test runtime.

STATUS: DONE

### 2026-07-30T21:50:16.242Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T21:50:16.563Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
