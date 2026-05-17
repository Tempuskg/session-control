---
title: "Chat Participant"
type: entity
created: 2026-04-12
updated: 2026-05-17
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

The `@session-control` chat participant is the user-facing interface for the Resume System. It's registered via the VS Code Chat Participant API.

## Registration

```typescript
// Defined in package.json
{
  "chatParticipants": [{
    "id": "session-control.resume",
    "name": "session-control",
    "description": "Resume a saved chat session"
  }]
}
```

Registered at activation via `vscode.chat.createChatParticipant()` in `src/chatParticipant.ts`.

**Minimum VS Code version**: `^1.93.0` (chat participant API stabilized).

## Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/resume` | `@session-control /resume <name>` | Load and inject a saved session as context |
| `/list` | `@session-control /list` | Show available saved sessions in chat response |
| `/analyze` | `@session-control /analyze` | Analyze saved sessions from a timeframe or only sessions that have not been analyzed yet |
| `/implement` | `@session-control /implement` | Reuse the latest analysis report as context for implementation follow-up |

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

### `/analyze` Behavior
1. Resolve an analysis scope from the prompt alias (`24h`, `7d`, `30d`, `needs analysis`) or from a QuickPick
2. When the user chooses a date-based scope interactively, ask whether to analyze only unanalyzed chats in that range or all chats in that range
3. Reassemble split session part chains before analysis so each logical conversation is analyzed once
4. Filter sessions either by saved-at timeframe or by fingerprint-based "needs analysis" state from `.chat/analysis/index.json`
5. Batch large transcript sets into multiple model requests, then synthesize one final markdown report
6. Stream the final report back into chat and persist it under `.chat/analysis/reports/`
7. Update each contributing workspace's analysis index so unchanged chats are skipped by future "Needs Analysis" runs
8. Offer an **Implement Recommendations** follow-up suggestion that routes to `/implement`

### `/implement` Behavior
1. Find the most recent analysis result in the current chat thread via result metadata
2. Load the saved markdown report from `.chat/analysis/reports/`
3. Use that report as implementation context for the next model request
4. Keep the analysis report metadata attached so additional implementation follow-ups can continue in the same thread

## Implementation

Handler is registered in `src/chatParticipant.ts`:

```typescript
// Pseudocode
const participant = vscode.chat.createChatParticipant('session-control.resume', handler);

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
  } else if (request.command === 'analyze') {
    // Filter saved sessions, analyze them with the chat model, and persist the report
  } else if (request.command === 'implement') {
    // Load the latest saved analysis report and continue with implementation guidance
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

## Notes

- The participant now serves two roles: resuming prior chat context and analyzing saved chats for recurring workflow problems.
- After `/analyze`, the participant suggests a follow-up that turns the saved report into implementation context.
- Analysis state is stored separately from saved session JSON documents so the saved session schema remains backward compatible.
