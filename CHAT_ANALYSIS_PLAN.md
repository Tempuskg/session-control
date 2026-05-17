# Chat Analysis Feature Plan

## Goal

Add an `@session-control /analyze` workflow that reads saved sessions from each workspace's configured `.chat` folder, lets the user choose either a timeframe or a "Needs Analysis" mode, reassembles split sessions, sends a batched analysis request through the current chat model, streams the result back into chat, and saves a durable markdown report plus analysis state. Existing saved session files remain unchanged; analysis tracking lives in a separate fingerprint-based index so unchanged chats are skipped and changed chats become eligible again.

## Steps

1. Define analysis-specific types and a separate persistence contract for reports, selection modes, and analyzed-session entries. Keep the existing session schema in `src/types.ts` backward compatible.
2. Add a new analysis storage layer that writes reports to an analysis subdirectory under the configured storage path and keeps an index file there.
3. Use a content fingerprint for "already analyzed" checks instead of file-name checks so rewritten or renamed saves dedupe correctly and changed content becomes analyzable again.
4. Reuse the existing session listing and split-session reassembly patterns so analysis runs against logical conversations, not individual part files.
5. Support these selection modes in the first version: Last 24 Hours, Last 7 Days, Last 30 Days, Custom Range, and Needs Analysis. For the chat-participant entry point, default `@session-control /analyze` with no prompt to a QuickPick, with optional simple aliases like `24h`, `7d`, `30d`, or `unanalyzed`.
6. Scope cross-repository analysis to the currently open multi-root workspace only. Save the combined report into one report-owner workspace, using the active-editor workspace first and the first root as fallback, while updating analysis state for every contributing workspace.
7. Add an analyzer module that turns selected sessions into structured evidence: workspace name, git branch and commit, timestamps, title, markdown summary, key turns, and tool-call summaries.
8. Use the supplied prompt as the core instruction, substitute the chosen timeframe label, and append a fixed output structure so reports stay comparable over time.
9. Add batching by character budget so large chat histories do not exceed model context. If the selected sessions are too large, generate batch-level interim findings first, then run a final synthesis pass across those findings.
10. Extend the participant command handling in `src/chatParticipant.ts` with `/analyze` beside the existing `/resume` and `/list` flows. Keep the handler thin by injecting dependencies for selection UI, session loading, analysis-store I/O, and model execution.
11. Update `package.json` so the session-control participant advertises the new `/analyze` command. Only add new settings if batching or retention truly need them after implementation.
12. Document the new flow in `README.md`, add the user-facing change to `CHANGELOG.md`, and update the required wiki pages and log per the repo rule.

## Relevant Files

- `src/chatParticipant.ts`
- `src/types.ts`
- `src/sessionStore.ts`
- `package.json`
- `test/unit/chatParticipant.test.ts`
- `test/unit/chatParticipant.integration.test.ts`
- `README.md`
- `CHANGELOG.md`
- `wiki/chat-participant.md`
- `wiki/overview.md`
- `wiki/file-manifest.md`
- `wiki/index.md`
- `wiki/log.md`

## Verification

1. Unit-test the new analysis store: report writing, index writing, unchanged-fingerprint skipping, and changed-content reanalysis.
2. Unit-test timeframe filtering and Needs Analysis mode, including custom-range boundaries.
3. Unit-test prompt composition and batching so the chosen timeframe is reflected and oversized input falls back to batch summaries plus final synthesis.
4. Extend chat participant integration tests for single-root and multi-root analysis, split-session reassembly, empty selections, and successful report persistence.
5. Run `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint`.
6. Manually smoke-test `@session-control /analyze` in VS Code, confirm a report is streamed in chat and saved under the analysis subdirectory, then rerun to verify unchanged sessions are skipped until content changes.

## Decisions

- Entry point: `@session-control /analyze`
- Output: stream results in chat and also save markdown reports
- Reanalysis rule: fingerprint-based, so changed sessions are analyzed again
- Cross-repo scope: current open multi-root workspace only, not global across unrelated workspaces
- Storage strategy: dedicated analysis subdirectory under the configured storage path, not inline flags inside saved session JSON
