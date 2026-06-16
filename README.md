# Session Control

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Marketplace-v1.2.1-blue)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control)
[![Open VSX](https://img.shields.io/open-vsx/v/darrenjmcleod/session-control)](https://open-vsx.org/extension/darrenjmcleod/session-control)
[![CI](https://github.com/tempuskg/session-control/actions/workflows/ci.yml/badge.svg)](https://github.com/tempuskg/session-control/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A VS Code extension that saves GitHub Copilot, Cursor, and local Codex chat sessions as structured JSON files in your repository, linked to git commits and branches. Resume saved conversations via the `@session-control` chat participant.

## Features

- **Provider choice** - Keep Copilot as the default save source, switch to Codex for local transcript import, and let Session Control auto-detect Cursor or Codex when running inside those hosts.
- **Import Codex skills** - Convert repository Copilot guidance into repo-scoped Codex skills under `.agents/skills/`.

- **Save sessions** — Capture the active Copilot Chat session as a JSON file in `.chat/`, enriched with branch and commit metadata.
- **Resume sessions** — Use `@session-control /resume <name>` to reload a saved conversation as LLM context in a new chat.
- **Analyze saved chats** — Use `@session-control /analyze` to review a timeframe of saved sessions or only chats that have not been analyzed yet.
- **Implement recommendations** — Use `@session-control /implement` to open a generated implementation prompt in chat or an agent session.
- **Browse, preview, delete** — Manage saved sessions via the Session Explorer and command palette.
- **Resume from viewer** — When viewing a saved session, click the ▶ icon in the editor title bar to resume it directly in chat.
- **Auto-save on chat response** — Optionally auto-save Copilot chat responses or Cursor Agent transcript updates after every response.
- **Lives in source control** — Sessions are plain JSON files tracked alongside your code, reviewable in diffs and PRs.
- **Bloat controls** — Configurable file size limits, session splitting, tool output stripping, and automatic pruning of old sessions.

Session Control can save Copilot, Cursor, and Codex sessions. When the save provider setting is unset, it auto-detects Cursor and Codex from the current host app and can auto-save updates from all three supported providers.

## Requirements

- VS Code `^1.93.0`
- GitHub Copilot extension installed and signed in if you want to save Copilot sessions
- Cursor installed locally if you want to import or auto-save Cursor Agent transcript sessions
- Codex installed locally if you want to import or auto-save Codex sessions, or create repo-scoped Codex skills

## Installation

Search for **Session Control** in the VS Code Extensions view, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control).

## Usage

### Save a session

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Session Control: Save Current Chat Session
```

By default this uses the provider configured in `session-control.save.provider` when you set one explicitly. If the setting is unset, Session Control auto-detects Cursor or Codex based on the host app and otherwise defaults to Copilot. The JSON file is written to `.chat/` in your workspace root.

For a one-off provider choice, run:

```
Session Control: Save Session From Provider...
```

Choose **Copilot** to read VS Code chat storage or **Codex** to import local transcripts from `CODEX_HOME` or `~/.codex`. Cursor support is automatic when the extension is running inside Cursor. In that case, Session Control reads Agent transcript JSONL files from `~/.cursor/projects/<project-slug>/agent-transcripts` and falls back to legacy Cursor workspace `chatSessions` JSONL files when possible.

### Auto-save on chat response

Enable:

```json
"session-control.autoSaveOnChatResponse": true
```

Auto-save follows the effective save provider:

- `copilot` watches VS Code chat storage and saves the latest Copilot session after each response.
- `cursor` is selected automatically when the extension is running in Cursor and no explicit provider override is set. It watches Cursor Agent transcript JSONL files under `~/.cursor/projects/<project-slug>/agent-transcripts` and auto-saves the latest Agent chat.
- `codex` is selected automatically when the extension is running in Codex and no explicit provider override is set. It watches local Codex session transcripts under `CODEX_HOME/sessions` or `~/.codex/sessions`, filters them to the current workspace by session `cwd`, and auto-saves the latest matching Codex chat.

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

The participant reviews saved sessions from the configured storage folder, streams a report back into chat, and writes a markdown report under `.chat/analysis/reports/`. It also keeps an analysis index in `.chat/analysis/index.json` so the **Needs Analysis** mode only selects chats that have not been analyzed yet or whose content has changed since the last analysis. The report compares candidate recommendations against the current `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and existing repository-local instruction or skill files before listing recommendations. The report is intended to list only gaps that are not already covered there, unless it is proposing a concrete improvement, consolidation, or removal. When repeated workflows suggest a better reusable setup, the report can also recommend creating new AI skill files such as `SKILL.md`, `*.instructions.md`, `*.prompt.md`, or `*.agent.md`.

After the report is generated, Session Control suggests an **Implement Recommendations** follow-up in chat.

`@session-control /implement` generates a compact implementation prompt that points a coding agent at the saved analysis report file and keeps the next step focused on those AI control files. When the report recommends a new reusable AI skill, the generated prompt tells the next coding-agent step to create that skill file and any supporting instruction assets. It opens a new chat with that prompt prefilled by default, and when a supported agent-session opener is available it can open that surface and copy the prompt to the clipboard.

### Implement the latest saved analysis from the command palette

Run:

```
Session Control: Implement Latest Analysis
```

This command looks across the open workspace folders, finds the newest saved analysis report that still exists on disk, and opens the same lightweight implementation flow used by `@session-control /implement`. If an agent-session opener is available, you can send the generated prompt there; otherwise it opens a new chat with the prompt prefilled. Internally this command is registered as `session-control.implementLatestAnalysis`.

### Import Copilot guidance as Cursor or Codex skills

Run:

```
Session Control: Import Copilot Guidance as Cursor Skills
Session Control: Import Copilot Guidance as Codex Skills
```

This scans repository guidance such as `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.github/prompts/*.prompt.md`, and other repo-local `*.instructions.md`, `*.prompt.md`, `*.agent.md`, or `SKILL.md` files. Use the Cursor command to import each source into `.cursor/skills/<slug>/SKILL.md`, or the Codex command to import into `.agents/skills/<slug>/SKILL.md`, without overwriting existing skills.

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
| `session-control.save.provider` | `copilot` | Explicit provider override for `Session Control: Save Current Chat Session`; when unset, Session Control auto-detects Cursor or Codex based on the host app and otherwise defaults to Copilot |
| `session-control.codex.homePath` | `""` | Optional Codex home directory override; when empty, Session Control uses `CODEX_HOME` or `~/.codex` |
| `session-control.cursor.userDataPath` | `""` | Optional Cursor user data directory for legacy workspace `chatSessions` JSONL fallback; when empty, Session Control uses the default Cursor user data location for this OS |
| `session-control.cursor.projectsPath` | `""` | Optional Cursor projects directory for Agent transcript import; when empty, Session Control uses `~/.cursor/projects` |
| `session-control.autoSaveOnChatResponse` | `false` | Auto-save after each detected provider update when the selected or auto-detected provider is `copilot`, `cursor`, or `codex` |
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
