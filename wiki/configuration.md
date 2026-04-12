---
title: "Configuration"
type: concept
created: 2026-04-12
updated: 2026-04-12
sources:
  - raw/plan.md
tags:
  - configuration
related:
  - wiki/save-system.md
  - wiki/resume-system.md
  - wiki/overview.md
---

# Configuration

All user-facing settings under the `session-control` namespace, accessed via `vscode.workspace.getConfiguration('session-control')`.

## General Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `storagePath` | `string` | `.chat` | Folder relative to workspace root for saved sessions |
| `autoSaveOnCommit` | `boolean` | `false` | Auto-save active session when a git commit is detected |
| `includeInGitignore` | `boolean` | `false` | Add `.chat/` to `.gitignore` (default: tracked in git) |

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
| `save.maxSavedSessions` | `number` | `0` | Max files in `.chat/` (0 = unlimited) |
| `save.pruneAction` | `enum` | `archive` | When maxSavedSessions exceeded: `archive` (to `.chat/.archive/`), `delete` |

## Validation Rules

- `storagePath` must be a relative path within the workspace
- `resume.maxTurns` must be a positive integer
- `resume.maxContextChars` must be a positive integer
- `save.maxFileSize` accepts human-readable sizes: `500kb`, `1mb`, `2mb`
- `save.maxSavedSessions` of `0` means unlimited

## Multi-Root Workspace Behavior

In multi-root workspaces, sessions are saved to the `.chat/` folder of the workspace folder containing the active file. Settings can be overridden per workspace folder.
