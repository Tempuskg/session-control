# Auto-Save Reference

Full reference for Session Control's project-scoped auto-save: the acquisition sources it
reads, how each one decides a chat belongs to your workspace, the boundaries it will not cross,
and how to diagnose a source that is not working.

For the short version, see the [Auto-save project chats](../README.md#auto-save-project-chats)
section of the README.

## Enabling auto-save

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

## Sources

### VS Code Copilot Chat (`copilot-vscode`)

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

### GitHub Copilot CLI (`copilot-cli`)

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

### Cursor CLI (`cursor-cli`, experimental)

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

## Timing and replacement

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

## Profiles and remote workspaces

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

## Diagnose auto-save

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
