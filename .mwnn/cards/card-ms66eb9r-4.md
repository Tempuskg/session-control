---
id: card-ms66eb9r-4
title: Add a regression test for the Copilot miss
column: col-mqycuy1w-4
position: -6000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785379295084
dependsOn: [card-ms66eb9r-3]
---

## Description
Add a focused failing regression test that models the observed Copilot source and the trigger that currently fails to auto-save.

## Acceptance criteria
- [x] The test represents the observed source format, project identity, and triggering event.
- [x] The test fails against the pre-fix behavior for the same reason as the reproduced miss.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-0/item-4::add-a-regression-test-for-the-copilot-miss`
Source item: Phase 0 item 4 — Add a failing regression test that represents the missed source and trigger.

### 2026-07-30T02:30:48.043Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T02:30:48.315Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T02:30:48.466Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-30T02:39:10.049Z - Copilot CLI regression captured
Added a focused red regression in `test/unit/extensionAutoSave.test.ts` using a sanitized schema-v1 `events.jsonl` contract for session `84a4c0f6-321d-401d-907a-72d94089b85e`, positive `E:\chat-commit` / `Tempuskg/session-control` project identity, and an `assistant.turn_end` file-change trigger.

`npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The repository test harness completed in the cached Insiders host with 296 passing tests and exactly one expected failure: the new assertion reports that no Copilot CLI `session-state/*/events.jsonl` watcher exists because pre-fix behavior watches only VS Code Copilot `chatSessions`.

STATUS: DONE

### 2026-07-30T02:40:00.253Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T02:40:00.440Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
