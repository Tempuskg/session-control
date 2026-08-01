---
title: "Configuration"
type: concept
created: 2026-04-12
updated: 2026-07-30
sources:
  - raw/plan.md
tags:
  - configuration
related:
  - wiki/save-system.md
  - wiki/file-manifest.md
  - wiki/resume-system.md
  - wiki/overview.md
---

# Configuration

All user-facing settings under the `session-control` namespace, accessed via `vscode.workspace.getConfiguration('session-control')`.

## General Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `storagePath` | `string` | `.chat` | Folder relative to workspace root for saved sessions |
| `save.provider` | `enum` | `copilot` | Provider preference for manual flows that do not prompt. It does not select auto-save sources. |
| `copilot.homePath` | `string` | `""` | GitHub Copilot CLI home override; falls back to `COPILOT_HOME`, then `~/.copilot` |
| `codex.homePath` | `string` | `""` | Codex home override; falls back to `CODEX_HOME`, then `~/.codex` |
| `claudeCode.homePath` | `string` | `""` | Claude Code home override; falls back to `CLAUDE_CONFIG_DIR`, then `~/.claude` |
| `cursor.projectsPath` | `string` | `""` | Cursor CLI / Agent projects root; falls back to `~/.cursor/projects` |
| `cursor.userDataPath` | `string` | `""` | Cursor user-data root for legacy manual `workspaceStorage/chatSessions` import |
| `autoSaveOnChatResponse` | `boolean` | `false` | Enable project-scoped auto-save for this workspace folder |
| `autoSave.providers` | `array` | `["copilot", "codex", "claude-code", "cursor"]` | Provider groups monitored concurrently; `copilot` includes VS Code Copilot Chat and Copilot CLI |
| `includeInGitignore` | `boolean` | `false` | Add `.chat/` to `.gitignore`. **Recommended for public repos** — see [Privacy Warning](#privacy-warning) below. |

## Auto-Save Selection and Migration

`autoSave.providers` is the sole runtime source-selection setting for auto-save. Unknown values and duplicates are removed; an explicitly empty array monitors no providers. Provider/source mapping and source-specific limitations are documented in the [Save System](save-system.md#source-readers-and-adapters).

At activation, a one-time scope-preserving migration handles old installations where an explicit `save.provider` also represented auto-save intent:

- Migration runs only for a workspace folder that is already auto-save enabled.
- An explicit `autoSave.providers` value at the applicable scope remains authoritative.
- Otherwise, the effective explicit legacy provider is copied as a one-element provider array at the same global, workspace, or workspace-folder scope.
- A durable migration marker prevents repeated writes.
- Migration never enables auto-save globally or for a disabled folder.

Changing the enable switch, providers, provider home paths, Cursor paths, or storage path recreates only the affected workspace controller and reconciles it immediately.

## Resume Settings (`resume.*`)

Control how saved sessions are injected as LLM context when resuming.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `resume.maxTurns` | `number` | `50` | Max number of turns to inject. Older turns handled per overflow strategy |
| `resume.overflowStrategy` | `enum` | `summarize` | Strategy when exceeding maxTurns: `summarize`, `truncate`, `recent-only` |
| `resume.maxContextChars` | `number` | `80000` | Hard cap on total characters injected. Safety net regardless of turn count |

### Overflow Strategies Explained

- **`summarize`** — LLM summarizes older turns into a preamble; recent turns kept verbatim. Best quality, costs an extra LLM call.
- **`truncate`** — Silently drops oldest turns. Fast, loses early context.
- **`recent-only`** — Loads only last N turns with a note: *"Earlier turns omitted"*. Simplest.

## Save Settings (`save.*`)

Control session file size and storage limits.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `save.maxFileSize` | `string` | `1mb` | Max size per saved session file |
| `save.overflowStrategy` | `enum` | `split` | When exceeded: `split`, `truncateOldest`, `warn` |
| `save.stripToolOutput` | `boolean` | `false` | Strip verbose tool outputs (keep names/summaries) |
| `save.useTimestampInFileName` | `boolean` | `true` | Include a UTC timestamp in saved filenames; title-only mode adds an ID suffix on collision |
| `save.maxSavedSessions` | `number` | `0` | Max files in `.chat/` (0 = unlimited) |
| `save.pruneAction` | `enum` | `archive` | When maxSavedSessions exceeded: `archive` (to `.chat/.archive/`), `delete` |

## Validation Rules

- `storagePath` must be a relative path within the workspace
- `resume.maxTurns` must be a positive integer
- `resume.maxContextChars` must be a positive integer
- `save.maxFileSize` accepts human-readable sizes: `500kb`, `1mb`, `2mb`
- `save.maxSavedSessions` of `0` means unlimited

## Privacy Warning

> **⚠️ Do not commit session files to a public repository without reviewing them first.**
>
> Saved session JSON files record the full conversation with the selected provider, including agent tool call inputs and outputs. These files routinely contain:
> - **Local filesystem paths** (e.g. `C:\Users\yourname\...`) that expose your OS username and machine layout
> - **Workspace-internal details** captured during agentic tool calls (file contents, terminal output, search results)
>
> Auto-save remains off by default. Enabling it through `Session Control: Toggle Auto-Save on Chat Response` displays a sensitivity warning and offers to add the configured in-workspace storage folder to `.gitignore` before enabling. You can also set `session-control.includeInGitignore: true` or add the folder manually.

## Multi-Root Workspace Behavior

Settings are resource-scoped. Each enabled folder in a multi-root workspace receives its own controller and writes only to its configured storage directory after a positive project match. CLI sources can match individual folders by working directory or project directory. The `copilot-vscode` source is deliberately skipped in multi-root windows because VS Code exposes one window-level workspace store and the implementation does not guess ownership from the active editor.

Only files visible to the running extension host can be monitored. The active VS Code profile is the only profile checked for `copilot-vscode`; remote SSH, dev-container, and WSL boundaries can put provider stores on a different host or filesystem. These conditions are reported by `Session Control: Diagnose Auto-Save` rather than triggering a fallback to an unrelated path.
