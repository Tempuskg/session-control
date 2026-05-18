# Chat Analysis Feature Plan

## Status

- State: Implemented in source, tests, docs, and manifest contributions.
- Last updated: 2026-05-17.
- Current follow-up model: `@session-control /analyze` persists a saved report and offers `@session-control /implement`; `Session Control: Implement Latest Analysis` provides the same lightweight implementation flow from the command palette.
- Implemented refinement: analysis recommendations and implementation prompts are restricted to AI-specific control files only.
- Implemented refinement: analysis also identifies reusable AI skills that ought to be created, and `/implement` prompts can direct the next coding-agent step to create those skills when the saved analysis recommends them.
- Remaining work: manually smoke-test the analyze and implement flows in VS Code.

## Goal

Implement an `@session-control /analyze` workflow that reads saved sessions from each workspace's configured `.chat` folder, lets the user choose either a timeframe or a "Needs Analysis" mode, reassembles split sessions, sends a batched analysis request through the current chat model, streams the result back into chat, and saves a durable markdown report plus analysis state. Existing saved session files remain unchanged; analysis tracking lives in a separate fingerprint-based index so unchanged chats are skipped and changed chats become eligible again. The saved report then becomes the artifact for a lightweight coding-agent implementation follow-up. Analysis recommendations should be restricted to AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and similar prompt, instruction, agent, or skill-definition files rather than general source-code changes. The analysis should also identify reusable AI skills that would improve recurring workflows, and `/implement` should be able to create those skill files when the saved report recommends them.

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
11. Completed: updated `package.json` so the participant advertises `/analyze`, and later added the lightweight implementation surface that reuses saved analysis reports.
12. Completed: documented the feature in `README.md`, `CHANGELOG.md`, and the required wiki pages.
13. Completed: added a lightweight implementation flow so analysis results can open a generated implementation prompt in chat or an agent-capable surface.
14. Completed: removed the earlier in-thread `/implement` path and standardized the post-analysis continuation model on the lightweight implementation flow instead.
15. Completed: restricted analysis recommendations and implementation prompts to AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and similar repository-local instruction files.
16. Completed: extended analysis prompts to recommend new reusable AI skills for repeated workflows and extended `/implement` prompts to create those repository-local skill files when recommended.

## Implemented Recommendation Scope Refinement

1. Completed: restricted the analysis and synthesis prompts so the recommendation sections only propose edits to AI-specific control files.
2. Completed: treated `AGENTS.md` and `.github/copilot-instructions.md` as first-class targets in this repository.
3. Completed: treated `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`, and comparable repository-local AI control files as in-scope when present.
4. Completed: treated recommendations for application source, tests, build tooling, and general documentation as out of scope unless the recommendation is specifically to change an AI control file that governs those workflows.
5. Completed: updated tests so prompt construction and follow-up behavior reflect the narrowed recommendation scope.

## Implemented AI Skill Refinement

1. Completed: extended the analysis prompt so it explicitly looks for repeated workflows that should be captured as reusable AI skills, not only edits to existing control files.
2. Completed: had the saved analysis report distinguish between changes to existing AI control files and proposals to create new skill assets such as `SKILL.md`, `*.instructions.md`, `*.prompt.md`, or `*.agent.md`.
3. Completed: updated the `/implement` flow so the generated implementation prompt can create the recommended AI skills, including new repository-local skill files when they are the highest-value next step.
4. Completed: kept the skill-creation scope repository-local by preferring new or updated skill, prompt, instruction, and agent-definition files over source-code changes.
5. Completed: updated tests so prompt construction covers both skill discovery during analysis and skill creation during `/implement`.

## Relevant Files

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `SKILL.md` (when created)
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
6. Completed: unit tests now verify that the analysis and implementation prompts restrict recommendations to AI-specific control files, including current repo targets `AGENTS.md` and `.github/copilot-instructions.md`, plus optional files such as `CLAUDE.md` when present.
7. Completed: unit tests now verify that analysis can recommend creating new reusable AI skills and that `/implement` prompts can direct creation of those skill files when recommended.
8. Remaining: manually smoke-test `@session-control /analyze`, verify report persistence under the analysis subdirectory, rerun to confirm unchanged sessions are skipped until content changes, confirm the implementation prompt opens as expected, and verify the resulting recommendations stay within the AI-control-file and AI-skill scope.

## Decisions

- Entry point: `@session-control /analyze`
- Output: stream results in chat and also save markdown reports
- Reanalysis rule: fingerprint-based, so changed sessions are analyzed again
- Cross-repo scope: current open multi-root workspace only, not global across unrelated workspaces
- Storage strategy: dedicated analysis subdirectory under the configured storage path, not inline flags inside saved session JSON
- Follow-up model: lightweight implementation flow via `@session-control /implement` and `Session Control: Implement Latest Analysis`
- Recommendation scope: only AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and other repository-local instruction or prompt control files
- Skill creation scope: analysis may recommend new repository-local AI skills, and `/implement` should create those skill files when they are the best next improvement
