# Session Control

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Marketplace-v1.0.0-blue)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control)
[![Open VSX](https://img.shields.io/open-vsx/v/darrenjmcleod/session-control)](https://open-vsx.org/extension/darrenjmcleod/session-control)
[![CI](https://github.com/tempuskg/session-control/actions/workflows/ci.yml/badge.svg)](https://github.com/tempuskg/session-control/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files in your repository, linked to git commits and branches. Resume saved conversations via the `@session-control` chat participant.

## Features

- **Save sessions** — Capture the active Copilot Chat session as a JSON file in `.chat/`, enriched with branch and commit metadata.
- **Resume sessions** — Use `@session-control /resume <name>` to reload a saved conversation as LLM context in a new chat.
- **Analyze saved chats** — Use `@session-control /analyze` to review a timeframe of saved sessions or only chats that have not been analyzed yet.
- **Implement recommendations** — Use `@session-control /implement` to open a generated implementation prompt in chat or an agent session.
- **Browse, preview, delete** — Manage saved sessions via the Session Explorer and command palette.
- **Resume from viewer** — When viewing a saved session, click the ▶ icon in the editor title bar to resume it directly in chat.
- **Auto-save on chat response** — Optionally save the active session automatically after every Copilot chat response.
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

### Analyze saved chats

In VS Code Chat, type:

```
@session-control /analyze
```

You can either choose a timeframe interactively or use a quick alias such as `24h`, `7d`, `30d`, or `needs analysis`.

When you pick a date-based range interactively, Session Control now asks whether it should analyze only chats in that range that have not been analyzed yet, or re-analyze everything in that range.

The participant reviews saved sessions from the configured storage folder, streams a report back into chat, and writes a markdown report under `.chat/analysis/reports/`. It also keeps an analysis index in `.chat/analysis/index.json` so the **Needs Analysis** mode only selects chats that have not been analyzed yet or whose content has changed since the last analysis. The report's recommendation sections are intentionally limited to AI-specific control files such as `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and similar repository-local instruction files.

After the report is generated, Session Control suggests an **Implement Recommendations** follow-up in chat.

`@session-control /implement` generates a compact implementation prompt that points a coding agent at the saved analysis report file and keeps the next step focused on those AI control files. It opens a new chat with that prompt prefilled by default, and when a supported agent-session opener is available it can open that surface and copy the prompt to the clipboard.

### Implement the latest saved analysis from the command palette

Run:

```
Session Control: Implement Latest Analysis
```

This command looks across the open workspace folders, finds the newest saved analysis report that still exists on disk, and opens the same lightweight implementation flow used by `@session-control /implement`. If an agent-session opener is available, you can send the generated prompt there; otherwise it opens a new chat with the prompt prefilled. Internally this command is registered as `session-control.implementLatestAnalysis`.

### View a saved session in the web viewer

You can open the HTML session viewer in two ways:

1. **From Session Explorer**
	- Open the **Session Control** activity bar view.
	- Under **Saved Sessions**, click a session row (or use the inline open action).

2. **From an open JSON file**
	- Open a saved session file (for example in `.chat/`).
	- Use the **View Session** preview icon in the editor title bar.

The editor title action is shown only when the active file is a valid Session Control session document. If your JSON does not match the Session Control schema, the viewer action is hidden and the command reports that the format is not recognized.

### Resume from the session viewer

When a saved session is open in the web viewer, a ▶ **Resume** icon appears in the editor title bar. Click it to open the chat panel with `@session-control /resume <session-title>` pre-filled. Press **Enter** to load the session as context and continue the conversation.

### Viewer command

You can also run this from the command palette:

```
Session Control: View Session
```

This command opens the web viewer for the active JSON file when it matches Session Control's saved session format.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `session-control.storagePath` | `.chat` | Folder (relative to workspace root) where sessions are saved |
| `session-control.autoSaveOnChatResponse` | `false` | Auto-save active session after every Copilot chat response |
| `session-control.includeInGitignore` | `false` | Add storage folder to `.gitignore` |
| `session-control.resume.maxTurns` | `50` | Max turns injected when resuming |
| `session-control.resume.overflowStrategy` | `summarize` | `summarize`, `truncate`, or `recent-only` |
| `session-control.resume.maxContextChars` | `80000` | Hard cap on characters injected as context |
| `session-control.save.maxFileSize` | `1mb` | Max size per session file (e.g. `500kb`, `1mb`) |
| `session-control.save.overflowStrategy` | `split` | `split`, `truncateOldest`, or `warn` |
| `session-control.save.stripToolOutput` | `false` | Strip verbose tool call outputs to reduce size |
| `session-control.save.maxSavedSessions` | `0` | Max sessions to keep (0 = unlimited) |
| `session-control.save.pruneAction` | `archive` | `archive` or `delete` when pruning old sessions |

## Privacy Warning — Public Repositories

> **⚠️ Do not commit `.chat/` sessions to a public repository without reviewing them first.**
>
> Saved session files are plain JSON that records the full conversation between you and Copilot, including all tool call inputs and outputs. These files routinely contain:
> - **Local filesystem paths** (e.g. `C:\Users\yourname\...`) that expose your OS username and machine layout
> - **Workspace-internal details** captured by agent tool calls (file contents, terminal output, search results)
>
> To keep sessions private, enable the built-in setting:
>
> ```json
> "session-control.includeInGitignore": true
> ```
>
> This automatically adds your storage folder to `.gitignore` so sessions are never staged. Alternatively, add `.chat/` (or your configured `storagePath`) to `.gitignore` manually.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, testing instructions, and PR guidelines.

## Release Checklist

Before cutting a tagged release:

1. Run `npm run lint`.
2. Run `npm test`.
3. Update `CHANGELOG.md` for the release.
4. Bump the extension version in `package.json`.
5. Push a `v*` tag to trigger the automated marketplace and Open VSX publish workflow.

The release workflow also supports manual dispatch from GitHub Actions, but it will only publish after lint, build, and test steps pass.

## License

[MIT](LICENSE)
