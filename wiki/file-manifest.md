---
title: "File Manifest"
type: entity
created: 2026-04-12
updated: 2026-04-12
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

Planned source files for the chat-commit extension, their roles, and dependencies.

## Source Files

| File | Role | Dependencies |
|------|------|-------------|
| `package.json` | Extension manifest: commands, settings, chat participant, menus | — |
| `src/extension.ts` | Entry point: registers commands and chat participant | All modules |
| `src/sessionReader.ts` | Reads Copilot internal session files; handles format versioning | VS Code internal API |
| `src/sessionWriter.ts` | Transforms raw sessions to [Session Format](session-format.md); writes to disk | `types.ts`, `gitIntegration.ts`, `utils.ts` |
| `src/chatParticipant.ts` | `@chat-commit` chat participant handler (resume logic) | `sessionStore.ts`, `types.ts` |
| `src/gitIntegration.ts` | Git extension API wrapper: branch, SHA, commit listener | `vscode.git` extension API |
| `src/sessionStore.ts` | CRUD operations on saved session files in `.chat/` | `types.ts`, `utils.ts` |
| `src/types.ts` | TypeScript interfaces: `ChatSession`, `SavedTurn`, etc. | — |
| `src/utils.ts` | Utilities: slugify, timestamp formatting, fuzzy matching | — |

## Dependency Graph

```mermaid
graph TD
    ext["extension.ts"] --> reader["sessionReader.ts"]
    ext --> writer["sessionWriter.ts"]
    ext --> cp["chatParticipant.ts"]
    ext --> git["gitIntegration.ts"]
    ext --> store["sessionStore.ts"]

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
- `chat-commit.saveSession` — "Chat Commit: Save Current Chat Session"
- `chat-commit.listSessions` — "Chat Commit: Browse Saved Sessions"
- `chat-commit.deleteSession` — "Chat Commit: Delete Saved Session"

### Chat Participant
- **ID**: `chat-commit.resume`
- **Name**: `chat-commit`
- **Description**: "Resume a saved chat session"
- **Commands**: `resume`, `list`

### Menus
- "Save Chat Session" in `chat/context` menu or command palette

### Tree View (Phase 4 stretch)
- `chat-commit.sessionExplorer` — Sidebar panel listing saved sessions
