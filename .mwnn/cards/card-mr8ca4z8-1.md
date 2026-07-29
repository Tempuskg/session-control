---
id: card-mr8ca4z8-1
title: add a datetime column to sidebar saved sessions
column: col-mr0qf1g9-1
position: 1000
assignee: { kind: human }
createdAt: 1783289090996
updatedAt: 1785324768208
---

## Description
Show when each saved session was created directly in the Saved Sessions sidebar. Add a compact date-and-time field, derived from the session's `savedAt` value, to each session row's existing secondary text while preserving the turn count and analyzed/harvested status indicators.

## Acceptance criteria
- [x] Every saved-session leaf row displays a date and time derived from that session's `savedAt` value; workspace-group rows are unchanged.
- [x] The displayed value uses the user's local time zone and the consistent 24-hour format `YYYY-MM-DD HH:mm`.
- [x] The date/time appears as the first segment of the existing secondary text, followed by the current metadata (for example, `2026-04-12 04:00 · 4 turns · analyzed · harvested`).
- [x] Plain, analyzed, harvested, and analyzed-and-harvested sessions retain their existing turn counts, status indicators, icons, commands, context values, and tooltips.
- [x] Adding the date/time field does not change the sessions returned, their grouping by workspace, or their existing order.
- [x] Automated session-explorer tests verify the formatted date/time for a known `savedAt` value and verify its composition with each existing status combination.

## Activity
### 2026-07-29T01:57:42.278Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-29T02:16:38.841Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-29T02:21:38.711Z - Completed by Codex (ChatGPT)
Prefixed every saved-session leaf's secondary text with its locally formatted `savedAt` date and time, preserved the existing metadata and tree behavior, added coverage for every status combination, and documented the user-facing change. Validation passed with `npm.cmd run compile-tests`, `npm.cmd run compile`, `npm.cmd test` (291 tests), and `npm.cmd run lint`.
STATUS: DONE
