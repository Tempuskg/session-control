# Chat Analysis Feature Plan

## Status

- State: Implemented in source, tests, docs, and manifest contributions.
- Last updated: 2026-05-17.
- Current follow-up model: `@session-control /analyze` persists a saved report and offers `@session-control /handoff`; `Session Control: Handoff Latest Analysis` provides the same handoff from the command palette.
- Planned refinement: restrict analysis recommendations to AI-specific control files only.
- Remaining work: implement and verify the AI-control-file recommendation restriction, then manually smoke-test the analyze and handoff flows in VS Code.

## Goal

Implement an `@session-control /analyze` workflow that reads saved sessions from each workspace's configured `.chat` folder, lets the user choose either a timeframe or a "Needs Analysis" mode, reassembles split sessions, sends a batched analysis request through the current chat model, streams the result back into chat, and saves a durable markdown report plus analysis state. Existing saved session files remain unchanged; analysis tracking lives in a separate fingerprint-based index so unchanged chats are skipped and changed chats become eligible again. The saved report then becomes the handoff artifact for a coding-agent follow-up. Analysis recommendations should be restricted to AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and similar prompt, instruction, agent, or skill-definition files rather than general source-code changes.

## Delivered Scope

1. Completed: defined analysis-specific types and a separate persistence contract for reports, selections, report metadata, and analyzed-session entries while keeping saved session schema compatibility in `src/types.ts`.
2. Completed: added a dedicated analysis storage layer in `src/analysisStore.ts` that writes reports to an analysis subdirectory and maintains an index file.
3. Completed: used content fingerprints for "already analyzed" checks so renamed or rewritten sessions dedupe correctly and changed content becomes eligible again.
4. Completed: reused session listing and split-session reassembly patterns so analysis runs against logical conversations rather than individual part files.
5. Completed: shipped Last 24 Hours, Last 7 Days, Last 30 Days, Custom Range, and Needs Analysis selection modes, including the follow-up prompt that asks whether a chosen date range should analyze only unanalyzed sessions or everything in that range.
6. Completed: kept cross-repository analysis scoped to the currently open multi-root workspace and wrote the combined report to one owner workspace while updating index state for each contributing workspace.
7. Completed: added analyzer/orchestration logic that builds structured evidence from saved sessions, including workspace context, git metadata, titles, summaries, timestamps, and tool-call summaries.
8. Completed: composed analysis prompts from the chosen timeframe label plus a fixed output structure so reports remain comparable.
9. Completed: added character-budget batching with batch summaries plus a final synthesis pass when selected sessions exceed a single prompt budget.
10. Completed: extended `src/chatParticipant.ts` with `/analyze` and kept the handler thin through injected dependencies for selection UI, session loading, persistence, and model execution.
11. Completed: updated `package.json` so the participant advertises `/analyze`, and later added the handoff surfaces that reuse saved analysis reports.
12. Completed: documented the feature in `README.md`, `CHANGELOG.md`, and the required wiki pages.
13. Completed: added a lightweight handoff flow so analysis results can open a generated implementation prompt in chat or an agent-capable surface.
14. Completed: removed the earlier in-thread `/implement` path and standardized the post-analysis continuation model on handoff-only flows.

## Next Scope Refinement

1. Restrict the analysis and synthesis prompts so the recommendation sections only propose edits to AI-specific control files.
2. Treat `AGENTS.md` and `.github/copilot-instructions.md` as first-class targets in this repository.
3. Treat `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`, and comparable repository-local AI control files as in-scope when present.
4. Treat recommendations for application source, tests, build tooling, and general documentation as out of scope unless the recommendation is specifically to change an AI control file that governs those workflows.
5. Add or update tests so prompt construction and follow-up behavior reflect the narrowed recommendation scope.

## Relevant Files

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `src/analysisOrchestrator.ts`
- `src/analysisStore.ts`
- `src/chatParticipant.ts`
- `src/extension.ts`
- `src/sessionAnalysis.ts`
- `src/types.ts`
- `src/sessionStore.ts`
- `package.json`
- `test/unit/analysisStore.test.ts`
- `test/unit/chatParticipant.test.ts`
- `test/unit/chatParticipant.integration.test.ts`
- `test/unit/sessionAnalysis.test.ts`
- `README.md`
- `CHANGELOG.md`
- `wiki/chat-participant.md`
- `wiki/file-manifest.md`
- `wiki/log.md`

## Verification

1. Completed: unit tests cover the analysis store, including report writing, index writing, unchanged-fingerprint skipping, and changed-content reanalysis.
2. Completed: unit tests cover timeframe filtering and Needs Analysis selection behavior, including custom-range handling.
3. Completed: unit tests cover prompt composition and batching so the selected timeframe is reflected and oversized input falls back to batch summaries plus a final synthesis pass.
4. Completed: chat participant tests cover analysis execution, empty selections, report persistence, and analysis follow-up behavior.
5. Completed: `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` all passed on 2026-05-17.
6. Remaining: add verification that the analysis prompt restricts recommendations to AI-specific control files, including current repo targets `AGENTS.md` and `.github/copilot-instructions.md`, plus optional files such as `CLAUDE.md` when present.
7. Remaining: manually smoke-test `@session-control /analyze`, verify report persistence under the analysis subdirectory, rerun to confirm unchanged sessions are skipped until content changes, confirm the handoff prompt opens as expected, and verify the resulting recommendations stay within the AI-control-file scope.

## Decisions

- Entry point: `@session-control /analyze`
- Output: stream results in chat and also save markdown reports
- Reanalysis rule: fingerprint-based, so changed sessions are analyzed again
- Cross-repo scope: current open multi-root workspace only, not global across unrelated workspaces
- Storage strategy: dedicated analysis subdirectory under the configured storage path, not inline flags inside saved session JSON
- Follow-up model: handoff-only via `@session-control /handoff` and `Session Control: Handoff Latest Analysis`
- Recommendation scope: only AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and other repository-local instruction or prompt control files
