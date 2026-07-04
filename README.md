# Session Control

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Marketplace-v1.3.4-blue)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control)
[![Open VSX](https://img.shields.io/open-vsx/v/darrenjmcleod/session-control)](https://open-vsx.org/extension/darrenjmcleod/session-control)
[![CI](https://github.com/tempuskg/session-control/actions/workflows/ci.yml/badge.svg)](https://github.com/tempuskg/session-control/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Save your Cursor, Claude Code, Codex, and GitHub Copilot chat history across git commits.**

Session Control is a cross-IDE session manager for AI chats. Every conversation with Cursor
Agent, Claude Code, Codex, or Copilot can be captured as a structured JSON file in your repo,
linked to the branch and commit it belongs to, and resumed later as context in a new chat —
through the `@session-control` chat participant.

Your conversations never leave your machine. They live next to the code they produced, in
source control you already trust. Works inside VS Code, Cursor, VSCodium, and other
VS-Code-compatible editors via the Open VSX Registry.

## Why Session Control

- **Cross-IDE by design.** Save and import chats from Cursor Agent, Claude Code, Codex, and
  GitHub Copilot — the four assistants polyglot AI users actually run.
- **Linked to the commit that produced the code.** Every saved session records the branch and
  SHA, so future you (or a reviewer) can open the chat that explains the diff.
- **Lives in your repo, not in someone else's cloud.** Sessions are plain JSON in
  `.chat/`, reviewable in diffs and PRs. Optional `.gitignore` toggle if you would rather keep
  them local.
- **Resume into a fresh chat.** `@session-control /resume <name>` reloads a saved conversation
  as LLM context. No copy-paste, no lost decisions.

## Screenshots

![Animated demo: save a Copilot chat session, browse it in the Session Explorer, and resume it as context in a new chat.](https://raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/demo.gif)

*Save a chat, browse saved sessions in the Session Explorer, and resume one as context in a new chat — all without leaving your editor.*

| Save any chat | Resume as context |
| :--: | :--: |
| ![Session Control: Save Session running from the Command Palette in VS Code, with a saved JSON file appearing under .chat/ in the explorer.](https://raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/save-session.png) | ![@session-control /resume cursor-debug-loop selected in VS Code Chat, loading a prior Cursor Agent transcript as LLM context for a new conversation.](https://raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/resume-session.png) |
| Capture a Cursor, Claude Code, Codex, or Copilot chat as JSON in `.chat/`, linked to the branch and commit you were on. | Type `@session-control /resume <name>` in chat to reload a saved session as context. Fuzzy match on the title. |

| Session Explorer | Cross-IDE provider picker |
| :--: | :--: |
| ![Session Control activity bar view showing saved sessions grouped by workspace folder, with open, resume, and delete actions on hover.](https://raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/session-explorer.png) | ![Session Control: Save Session quick pick offering Copilot, Cursor, Codex, and Claude Code options.](https://raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/provider-picker.png) |
| Browse every saved session per workspace folder. Open, resume, or delete from the activity bar. | Pick a provider per save — Cursor, Claude Code, Codex, or Copilot. Auto-detects when running inside Cursor, Codex, or Claude Code. |

## Features

- **Provider choice** — Keep Copilot as the default save source, switch to Codex or Claude Code
  for local transcript import, and let Session Control auto-detect Cursor, Codex, or Claude
  Code when running inside those hosts.
- **Import AI skills** — Convert repository Copilot guidance into repo-scoped Cursor, Codex, or
  Claude Code skills under `.cursor/skills/`, `.agents/skills/`, or `.claude/skills/`.
- **Save sessions** — Capture Copilot, Cursor, Codex, or Claude Code chats as JSON files in
  `.chat/`, enriched with branch and commit metadata.
- **Resume sessions** — Use `@session-control /resume <name>` to reload a saved conversation as
  LLM context in a new chat.
- **Analyze saved chats** — Use `@session-control /analyze` to review a timeframe of saved
  sessions or only chats that have not been analyzed yet.
- **Implement recommendations** — Use `@session-control /implement` to open a generated
  implementation prompt in chat or an agent session.
- **Browse, preview, delete** — Manage saved sessions via the Session Explorer and command
  palette.
- **Resume from viewer** — When viewing a saved session, click the Resume icon in the editor
  title bar to resume it directly in chat.
- **Auto-save on chat response** — Optionally auto-save Copilot chat responses, Cursor Agent
  transcript updates, Codex transcript updates, or Claude Code transcript updates after every
  response.
- **Lives in source control** — Sessions are plain JSON files tracked alongside your code,
  reviewable in diffs and PRs.
- **Bloat controls** — Configurable file size limits, session splitting, tool output
  stripping, and automatic pruning of old sessions.

Session Control can save Copilot, Cursor, Codex, and Claude Code sessions. When the save
provider setting is unset, it auto-detects Cursor, Codex, and Claude Code from the current host
app. Outside Cursor, auto-save watches Copilot, Codex, and Claude Code sources by default.

## Requirements

- VS Code `^1.93.0`
- GitHub Copilot extension installed and signed in if you want to save Copilot sessions
- Cursor installed locally if you want to import or auto-save Cursor Agent transcript sessions
- Codex installed locally if you want to import or auto-save Codex sessions, or create repo-scoped Codex skills
- Claude Code installed locally if you want to import or auto-save Claude Code sessions, or create repo-scoped Claude Code skills

## Installation

Search for **Session Control** in your editor's extensions view, or install from:

- [Open VSX Registry](https://open-vsx.org/extension/darrenjmcleod/session-control) — for
  Cursor, Windsurf, VSCodium, Codium, Positron, Trae, and other VS-Code-compatible editors.
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control)
  — for stock Visual Studio Code.

## Usage

### Save a session

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Session Control: Save Session...
```

Session Control prompts for the provider so what gets saved is always your explicit choice rather than a guess from the active window. Choose **Copilot** to read VS Code chat storage, **Codex** to import local transcripts from `CODEX_HOME` or `~/.codex`, or **Claude Code** to import JSONL transcripts from `CLAUDE_CONFIG_DIR` or `~/.claude`. After picking a provider, choose the session to save. The JSON file is written to `.chat/` in your workspace root.

Cursor support is automatic when the extension is running inside Cursor. In that case, Session Control reads Agent transcript JSONL files from `~/.cursor/projects/<project-slug>/agent-transcripts` and falls back to legacy Cursor workspace `chatSessions` JSONL files when possible.

Claude Code transcripts are read from:

```text
~/.claude/projects/<encoded-workspace-path>/<session-id>.jsonl
```

Set `session-control.claudeCode.homePath` if your Claude Code config directory lives somewhere else. Session Control derives `<encoded-workspace-path>` the same way Claude Code does by replacing `:`, `\`, and `/` in the absolute workspace path with `-`; for example, `E:\chat-commit` becomes `E--chat-commit`. Main session files are normalized into the shared saved-session format, while nested `subagents/` transcripts and Claude sidechain records are ignored.

### Auto-save on chat response

Enable:

```json
"session-control.autoSaveOnChatResponse": true
```

Auto-save follows the effective save provider:

- `copilot` watches VS Code chat storage and saves the latest Copilot session after each response.
- `cursor` is selected automatically when the extension is running in Cursor and no explicit provider override is set. It watches Cursor Agent transcript JSONL files under `~/.cursor/projects/<project-slug>/agent-transcripts` and auto-saves the latest Agent chat.
- `codex` is selected automatically when the extension is running in Codex and no explicit provider override is set. It watches local Codex session transcripts under `CODEX_HOME/sessions` or `~/.codex/sessions`, filters them to the current workspace by session `cwd`, and auto-saves the latest matching Codex chat.
- `claude-code` watches local Claude Code transcripts under `CLAUDE_CONFIG_DIR/projects/<project-slug>` or `~/.claude/projects/<project-slug>`, filters them to the current workspace by session `cwd`, and auto-saves the latest matching Claude Code chat.

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

### Import Copilot guidance as Cursor, Codex, or Claude Code skills

Run:

```
Session Control: Import Copilot Guidance as Cursor Skills
Session Control: Import Copilot Guidance as Codex Skills
Session Control: Import Copilot Guidance as Claude Code Skills
```

This scans repository guidance such as `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.github/prompts/*.prompt.md`, and other repo-local `*.instructions.md`, `*.prompt.md`, `*.agent.md`, or `SKILL.md` files. Use the Cursor command to import each source into `.cursor/skills/<slug>/SKILL.md`, the Codex command to import into `.agents/skills/<slug>/SKILL.md`, or the Claude Code command to import into `.claude/skills/<slug>/SKILL.md`, without overwriting existing skills.

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
| `session-control.save.provider` | `copilot` | Explicit provider override for auto-save (`Session Control: Save Session...` always prompts for the provider); when unset, Session Control auto-detects Cursor, Codex, or Claude Code based on the host app and otherwise defaults to Copilot |
| `session-control.codex.homePath` | `""` | Optional Codex home directory override; when empty, Session Control uses `CODEX_HOME` or `~/.codex` |
| `session-control.claudeCode.homePath` | `""` | Optional Claude Code home directory override; when empty, Session Control uses `CLAUDE_CONFIG_DIR` or `~/.claude` |
| `session-control.cursor.userDataPath` | `""` | Optional Cursor user data directory for legacy workspace `chatSessions` JSONL fallback; when empty, Session Control uses the default Cursor user data location for this OS |
| `session-control.cursor.projectsPath` | `""` | Optional Cursor projects directory for Agent transcript import; when empty, Session Control uses `~/.cursor/projects` |
| `session-control.autoSaveOnChatResponse` | `false` | Auto-save after each detected provider update when the selected or auto-detected provider is `copilot`, `cursor`, `codex`, or `claude-code` |
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
> Saved session files are plain JSON that records the full conversation between you and the selected AI provider, including all tool call inputs and outputs. These files routinely contain:
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
