---
title: "Wiki Log"
type: log
created: 2026-04-12
updated: 2026-07-03
---

# Wiki Log

Chronological record of all wiki operations.

---

## [2026-07-04] change | VSIX packaging cleanup
Added `.mwnn/**` (kanban cards), `session-control-pro/**` (Pro workspace stub), `debug.log`, and `**/*.log` to `.vscodeignore`. These development-only files were shipping in the published VSIX (discovered while packaging the dev build for Cursor testing). Package contents verified after the change: 10 files (LICENSE, changelog, package.json, readme, dist/extension.js, media assets), down from 20.
Pages touched: (repo files: .vscodeignore, CHANGELOG.md)

## [2026-07-04] change | Cursor resume opens a fresh agent chat
Reordered `RESUME_TARGET_CANDIDATES.cursor` to prefer `composer.newAgentChat` over `aichat.newchataction` so resuming pastes into a new agent chat tab instead of the currently open conversation/draft (parity with Claude Code's new-conversation step). Probe-verified in Cursor 3.9.16: with an existing draft in the composer, `composer.newAgentChat` opens a second chat tab and the paste lands only in the fresh composer. `aichat.newchataction` kept as fallback for older builds; unverified legacy candidates retained last.
Pages touched: resume-system.md (+ repo files: src/resumeTarget.ts, test/unit/resumeTarget.test.ts, test/unit/chatParticipant.integration.test.ts, CHANGELOG.md)

## [2026-07-04] change | Host-aware provider picker for Save Session...
`Session Control: Save Session...` now builds its provider quick pick from the host app: inside Cursor (detected via `vscode.env.appName`, same regex as `resolveImplicitSaveProviderForHost`) the Copilot entry is replaced with a Cursor entry that imports from local Cursor agent transcripts, since Cursor has no Copilot chat storage to save from. Other hosts keep Copilot/Codex/Claude Code. Implemented as the exported pure helper `createSessionProviderPickItems(appName)` in `src/extension.ts` with unit coverage in `extensionPhase10.test.ts`.
Pages touched: (repo files: src/extension.ts, test/unit/extensionPhase10.test.ts, CHANGELOG.md)

## [2026-07-03] change | Cursor resume auto-paste parity
Brought the Cursor origin-agent resume flow to parity with Codex/Claude Code: added `cursor` focus-command candidates (`composer.focusComposer`, `workbench.panel.aichat.view.focus`) to `FOCUS_COMMAND_CANDIDATES` — verified against Cursor 3.9.16's workbench bundle, where `composer.focusComposer` is the registered "Focus Agent" action — and included `cursor` in the auto-paste branch of `runResumeIntoOriginAgent` with Codex-style settle/retry constants. On success the message now says the context was pasted; if focus or paste fails, the existing copied-to-clipboard "paste (Ctrl+V) to continue" fallback is unchanged. Cursor's composer is host-provided (not an extension webview), so the paste relies on VS Code's generic DOM paste fallback; this caveat is documented in the code and in resume-system.md. `resume.providerCommands` overrides keep working.
Pages touched: resume-system.md (+ repo files: src/resumeTarget.ts, src/chatParticipant.ts, test/unit/resumeTarget.test.ts, test/unit/chatParticipant.integration.test.ts, CHANGELOG.md)

## [2026-06-30] change | Consolidate manual save onto a single explicit picker
Removed the `session-control.saveSession` ("Save Current Chat Session") command: it inferred the provider from the host app or the `save.provider` override, which could silently save the wrong agent's transcript when the user expected a different one. Renamed `session-control.saveSessionFromProvider` to "Save Session..." so the provider quick pick is now the single manual save entry point. Reverted the short-lived dedicated `saveCodexSession`/`saveClaudeCodeSession` commands, the `Save Current Session` view-title submenu, and the exported `runSaveSessionForProviderFlow` test seam (the explored "active chat window" detection was rejected because recency-based detection does not match which chat the user has focused, and there is no VS Code API to detect the focused chat panel). The exported `runSaveSessionFlow` copilot test seam and its coverage are retained. Updated the `save.provider` setting description to note it now only affects auto-save.
Pages touched: (repo files: src/extension.ts, package.json, test/unit/extensionSaveFlow.test.ts, README.md, CHANGELOG.md)

## [2026-06-28] add | Open VSX Listing — Phase 2 Step 2 (screenshots markup + capture brief)
Added a `## Screenshots` section to `README.md` above the Features list with five staged image references (`demo.gif`, `save-session.png`, `resume-session.png`, `session-explorer.png`, `provider-picker.png`) using absolute `raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/` URLs so both Open VSX and VS Marketplace resolve them. Wrapped the image block in `<!-- screenshots:pending … -->` HTML comment markers so the live listing renders no broken-image icons until the human captures and commits the five files. Created `media/screenshots/README.md` as a precise capture brief with required filenames, target dimensions, max sizes, OS/UI prep checklist, per-shot scripts, privacy sweep, and post-capture uncomment-and-release flow. Extended `wiki/open-vsx-listing.md` with §3.5 (Step 2 strategy, asset table, URL pattern, comment-wrap rationale, anti-patterns) and added a dedicated Step 2 approval checklist to §4. No image binaries were committed; the visual capture remains human-owned.
Pages touched: open-vsx-listing.md (+ repo files: README.md, media/screenshots/README.md, CHANGELOG.md)

## [2026-06-28] add | Open VSX Listing — Audit & Rewrite
Drafted `wiki/open-vsx-listing.md` with the current-state audit (v1.3.3 `description` + keywords + README hero), the keyword plan (added `windsurf`, `chat-history`, `session-manager`, `ai-sessions`, `cross-ide`, `ai-chat`, `agent`, `transcript`, `history`, `vscodium`), the new `description` string, the new README hero, and the human-approval checklist. Reordered keywords in `package.json` to put the audience-priority providers first (Cursor, Claude Code, Codex, Copilot). Rewrote `README.md` to lead with "Save your Cursor, Claude Code, Codex, and GitHub Copilot chat history across git commits", added a "Why Session Control" section above the features list, expanded the installation section to surface the Open VSX install path explicitly for Cursor / Windsurf / VSCodium users. No feature, command, or behavior claims changed; configuration table, command list, and privacy warning are unchanged. Screenshots/GIF (Phase 2 Step 2) deferred to a separate task. Pending human approval before the next tagged release.
Pages touched: open-vsx-listing.md, index.md (+ repo files: README.md, package.json, CHANGELOG.md)

## [2026-04-12] ingest | PLAN.md
Initial wiki creation from project plan (`raw/plan.md`).
Created 10 wiki pages covering architecture, subsystems, configuration, and file manifest.
Pages touched: overview.md, architecture.md, save-system.md, resume-system.md, chat-participant.md, git-integration.md, session-format.md, configuration.md, file-manifest.md, source-plan.md, index.md

## [2026-04-12] update | Address Gaps in PLAN.md
Updated PLAN.md with six new sections addressing gaps identified during initial wiki creation: testing strategy, error handling patterns, markdown summary generation, fuzzy matching algorithm, multi-root workspace handling, and extension activation events.
Pages touched: source-plan.md

## [2026-04-12] update | Open Source Project
Updated PLAN.md to declare the project as open source (MIT). Added Step 1.1b for open source project files (LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, GitHub issue/PR templates, CI/CD workflows). Updated Decisions & Assumptions and Risks & Mitigations. Updated file manifest with open source project files.
Pages touched: overview.md, source-plan.md, file-manifest.md

## [2026-04-12] restructure | Break Plan into Smaller Phases
Restructured PLAN.md from 4 large phases to 10 incremental phases, each with a clear deliverable. Phases now follow the dependency graph: scaffolding → types → git → reader → writer → save command → resume → bloat controls → auto-save → polish. Added JSON schema back to Phase 5. Updated overview.md phase table and source-plan.md phase description.
Pages touched: overview.md, source-plan.md

## [2026-04-12] checkpoint | Phase 10 Complete
Phase 10 (Polish & Multi-Root Support) now complete with all deliverables implemented and tested:
- Configuration validation for safe relative storagePath resolution and bounded resume settings
- Multi-root manual save/list/delete with active-editor workspace preference and cross-workspace browsing
- Multi-root resume/list with folder-prefixed disambiguation and workspace-folder-specific config lookup
- .gitignore management for configured storage folder during save flow (idempotent workspace-relative entries)
- Session explorer tree view with workspace grouping, open-in-editor, refresh, and delete actions
- Status bar auto-save indicator/toggle with dynamic listener sync on config changes
- 58 passing tests (100% coverage of Phase 10 deliverables); npm run lint clean; ready for release
All changes committed: commit 656f480 "feat: complete phase 10 polish and multi-root support"
Pages touched: overview.md, source-plan.md, file-manifest.md

## [2026-04-13] update | Session Viewer Feature
Added session viewer documentation to wiki after implementing the `session-control.viewSessionFile` command and editor title preview action. The session viewer is an HTML webview panel that renders saved sessions as formatted conversations, accessible from the Session Explorer sidebar or by opening a session JSON file and clicking the preview icon in the editor title bar. A context key (`session-control.isSessionFile`) controls button visibility.
Pages touched: architecture.md, file-manifest.md, overview.md, index.md, log.md

## [2026-04-13] update | Auto-Save on Chat Response Feature
Documented the new `autoSaveOnChatResponse` setting and its implementation. The feature watches the Copilot chat session storage directory for file changes, debounces (5s), checks turn count increases, auto-saves with old-file cleanup, and disables on error. Uses dependency injection (`AutoSaveOnChatResponseDeps`) for testability. The toggle command now controls chat-response auto-save. Status bar reflects both auto-save modes. 4 new tests added.
Pages touched: save-system.md, configuration.md, architecture.md, overview.md, file-manifest.md, log.md

## [2026-04-13] update | Resume Icon in Session Viewer
Implemented the resume icon feature for the Session Viewer. Added `sessionTitle` and `fileName` properties to `SessionViewerPanel` with public getters to expose session metadata. Registered new command `session-control.resumeSessionFromViewer` that opens the chat panel with a pre-filled `@session-control /resume <title>` query. Updated `package.json` to add command declaration and editor/title menu entry (appears when viewer is active via `activeWebviewPanelId` context). Icon: `debug-start` (▶). Added unit test for no-open-viewer case. Architecture documentation already contained forward-looking description; this completes the implementation.
Pages touched: (implementation only; wiki docs already current)

## [2026-04-13] update | Remove Auto-Save on Commit
Removed the `autoSaveOnCommit` feature entirely. The feature relied on the VS Code Git extension API to watch for HEAD changes and was superseded by the more reliable `autoSaveOnChatResponse` feature. Removed: `autoSaveOnCommit` setting, `toggleAutoSaveOnCommit` command (replaced by `toggleAutoSave`), `registerAutoSaveOnCommitListener` function, `GitRepositoryLike`/`GitApiLike`/`AutoSaveListenerDeps` interfaces, all related tests. Added diagnostic logging to `registerAutoSaveOnChatResponseListener` for all lifecycle events. Added marketplace icon (`media/session-control.png`). Wiki updated to remove commit-based auto-save docs from configuration and git-integration pages.
Pages touched: save-system.md, configuration.md, git-integration.md, log.md

## [2026-04-13] update | Privacy Warning for Public Repos
Documented privacy risks of committing `.chat/` session files to public repositories. Session files record full Copilot conversations including agent tool call I/O, which routinely captures local filesystem paths (exposing OS usernames) and workspace-internal details. Added Privacy Warning section to `configuration.md` (with cross-reference from `includeInGitignore` setting) and a Privacy Considerations section to `save-system.md`. Mirrors the new warning added to README.md.
Pages touched: configuration.md, save-system.md, log.md

## [2026-04-13] update | Finish Removing Auto-Save on Commit Docs
Completed removal of all `autoSaveOnCommit` references missed in the previous cleanup. Removed the "Auto-save on commit" feature bullet and settings table row from README.md. Removed the "Auto-Save on Commit" section and its sequence diagram from git-integration.md. Updated overview.md phase table and key design decision. Updated file-manifest.md command to `toggleAutoSave`. Updated index.md git-integration summary.
Pages touched: README.md, wiki/git-integration.md, wiki/overview.md, wiki/file-manifest.md, wiki/index.md, wiki/log.md

## [2026-04-24] fix | Empty Snapshot Session False Positive Error
Fixed a bug where opening a new project and typing the first prompt (before any response) triggered the error "Unrecognized Copilot session format (VS Code X.Y.Z). Session Control may need an update."

Root cause: VS Code writes a JSONL file with a valid `kind:0` snapshot record but an empty `requests[]` array the moment a chat session is created. The session reader correctly identified the snapshot-patch format but found no completed turns and returned `null`, which was then counted as an unknown format error.

Fix: added `EmptySessionError` class to distinguish "recognized format with no completed turns yet" from a genuinely unrecognized format. The reader now throws `EmptySessionError` when a `kind:0` snapshot record is present but yields no turns, catches it silently (with a log warning only), and does not increment the unknown-format counter. Added a fixture (`test/fixtures/session-reader/empty-snapshot-session.jsonl`) and two new unit tests.
Pages touched: save-system.md, log.md

## [2026-05-17] update | Saved Chat Analysis Feature
Implemented the first version of saved-chat analysis via `@session-control /analyze`. The chat participant can now resolve a timeframe or "Needs Analysis" scope, reassemble split session files, batch large transcript sets into multiple model requests, synthesize a final markdown report, and persist that report under `.chat/analysis/reports/`. Added a fingerprint-based analysis index at `.chat/analysis/index.json` so unchanged chats can be skipped on future analysis runs. Added new source files `src/analysisStore.ts` and `src/sessionAnalysis.ts`, plus unit coverage for prompt selection, filtering, batching, and analysis-store persistence.
Pages touched: chat-participant.md, file-manifest.md, overview.md, index.md, log.md

## [2026-05-17] update | Analysis Implementation Followup
Extended the saved-chat analysis flow so it now suggests an **Implement Recommendations** follow-up after `@session-control /analyze`. Added `/implement` to the participant command set, report-loading support in `analysisStore.ts`, and implementation-context prompt building in `sessionAnalysis.ts`. The participant can now reuse the latest saved analysis report in the same chat thread for implementation-oriented follow-ups.
Pages touched: chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Date Range Analyze Scope Choice
Updated the interactive `@session-control /analyze` date-range flow so it now asks whether to analyze only unanalyzed chats within the selected date range or re-analyze every chat in that range. Persisted reports now record whether the run was limited to unanalyzed chats.
Pages touched: chat-participant.md, log.md

## [2026-05-17] update | Analysis Handoff Command
Added `@session-control /handoff` as a lighter bridge from saved analysis into a coding-agent workflow. The participant now offers a **Handoff to Agent** follow-up after analysis, builds a compact handoff prompt that points the next agent session at the saved analysis report and repository instructions, opens chat by default, and can copy the prompt for an agent session when that surface is available.
Pages touched: chat-participant.md, file-manifest.md, overview.md, log.md

## [2026-05-17] update | Latest Analysis Handoff Command
Added the `Session Control: Handoff Latest Analysis` command so users can launch the lightweight handoff flow from the command palette without depending on prior chat-thread metadata. The command scans open workspaces for the newest usable saved analysis report, then opens chat or an agent session with the generated prompt.
Pages touched: README.md, chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Remove Implement Command
Removed `@session-control /implement` from the chat participant so saved-chat analysis now flows only into the handoff surfaces. Updated the participant follow-up behavior, manifest, README, changelog, and wiki pages to point users at `@session-control /handoff` or `Session Control: Handoff Latest Analysis` instead.
Pages touched: README.md, CHANGELOG.md, chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Restrict Analysis Recommendations To AI Control Files
Restricted saved-chat analysis recommendations and handoff implementation prompts to AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and similar repository-local instruction files. Updated prompt construction, tests, README, changelog, and wiki pages to reflect the narrower scope.
Pages touched: CHAT_ANALYSIS_PLAN.md, README.md, CHANGELOG.md, chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Rename Slash Command To Implement
Renamed the chat-participant implementation follow-up command from `@session-control /handoff` to `@session-control /implement` while keeping `Session Control: Handoff Latest Analysis` as the command-palette entry point. Updated the manifest, participant follow-up wiring, guidance copy, tests, README, changelog, plan, and wiki pages to reflect the renamed slash command.
Pages touched: CHAT_ANALYSIS_PLAN.md, README.md, CHANGELOG.md, chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Rename Latest Analysis Command To Implement
Renamed the command-palette entry from `Session Control: Handoff Latest Analysis` (`session-control.handoffLatestAnalysis`) to `Session Control: Implement Latest Analysis` (`session-control.implementLatestAnalysis`). Updated the extension registration, tests, README, changelog, plan, and wiki pages to reflect the unified implementation terminology.
Pages touched: CHAT_ANALYSIS_PLAN.md, README.md, CHANGELOG.md, chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Add AI Skill Recommendations
Extended the saved-chat analysis prompts so reports can recommend new reusable repository-local AI skills for repeated workflows. Updated the `/implement` prompt construction so the next coding-agent step can create those skill files, including `SKILL.md`, `*.instructions.md`, `*.prompt.md`, and `*.agent.md` when recommended.
Pages touched: CHAT_ANALYSIS_PLAN.md, README.md, CHANGELOG.md, chat-participant.md, file-manifest.md, log.md

## [2026-05-17] update | Filter Existing AI Guidance
Extended the saved-chat analysis flow so it now compares candidate recommendations against the current AI instruction and skill files in the analyzed workspaces. Reports are now intended to list only gaps or concrete improvements that are not already covered by the existing AI guidance baseline.
Pages touched: CHAT_ANALYSIS_PLAN.md, README.md, CHANGELOG.md, chat-participant.md, file-manifest.md, log.md

## [2026-06-06] query | Codex Session Saving Feasibility
Answered whether Session Control can save Codex sessions like Copilot sessions. Reviewed the save-system, resume-system, chat-participant, architecture pages, README, current source reader/writer behavior, and official Codex manual notes about local transcripts, resume, and app-server thread APIs.
Pages touched: log.md

## [2026-06-06] update | Codex Provider Support
Implemented opt-in Codex provider support alongside the existing Copilot save flow. Added provider metadata to saved sessions, a provider picker and default provider setting, local Codex transcript import, and a command that imports repository Copilot guidance into repo-scoped Codex skills under `.agents/skills/`.
Pages touched: log.md

## [2026-06-06] update | Cursor JSONL Provider Support
Implemented opt-in Cursor provider support for workspace `chatSessions` JSONL import. Added a separate `cursor` provider, Cursor user data path resolution via `workspace.json`, shared snapshot-patch parsing with the existing Copilot reader, and focused unit coverage for workspace matching and import behavior.
Pages touched: log.md

## [2026-06-07] update | Cursor Auto-save Documentation
Updated the user-facing docs to describe Cursor Agent transcript import, legacy `chatSessions` fallback, and provider-aware auto-save behavior. Synced the marketplace-facing extension description with the current Copilot, Cursor, and Codex support surface.
Pages touched: README.md, CHANGELOG.md, package.json, log.md

## [2026-06-07] update | Cursor Provider Autodetection
Removed the explicit Cursor provider option from the visible provider picker and settings surface. Session Control now auto-detects Cursor at runtime and uses the Cursor provider there unless the user explicitly overrides the save provider to Copilot or Codex.
Pages touched: README.md, CHANGELOG.md, package.json, log.md

## [2026-06-10] update | Codex Host Auto-save
Extended the existing provider-aware save flow so Session Control now auto-detects Codex when running inside Codex and can auto-save Codex session transcript updates. Codex auto-save watches the local Codex sessions directory, filters sessions to the active workspace using transcript `cwd`, and preserves the existing Copilot and Cursor integrations.
Pages touched: README.md, CHANGELOG.md, package.json, src/types.ts, src/codexSessionReader.ts, src/extension.ts, test/unit/codexSessionReader.test.ts, test/unit/extensionAutoSave.test.ts, test/unit/extensionPhase10.test.ts, log.md

## [2026-06-21] update | Command Title Cleanup
Synced the wiki file manifest with the shorter command titles now used in `package.json`, including the import, analyze, save, and toggle-auto-save entries.
Pages touched: file-manifest.md, log.md

## [2026-07-04] update | Screenshots Live + v1.3.4 Release
Committed the five captured listing assets (demo.gif, save-session.png, resume-session.png, session-explorer.png, provider-picker.png) under media/screenshots/, removed the screenshots:pending comment markers so the README Screenshots section renders on the Open VSX and VS Marketplace listings, bumped to 1.3.4, and signed off the Step 2 rows in the open-vsx-listing approval checklist. Release tag v1.3.4 triggers release.yml to publish the same VSIX to both registries.
Pages touched: README.md, CHANGELOG.md, package.json, media/screenshots/README.md, open-vsx-listing.md, log.md

## [2026-07-30] update | Project Auto-Save Architecture and Operations
Synchronized the wiki with the implemented project auto-save system: source adapters and positive project matching, per-workspace reconciliation and isolated retries, semantic revisions and durable checkpoints, ownership-scoped staged upserts that preserve manual snapshots, provider settings and migration, metadata-only diagnostics, status/Explorer integration, and profile/remote/local-transcript limitations.
Pages touched: save-system.md, configuration.md, file-manifest.md, architecture.md, overview.md, index.md, log.md
