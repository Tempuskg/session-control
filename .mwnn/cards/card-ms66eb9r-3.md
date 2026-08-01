---
id: card-ms66eb9r-3
title: Record the missed source contract
column: col-mqycuy1w-4
position: 7000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785378377869
dependsOn: [card-ms66eb9r-2]
---

## Description
Record the concrete local source contract for the missed session so implementation and fixtures are based on observed provider behavior.

## Acceptance criteria
- [x] The source path, provider version, last modification time, and workspace identity are recorded.
- [x] The record contains metadata only and does not copy sensitive transcript content.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-0/item-3::record-the-missed-source-contract`
Source item: Phase 0 item 3 — Record the actual source path, source version, last modification time, and workspace identity without copying sensitive content.

### 2026-07-30T02:26:17.869Z - GitHub Copilot CLI source contract recorded
User-supplied visual evidence identifies GitHub Copilot CLI v1.0.75 running in `E:\chat-commit` on branch `main` and connected to Visual Studio Code.

The reproduced session ID is `84a4c0f6-321d-401d-907a-72d94089b85e`. Its source file is `C:\Users\darre\.copilot\session-state\84a4c0f6-321d-401d-907a-72d94089b85e\events.jsonl`, last modified `2026-07-29T13:59:38.027Z`. The event log records schema version 1, `cwd` `E:\chat-commit`, repository `Tempuskg/session-control`, session start `2026-07-29T13:59:25.414Z`, and settled assistant turn `2026-07-29T13:59:37.917Z`.

Observed discovery contract: GitHub Copilot CLI stores this project-owned session under the user Copilot home in `session-state/<session-id>/events.jsonl`; the `session.start` event provides the positive workspace match through `data.context.cwd`. Only path, version, identity, and timing metadata are retained here—no transcript content.

All acceptance criteria are satisfied.
