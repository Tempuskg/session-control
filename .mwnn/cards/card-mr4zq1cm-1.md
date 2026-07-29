---
id: card-mr4zq1cm-1
title: When you delete a session in the sidebar have the side bar auto refresh
column: col-mqycuy1w-4
position: 2000
assignee: { kind: human }
createdAt: 1783086599254
updatedAt: 1783168557611
---

## Description
When a saved session is deleted — via the sidebar context-menu action (`session-control.deleteSessionFromExplorer`) or the Command Palette command (`session-control.deleteSession`) — the Session Explorer tree view must update immediately so the deleted entry disappears without the user clicking the manual Refresh button or collapsing/reopening the view.

The command handlers in `src/extension.ts` already call `sessionExplorerProvider.refresh()` after `sessionStore.deleteSession(...)` resolves, yet the deleted item can remain visible in the sidebar. This card covers verifying the full delete → refresh flow in the running extension, finding why the tree still shows the stale entry (e.g. refresh firing before the file removal is observable, tree item id/caching behavior, or the deletion path not being one of the wired commands), and fixing it so the sidebar always reflects the store immediately after a delete.

## Acceptance criteria
- [ ] Deleting a session from the sidebar context menu removes that item from the Session Explorer immediately after the "Delete" confirmation, with no manual refresh needed.
- [ ] Deleting a session via the `Session Control: Delete Session` Command Palette command also updates the sidebar immediately.
- [ ] If the delete fails because the file is already gone, the sidebar still refreshes so the stale entry disappears (existing behavior at the `deleted === false` branch is preserved).
- [ ] Cancelling the delete confirmation leaves the sidebar unchanged and the session file on disk.
- [ ] When the last session in a workspace group is deleted, the group node updates correctly (empty state or group removal, matching existing empty-tree behavior).
- [ ] A unit test asserts that the delete command handlers trigger a tree refresh after deletion (both the explorer context-menu path and the Command Palette path).
- [ ] Verified manually in the Extension Development Host: delete a session from the sidebar and confirm the entry disappears without clicking Refresh.

## Activity
### 2026-07-03T13:59:37.706Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-03T14:01:04.580Z - AI loop triage
The AI judged this card doable by an agent and assigned it to AI.
Why: The implementation involves code changes and unit tests that an AI coding agent can handle autonomously.

### 2026-07-03T14:01:04.604Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-03T14:01:04.626Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-03T14:02:42.407Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-03T14:17:43.840Z - AI loop timed out
Gave up waiting for the dispatched agent to finish; the loop will not retry this card this run.
