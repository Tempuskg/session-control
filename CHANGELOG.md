# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added `@session-control /analyze` to review saved chat sessions from a selected timeframe or only chats that have not been analyzed yet, with markdown reports persisted under `.chat/analysis/`.
- Added `@session-control /handoff` to open a generated implementation prompt in chat or an agent session using the latest saved analysis report.
- Added the `Session Control: Handoff Latest Analysis` command so the newest saved analysis report can be handed off from the command palette without relying on chat-thread metadata.

### Changed
- When choosing an interactive date range for `@session-control /analyze`, the participant now asks whether to analyze only unanalyzed chats in that range or re-analyze every chat in that range.
- Analysis results now offer a **Handoff to Agent** follow-up that opens the generated coding-agent handoff prompt.

### Removed
- Removed `@session-control /implement`; saved-chat analysis now transitions only through the handoff flow.

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
