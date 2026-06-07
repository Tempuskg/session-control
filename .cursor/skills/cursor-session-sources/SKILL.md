---
name: cursor-session-sources
description: Distinguish Cursor `chatSessions` JSONL from `.cursor/projects/.../agent-transcripts` JSONL, resolve workspace-to-storage mapping, and validate picker/current-session visibility. Use when working on Cursor session import/save behavior, missing current Cursor chats, `chatSessions`, `agent-transcripts`, project-slug mapping, or Cursor provider picker behavior in this repository.
---
# Cursor Session Sources

## Instructions
- First decide which Cursor session source is in scope: legacy `%APPDATA%/Cursor/User/workspaceStorage/.../chatSessions/*.jsonl` or current `%USERPROFILE%/.cursor/projects/<project-slug>/agent-transcripts/**/*.jsonl`.
- Match the active workspace to Cursor storage before editing. Prefer `workspace.json` and project-slug derivation over broad filesystem exploration.
- Keep SQLite and `state.vscdb` out of scope unless the user explicitly asks for them.
- When the current Cursor conversation is missing from the provider picker, check `agent-transcripts` before changing `chatSessions` logic.
- For Cursor provider changes, preserve legacy `chatSessions` support unless the user explicitly asks to replace it.

## Validation
- Confirm the Cursor provider picker still appears.
- Confirm the expected current session or thread becomes visible when that is the goal.
- Confirm older `chatSessions` imports still work when both sources are supported.
- Add or update focused tests for workspace resolution, project-slug mapping, and transcript normalization when those areas change.

## Repo Touchpoints
- `src/cursorSessionReader.ts`
- `src/cursorAgentTranscriptReader.ts`
- `src/extension.ts`
- `test/unit/cursorSessionReader.test.ts`
- `test/unit/cursorAgentTranscriptReader.test.ts`
