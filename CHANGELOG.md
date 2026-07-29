# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New per-session **Analyze This Session** inline action in the Saved Sessions view. It runs the existing saved-chat analysis pipeline (provider picker, progress notification, report + analysis-index writing, or agent handoff when no host chat model is available) scoped to exactly the clicked session, using a new `singleSession` analysis selection mode. After a successful run the view refreshes so the session's `analyzed` badge and tooltip update immediately.
- The Saved Sessions view now shows per-session status badges in the item description: `analyzed` for sessions already included in a chat-analysis report (from the workspace's `analysis/index.json`) and `harvested` for sessions already harvested into a knowledge bundle by Session Control Pro (from the workspace's `harvest/index.json`). The badges compose (`analyzed · harvested`), and each state also gets a glanceable icon — plain comment for untouched sessions, a green graph when analyzed, an orange book when harvested, and a purple library when both. The tooltip shows the analysis and harvest dates, status is resolved per workspace folder, and the view falls back to the plain rendering when an index is missing or unreadable.
- Saved-session rows now prefix their existing turn-count and status metadata with the saved date and time in the user's local time zone, consistently formatted as `YYYY-MM-DD HH:mm`.

### Changed
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
