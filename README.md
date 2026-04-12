# Session Control

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/darrenjmcleod.session-control?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control)
[![Open VSX](https://img.shields.io/open-vsx/v/darrenjmcleod/session-control)](https://open-vsx.org/extension/darrenjmcleod/session-control)
[![CI](https://github.com/darrenjmcleod/session-control/actions/workflows/ci.yml/badge.svg)](https://github.com/darrenjmcleod/session-control/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files in your repository, linked to git commits and branches. Resume saved conversations via the `@session-control` chat participant.

## Features

- **Save sessions** — Capture the active Copilot Chat session as a JSON file in `.chat/`, enriched with branch and commit metadata.
- **Resume sessions** — Use `@session-control /resume <name>` to reload a saved conversation as LLM context in a new chat.
- **Browse & delete** — Manage saved sessions via the command palette.
- **Auto-save on commit** — Optionally save the active session automatically when you make a git commit.
- **Lives in source control** — Sessions are plain JSON files tracked alongside your code, reviewable in diffs and PRs.
- **Bloat controls** — Configurable file size limits, session splitting, tool output stripping, and automatic pruning of old sessions.

## Requirements

- VS Code `^1.93.0`
- GitHub Copilot extension installed and signed in

## Installation

Search for **Session Control** in the VS Code Extensions view, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control).

## Usage

### Save a session

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Session Control: Save Current Chat Session
```

Select the session you want to save. The JSON file is written to `.chat/` in your workspace root.

### Resume a session

In VS Code Chat, type:

```
@session-control /resume <session-name>
```

The extension does a fuzzy search on the session name. If multiple sessions match, you'll be presented with options to choose from. The saved conversation is injected as context into the current chat.

### List sessions

```
@session-control /list
```

or via the Command Palette:

```
Session Control: Browse Saved Sessions
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `session-control.storagePath` | `.chat` | Folder (relative to workspace root) where sessions are saved |
| `session-control.autoSaveOnCommit` | `false` | Auto-save active session on git commit |
| `session-control.includeInGitignore` | `false` | Add storage folder to `.gitignore` |
| `session-control.resume.maxTurns` | `50` | Max turns injected when resuming |
| `session-control.resume.overflowStrategy` | `summarize` | `summarize`, `truncate`, or `recent-only` |
| `session-control.resume.maxContextChars` | `80000` | Hard cap on characters injected as context |
| `session-control.save.maxFileSize` | `1mb` | Max size per session file (e.g. `500kb`, `1mb`) |
| `session-control.save.overflowStrategy` | `split` | `split`, `truncateOldest`, or `warn` |
| `session-control.save.stripToolOutput` | `false` | Strip verbose tool call outputs to reduce size |
| `session-control.save.maxSavedSessions` | `0` | Max sessions to keep (0 = unlimited) |
| `session-control.save.pruneAction` | `archive` | `archive` or `delete` when pruning old sessions |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, testing instructions, and PR guidelines.

## License

[MIT](LICENSE)
