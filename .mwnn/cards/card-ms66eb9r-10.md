---
id: card-ms66eb9r-10
title: Add GitHub Copilot CLI session adapter
column: col-mqycuy1w-4
position: -12000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785417691496
dependsOn: [card-ms66eb9r-3, card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Add GitHub Copilot CLI event-log discovery and normalization from `COPILOT_HOME` or `~/.copilot/session-state/<session-id>/events.jsonl`.

## Acceptance criteria
- [x] Home override, environment, default, missing-path, and project-match cases are fixture-tested.
- [x] Event logs normalize session identity, working directory, turns, timestamps, and tool calls into the shared model with a stable revision.
- [x] The adapter does not read or mutate `session-store.db` or other provider state.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-2/item-1::add-github-copilot-cli-session-adapter`
Source item: Phase 2 item 1 — Add GitHub Copilot CLI event-log discovery and normalization.

### 2026-07-30T12:39:13.368Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:15.414Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T12:49:22.927Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T07:15:54.1763303-06:00 - GitHub Copilot CLI adapter completed
Added a read-only `events.jsonl` locator/parser for configured home overrides, `COPILOT_HOME`, and `~/.copilot`; normalized project-matched Copilot CLI sessions, timestamps, turns, attachments, and tool executions into the shared session model with a stable SHA-256 source revision. Wired the project-scoped `copilot-cli` watcher alongside VS Code Copilot without consulting the managed SQLite store, and added a sanitized fixture plus discovery, normalization, matching, revision, and provider-state boundary tests.

Validation passed: `npm run compile-tests`, `npm run compile`, the cached VS Code 1.93 `npm test` run (311 passing), `npm run lint`, and the scoped `git diff --check`. The first default-host `npm test` attempt did not start tests because the installed VS Code updater mutex was active; the repository-supported cached host completed cleanly.

STATUS: DONE

### 2026-07-30T13:16:11.037Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T13:16:11.274Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
