---
id: card-ms2ag2zm-2
title: if the session has already been analyzed have the tooltip say reanalyze
column: col-mqycuy1w-4
position: -3000
assignee: { kind: human }
createdAt: 1785099994402
updatedAt: 1785242855754
---

## Description
Update the Session Explorer's inline analysis action so its tooltip reflects whether the selected session has already been analyzed. Unanalyzed sessions continue to show `Analyze This Session`; sessions that the explorer already identifies as analyzed show `Reanalyze This Session`. This is a labeling change only—the action must continue to run the existing single-session analysis flow.

## Acceptance criteria
- [x] Hovering over the inline analysis action for a session with no matching analysis entry shows the tooltip `Analyze This Session`.
- [x] Hovering over the inline analysis action for a session with a matching analysis entry shows the tooltip `Reanalyze This Session`.
- [x] The tooltip uses the same per-workspace analyzed-state resolution as the session row's existing `analyzed` badge, including sessions matched by the existing session ID or root-file-name rules.
- [x] Activating either tooltip variant runs the existing single-session analysis action for the clicked session; an already analyzed session can be analyzed again.
- [x] After a session is successfully analyzed and the Session Explorer refreshes, its inline action changes from `Analyze This Session` to `Reanalyze This Session` without requiring a VS Code reload.
- [x] Automated tests cover both analyzed and unanalyzed session rows and verify the tooltip text and command/action behavior.

## Activity
### 2026-07-28T03:55:05.072Z - OpenAI Codex CLI definition handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-28T12:02:06.435Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-07-28T06:10:27.1966349-06:00 - Implementation completed
Added analyzed-row context and a `Reanalyze This Session` inline command that shares the existing single-session analysis handler, preserved the other inline row actions for both states, and added automated coverage for tooltip contributions, per-workspace ID/root-file matching, analyzed-session reruns, and refresh-time label changes. Verified with `npm.cmd run compile-tests`, `npm.cmd run compile`, `npm.cmd test` (289 passing), `npm.cmd run lint`, and scoped `git diff --check`.

STATUS: DONE
