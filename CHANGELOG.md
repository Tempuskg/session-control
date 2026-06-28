# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Rewrote the marketplace listing hero in `README.md` to lead with "Save your Cursor, Claude Code, Codex, and GitHub Copilot chat history across git commits" and frame Session Control as a cross-IDE session manager for the Open VSX / Cursor / Windsurf / VSCodium audience, with a new "Why Session Control" section above the feature list.
- Updated `package.json` `description` to "Save your Cursor, Claude Code, Codex, and Copilot chat history across git commits. Cross-IDE session manager that keeps every AI conversation in your repo, locally." and reordered/expanded `keywords` to add `windsurf`, `vscodium`, `chat-history`, `session-manager`, `ai-sessions`, `ai-chat`, `cross-ide`, `agent`, `transcript`, and `history` for Open VSX search ranking.
- Expanded the README installation section to surface the Open VSX install path alongside the VS Marketplace link.

### Added
- Added `wiki/open-vsx-listing.md` with the Phase 2 Step 1 listing audit, keyword plan, rewrite rationale, and human-approval checklist for the Open VSX and VS Marketplace listings.

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
