---
title: "Chat Participant"
type: entity
created: 2026-04-12
updated: 2026-04-12
sources:
  - raw/plan.md
tags:
  - chat-participant
  - vscode-api
  - phase-3
related:
  - wiki/resume-system.md
  - wiki/architecture.md
---

# Chat Participant

The `@chat-commit` chat participant is the user-facing interface for the Resume System. It's registered via the VS Code Chat Participant API.

## Registration

```typescript
// Defined in package.json
{
  "chatParticipants": [{
    "id": "chat-commit.resume",
    "name": "chat-commit",
    "description": "Resume a saved chat session"
  }]
}
```

Registered at activation via `vscode.chat.createChatParticipant()` in `src/chatParticipant.ts`.

**Minimum VS Code version**: `^1.93.0` (chat participant API stabilized).

## Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/resume` | `@chat-commit /resume <name>` | Load and inject a saved session as context |
| `/list` | `@chat-commit /list` | Show available saved sessions in chat response |

### `/resume` Behavior
1. Fuzzy match `<name>` against session titles and filenames in `.chat/`
2. If single match → load and inject
3. If multiple matches → present clickable options in chat
4. If no argument → open QuickPick of all sessions
5. Stream a context summary showing what was loaded (turn count, any truncation notices)

### `/list` Behavior
- Displays all saved sessions as a formatted list in the chat response
- Shows: title, date, branch, commit SHA, turn count
- Each entry is clickable to resume that session

## Implementation

Handler is registered in `src/chatParticipant.ts`:

```typescript
// Pseudocode
const participant = vscode.chat.createChatParticipant('chat-commit.resume', handler);

async function handler(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  if (request.command === 'resume') {
    // Find, load, and inject session
  } else if (request.command === 'list') {
    // List all saved sessions
  }
}
```

## Context Injection Mechanism

The chat participant injects saved session turns as a formatted context block:

```
The following is a previous conversation that the user wants to continue:

[Turn 1 - User]: ...
[Turn 1 - Copilot]: ...
[Turn 2 - User]: ...
...
```

On follow-up turns, this context is re-injected via `context.history` and the context budget is re-evaluated. See [Resume System](resume-system.md) for details on overflow strategies.

## Menu Integration

- "Save Chat Session" added to the `chat/context` menu (if available) or command palette
- Future: Tree View sidebar panel (`chat-commit.sessionExplorer`) for browsing sessions (Phase 4 stretch goal)
