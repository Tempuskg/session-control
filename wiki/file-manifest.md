---
title: "File Manifest"
type: entity
created: 2026-04-12
updated: 2026-04-13
sources:
  - raw/plan.md
tags:
  - architecture
  - types
related:
  - wiki/architecture.md
  - wiki/save-system.md
  - wiki/resume-system.md
---

# File Manifest

Planned source files for the session-control extension, their roles, and dependencies.

## Source Files

| File | Role | Dependencies |
|------|------|-------------|
| `package.json` | Extension manifest: commands, settings, chat participant, menus | — |
| `src/extension.ts` | Entry point: registers commands, chat participant, and auto-save listeners (exports `registerAutoSaveOnChatResponseListener`) | All modules |
| `src/sessionReader.ts` | Reads Copilot internal session files; handles format versioning | VS Code internal API |
| `src/sessionWriter.ts` | Transforms raw sessions to [Session Format](session-format.md); writes to disk | `types.ts`, `gitIntegration.ts`, `utils.ts` |
| `src/chatParticipant.ts` | `@session-control` chat participant handler (resume logic) | `sessionStore.ts`, `types.ts` |
| `src/gitIntegration.ts` | Git extension API wrapper: branch, SHA, commit listener | `vscode.git` extension API |
| `src/sessionStore.ts` | CRUD operations on saved session files in `.chat/` | `types.ts`, `utils.ts` |
| `src/types.ts` | TypeScript interfaces: `ChatSession`, `SavedTurn`, etc. | — |
| `src/sessionViewer.ts` | HTML webview panel for viewing saved sessions as formatted conversations | `types.ts`, `marked` |
| `src/sessionExplorer.ts` | Tree data provider for the Session Explorer sidebar view | `sessionStore.ts` |
| `src/utils.ts` | Utilities: slugify, timestamp formatting, fuzzy matching | — |
| `media/session-viewer.css` | Stylesheet for the session viewer webview | — |

### Open Source & CI Files

| File | Role |
|------|------|
| `LICENSE` | MIT license |
| `README.md` | Project overview, installation, usage, configuration, contributing |
| `CONTRIBUTING.md` | Dev setup, testing, PR guidelines |
| `CODE_OF_CONDUCT.md` | Contributor Covenant v2.1 |
| `CHANGELOG.md` | Release history (Keep a Changelog format) |
| `.github/ISSUE_TEMPLATE/` | Bug report and feature request templates |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist |
| `.github/workflows/ci.yml` | CI pipeline: lint, build, test, Snyk scan |
| `.github/workflows/release.yml` | Publish to VS Code Marketplace + Open VSX on tag push |

## Dependency Graph

```mermaid
graph TD
    ext["extension.ts"] --> reader["sessionReader.ts"]
    ext --> writer["sessionWriter.ts"]
    ext --> cp["chatParticipant.ts"]
    ext --> git["gitIntegration.ts"]
    ext --> viewer["sessionViewer.ts"]
    ext --> explorer["sessionExplorer.ts"]
    ext --> store["sessionStore.ts"]

    viewer --> types
    explorer --> store

    writer --> types["types.ts"]
    writer --> git
    writer --> utils["utils.ts"]

    cp --> store
    cp --> types

    store --> types
    store --> utils

    reader --> types
```

## Package.json Contributions

### Commands
- `session-control.saveSession` — "Session Control: Save Current Chat Session"
- `session-control.listSessions` — "Session Control: Browse Saved Sessions"
- `session-control.deleteSession` — "Session Control: Delete Saved Session"
- `session-control.viewSessionFile` — "Session Control: View Session" (editor title preview action)
- `session-control.openSessionFromExplorer` — "Open Saved Session" (Session Explorer inline action)
- `session-control.deleteSessionFromExplorer` — "Delete Saved Session" (Session Explorer inline action)
- `session-control.refreshSessionExplorer` — "Refresh Session Explorer"
- `session-control.toggleAutoSave` — "Toggle Auto-Save" (toggles `autoSaveOnChatResponse`)

### Chat Participant
- **ID**: `session-control.resume`
- **Name**: `session-control`
- **Description**: "Resume a saved chat session"
- **Commands**: `resume`, `list`

### Menus
- "Save Chat Session" in `chat/context` menu or command palette

### Tree View
- `session-control.sessionExplorer` — Sidebar panel listing saved sessions grouped by workspace

### Editor Title Menu
- `session-control.viewSessionFile` — Preview icon shown when the active file is a recognized session (`.json`/`.jsonl`) via context key `session-control.isSessionFile`
