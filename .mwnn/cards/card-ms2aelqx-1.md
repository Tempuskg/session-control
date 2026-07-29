---
id: card-ms2aelqx-1
title: move the trash can to the far right and replace the open text with an icon
column: col-mqycuy1w-4
position: -4000
assignee: { kind: human }
createdAt: 1785099925401
updatedAt: 1785290232566
---

## Description
Update the Session Explorer item actions so the trash-can delete control is the rightmost action and the current visible “Open” label is replaced with an icon. Preserve the existing open and delete behavior while keeping both controls understandable and accessible.

## Acceptance criteria
- [x] Each affected Session Explorer item shows the trash-can delete control as the rightmost action.
- [x] The visible “Open” text is replaced with an open icon, with no visible “Open” label remaining in the action area.
- [x] Activating the open icon performs the same open action as the existing text control.
- [x] Activating the trash-can control continues to use the existing delete flow, including any confirmation behavior.
- [x] The open icon has an accessible name or tooltip identifying the action as “Open” and can be activated with the keyboard.
- [x] The reordered controls remain visible, aligned, and non-overlapping at supported Session Explorer widths.

## Activity
### 2026-07-28T12:16:42.087Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-28T12:49:34.408Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-28T12:55:34.661Z - OpenAI Codex implementation completed
Changed the Session Explorer Open action to a native `$(open-preview)` icon while retaining its existing command and accessible title, assigned explicit compact inline ordering so the trash action is rightmost, and added manifest regression coverage for icons and ordering. Verified with `npm run compile-tests`, `npm run compile`, `npm test` (290 passing), `npm run lint`, and a scoped diff check; the existing open and confirmed/cancelled delete-flow tests remain green.
STATUS: DONE

### 2026-07-28T14:11:32.284Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-28T14:18:56.095Z - OpenAI Codex implementation completed
Verified the native icon-only Session Explorer actions and explicit ordering that keeps Delete rightmost, then added regression coverage for direct Open activation, shared action contexts, accessible command metadata, and keyboard invocation. `npm.cmd run compile-tests`, `npm.cmd run compile`, the focused manifest check, `npm.cmd test` (291 passing), and `npm.cmd run lint` all passed.
STATUS: DONE

### 2026-07-28T14:20:01.598Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
