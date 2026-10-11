# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-10-10

### Added

- **TypeSafe triage for `/analyze`.** When TypeSafe is enabled, `/analyze` first asks TypeSafe to score each candidate session for signs of friction, such as repeated tool failures, and whether an AI control file change could have prevented them. The scores are advisory, and if triage fails the analysis runs as before. For each candidate session, the title, provider, turn count, a summary of its evidence, and the first and last turns (each clipped to 1,200 characters, with tool names) are sent to the TypeSafe AI provider. Turn it off with the `triage` entry in `session-control.typesafe.features`.
- **Save and analyze from the Saved Sessions title bar.** Save a session from a provider and Analyze Saved Chats are now one click away in the Session Explorer.

### Changed

- **Clearer listing and privacy wording.** The extension description now says the core is free and names the paid Pro add-on. The README no longer says chats are never uploaded: it now says content leaves your machine only when you run a feature that sends it to an AI provider you choose, or push to a Git repository you own. The Pro privacy notes now cover TypeSafe search reranking and where Git sync pushes.

### Fixed

- **`/analyze` fits the selected model's input limit.** Each analysis prompt is checked against the model's input limit before sending, and Session Control steps down to condensed evidence or smaller batches instead of failing and retrying. An empty model response now fails with a message naming the model, and Copilot CLI agent models, which return empty responses to direct requests, are no longer offered in the model picker.
- **Pro menu entries appear only once Pro has loaded.** Pro commands no longer show in Saved Sessions menus before the bundled Pro features finish loading, or when they cannot load.

## [1.6.0] - 2026-10-03

### Added

- **`@session-control` understands requests without a slash command.** Type something like "analyze last week's chats" or "pick up the auth refactor session", and Session Control works out whether you meant `/analyze`, `/resume`, `/list`, or `/implement`. When it is confident it runs that command and shows how it read your request; when it is less sure it offers the command as a one-click suggestion; otherwise chat behaves as before. This uses TypeSafe, so it only runs when TypeSafe is enabled and you have agreed to its first-use notice, and it can be turned off with `session-control.typesafe.features.routing`. Your prompt and the titles, providers, and saved dates of up to 20 candidate saved sessions are sent to the TypeSafe AI provider to make the decision.

### Fixed

- **Push Saved Sessions to Git** and **Pull Saved Sessions from Git** (Pro) no longer report that a sync is "already running" while the previous run's notification is still in the notification center, and **Retry** and **Pull Now** on those notifications now start the next run.
- **Export Session to AI Control File...** (Pro) no longer offers agent handoffs as the model destination, since the export needs the generated file back to show you before writing. Choose a VS Code language model or an installed Claude Code or Codex CLI.

### Changed

- The privacy prompts before an export and before Knowledge Harvesting (Pro) are shorter and say who receives the content, how much is sent, and what will be written.
- Requires Session Control Pro 0.7.1 or later for the Pro fixes above.

## [1.5.0] - 2026-09-30

### Added

- **Export Session to AI Control File...** (Pro) is now available from the right-click menu on a saved session. It turns one session into a Cursor rule, Claude Code skill, Copilot `*.instructions.md` file, or `AGENTS.md` section, and shows you the result before anything is written.
- **Sync AI Skills Across Assistants** (Pro) is now in the Command Palette. It keeps the same repository guidance matching across the Copilot, Cursor, Claude Code, and Codex copies, in both directions, and asks before overwriting.
- **Push Saved Sessions to Git** and **Pull Saved Sessions from Git** (Pro), in the Saved Sessions title-bar menu, sync saved sessions with a private Git repository you own. Configure `session-control-pro.gitSync.remoteUrl` in your user settings. Multi-part sessions move as a whole, sessions changed on two machines are shown to you to resolve, Push never force-pushes, and Git uses your own credentials.

### Changed

- Requires Session Control Pro 0.7.0 or later for the Pro features above.

## [1.4.1] - 2026-09-27

### Fixed

- Saved Session search now shows prompt and reply matches even when the session title does not contain the query.

## [1.4.0] - 2026-09-27

### Added

- Optional TypeSafe System One (Jev) integration for chat intent routing, analysis triage, resume context selection, report verification, and saved-session knowledge and skill indicators. The integration is opt-in and supports per-feature settings.
- A one-time Session Control Pro upgrade notice that highlights finding past solutions across workspaces and turning them into reusable knowledge, with reassurance that free features stay free. It appears at most once per installation, no earlier than 24 hours after the extension first activates, and only for users without an active Pro license. Dismissing it, ignoring it, or acting on it all retire it permanently — it is never shown a second time, and licensed users never see it at all. The notice offers **Get Pro** and **Enter License Key** and nothing else.

## [1.3.14] - 2026-09-17

### Added

- New **Continue This Session In...** command in the session viewer title bar continues any saved session in any installed assistant — Copilot, Codex, Cursor, or Claude Code — independent of where the session was captured. The picker only lists providers whose chat command is actually registered in the current host, and delivery reuses the existing resume path (query prefill when supported, otherwise open, copy, focus, paste). When the target differs from the session's origin, the generated prompt tells the receiving assistant which assistant produced the transcript. `resume.maxTurns`, `resume.maxContextChars`, `resume.overflowStrategy`, and `resume.providerCommands` all apply, and an unresolvable target still falls back to the VS Code chat resume flow. **Resume This Session in Chat** is unchanged and still follows `session-control.resume.target`.

## [1.3.13] - 2026-09-17

### Changed

- Marketplace listing metadata is now fork-first. The extension description leads with Cursor, Claude Code, Codex, and Copilot chat history and names Cursor, Windsurf, and VSCodium alongside VS Code; `keywords` are reordered and retargeted around how the listing is actually searched (`cursor`, `claude-code`, `codex`, `windsurf`, `chat-history`, `session-manager`) instead of generic terms like `chat`, `git`, and `history`; and `categories` moved from `Other` to `AI` and `Chat` beside `SCM Providers`. No behavior change — listing and search metadata only.

## [1.3.12] - 2026-09-09

### Added

- The **Saved Sessions** view title bar now has a search button for **Search Saved Sessions (All Workspaces)**, so Pro global session search is reachable from the sidebar instead of the Command Palette alone. The Pro gate is unchanged: without an active license the button shows the upgrade prompt.

## [1.3.11] - 2026-08-28

### Added

- Session Control Pro now contributes **Import and Harvest Word Document...**, which imports an unchanged DOCX into workspace-local Session Control storage and opens the existing reviewed knowledge-harvest workflow for that document.

## [1.3.10] - 2026-08-18

### Fixed
- Codex auto-save no longer reads every workspace's transcripts into memory. `~/.codex/sessions` is a machine-wide store, so a scan previously loaded unrelated workspaces' history in full before discarding it. Auto-save now identifies the owning workspace from the `session_meta` record at the head of each transcript and skips non-matching files without reading their bodies. A transcript whose owner cannot be determined still falls back to a full read, so unusually shaped sessions are never silently dropped.

## [1.3.9] - 2026-08-08

### Added
- New **Get Session Control Pro** command opens the Session Control Pro purchase page. It is hidden from the Command Palette once a license validates, via the new `session-control.hasProLicense` context key.
- Session Control Pro now exposes **Search Saved Sessions (All Workspaces)** for local full-text search across saved-session stores, with provider, branch, workspace, and date filters.
- README now documents the Session Control Pro tier, its commands, and where to buy.

### Fixed
- The in-editor Pro upgrade prompt now opens the sessioncontrol.dev Pro section, which carries the checkout links, instead of the public source repository. Its action button reads **Get Pro**.
- Production Pro license activation now defaults to the Session Control Polar organization in both the extension manifest and runtime fallback, so paid keys validate without manual organization setup while sandbox overrides remain supported.

## [1.3.7] - 2026-08-03

### Changed
- Updated the bundled Session Control Pro companion capability to version 0.2.1.

## [1.3.6] - 2026-08-01

### Added
- Workspace-scoped auto-save now watches all selected, positively matched local sources concurrently: VS Code Copilot Chat, GitHub Copilot CLI, Codex CLI, Claude Code, and the verified Cursor CLI project transcript layout. Cursor IDE SQLite and cloud history are not read; VS Code Copilot workspace-store capture rejects remote extension hosts and validates only the active profile's workspace store.
- Auto-save now reconciles on activation or enablement, after source changes, when missing source directories appear, and on a periodic fallback scan. Stable semantic revisions detect same-turn content changes, incomplete provider writes settle and retry with bounded backoff, and a persistent source failure no longer stops unrelated providers or workspaces.
- New **Diagnose Auto-Save** output and a source-health status tooltip report metadata-only paths, match strategies, watcher and scan state, skips, successes, errors, and the most recent successful provider without including prompt or response content.
- New per-session **Analyze This Session** inline action in the Saved Sessions view. It runs the existing saved-chat analysis pipeline (provider picker, progress notification, report + analysis-index writing, or agent handoff when no host chat model is available) scoped to exactly the clicked session, using a new `singleSession` analysis selection mode. After a successful run the view refreshes so the session's `analyzed` badge and tooltip update immediately.
- The Saved Sessions view now shows per-session status badges in the item description: `analyzed` for sessions already included in a chat-analysis report (from the workspace's `analysis/index.json`) and `harvested` for sessions already harvested into a knowledge bundle by Session Control Pro (from the workspace's `harvest/index.json`). The badges compose (`analyzed · harvested`), and each state also gets a glanceable icon — plain comment for untouched sessions, a green graph when analyzed, an orange book when harvested, and a purple library when both. The tooltip shows the analysis and harvest dates, status is resolved per workspace folder, and the view falls back to the plain rendering when an index is missing or unreadable.
- Saved-session rows now prefix their existing turn-count and status metadata with the saved date and time in the user's local time zone, consistently formatted as `YYYY-MM-DD HH:mm`.
- The Saved Sessions toolbar now includes **Sort Saved Sessions...**, with newest/oldest saved-date and A–Z/Z–A session-name orders. The selected order applies within every workspace group and persists for the current workspace.

### Changed
- Auto-saved sessions now carry durable source identity and use an atomic upsert to keep one current single- or multi-part file set per source session across extension reloads. New files are made durable before matching older auto-saves are retired, manual snapshots remain independent, pruning runs only after success, and the Session Explorer refreshes after each completed upsert.
- `session-control.autoSave.providers` now controls auto-save independently of the manual `session-control.save.provider` preference and, for enabled workspaces, defaults to all four provider values without host-based exclusion. GitHub Copilot CLI discovery honors `session-control.copilot.homePath`, then `COPILOT_HOME`, then `~/.copilot`; legacy provider intent is migrated at most once without enabling auto-save.
- Enabling workspace auto-save now requires an explicit privacy confirmation that warns saved prompts, workspace paths, file content, and tool output may be sensitive, then lets the user add the configured session-storage folder to the project's `.gitignore` or keep it trackable. Auto-save remains disabled by default and cancellation leaves it off.
- The Saved Sessions inline analysis action now reads **Reanalyze This Session** for sessions already marked `analyzed`, while unanalyzed sessions retain **Analyze This Session**; both labels run the same single-session analysis flow.
- The saved-chat analysis flow now prompts for the available provider that should generate the report. Direct language-model providers run in-process, while installed Codex, Claude Code, and Cursor agents receive a workspace-aware handoff; all eligible sessions from every provider in the workspace's `.chat` folder remain in scope.
- The `/implement` and `Session Control: Implement Latest Analysis` flows now use the same provider selector, so users choose a VS Code language model, Codex, Claude Code, or Cursor instead of choosing between an ambiguous chat or agent-session destination.

## [1.3.5] - 2026-07-07

### Fixed
- Auto-save no longer leaves orphaned part files behind when a large session is split across multiple files. The replacement flow used to remember and delete only the first part of the previous save, so every later part accumulated on disk with a `previousPartFile` link pointing at a deleted file; it now tracks and cleans up every part file of the previous save.
- Session pruning (`session-control.prune.maxSavedSessions`) now keeps or removes the part files of a split session as one unit instead of applying a per-file cutoff that could delete part 1 while keeping part 2, which broke the part chain.
- `npm test` now really runs the suite: the test harness resolved VS Code to the `code.cmd` CLI wrapper, which detaches and exits 0 immediately, so failures never propagated. The runner now launches the electron `Code.exe` directly.

### Added
- New `Session Control: Clean Up Orphaned Session Part Files` command. It scans every workspace folder's session storage for part files whose linked part no longer exists, and — after a confirmation showing the file and session counts — deletes the ones that are superseded by a newer intact save of the same session. Broken files without a newer intact copy are reported but never removed, since they may hold the only surviving turns.

## [1.3.4] - 2026-07-04

### Fixed
- Resuming a Cursor-originated session into Cursor's agent chat now auto-pastes the resume prompt instead of only copying it to the clipboard: the flow focuses Cursor's composer (`composer.focusComposer`, falling back to `workbench.panel.aichat.view.focus`) and pastes with the same settle/retry handling as Codex and Claude Code. If Cursor's host UI blocks the focus or paste, the prompt is still on the clipboard and the message says to paste (Ctrl+V) to continue.
- Resuming in Cursor now starts a fresh agent chat (`composer.newAgentChat`) instead of pasting the resume prompt into whatever conversation or draft is currently open in the composer, matching the Claude Code flow's new-conversation behavior. Older Cursor builds without that command fall back to `aichat.newchataction`.
- The published VSIX no longer packages development-only files: `.mwnn/` kanban cards, `debug.log` (and other `*.log` files), and the `session-control-pro/` workspace stub are now excluded via `.vscodeignore`.
- The Session Control sidebar now refreshes its session list automatically whenever the view becomes visible (e.g. clicking the Session Control activity bar icon), so sessions saved while the sidebar was closed appear without a manual refresh.
- Fixed saved sessions (e.g. from the Claude Code provider) not appearing in the Session Control sidebar until reload: the save flow awaited its "Saved chat session to ..." notification, and VS Code only resolves that promise when the notification is dismissed, which blocked both post-save pruning and the sidebar refresh. Notifications are now fire-and-forget.
- Session files skipped by the sidebar because they fail to parse or validate are no longer dropped silently; the file name and reason are logged to the "Session Control" output channel.

### Removed
- Removed the `Session Control: Save Current Chat Session` command. Its provider was inferred from the host app (or the `save.provider` override), which could silently save the wrong agent's transcript. Saving is now always an explicit provider choice.

### Changed
- Renamed the `Session Control: Save Session From Provider...` command to `Session Control: Save Session...`. It is now the single manual save entry point: it prompts for the provider and then for the session, so what gets saved is never guessed from the active window.
- The `Session Control: Save Session...` provider picker is host-aware: inside Cursor it offers Cursor (agent transcripts) in place of Copilot — Cursor has no Copilot chat storage to save from — alongside Codex and Claude Code. In VS Code and other hosts it still offers Copilot, Codex, and Claude Code.
- Rewrote the marketplace listing hero in `README.md` to lead with "Save your Cursor, Claude Code, Codex, and GitHub Copilot chat history across git commits" and frame Session Control as a cross-IDE session manager for the Open VSX / Cursor / Windsurf / VSCodium audience, with a new "Why Session Control" section above the feature list.
- Updated `package.json` `description` to "Save your Cursor, Claude Code, Codex, and Copilot chat history across git commits. Cross-IDE session manager that keeps every AI conversation in your repo, locally." and reordered/expanded `keywords` to add `windsurf`, `vscodium`, `chat-history`, `session-manager`, `ai-sessions`, `ai-chat`, `cross-ide`, `agent`, `transcript`, and `history` for Open VSX search ranking.
- Expanded the README installation section to surface the Open VSX install path alongside the VS Marketplace link.

### Added
- Added `wiki/open-vsx-listing.md` with the Phase 2 Step 1 listing audit, keyword plan, rewrite rationale, and human-approval checklist for the Open VSX and VS Marketplace listings.
- Added a `## Screenshots` section to `README.md` above the feature list with five image references (`demo.gif`, `save-session.png`, `resume-session.png`, `session-explorer.png`, `provider-picker.png`) using absolute `raw.githubusercontent.com` URLs so both Open VSX and VS Marketplace resolve the images.
- Added the captured screenshot and demo GIF assets under `media/screenshots/` and removed the `screenshots:pending` comment markers so the `## Screenshots` section renders live on the Open VSX and VS Marketplace listing pages.
- Added `media/screenshots/README.md` capture brief with required filenames, target dimensions, max sizes, OS/UI prep checklist, per-shot scripts, privacy sweep, and the post-capture uncomment-and-release flow. The brief itself is excluded from the published VSIX via `.vscodeignore` so only the PNG/GIF assets ship to users.

## [1.3.2] - 2026-06-21

### Fixed
- Improved Codex origin-agent resume on cold starts by preferring the dedicated Codex sidebar focus command and retrying clipboard paste until the composer is ready.
- Improved Claude Code origin-agent resume on cold starts by starting a fresh conversation when supported and retrying clipboard paste after the sidebar webview finishes mounting.

## [1.3.0] - 2026-06-20

### Added
- Added Claude Code session import support from local JSONL transcripts under `CLAUDE_CONFIG_DIR/projects/<project-slug>` or `~/.claude/projects/<project-slug>`, including manual provider saves, workspace-filtered auto-save, and the `claude-code` provider setting.
- Added `Session Control: Import Copilot Guidance as Claude Code Skills` to convert repository guidance into `.claude/skills/`.

## [1.2.1] - 2026-06-14

### Added
- Added provider-aware Codex auto-save support by watching local Codex session transcripts under `CODEX_HOME/sessions` or `~/.codex/sessions` and saving the latest session that matches the current workspace.

### Changed
- Session Control now auto-detects Codex when running inside the Codex host app, matching the existing host-based Cursor detection and keeping Copilot as the fallback elsewhere.
- Auto-save now follows the effective provider for Copilot, Cursor, and Codex instead of treating Codex as a manual-import-only path.

## [1.2.0] - 2026-06-07

### Added
- Added `@session-control /analyze` to review saved chat sessions from a selected timeframe or only chats that have not been analyzed yet, with markdown reports persisted under `.chat/analysis/`.
- Added `@session-control /implement` to open a generated implementation prompt in chat or an agent session using the latest saved analysis report.
- Added the `Session Control: Implement Latest Analysis` command so the newest saved analysis report can be opened from the command palette without relying on chat-thread metadata.
- Added opt-in Codex session import support alongside the existing Copilot save flow, including the `session-control.save.provider` setting and the `Session Control: Save Session From Provider...` command.
- Added opt-in Cursor session import support for Cursor Agent transcript JSONL files under `~/.cursor/projects`, including the `cursor` provider option plus optional `session-control.cursor.projectsPath` and legacy `chatSessions` fallback settings.
- Added provider-aware auto-save support for Cursor Agent transcript sessions when `session-control.save.provider = cursor`.
- Added `Session Control: Import Copilot Guidance as Cursor Skills` and `Session Control: Import Copilot Guidance as Codex Skills` to convert repository Copilot guidance into repo-scoped skills under `.cursor/skills/` or `.agents/skills/`.

### Changed
- Saved session files can now record their source provider, and resume/save summaries label assistant turns from the underlying provider (for example Copilot, Codex, or Cursor).
- Cursor is now auto-detected when Session Control is running inside Cursor, so Cursor session saving and auto-save no longer require selecting a visible `cursor` provider option.
- When choosing an interactive date range for `@session-control /analyze`, the participant now asks whether to analyze only unanalyzed chats in that range or re-analyze every chat in that range.
- Analysis results now offer an **Implement Recommendations** follow-up that opens the generated coding-agent implementation prompt.
- Analysis prompts and implementation prompts now restrict recommendations and implementation follow-up to AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and similar repository-local instruction files.
- Analysis reports now compare candidate recommendations against the current AI instruction and skill files and only list gaps or concrete improvements that are not already covered there.
- Analysis prompts now identify reusable AI skills that should be created for repeated workflows, and `/implement` prompts can direct the next coding-agent step to create those skill files.
- Renamed the lightweight post-analysis slash command from `@session-control /handoff` to `@session-control /implement`.
- Renamed the command-palette entry from `Session Control: Handoff Latest Analysis` (`session-control.handoffLatestAnalysis`) to `Session Control: Implement Latest Analysis` (`session-control.implementLatestAnalysis`).

## [0.1.24] - 2026-04-25

### Changed
- Session viewer search controls are now collapsible/expandable via a sticky panel header, so the search bar remains accessible while scrolling through long sessions.

## [0.1.23] - 2026-04-25

### Added
- Session viewer preview now includes in-page search across summary and conversation content, with match highlighting, next/previous navigation, and clear/reset controls.

## [0.1.22] - 2026-04-24

### Fixed
- Opening a new project and typing the first prompt before receiving any response no longer triggers the "Unrecognized Copilot session format" error popup. VS Code writes a valid snapshot-patch session file (`kind:0`) with an empty `requests` array the moment a chat is created; this is now recognised as an in-progress session and skipped silently rather than counted as an unknown format.

### Changed
- Added a public-repository privacy warning to the README and clarified that saved chat sessions often contain sensitive local context.
- Removed outdated auto-save-on-commit references from the documentation and wiki to match the current extension behavior.

### Fixed
- Corrected repository metadata and documentation links to point to the published `tempuskg/session-control` repository.

## [0.1.14] - 2026-04-13

### Added
- Initial project scaffolding for the Session Control VS Code extension
- Session web viewer command for active JSON files: `Session Control: View Session`
- Editor title preview action that appears for recognized Session Control session files (`.json` / `.jsonl`)
- Session viewer usage documentation covering Session Explorer and open-file workflows
- Auto-save on chat response: saves the active session automatically after every Copilot chat response (configurable via `session-control.autoSaveOnChatResponse`)
- Resume icon (▶) in the session viewer editor title bar — opens chat with `@session-control /resume <title>` pre-filled

### Fixed
- Unrecognized session format files are now skipped individually instead of aborting the entire session read; auto-save and save flows now proceed correctly when at least one valid session exists alongside unrecognised files
