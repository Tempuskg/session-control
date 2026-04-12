# Plan: Chat-Commit — VS Code Extension

## TL;DR
A VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files into a configurable `.chat/` folder in the repo, linked to git commits/branches. Users resume saved chats via a `@chat-commit` chat participant that loads prior conversation as LLM context. Manual save + optional auto-save on commit.

---

## Architecture Overview

**Two main subsystems:**
1. **Save System** — Reads Copilot's internal session storage files and copies/transforms them into the repo's `.chat/` folder with git metadata.
2. **Resume System** — A registered VS Code Chat Participant (`@chat-commit`) that loads a saved session and injects its history as context into a new conversation.

**Storage format:** JSON (primary, machine-parseable for resume) with a rendered Markdown summary embedded in the JSON for human review in diffs/PRs.

---

## Phase 1: Project Scaffolding

### Step 1.1 — Scaffold the extension
- Use `yo code` to generate a TypeScript VS Code extension
- Target minimum VS Code engine version `^1.93.0` (chat participant API stabilized)
- Set up webpack bundling
- Configure `.vscodeignore`

### Step 1.1a — Extension activation events
- **`activationEvents`**: The extension should activate lazily. Define activation events in `package.json`:
  - `onCommand:chat-commit.saveSession` — activate when the user runs the save command
  - `onCommand:chat-commit.listSessions` — activate when the user browses sessions
  - `onCommand:chat-commit.deleteSession` — activate when the user deletes a session
  - The chat participant (`chat-commit.resume`) automatically activates the extension when invoked — no explicit activation event needed for chat participants in VS Code ≥1.93
- **No `*` activation**: Do not use `"*"` (activate on startup). The extension has no reason to run until the user interacts with it.
- **`autoSaveOnCommit` re-activation**: When `autoSaveOnCommit` is enabled, the extension must activate on workspace open to register the git state listener. Add `onStartupFinished` as a conditional activation event — in `activate()`, check the setting and only register the git listener if enabled. If disabled, the activation is effectively a no-op and returns immediately.

### Step 1.2 — Define package.json contributions
- **Commands:**
  - `chat-commit.saveSession` — "Chat Commit: Save Current Chat Session"
  - `chat-commit.listSessions` — "Chat Commit: Browse Saved Sessions"
  - `chat-commit.deleteSession` — "Chat Commit: Delete Saved Session"
- **Configuration settings:**
  - `chat-commit.storagePath` (string, default: `.chat`) — folder relative to workspace root
  - `chat-commit.autoSaveOnCommit` (boolean, default: false) — auto-save active session on git commit
  - `chat-commit.includeInGitignore` (boolean, default: false) — optionally gitignore the .chat folder
  - **Large session options (resume context):**
    - `chat-commit.resume.maxTurns` (number, default: 50) — max number of turns to inject when resuming. Older turns beyond this limit are handled per `resume.overflowStrategy`
    - `chat-commit.resume.overflowStrategy` (enum, default: `summarize`) — what to do when a session exceeds `maxTurns`: `summarize` (LLM-summarize older turns into a preamble), `truncate` (drop oldest turns), `recent-only` (only load the last N turns with no summary)
    - `chat-commit.resume.maxContextChars` (number, default: 80000) — hard cap on total character count injected as context. Acts as a safety net regardless of turn count. Overflow handled per `overflowStrategy`
  - **Session file bloat options (save size):**
    - `chat-commit.save.maxFileSize` (string, default: `1mb`) — max size per saved session file. Sessions exceeding this are handled per `save.overflowStrategy`
    - `chat-commit.save.overflowStrategy` (enum, default: `split`) — what to do when a session file exceeds `maxFileSize`: `split` (chunk into part files e.g. `…-part1.json`, `…-part2.json` with linking metadata), `truncateOldest` (drop oldest turns to fit), `warn` (save anyway but show a warning)
    - `chat-commit.save.stripToolOutput` (boolean, default: false) — strip verbose tool call outputs (file contents, terminal output) from saved turns to reduce size. Tool call names and summaries are preserved
    - `chat-commit.save.maxSavedSessions` (number, default: 0 = unlimited) — max number of session files to keep in `.chat/`. When exceeded, the oldest sessions are moved to `.chat/.archive/` (or deleted per `save.pruneAction`)
    - `chat-commit.save.pruneAction` (enum, default: `archive`) — what to do when `maxSavedSessions` is exceeded: `archive` (move to `.chat/.archive/`), `delete` (permanently remove oldest)
- **Chat Participant:**
  - id: `chat-commit.resume`
  - name: `chat-commit`
  - description: "Resume a saved chat session"
  - commands: `resume`, `list`
- **Menus:**
  - Add "Save Chat Session" to `chat/context` menu (if available) or command palette
- **Tree View (optional Phase 3):**
  - `chat-commit.sessionExplorer` — sidebar panel listing saved sessions

---

## Phase 2: Save System

### Step 2.1 — Locate and read Copilot chat session files
- Access internal storage path: `{context.globalStorageUri}/../../../workspaceStorage/{workspaceId}/chatSessions/`
  - Alternatively, derive from `context.storageUri` which gives `workspaceStorage/{workspaceId}/{extensionId}` — go up one level + into `chatSessions/`
- Read `.json` and `.jsonl` session files
- Parse session data: extract turns (user prompts, assistant responses, tool invocations, file references)
- **Important:** This relies on VS Code internal format. Implement a version-detection layer to handle format changes gracefully with a clear error message.

### Step 2.2 — Determine active/most-recent session
- Read the session index from the chatSessions directory listing
- Sort by `lastMessageDate` to find active/recent session
- Present a QuickPick list to the user so they can choose which session to save

### Step 2.3 — Transform to save format
- Create a `ChatSession` JSON schema:
```json
{
  "version": 1,
  "id": "<uuid>",
  "title": "<auto-generated or user-provided>",
  "savedAt": "<ISO timestamp>",
  "git": {
    "branch": "<current branch>",
    "commit": "<HEAD commit SHA>",
    "dirty": "<boolean>"
  },
  "vscodeVersion": "<version>",
  "totalTurns": "<number>",
  "part": "<number | null>",
  "totalParts": "<number | null>",
  "previousPartFile": "<filename | null>",
  "nextPartFile": "<filename | null>",
  "turns": [
    {
      "type": "request",
      "participant": "copilot",
      "prompt": "...",
      "references": [],
      "timestamp": "..."
    },
    {
      "type": "response",
      "participant": "copilot",
      "content": "...",
      "toolCalls": [],
      "timestamp": "..."
    }
  ],
  "markdownSummary": "# Chat: <title>\n\n## User\n...\n\n## Copilot\n..."
}
```
- Use Git extension API (`vscode.git`) to get branch name and commit SHA
- Auto-generate title from first user prompt (truncated) or let user rename
- **Bloat controls applied here:** check `save.maxFileSize` after serialization. If exceeded, apply `save.overflowStrategy` (split/truncateOldest/warn). If `save.stripToolOutput` is true, replace tool call output bodies with `"[output stripped — N chars]"` summaries before size check.

### Step 2.4 — Write to .chat/ folder
- Create `.chat/` directory if it doesn't exist
- File naming: `{timestamp}-{slugified-title}.json` (e.g., `2026-04-12T14-30-fix-auth-bug.json`)
  - For split sessions: append `-part1`, `-part2`, etc.
- Optionally create a parallel `.md` file for easy browsing in git diffs
- If `autoSaveOnCommit` is enabled, register a git post-commit hook or listen to `Repository.state` changes
- **After write:** check `save.maxSavedSessions`. If exceeded, apply `save.pruneAction` (archive or delete oldest sessions)

### Step 2.5 — Auto-save on commit (optional)
- Watch `git.repositories[0].state.onDidChange` for HEAD changes
- When a new commit is detected, automatically save the most recent active chat session
- Debounce to avoid saving on every micro-state change
- Only save if there are new turns since last save (track via turn count or hash)

---

## Phase 3: Resume System (Chat Participant)

### Step 3.1 — Register the chat participant
- Register `@chat-commit` via `vscode.chat.createChatParticipant()`
- Handle commands:
  - `/resume <session-name-or-id>` — load and inject a saved session as context
  - `/list` — show available saved sessions in the chat response stream

### Step 3.2 — Implement resume flow
- When user types `@chat-commit /resume fix-auth-bug`:
  1. Search `.chat/` folder for matching session file (fuzzy match on title/filename — see **Fuzzy Matching** section below)
  2. Parse the JSON session file (if split across parts, load all parts and reassemble)
  3. **Apply large session limits:** check turn count against `resume.maxTurns` and total character length against `resume.maxContextChars`. If either limit is exceeded, apply `resume.overflowStrategy`:
     - `summarize`: Send older turns to the LLM with a "summarize this conversation so far" prompt, use the summary as a preamble, then include the most recent turns verbatim
     - `truncate`: Silently drop oldest turns until within limits
     - `recent-only`: Load only the last N turns, prepend a note: "Earlier turns omitted (M total)"
  4. Build a context prompt from the (possibly reduced) turns:
     - Format as a system message: "The following is a previous conversation that the user wants to continue:"
     - Include all included turns in chronological order
  5. Stream a context summary to the user via `stream.markdown()` so they see what was loaded (including any truncation/summarization notices)
  6. Make the context available for follow-up questions via `ChatContext.history`
  
### Step 3.3 — Session selection UX
- If multiple matches, present options in chat response with clickable command buttons
- If no argument given, show a QuickPick of all saved sessions
- Display metadata: title, date, branch, commit SHA, turn count

### Step 3.4 — Context injection for follow-up
- On subsequent turns (detected via `context.history`), re-inject the loaded session context
- Use `request.model.sendRequest()` or similar to prepend saved turns as prior context
- Re-apply `resume.maxTurns` / `resume.maxContextChars` limits on each follow-up (the budget now includes both the saved context AND the new turns in the current conversation)
- This ensures the LLM "remembers" the saved conversation across follow-ups while staying within context limits

---

## Phase 4: Polish & Settings

### Step 4.1 — Configuration handling
- Read settings via `vscode.workspace.getConfiguration('chat-commit')`
- Validate storage path (must be relative, within workspace)
- Handle multi-root workspaces (see **Multi-Root Workspace Handling** section below)

### Step 4.2 — .gitignore management
- If `includeInGitignore` is true, add `.chat/` to `.gitignore`
- Otherwise, leave it tracked (default — the whole point is source control)

### Step 4.3 — Session management commands
- `listSessions`: Open a QuickPick showing all sessions with metadata
- `deleteSession`: Soft-delete (move to `.chat/.trash/`) or hard-delete with confirmation

### Step 4.4 — Status bar indicator (stretch)
- Show a status bar item when auto-save is active
- Click to toggle auto-save or save manually

---

## Error Handling

Error handling strategy across all subsystems. The principle: never silently fail, always give the user actionable information.

### Copilot Storage Errors (Session Reader)
- **Storage directory not found**: The `chatSessions/` directory may not exist if Copilot hasn't been used in this workspace. Show an info message: *"No Copilot chat sessions found in this workspace. Start a Copilot chat first."* Do not throw.
- **Unreadable/corrupt session files**: If a `.json` or `.jsonl` file fails to parse, skip it with a warning in the output channel: *"Skipped corrupt session file: {filename}"*. Continue processing remaining files. Never crash on a single bad file.
- **Unknown format version**: If the session data structure doesn't match any known format, show an error: *"Unrecognized Copilot session format (VS Code {version}). Chat-Commit may need an update."* Include a link to file an issue. Return an empty session list rather than throwing.
- **Permission errors**: If files can't be read due to OS permissions, surface the OS error message directly.

### Save Errors (Session Writer / Session Store)
- **`.chat/` directory creation fails**: Surface the OS error. Common cause: workspace is read-only.
- **Disk full / write failure**: Catch write errors, show *"Failed to save session: {error}"*, and do not leave partial files. Use write-to-temp-then-rename to ensure atomicity.
- **JSON serialization errors**: Should not happen with well-formed data, but catch and log with full context if it does.

### Resume Errors (Chat Participant)
- **No matching session**: If fuzzy match returns zero results, respond in chat: *"No saved session matching '{query}'. Use @chat-commit /list to see available sessions."*
- **Corrupt saved session file**: If a `.chat/*.json` file fails to parse, respond in chat: *"Session file is corrupt: {filename}. Try re-saving the session."*
- **Summarization failure**: If the `summarize` overflow strategy fails (LLM error), fall back to `truncate` silently and note in the context summary: *"Summary generation failed — showing most recent turns only."*

### Git Integration Errors
- **Git extension not available**: If `vscode.git` extension isn't installed/active, save sessions without git metadata (set `git` field to `null`). Show an info message on first occurrence: *"Git extension not available. Sessions will be saved without git metadata."*
- **No repository**: If workspace has no git repo, same as above — save without git metadata.
- **Auto-save listener failure**: If the `onDidChange` listener throws, log to output channel and disable auto-save for the session with a warning notification.

---

## Markdown Summary Generation

The `markdownSummary` field in the session JSON provides a human-readable rendering of the conversation for git diffs and PR reviews.

### Format
```markdown
# Chat: {title}

**Branch:** {branch} | **Commit:** {short-sha} | **Saved:** {date}
**Turns:** {count}

---

### Turn 1 — User
{prompt text}

### Turn 1 — Copilot
{response text}

> **Tool calls:** read_file (src/login.ts), run_in_terminal (npm test)

### Turn 2 — User
...
```

### Rules
- Each turn is a `### Turn N — {role}` heading
- User turns show the prompt text verbatim
- Copilot turns show the response content (markdown preserved as-is)
- Tool calls are listed in a blockquote below the response: tool name + summary only (not full output)
- If `stripToolOutput` is enabled, tool call output is already stripped — the summary reflects this
- File references from user turns are listed as a bullet list below the prompt
- The summary is truncated to the first 50 turns if the session is very long, with a note: *"... {N} additional turns not shown in summary"*
- Total summary target: ≤100KB. If it exceeds this, truncate from the middle (keep first 10 and last 10 turns, replace middle with *"... {N} turns omitted ..."*)

---

## Fuzzy Matching

Used by the resume system to find sessions matching a user's query (e.g., `@chat-commit /resume fix-auth`).

### Algorithm
- Input: user query string, list of session files in `.chat/`
- **Match candidates**: For each session, extract the title (from JSON) and the filename slug
- **Scoring**: Use a simple substring + word-boundary scoring approach:
  1. **Exact match** (query equals title or filename slug) → score 100
  2. **Prefix match** (title or slug starts with query) → score 80
  3. **Substring match** (query appears as substring in title or slug) → score 60
  4. **Word-boundary match** (each word in query appears at a word boundary in title) → score 40
  5. **Includes all characters in order** (fuzzy) → score 20
  6. **No match** → score 0
- Return candidates with score > 0, sorted by score descending, then by `savedAt` descending (most recent first)
- All matching is case-insensitive

### Behavior
- **Single match (score ≥ 60)**: Auto-select and load
- **Multiple matches**: Present sorted list with clickable buttons in chat
- **No matches**: Show error with suggestion to use `/list`
- **No query provided**: Skip fuzzy match, show QuickPick of all sessions

### Implementation
- Implement in `src/utils.ts` as a pure function: `fuzzyMatchSessions(query: string, sessions: SessionMeta[]): ScoredSession[]`
- No external fuzzy-matching library needed — the algorithm is simple enough to implement inline
- If a more sophisticated approach is needed later (e.g., Levenshtein distance), it can be swapped in behind the same interface

---

## Multi-Root Workspace Handling

VS Code supports multi-root workspaces where multiple folders are open simultaneously. Chat-Commit must handle this correctly.

### Which workspace folder gets the `.chat/` directory?
- **On manual save**: Use the workspace folder of the **active editor's file**. If no file is open, prompt the user to select a workspace folder via QuickPick.
- **On auto-save (commit)**: Use the workspace folder of the **repository that just committed**. The git extension provides the repository object, which maps to a workspace folder.
- **On resume/list**: Search `.chat/` folders across **all** workspace folders. Present results with the workspace folder name as a prefix for disambiguation (e.g., *"[backend] fix-auth-bug"*, *"[frontend] add-navbar"*).

### Settings scope
- `chat-commit.*` settings can be configured at the workspace-folder level (VS Code supports this natively via `.vscode/settings.json` per folder)
- `storagePath` is always relative to the workspace folder root, not the multi-root workspace file
- Example: workspace with `backend/` and `frontend/` → sessions save to `backend/.chat/` or `frontend/.chat/`

### Git integration
- `vscode.git` exposes `git.repositories` as an array — one per repo in the workspace
- Match the active file's URI to the correct repository via `repo.rootUri`
- If a workspace folder has no git repo, save sessions without git metadata (same as single-root behavior)

---

## Testing Strategy

Testing is split into unit tests, integration tests, and manual tests. Use the VS Code testing infrastructure (`@vscode/test-electron` or `@vscode/test-cli`).

### Unit Tests
Run without VS Code — pure logic, mocked dependencies.

| Module | What to Test | Mock |
|--------|-------------|------|
| `sessionWriter.ts` | JSON schema output, title generation, bloat controls (split/truncate/strip) | File system, git API |
| `sessionStore.ts` | File naming, CRUD operations, pruning logic, archive behavior | File system |
| `utils.ts` | Slugify, timestamp formatting, fuzzy matching scoring | None (pure functions) |
| `types.ts` | Type guards, validation functions | None |
| `gitIntegration.ts` | Metadata extraction, null handling when git unavailable | `vscode.git` extension API |

**Fuzzy matching** deserves dedicated test cases:
- Exact match: `"fix-auth-bug"` → `fix-auth-bug.json` → score 100
- Prefix match: `"fix"` → `fix-auth-bug.json` → score 80
- Substring: `"auth"` → `fix-auth-bug.json` → score 60
- Word-boundary: `"fix bug"` → `fix-auth-bug.json` → score 40
- Fuzzy: `"fab"` → `fix-auth-bug.json` → score 20
- No match: `"deploy"` → `fix-auth-bug.json` → score 0

**Bloat controls** test matrix:
- `split`: Session of 1.5MB with `maxFileSize=1mb` → 2 part files, linked correctly
- `truncateOldest`: 100 turns, `maxFileSize=500kb` → oldest turns dropped, remaining fit
- `warn`: Oversized session saved as-is, warning returned
- `stripToolOutput`: Tool output replaced with `"[output stripped — N chars]"`

### Integration Tests
Run inside VS Code extension host via `@vscode/test-electron`.

| Test | Description |
|------|-------------|
| Save round-trip | Save a mock session → read back → verify JSON structure matches schema |
| Resume context injection | Save a session → resume via chat participant → verify context prompt format |
| Multi-part reassembly | Save a large session that splits → resume → verify all parts loaded and ordered |
| Git metadata | With a real git repo in temp dir → save → verify branch/SHA/dirty captured |
| Pruning | Set `maxSavedSessions=2`, save 4 → verify 2 archived/deleted |
| Auto-save trigger | Enable `autoSaveOnCommit`, make a commit in test repo → verify session saved |

### Mocking Copilot Internals
- **Do not mock the actual Copilot session files in unit tests** — the format is undocumented and may change.
- Instead, create **fixture files** based on observed real session structures. Store these in `test/fixtures/`.
- The `sessionReader.ts` version-detection layer is tested by providing fixture files for each known format version.
- When a new VS Code version changes the format, add a new fixture file and update the reader.
- Integration tests can write known JSON to a temp `chatSessions/` directory to simulate Copilot storage.

### Test Infrastructure
- **Framework**: Mocha (VS Code extension standard) with `@vscode/test-electron` for integration tests
- **Fixture directory**: `test/fixtures/` — sample session files in various formats
- **Temp directories**: Integration tests use `os.tmpdir()` for isolation; cleaned up in `afterEach`
- **CI**: Tests run in GitHub Actions via `xvfb-run` (Linux) for the extension host tests

---

## Relevant Files (to create)

- `package.json` — Extension manifest with commands, settings, chat participant, menus
- `src/extension.ts` — Entry point, registers commands and chat participant
- `src/sessionReader.ts` — Reads Copilot internal session files, handles format versioning
- `src/sessionWriter.ts` — Transforms and writes sessions to `.chat/` folder
- `src/chatParticipant.ts` — `@chat-commit` chat participant handler (resume logic)
- `src/gitIntegration.ts` — Git extension API wrapper (branch, SHA, commit listener)
- `src/sessionStore.ts` — CRUD operations on saved session files in `.chat/`
- `src/types.ts` — TypeScript interfaces for `ChatSession`, `SavedTurn`, etc.
- `src/utils.ts` — Slugify, timestamp formatting, fuzzy matching
- `test/fixtures/` — Sample Copilot session files for testing the session reader
- `test/unit/` — Unit tests (pure logic, mocked dependencies)
- `test/integration/` — Integration tests (run in VS Code extension host)

---

## Verification

1. **Unit tests** — Test session parsing, JSON schema validation, slugification, git metadata extraction (mock git API)
2. **Integration test** — Save a session, verify JSON structure, load it back, verify round-trip fidelity
3. **Manual test: Save flow** — Open Copilot Chat, have a conversation, run "Chat Commit: Save Current Chat Session", verify `.chat/` folder contains valid JSON with correct git metadata
4. **Manual test: Resume flow** — Type `@chat-commit /resume <saved-session>`, verify the conversation context is loaded, ask a follow-up question referencing earlier context, verify LLM responds coherently
5. **Manual test: Auto-save** — Enable `chat-commit.autoSaveOnCommit`, make a commit, verify a new session JSON appears in `.chat/`
6. **Manual test: Git diff** — Save a session, `git diff` and verify the JSON/Markdown is readable
7. **Snyk scan** — Run `snyk_code_scan` on all source files per project rules
8. **Extension packaging** — `vsce package` succeeds, `.vsix` installs cleanly
9. **Manual test: Large session save** — Create/mock a session with 100+ turns and heavy tool output. Test each `save.overflowStrategy` (split → verify part files link correctly; truncateOldest → verify oldest turns dropped; warn → verify warning shown). Test `stripToolOutput` → verify tool call bodies replaced with summaries
10. **Manual test: Large session resume** — Resume a 100+ turn session. Test each `resume.overflowStrategy` (summarize → verify summary preamble generated; truncate → verify oldest turns silently dropped; recent-only → verify only last N turns loaded with omission note). Verify `maxContextChars` hard cap works
11. **Manual test: Session pruning** — Set `maxSavedSessions` to 3, save 5 sessions. Verify oldest 2 are archived (or deleted per `pruneAction`)

---

## Decisions & Assumptions

- **Internal storage dependency:** Reading Copilot's internal session files is fragile — format may change across VS Code versions. Mitigated by version detection and graceful error handling. This is the only way to access full Copilot session history (public API only exposes history for your own participant).
- **Resume via chat participant, not native restore:** No public API exists to restore a native Copilot session. The `@chat-commit` participant approach is stable and uses public APIs.
- **JSON as primary format:** Chosen because the user wants resume capability. Markdown is embedded in the JSON for human readability in diffs.
- **Personal use focus:** No collaboration features like conflict resolution or merge strategies for `.chat/` files. Sessions are append-only snapshots.
- **Scope boundary — excluded:** No support for non-Copilot chats, no web UI, no cross-repo session syncing, no chat search/indexing.

---

## Risks & Mitigations

1. **Copilot internal format changes** — Implement a format version detector in `sessionReader.ts`. If unknown format, show a clear error message with the VS Code version and link to file an issue. Consider contributing a feature request to VS Code for a public chat export API.
2. **Large session files in repo** — Fully configurable via `save.maxFileSize` (split/truncate/warn), `save.stripToolOutput` (remove verbose tool output), and `save.maxSavedSessions` + `save.pruneAction` (archive/delete oldest). Defaults are conservative (1 MB max, no stripping, unlimited sessions).
3. **Chat participant context window limits on resume** — Fully configurable via `resume.maxTurns`, `resume.maxContextChars`, and `resume.overflowStrategy` (summarize/truncate/recent-only). Defaults target ~80K chars / 50 turns with summarization as the fallback.
