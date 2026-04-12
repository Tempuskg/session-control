# Chat Commit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/your-publisher-id.chat-commit?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=your-publisher-id.chat-commit)
[![Open VSX](https://img.shields.io/open-vsx/v/your-publisher-id/chat-commit)](https://open-vsx.org/extension/your-publisher-id/chat-commit)
[![CI](https://github.com/your-username/chat-commit/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/chat-commit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files in your repository, linked to git commits and branches. Resume saved conversations via the `@chat-commit` chat participant.

## Features

- **Save sessions** — Capture the active Copilot Chat session as a JSON file in `.chat/`, enriched with branch and commit metadata.
- **Resume sessions** — Use `@chat-commit /resume <name>` to reload a saved conversation as LLM context in a new chat.
- **Browse & delete** — Manage saved sessions via the command palette.
- **Auto-save on commit** — Optionally save the active session automatically when you make a git commit.
- **Lives in source control** — Sessions are plain JSON files tracked alongside your code, reviewable in diffs and PRs.
- **Bloat controls** — Configurable file size limits, session splitting, tool output stripping, and automatic pruning of old sessions.

## Requirements

- VS Code `^1.93.0`
- GitHub Copilot extension installed and signed in

## Installation

Search for **Chat Commit** in the VS Code Extensions view, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=your-publisher-id.chat-commit).

## Usage

### Save a session

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Chat Commit: Save Current Chat Session
```

Select the session you want to save. The JSON file is written to `.chat/` in your workspace root.

### Resume a session

In VS Code Chat, type:

```
@chat-commit /resume <session-name>
```

The extension does a fuzzy search on the session name. If multiple sessions match, you'll be presented with options to choose from. The saved conversation is injected as context into the current chat.

### List sessions

```
@chat-commit /list
```

or via the Command Palette:

```
Chat Commit: Browse Saved Sessions
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `chat-commit.storagePath` | `.chat` | Folder (relative to workspace root) where sessions are saved |
| `chat-commit.autoSaveOnCommit` | `false` | Auto-save active session on git commit |
| `chat-commit.includeInGitignore` | `false` | Add storage folder to `.gitignore` |
| `chat-commit.resume.maxTurns` | `50` | Max turns injected when resuming |
| `chat-commit.resume.overflowStrategy` | `summarize` | `summarize`, `truncate`, or `recent-only` |
| `chat-commit.resume.maxContextChars` | `80000` | Hard cap on characters injected as context |
| `chat-commit.save.maxFileSize` | `1mb` | Max size per session file (e.g. `500kb`, `1mb`) |
| `chat-commit.save.overflowStrategy` | `split` | `split`, `truncateOldest`, or `warn` |
| `chat-commit.save.stripToolOutput` | `false` | Strip verbose tool call outputs to reduce size |
| `chat-commit.save.maxSavedSessions` | `0` | Max sessions to keep (0 = unlimited) |
| `chat-commit.save.pruneAction` | `archive` | `archive` or `delete` when pruning old sessions |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, testing instructions, and PR guidelines.

## License

[MIT](LICENSE)
