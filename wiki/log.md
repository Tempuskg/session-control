---
title: "Wiki Log"
type: log
created: 2026-04-12
updated: 2026-04-24
---

# Wiki Log

Chronological record of all wiki operations.

---

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
