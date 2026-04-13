---
title: "Architecture"
type: entity
created: 2026-04-12
updated: 2026-04-13
sources:
  - raw/plan.md
tags:
  - architecture
related:
  - wiki/overview.md
  - wiki/save-system.md
  - wiki/resume-system.md
  - wiki/session-format.md
  - wiki/file-manifest.md
---

# Architecture

Session Control is structured around two independent subsystems connected by a shared storage layer.

## System Diagram

```mermaid
graph TB
    subgraph "VS Code"
        CopilotStorage["Copilot Internal Storage<br/>(chatSessions/*.json)"]
        ChatUI["VS Code Chat UI"]
    end

    subgraph "Session Control Extension"
        SaveSystem["Save System<br/>(sessionReader → sessionWriter)"]
        ResumeSystem["Resume System<br/>(@session-control participant)"]
        SessionViewer["Session Viewer<br/>(webview panel)"]
        GitIntegration["Git Integration<br/>(branch, SHA, commit hooks)"]
        SessionStore["Session Store<br/>(CRUD on .chat/)"]
    end

    subgraph "Repository"
        ChatFolder[".chat/ folder<br/>(JSON session files)"]
        GitRepo["Git History"]
    end

    CopilotStorage -->|read| SaveSystem
    GitIntegration -->|metadata| SaveSystem
    SaveSystem -->|write| SessionStore
    SessionStore -->|read/write| ChatFolder
    ChatFolder -->|tracked in| GitRepo
    ResumeSystem -->|read| SessionStore
    SessionViewer -->|read| SessionStore
    ChatUI <-->|interact| ResumeSystem
```

## Subsystems

### Save System
Reads Copilot's internal session storage files, transforms them into the [Session Format](session-format.md), enriches with git metadata via [Git Integration](git-integration.md), and writes to `.chat/`. Applies bloat controls (size limits, splitting, stripping) before writing. See [Save System](save-system.md).

### Resume System
A registered VS Code chat participant (`@session-control`) that reads saved sessions from `.chat/`, applies context limits (max turns, max chars), and injects prior conversation as LLM context. See [Resume System](resume-system.md) and [Chat Participant](chat-participant.md).

### Session Store
CRUD layer for saved session files in `.chat/`. Handles file naming, searching, fuzzy matching, archival, and deletion. Used by both Save and Resume systems.

### Session Viewer
An HTML webview panel (`SessionViewerPanel`) that renders saved sessions as a formatted conversation view. Accessible from the Session Explorer sidebar (click a session) or from the editor title bar when a recognized session JSON file is open. Uses `buildPageHtml()` to generate a self-contained HTML page with CSP nonce, markdown rendering via `marked`, and XSS-safe escaping. See `src/sessionViewer.ts`.

### Git Integration
Wraps the VS Code Git extension API. Provides branch name, commit SHA, dirty state. Optionally listens for commit events to trigger auto-save. See [Git Integration](git-integration.md).

## Data Flow

### Save Flow
1. User triggers "Save Current Chat Session" command
2. `sessionReader` accesses Copilot internal storage at `workspaceStorage/{workspaceId}/chatSessions/`
3. User selects which session to save via QuickPick
4. `sessionWriter` transforms to [Session Format](session-format.md), applies bloat controls
5. `sessionStore` writes JSON file to `.chat/` with git metadata from `gitIntegration`

### View Flow
1. User opens a session JSON file in the editor (or clicks a session in Session Explorer)
2. Extension sets context key `session-control.isSessionFile` when the active file is a valid session
3. Editor title bar shows a preview icon button
4. User clicks the button (or runs `Session Control: View Session` from the command palette)
5. `extension.ts` parses the document, validates with `isChatSession()`, and calls `SessionViewerPanel.createOrShow()`
6. Webview panel renders the full conversation with metadata, summary, turns, tool calls, and git info

### Resume Flow
1. User types `@session-control /resume fix-auth-bug` in chat
2. `chatParticipant` handler receives the request
3. `sessionStore` searches `.chat/` for matching session (fuzzy match)
4. Session JSON loaded, reassembled if split across parts
5. Context limits applied per [Configuration](configuration.md) (maxTurns, maxContextChars, overflowStrategy)
6. Prior turns injected as context; summary streamed to user

## Storage Format

Sessions are stored as JSON files in `.chat/`:  
`{timestamp}-{slugified-title}.json`  
e.g., `2026-04-12T14-30-fix-auth-bug.json`

Split sessions append `-part1`, `-part2`, etc. with linking metadata.

See [Session Format](session-format.md) for the full schema.

## Technology Constraints

- **VS Code `^1.93.0`** — Required for stable chat participant API
- **TypeScript** — Extension language
- **Webpack** — Bundling
- **VS Code Git Extension API** — For git metadata (not shelling out to git CLI)
