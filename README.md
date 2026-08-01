# Session Control

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Marketplace-v1.3.5-blue)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control)
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
- **Auto-save project chats** — Optionally monitor project-matched VS Code Copilot Chat,
  GitHub Copilot CLI, Cursor, Codex, or Claude Code transcript updates and save settled
  responses to the workspace that owns them.
- **Lives in source control** — Sessions are plain JSON files tracked alongside your code,
  reviewable in diffs and PRs.
- **Bloat controls** — Configurable file size limits, session splitting, tool output
  stripping, and automatic pruning of old sessions.

Session Control can save Copilot, Cursor, Codex, and Claude Code sessions. Manual save flows
prompt for a provider or use `session-control.save.provider` where a prompt is unavailable.
Auto-save has its own `session-control.autoSave.providers` setting and watches all supported
providers by default once it is enabled.

## Requirements

- VS Code `^1.93.0`
- GitHub Copilot extension installed and signed in if you want to save VS Code Copilot Chat
  sessions
- GitHub Copilot CLI installed and signed in if you want to auto-save its local session event
  logs
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

Cursor support is automatic when the extension is running inside Cursor. Session Control keeps
the experimental Cursor CLI project transcripts and legacy Cursor IDE workspace `chatSessions`
input as separate sources; the CLI contract and its verified versions are documented below.

Claude Code transcripts are read from:

```text
~/.claude/projects/<encoded-workspace-path>/<session-id>.jsonl
```

Set `session-control.claudeCode.homePath` if your Claude Code config directory lives somewhere else. Session Control derives `<encoded-workspace-path>` the same way Claude Code does by replacing `:`, `\`, and `/` in the absolute workspace path with `-`; for example, `E:\chat-commit` becomes `E--chat-commit`. Main session files are normalized into the shared saved-session format, while nested `subagents/` transcripts and Claude sidechain records are ignored.

### Auto-save project chats

Auto-save is off by default and is enabled independently for each workspace folder. Use
**Session Control: Toggle Auto-Save on Chat Response**, or add this to the folder's workspace
settings:

```json
{
  "session-control.autoSaveOnChatResponse": true,
  "session-control.autoSave.providers": ["copilot"]
}
```

The example monitors Copilot only. If `session-control.autoSave.providers` is omitted, enabling
auto-save monitors `copilot`, `codex`, `claude-code`, and `cursor`. The manual
`session-control.save.provider` preference does not narrow auto-save.

Each enabled folder gets its own controller and writes to that folder's configured
`session-control.storagePath` (normally `.chat`). A source must positively match that folder;
Session Control does not assign an ambiguous global chat to whichever editor happens to be
active. Selecting `copilot` enables two independent, read-only acquisition sources. Both
produce saved sessions with `provider: "copilot"`; use diagnostics to distinguish their
internal source IDs.

#### VS Code Copilot Chat (`copilot-vscode`)

- **Setup:** Install and sign in to GitHub Copilot, open one local workspace folder in VS
  Code, and enable the `copilot` auto-save provider. There is no Copilot Chat source-path
  setting.
- **Source:** Session Control derives the active profile's
  `workspaceStorage/<workspace-id>/chatSessions` directory from VS Code's
  `ExtensionContext.storageUri` and reads supported `.json` and `.jsonl` snapshots. It does
  not use the Chat Participant API as a general Copilot-history feed.
- **Project match:** The validated VS Code workspace-store identity owns the chat. This is a
  positive match only for a single local file-backed workspace folder.
- **Limits:** VS Code's workspace store belongs to the whole window, so this source is skipped
  in a multi-root workspace instead of guessing a folder. Remote extension hosts and non-file
  workspaces are unsupported for this source, and only the active VS Code profile is checked.
  An unavailable VS Code source does not stop the Copilot CLI source.

#### GitHub Copilot CLI (`copilot-cli`)

- **Setup:** Start or continue Copilot CLI from the project directory and enable the `copilot`
  auto-save provider. The CLI must write a complete local event log visible to the extension
  host.
- **Source:** Session Control reads
  `~/.copilot/session-state/<session-id>/events.jsonl`. Resolution order is
  `session-control.copilot.homePath`, then `COPILOT_HOME`, then `~/.copilot`. The setting and
  environment variable name the Copilot home directory, not its `session-state` child.
- **Project match:** The event log must contain an absolute working directory that overlaps
  the workspace path (the same path, an ancestor, or a descendant). Missing, relative, or
  mismatched working directories are skipped; there is no fallback to the newest global CLI
  session.
- **Limits:** The adapter reads event logs only. It neither reads nor changes
  `session-store.db`, provider hooks, Copilot settings, or retention state. Cloud, background,
  or synced chats without a complete local event log are not captured.

#### Cursor CLI (`cursor-cli`, experimental)

- **Verified builds:** The sanitized real-session fixture records Cursor CLI
  `2026.06.19-653a7fb`; the same location contract was reverified from the
  `2026.07.23-e383d2b` Linux x64 package. These are the only builds claimed by the fixture.
  Session Control does not detect or certify the installed Cursor CLI version.
- **Source:** The verified default location is
  `~/.cursor/projects/<project-slug>/agent-transcripts/<session-id>/<session-id>.jsonl`.
  `session-control.cursor.projectsPath` can replace the `~/.cursor/projects` root, but the
  project, `agent-transcripts`, session-directory, and UUID-named JSONL layout remain the
  expected contract.
- **Project match:** `<project-slug>` is derived from the absolute workspace path, and only
  transcripts below that project directory are considered. A transcript from a second
  project's directory is not used as a fallback.
- **Persistence contract:** The verified transcript is JSONL containing
  Anthropic-style `role` and `message.content` records. Its session UUID names both the
  directory and file. In the continuation fixture,
  `cursor-agent --resume=<session-id>` retains that UUID and appends records to the same file,
  so Session Control treats it as the same logical source session. Native per-turn timestamps
  are not part of the verified records; the adapter derives normalized turn times from file
  modification time.
- **Boundary:** Cursor does not document this on-disk layout as a stable public API. Support is
  therefore experimental and fixture-backed, not a promise for other Cursor CLI builds,
  platforms, record shapes, cloud sessions, or background sessions without a complete local
  transcript. A changed or unreadable contract is skipped and surfaced through source
  diagnostics rather than being reinterpreted as Cursor IDE history.

Cursor IDE compatibility remains a separately identified `cursor-vscode-legacy` source. It
resolves a workspace-specific `workspaceStorage/<workspace-id>/chatSessions` directory and
validates its `workspace.json`; Cursor IDE SQLite history is not read as Cursor CLI history.

File events are debounced for five seconds and read repeatedly until their semantic content
settles. A normally completed local response should be saved within 15 seconds. Session
Control also reconciles when auto-save starts, checks for a newly created source directory
every 30 seconds, and runs a five-minute fallback scan for missed file events. A timestamp-only
touch does not write a new snapshot; a same-turn content change does.

Within one extension-host run, continuing the same source session replaces the file set that
controller previously auto-saved, while manual snapshots remain independent. Current
limitation: that replacement checkpoint is not yet persisted or rebuilt from `.chat`, so
reloading the extension and then continuing a session can create another timestamped snapshot.
Cross-file replacement is also not advertised as atomic.

#### Profiles and remote workspaces

Session Control can read only files visible to the VS Code extension host that is running the
extension. Its home directory, environment variables, path syntax, and active VS Code profile
may belong to a different machine or environment than the editor UI or provider process:

- **VS Code profiles:** `copilot-vscode` derives `workspaceStorage` from
  `ExtensionContext.storageUri` for the active profile only. Default-profile storage and other
  profiles are not scanned. CLI homes are resolved from the extension-host environment and do
  not move merely because the VS Code profile changes.
- **Remote SSH:** A remote extension host sees the remote home and workspace, not provider
  storage on the local UI machine. CLI acquisition can work when the CLI and its complete
  local store are on that same remote host. The `copilot-vscode` workspace-store source is
  explicitly unsupported on remote hosts because its current reader and watcher require local
  file-backed extension storage.
- **Dev containers:** The container home and filesystem are distinct from the host home. A CLI
  store created on the host is unavailable unless it is deliberately exposed to the container
  and configured as the source root; running the provider inside the container keeps its store
  on the extension-host side.
- **WSL:** Windows `%USERPROFILE%` stores and WSL `$HOME` stores are different, and Windows
  drive paths do not identify the same source directory as WSL paths. Session Control does not
  infer or translate a provider store across that boundary.

These mixed-host cases are diagnostic limitations, not path-fallback rules. **Session Control:
Diagnose Auto-Save** reports the extension host, active-profile validation, resolved path,
path existence, and project-match strategy. If the required store is on another machine,
profile, container boundary, or WSL side, the source is reported as unsupported or needing
attention and is skipped; Session Control does not silently substitute another profile's
`workspaceStorage`, another user's home, or a same-looking unrelated provider path.

#### Diagnose auto-save

Run **Session Control: Diagnose Auto-Save** and select the workspace folder when prompted. The
command copies a metadata-only report to the clipboard and writes it to the **Session Control**
output channel. Check the independent source entries, including `copilot-vscode`,
`copilot-cli`, `cursor-cli`, and `cursor-vscode-legacy`, for:

- resolved source path and path existence;
- workspace-match strategy and watcher state;
- VS Code workspace, host, and profile validation;
- last event, scan, candidate count, successful save, skip, retry, or error state.

The copyable report omits prompt and response text, session titles, detailed skip/error text,
and saved filenames. Use **View > Output > Session Control** for the detailed runtime reason
when the report says a source needs attention. The status-bar tooltip summarizes healthy
sources and the latest successful provider and time.

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

After choosing the analysis scope, Session Control asks which available provider should perform the analysis. Direct language-model providers run inside Session Control; installed Codex, Claude Code, or Cursor agent providers open their chat and receive a workspace-aware analysis handoff. The analysis itself includes all eligible saved sessions from every provider in the workspace's `.chat` folder; the provider choice only selects who generates the report.

The participant reviews saved sessions from the configured storage folder, streams a report back into chat, and writes a markdown report under `.chat/analysis/reports/`. It also keeps an analysis index in `.chat/analysis/index.json` so the **Needs Analysis** mode only selects chats that have not been analyzed yet or whose content has changed since the last analysis. The report compares candidate recommendations against the current `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` when present, and existing repository-local instruction or skill files before listing recommendations. The report is intended to list only gaps that are not already covered there, unless it is proposing a concrete improvement, consolidation, or removal. When repeated workflows suggest a better reusable setup, the report can also recommend creating new AI skill files such as `SKILL.md`, `*.instructions.md`, `*.prompt.md`, or `*.agent.md`.

After the report is generated, Session Control suggests an **Implement Recommendations** follow-up in chat.

`@session-control /implement` generates a compact implementation prompt that points a coding agent at the saved analysis report file and keeps the next step focused on those AI control files. When the report recommends a new reusable AI skill, the generated prompt tells the next coding-agent step to create that skill file and any supporting instruction assets. It then uses the same provider selector as analysis: choose an available VS Code language model, Codex, Claude Code, or Cursor. External providers receive the handoff directly; a VS Code language-model choice opens the prompt in VS Code Chat for review and sending.

### Implement the latest saved analysis from the command palette

Run:

```
Session Control: Implement Latest Analysis
```

This command looks across the open workspace folders, finds the newest saved analysis report that still exists on disk, and opens the same provider-selection flow used by `@session-control /implement`. Choose an available VS Code language model, Codex, Claude Code, or Cursor. Internally this command is registered as `session-control.implementLatestAnalysis`.

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
| `session-control.save.provider` | `copilot` | Provider preference for manual flows that do not prompt; this setting does not control auto-save |
| `session-control.copilot.homePath` | `""` | Optional GitHub Copilot CLI home directory override; when empty, Session Control uses `COPILOT_HOME` or `~/.copilot` |
| `session-control.codex.homePath` | `""` | Optional Codex home directory override; when empty, Session Control uses `CODEX_HOME` or `~/.codex` |
| `session-control.claudeCode.homePath` | `""` | Optional Claude Code home directory override; when empty, Session Control uses `CLAUDE_CONFIG_DIR` or `~/.claude` |
| `session-control.cursor.userDataPath` | `""` | Optional Cursor user data directory for legacy workspace `chatSessions` JSONL fallback; when empty, Session Control uses the default Cursor user data location for this OS |
| `session-control.cursor.projectsPath` | `""` | Optional Cursor projects directory for Agent transcript import; when empty, Session Control uses `~/.cursor/projects` |
| `session-control.autoSaveOnChatResponse` | `false` | Enable project-scoped auto-save for this workspace folder after each detected response or transcript update |
| `session-control.autoSave.providers` | `["copilot", "codex", "claude-code", "cursor"]` | Providers monitored while workspace-scoped auto-save is enabled; `copilot` includes both VS Code Copilot Chat and GitHub Copilot CLI sources |
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
