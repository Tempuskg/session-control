# Project Chat Auto-Save Plan

## Status

- State: Proposed.
- Created: 2026-07-29.
- Scope: Plan only; implementation source, tests, manifest, and documentation are unchanged.
- Target: Reliable project-scoped auto-save for VS Code Copilot Chat, GitHub Copilot CLI, Codex CLI, Claude Code, and Cursor CLI.
- Reported example: a Copilot chat created while working in `E:\chat-commit` did not appear in `E:\chat-commit\.chat`, even though this workspace currently has `session-control.autoSaveOnChatResponse` enabled.

## Goal

When auto-save is enabled for a project folder, every completed or settled chat update produced for that project by a supported local assistant should be written automatically to the project's configured Session Control storage folder, which defaults to `.chat`.

For `E:\chat-commit`, the expected result is:

1. Start or continue a chat from `E:\chat-commit` with VS Code Copilot Chat, GitHub Copilot CLI, Codex CLI, Claude Code, or Cursor CLI.
2. Finish an assistant response.
3. Within a bounded delay, see one current Session Control snapshot for that logical provider session under `E:\chat-commit\.chat`.
4. Continue the same chat and have that snapshot updated without accumulating duplicate files.
5. Never save a session that belongs to another project merely because its provider uses a global session directory.

## Current State and Confirmed Gaps

The repository already contains most of the parsing and writing foundation:

- `src/sessionReader.ts` reads VS Code workspace `chatSessions` files as Copilot sessions.
- `src/codexSessionReader.ts` reads local Codex session transcripts.
- `src/claudeCodeSessionReader.ts` reads project-scoped Claude Code transcripts.
- `src/cursorSessionReader.ts` and `src/cursorAgentTranscriptReader.ts` read Cursor workspace chats and Agent transcript files.
- `src/sessionWriter.ts` and `src/sessionStore.ts` write normalized sessions to `.chat`.
- `src/extension.ts` registers file watchers and calls the shared save flow.
- `test/unit/extensionAutoSave.test.ts` covers a successful file-event path for the four existing provider IDs.

The current auto-save path does not yet satisfy the requested behavior:

1. **"Copilot" currently means only VS Code workspace chat storage.** There is no reader or watcher for GitHub Copilot CLI's local `session-state/<session-id>/events.jsonl` sessions. If the reported chat was created with Copilot CLI, it cannot be detected by the current implementation.
2. **Default source selection is host-based, not project-wide.** Outside Cursor, the extension watches Copilot, Codex, and Claude Code, but not Cursor. Inside Cursor, it watches only Cursor. An explicit `session-control.save.provider` value narrows auto-save to one provider. This conflicts with the requirement to capture all supported tools used in the project.
3. **Only one implicit workspace folder gets a listener.** `registerAutoSaveOnChatResponseListener` resolves one active or first workspace folder even though the enable setting is resource-scoped and multi-root workspaces may contain several folders.
4. **Detection is event-only.** There is no startup or enable-time reconciliation, no recovery if a source directory is created after watcher registration, and no bounded polling fallback for missed or unsupported external-file events.
5. **The changed file identity is discarded.** A watcher event causes the implementation to read all sessions and save `sessions[0]`, rather than reconciling the source session represented by the changed file.
6. **Turn count is used as the change detector.** A response can keep the same number of turns while its streamed content grows, is regenerated, or gains tool results. The current `prev.turnCount >= latest.turns.length` check can therefore preserve a partial or stale snapshot.
7. **Auto-save identity is only held in memory.** Reloading the extension loses the previous output filenames. Continuing the same provider session can create duplicate timestamped snapshots instead of updating the prior auto-save.
8. **One error disables every watched provider.** The listener has a single `disabled` flag, so a transient parse or path failure in one source stops unrelated sources until reload.
9. **Project matching is not uniformly fail-closed.** Codex and Claude filtering can fall back to all sessions when none has `cwd` metadata. That is acceptable for an interactive import with user confirmation, but it is unsafe for unattended project auto-save.
10. **Cursor CLI is not a verified source contract.** The existing Cursor Agent transcript path may also be used by Cursor CLI, but the CLI documentation does not promise that storage layout. CLI support needs a sanitized real-session fixture and a versioned locator/parser contract rather than an assumption based on the IDE reader.
11. **The current status UI reports only on/off.** It does not show which sources are healthy, which paths are watched, why a source was skipped, or when the last successful save occurred.

## Product Decisions

1. **Auto-save remains explicitly enabled per workspace.** Do not silently flip the current default to on because `.chat` may be tracked by git and can contain sensitive prompts, file contents, paths, and tool output.
2. **Once enabled, all supported local sources are watched by default.** Host application detection must not exclude a CLI that is writing sessions for the same project.
3. **Provider and source are separate concepts.** Keep the saved provider values (`copilot`, `codex`, `claude-code`, and `cursor`) stable, but distinguish acquisition sources internally:
   - `copilot-vscode`
   - `copilot-cli`
   - `codex-cli`
   - `claude-code-cli`
   - `cursor-cli`
   - `cursor-vscode-legacy` for compatibility
4. **Auto-save is project-scoped and fail-closed.** A source session must positively match the workspace through a workspace-specific store, a canonical `cwd`, or a project-specific directory. Ambiguous global sessions are skipped and explained in diagnostics.
5. **Auto-save is an upsert, not a history generator.** One logical provider session has one current auto-saved file set. Manual saves remain independent historical snapshots and are never deleted by auto-save cleanup.
6. **Save only settled content.** Debounce rapid writes and retry partially written JSON/JSONL. A save should represent the completed response rather than an arbitrary streaming delta.
7. **Watchers are accelerators, not the sole correctness mechanism.** Reconciliation at startup, after enabling, after source-path changes, and on a low-frequency fallback interval closes missed-event gaps.
8. **Provider stores are read-only.** Do not modify provider session files, SQLite databases, hooks, settings, indexes, or retention state.
9. **Do not depend on proposed VS Code APIs for the shipping path.** A stable API can replace an internal adapter later, but the extension must continue to work on its declared stable VS Code engine.

## Supported Source Matrix

| Source | Discovery contract | Positive project match | Primary trigger | Required implementation |
| --- | --- | --- | --- | --- |
| VS Code Copilot Chat | Current workspace storage `chatSessions` candidate derived from the extension context, validated before use | Workspace storage identity; single-root direct match; explicit routing rule for multi-root | JSON/JSONL create/change plus reconciliation | Harden the existing Copilot locator, report the resolved path, retain format-version handling, and cover profile/remote limitations |
| GitHub Copilot CLI | `COPILOT_HOME` or `~/.copilot`, then `session-state/<session-id>/events.jsonl` | Canonical working-directory or repository metadata from the event log | Event-log create/change plus reconciliation | Add `src/copilotCliSessionReader.ts`, a configurable home path, sanitized fixtures, and source revision calculation; do not read or mutate `session-store.db` |
| Codex CLI | Configured Codex home, `CODEX_HOME`, or `~/.codex`, then `sessions/**/*.{json,jsonl}` | Canonical session `cwd` overlaps the workspace | Transcript create/change plus reconciliation | Reuse `src/codexSessionReader.ts`, expose a stable source revision, and remove the ambiguous all-sessions fallback from unattended auto-save |
| Claude Code | Configured Claude home, `CLAUDE_CONFIG_DIR`, or `~/.claude`, then the encoded project directory | Encoded project directory and, when present, canonical session `cwd` | Transcript create/change plus reconciliation | Reuse `src/claudeCodeSessionReader.ts`, retain sidechain/subagent exclusions, and expose a stable source revision |
| Cursor CLI | Verified Cursor CLI project/session location; start with the current project transcript candidate only after a real CLI fixture confirms it | Project directory/slug plus any recorded CLI `cwd` | Transcript create/change plus reconciliation | Add a dedicated Cursor CLI locator contract or explicitly share the existing parser only after fixture proof; do not treat Cursor IDE SQLite history as Cursor CLI history |
| Cursor IDE legacy | Cursor workspace storage resolved through `workspace.json` | Exact workspace-folder URI | JSON/JSONL create/change plus reconciliation | Keep as compatibility input, separate from the Cursor CLI acceptance criteria |

## Target Architecture

```text
provider source adapters
  ├─ locate source paths
  ├─ watch create/change events
  ├─ read normalized sessions
  └─ prove project ownership + calculate source revision
                         │
                         ▼
per-workspace auto-save controller
  ├─ startup/event/interval reconciliation
  ├─ settle + retry incomplete writes
  ├─ compare provider/session fingerprints
  ├─ isolate source health and errors
  └─ serialize writes per logical session
                         │
                         ▼
existing session writer and store
  ├─ mark auto-save ownership
  ├─ atomically upsert the current file set
  ├─ preserve manual snapshots
  └─ refresh Session Explorer
                         │
                         ▼
             <workspace>/.chat/
```

### 1. Source Adapter Contract

Create a small provider-independent contract in a new owner module, preferably `src/autoSaveController.ts` with source definitions in `src/autoSaveSources.ts`.

Each source adapter should provide:

- A stable internal source ID.
- One or more watch targets for a specific workspace.
- A read/reconcile method that returns normalized `SourceChatSession` values.
- A positive workspace-match result with a reason when rejected.
- A stable content revision or fingerprint based on source content, not only turn count or generated timestamps.
- Diagnostic state: resolved path, path existence, last scan, last event, last success, and last error.

Do not add transient auto-save fields directly to every provider reader if an envelope can carry them:

```ts
interface AutoSaveCandidate {
	sourceId: AutoSaveSourceId;
	workspaceKey: string;
	session: SourceChatSession;
	revision: string;
	sourcePath: string;
}
```

Use strict optional-property typing: omit optional keys instead of passing `undefined`.

### 2. Per-Workspace Controller

Replace the single implicit-workspace listener with one controller per open workspace folder:

- Create a controller only when that folder has auto-save enabled.
- Register all configured sources for that folder.
- Add and dispose controllers when workspace folders or relevant configuration change.
- Key debounce, in-flight work, health, and checkpoints by `workspace + source + provider session ID`.
- Serialize saves for the same logical session while allowing unrelated providers/workspaces to progress independently.
- Refresh the Session Explorer after a successful upsert.

For ambiguous multi-root VS Code Copilot sessions, define and test one deterministic rule before implementation. Prefer positive source metadata; otherwise skip with a diagnostic instead of assigning the chat to the active editor by guess.

### 3. Reconciliation and Settling

Run reconciliation:

- Immediately when auto-save is enabled or the extension activates.
- After a relevant source file is created or changed.
- After provider home-path settings change.
- When a previously missing source directory appears.
- On a conservative fallback interval while enabled.

Event handling should preserve the changed URI when available. If it maps to a session ID, reconcile that session first. A full provider scan remains the fallback.

Before parsing an actively written transcript:

1. Debounce the provider event burst.
2. Read file metadata/content.
3. Confirm the source revision is stable across two reads, or wait with bounded backoff.
4. Retry recognized incomplete JSON/JSONL failures.
5. Save the latest stable revision.
6. If another event arrived during the save, run one more reconciliation.

The exact delay should be centralized and test-injected. The acceptance target is a completed response saved within 15 seconds under normal local filesystem conditions.

### 4. Fingerprints, Checkpoints, and Upsert Semantics

Replace turn-count comparison with a deterministic hash over normalized semantic content:

- Provider and source ID.
- Provider session ID.
- Title when title changes should update the snapshot.
- Request/response text.
- References.
- Tool call names, arguments, summaries, and retained output.
- Exclude volatile generated timestamps when a reader derives them from file modification time.

Make auto-saved outputs self-identifying so restart behavior is safe. Extend the saved schema backward-compatibly with optional origin metadata or introduce a versioned equivalent:

```ts
interface SessionOrigin {
	saveKind: 'manual' | 'auto';
	sourceId: AutoSaveSourceId;
	sourceSessionId: string;
	sourceRevision: string;
}
```

Implementation rules:

- Auto-save may replace only files whose origin says `saveKind: 'auto'` and whose source/session identity matches.
- Manual snapshots are never part of auto-save replacement.
- A split session is replaced atomically as one file set: write the new parts first, then remove the previous auto-saved parts.
- Persist a lightweight checkpoint in `workspaceState` for fast comparisons, but treat the self-identifying `.chat` files as the recovery source if workspace state is lost.
- Use temporary files plus rename where supported so readers never see a half-written Session Control snapshot.
- Run normal pruning only after the upsert succeeds.

### 5. Configuration and Migration

Keep `session-control.autoSaveOnChatResponse` as the enable switch for compatibility.

Add:

- `session-control.autoSave.providers`: array of `copilot`, `codex`, `claude-code`, and `cursor`; default is all four once auto-save is enabled.
- `session-control.copilot.homePath`: optional GitHub Copilot CLI home override; otherwise use `COPILOT_HOME` or `~/.copilot`.

Clarify existing settings:

- `session-control.save.provider` remains a manual/non-interactive provider preference and must no longer silently limit all project auto-save sources.
- If preserving the old explicit auto-save override is required, perform a one-time migration into `autoSave.providers`; do not maintain two competing sources of truth.
- Existing Codex, Claude Code, Cursor, storage-path, bloat, pruning, and gitignore settings continue to apply.

Do not enable auto-save globally during migration. For first-time users, add a privacy-aware enable action that explains whether `.chat` is tracked and offers to add the configured storage folder to `.gitignore`.

### 6. Diagnostics and UX

Add `Session Control: Diagnose Auto-Save` and make its report copyable. It should contain metadata only, never prompt/response content:

- Workspace folder and configured storage path.
- Enable state and selected providers.
- Each internal source ID.
- Resolved source path and whether it exists/is readable.
- Project-match strategy.
- Watcher state.
- Last event, scan, candidate count, successful save, skip reason, and error.
- Remote/profile limitations.

Improve the status-bar tooltip:

- `On — 5/5 sources healthy`
- `On — 1 source needs attention`
- Last successful save time and provider.

Keep a failure isolated to its source. Warn once for an actionable persistent failure, continue watching other sources, and periodically retry the failed source.

### 7. Provider Format Verification

Before finalizing each adapter:

1. Record the provider and CLI/editor version.
2. Create a disposable test conversation in a temporary project.
3. Identify the files changed by that conversation.
4. Copy only a sanitized minimal transcript into `test/fixtures/`.
5. Verify session ID, working directory, timestamps, user turns, assistant turns, and tool calls.
6. Verify continuation/resume changes the same logical session.
7. Verify a second project is rejected by the first project's auto-save controller.

Special cases:

- Verify whether the reported Copilot miss came from VS Code Copilot Chat or GitHub Copilot CLI. The plan supports both, but they use different adapters.
- Treat Cursor CLI storage as experimental until its current installed version is captured in a fixture. Official Cursor CLI documentation supports listing/resuming sessions but does not document a stable persistence path.
- Keep the current Codex path adapter behind tests because its on-disk format is an implementation detail not established by current public Codex documentation.
- Verify VS Code profiles and remote workspaces separately. If provider storage is on the UI machine while Session Control runs in a remote extension host, report that limitation rather than reading an unrelated remote path.

## Implementation Phases

### Phase 0 — Reproduce and Instrument the Current Copilot Miss

- [ ] Capture the Session Control output-channel lines for the current workspace with auto-save enabled.
- [ ] Determine whether the source was VS Code Copilot Chat or GitHub Copilot CLI.
- [ ] Record the actual source path, source version, last modification time, and workspace identity without copying sensitive content.
- [ ] Add a failing regression test that represents the missed source and trigger.
- [ ] Implement the diagnostic state needed to make subsequent failures observable.

Deliverable: a reproducible failure and an evidence-backed source contract.

### Phase 1 — Extract the Auto-Save Controller

- [ ] Move watcher, debounce, reconciliation, health, and save coordination out of the `src/extension.ts` hotspot.
- [ ] Create one controller per enabled workspace folder.
- [ ] Keep activation/configuration wiring thin in `src/extension.ts`.
- [ ] Make scheduling, hashing, source reads, storage, and notifications dependency-injected for tests.

Deliverable: provider-independent, per-workspace orchestration with no behavior regression.

### Phase 2 — Add and Harden Source Adapters

- [ ] Add GitHub Copilot CLI event-log discovery and normalization.
- [ ] Harden VS Code Copilot workspace-store validation and diagnostics.
- [ ] Adapt Codex and Claude Code readers to emit stable revisions and strict project matches.
- [ ] Verify and implement Cursor CLI discovery separately from Cursor IDE legacy history.
- [ ] Preserve existing manual provider imports.

Deliverable: all requested local chat sources normalize into the shared session model.

### Phase 3 — Reconciliation and Reliable Change Detection

- [ ] Reconcile at activation/enable time.
- [ ] Preserve changed source paths from watcher events.
- [ ] Add missing-directory recovery and a low-frequency fallback scan.
- [ ] Add settle/retry behavior for streaming and atomic provider writes.
- [ ] Replace turn-count dedupe with semantic source revisions.
- [ ] Isolate provider failures and retries.

Deliverable: no lost same-turn updates and recovery from missed watcher events.

### Phase 4 — Durable Auto-Save Upserts

- [ ] Add backward-compatible origin metadata.
- [ ] Implement lookup by source/session identity.
- [ ] Atomically replace the previous auto-saved single or split file set.
- [ ] Persist/rebuild checkpoints across extension reloads.
- [ ] Prove that manual saves are preserved.

Deliverable: one current auto-saved snapshot per logical provider session without restart duplicates.

### Phase 5 — Settings, Diagnostics, and Explorer Refresh

- [ ] Add all-provider auto-save configuration and Copilot CLI home configuration.
- [ ] Migrate legacy provider override semantics.
- [ ] Add the diagnostic command and source-health status tooltip.
- [ ] Refresh Session Explorer after successful saves.
- [ ] Keep privacy and gitignore choices explicit.

Deliverable: users can tell exactly what is watched and why a session was saved or skipped.

### Phase 6 — Documentation and Release Sync

After one targeted validation step is green:

- [ ] Update `README.md` with separate VS Code Copilot and Copilot CLI instructions.
- [ ] Update `CHANGELOG.md` under `[Unreleased]`.
- [ ] Update `PLAN.md` so its old non-Copilot scope boundary and auto-save description no longer contradict the shipping product.
- [ ] Update the relevant wiki pages and append `wiki/log.md`.
- [ ] Document Cursor CLI's verified versions/path contract and remote-workspace limitations.

Deliverable: the documented promise matches the implemented source matrix.

## Test Plan

### Unit Tests

- Source locator tests for defaults, environment overrides, configured overrides, missing paths, Windows drive-letter casing, POSIX paths, and project slugs.
- Sanitized reader fixtures for VS Code Copilot, Copilot CLI, Codex CLI, Claude Code, Cursor CLI, and Cursor legacy sessions.
- Positive and negative project matching for every global store.
- Startup reconciliation saves a new current-project session without requiring a new file event.
- Source directory created after activation becomes discoverable.
- Same turn count with changed response content triggers an update.
- Unchanged semantic content with a touched file does not write.
- A changed source URI selects the corresponding session instead of an unrelated newest session.
- Reload/restart continues the same auto-save without duplicate files.
- Split-session replacement removes every old auto-saved part only after new parts are written.
- Manual saves with the same provider/session ID are retained.
- A parse failure in one provider does not stop any other provider.
- Events arriving during a save cause one trailing reconciliation.
- Multi-root controllers write only to their own configured storage directories.
- Ambiguous or mismatched `cwd` sessions are skipped.
- Controller disposal clears timers, watchers, and retries.
- Diagnostic output contains paths/status but no chat content.

Likely owner tests:

- `test/unit/extensionAutoSave.test.ts`
- New `test/unit/autoSaveController.test.ts`
- New `test/unit/copilotCliSessionReader.test.ts`
- Existing provider reader tests
- `test/unit/sessionStore.test.ts`
- `test/unit/sessionWriter.test.ts`
- `test/unit/types.test.ts`

### Extension-Host and Filesystem Tests

- Verify real `vscode.workspace.createFileSystemWatcher` behavior for external absolute paths.
- Verify watcher recovery when the target directory is absent at activation.
- Verify resource-scoped enablement in a two-folder workspace.
- Verify Session Explorer refresh after an auto-save.
- Verify profile and remote-host diagnostics.

### Manual Smoke Matrix

For each source, open `E:\chat-commit`, enable auto-save, create a uniquely titled chat, wait for completion, and inspect `.chat`:

| Scenario | Expected result |
| --- | --- |
| VS Code Copilot Chat | New/updated `provider: "copilot"` snapshot within 15 seconds |
| GitHub Copilot CLI started in the repo | New/updated Copilot snapshot associated with `E:\chat-commit` |
| Codex CLI started in the repo | New/updated `provider: "codex"` snapshot; another repo's Codex session is ignored |
| Claude Code started in the repo | New/updated `provider: "claude-code"` snapshot; subagent/sidechain files do not create top-level duplicates |
| Cursor CLI started in the repo | New/updated `provider: "cursor"` snapshot from the verified CLI source |
| Continue each session | Existing auto-save is replaced; no duplicate logical snapshot |
| Reload VS Code, then continue | The same auto-save identity is recovered and updated |
| Force one malformed provider file | That source reports an error; the other sources continue saving |
| Use a custom `storagePath` | Files go only to the configured in-workspace directory |

## Validation Order

Run repository validation in this order:

1. Touched-file diagnostics.
2. `npm run compile-tests`
3. `npm run compile`
4. Focused relevant tests through the repository-supported test path.
5. `npm test`
6. `npm run lint`
7. Development Host smoke tests for the full manual source matrix.

Do not use plain `node --test`. Rebuild `dist-test` before diagnosing any disagreement with source.

## Acceptance Criteria

The work is complete only when:

1. With auto-save enabled, all requested local sources are active concurrently for the workspace rather than selected by host application.
2. Both VS Code Copilot Chat and GitHub Copilot CLI are explicitly handled and diagnosable.
3. A completed response for `E:\chat-commit` appears in `E:\chat-commit\.chat` within 15 seconds in the supported local Windows configuration.
4. Continuing or regenerating a response with unchanged turn count updates the saved content.
5. Restarting the extension does not create a duplicate auto-save for the same provider session.
6. Manual snapshots are never overwritten or deleted by auto-save.
7. No session with a positively different project path is saved into this workspace.
8. Multi-root workspaces route each positively matched session to the correct folder.
9. A failure in one source does not disable another source.
10. The diagnostic command explains source paths, health, skips, and the last successful save without exposing chat content.
11. All automated validation passes and every provider completes one Development Host/manual smoke test using a sanitized disposable conversation.

## Risks and Boundaries

- Provider transcript formats and locations are not stable public APIs. Keep adapters isolated, version-tolerant, fixture-backed, and diagnosable.
- VS Code's Chat Participant API only exposes history involving Session Control's own participant; it cannot be used as a general Copilot transcript feed.
- VS Code currently offers user-driven JSON export and a proposed session-provider integration surface, but the shipping extension must not require a proposed API.
- Cursor IDE history can be SQLite-backed and is not the same contract as Cursor CLI. This plan does not add direct Cursor IDE SQLite parsing.
- Cloud/background/synced sessions that do not have a complete local transcript are out of scope.
- Remote SSH, dev containers, and WSL may split the editor UI, extension host, project, and provider store across machines. Initial completion targets local stores visible to the running extension; unsupported topologies must be reported clearly.
- This plan does not install provider hooks or alter provider configuration to obtain transcripts.
- This plan does not restore a native provider session; it only saves Session Control snapshots and leaves the existing resume behavior intact.

## Relevant Files

- `src/extension.ts`
- `src/types.ts`
- `src/sessionReader.ts`
- `src/codexSessionReader.ts`
- `src/claudeCodeSessionReader.ts`
- `src/cursorSessionReader.ts`
- `src/cursorAgentTranscriptReader.ts`
- `src/sessionWriter.ts`
- `src/sessionStore.ts`
- New `src/autoSaveController.ts`
- New `src/autoSaveSources.ts`
- New `src/copilotCliSessionReader.ts`
- `package.json`
- `test/unit/extensionAutoSave.test.ts`
- Existing provider reader, writer, store, and type tests
- New controller and Copilot CLI reader tests
- `README.md`
- `CHANGELOG.md`
- `PLAN.md`
- `wiki/save-system.md`
- `wiki/configuration.md`
- `wiki/file-manifest.md`
- `wiki/log.md`

## External Source Notes

- VS Code's documented Chat Participant API limits participant history to messages in which that participant was mentioned: <https://code.visualstudio.com/api/extension-guides/ai/chat>
- VS Code documents user-driven JSON chat export and identifies `chatSessionsProvider` as proposed API: <https://code.visualstudio.com/docs/chat/chat-sessions>
- GitHub documents Copilot CLI session event logs under `~/.copilot/session-state/` and a separate managed SQLite index: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference>
- Cursor documents CLI session listing/resume but does not document a stable local persistence path: <https://docs.cursor.com/en/cli/using>
- Cursor's documented stream JSON includes `cwd` and `session_id`, which can guide fixture normalization but does not by itself establish the interactive persistence layout: <https://docs.cursor.com/en/cli/reference/output-format>
