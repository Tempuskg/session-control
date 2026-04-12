# Plan: Chat-Commit — VS Code Extension

## TL;DR
An **open source** VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files into a configurable `.chat/` folder in the repo, linked to git commits/branches. Users resume saved chats via a `@chat-commit` chat participant that loads prior conversation as LLM context. Manual save + optional auto-save on commit. Licensed under MIT and published to the VS Code Marketplace and Open VSX Registry.

## Implementation Progress (Updated: 2026-04-12)

- [x] **Phase 1 — Project Scaffolding**
  - Completed: extension manifest/config scaffolding, webpack + TypeScript + ESLint setup, extension/test launch config, baseline `src/extension.ts`, open source docs/templates, CI/release workflows
  - Validation completed: `npm run compile`, `npm run lint`, `npm test`, `npm audit` (0 vulnerabilities after dependency hardening)
- [x] **Phase 2 — Types & Core Utilities**
  - Completed: `src/types.ts` interfaces + type guards (`isChatSession`, `isSavedTurn`, etc.), `src/utils.ts` helpers (`slugify`, `formatTimestamp`, `parseFileSize`, `fuzzyMatchSessions`), and unit tests in `test/unit/`
  - Validation completed: `npm test` (10 passing, including guard and utility scoring matrix tests)
- [x] **Phase 3 — Git Integration**
  - Completed: `src/gitIntegration.ts` with repository matching by workspace URI, dirty-state detection, graceful fallback when git extension/repo are unavailable, and one-time user notification when git extension is missing
  - Validation completed: `npm run lint`, `npm test` (14 passing, including `test/unit/gitIntegration.test.ts`)
- [x] **Phase 4 — Session Reader**
  - Completed: `src/sessionReader.ts` with storage-path derivation, `.json`/`.jsonl` parsing, turn normalization, recency sorting, corrupt-file skipping with warnings, and unknown-format fail-safe behavior
  - Validation completed: `npm test` (18 passing, including fixture-driven `test/unit/sessionReader.test.ts`)
- [x] **Phase 5 — Session Writer & Store**
  - Completed: `src/sessionWriter.ts` (`createChatSession`, markdown summary generation with turn/size limits) and `src/sessionStore.ts` (file naming, atomic writes, read/list metadata)
  - Validation completed: `npm run lint`, `npm test` (27 passing, including `test/unit/sessionWriter.test.ts` and `test/unit/sessionStore.test.ts`)
- [ ] **Phase 6 — Save Command**
- [ ] **Phase 7 — Chat Participant & Resume**
- [ ] **Phase 8 — Bloat Controls**
- [ ] **Phase 9 — Auto-Save & Session Pruning**
- [ ] **Phase 10 — Polish & Multi-Root**

**Current focus:** Start Phase 6 (`src/extension.ts` command wiring + save flow integration).

---

## Architecture Overview

**Two main subsystems:**
1. **Save System** — Reads Copilot's internal session storage files and copies/transforms them into the repo's `.chat/` folder with git metadata.
2. **Resume System** — A registered VS Code Chat Participant (`@chat-commit`) that loads a saved session and injects its history as context into a new conversation.

**Storage format:** JSON (primary, machine-parseable for resume) with a rendered Markdown summary embedded in the JSON for human review in diffs/PRs.

---

## Phase 1: Project Scaffolding (Completed)

> **Goal:** A buildable, empty extension with all boilerplate in place.

### Step 1.1 — Scaffold the extension
- Use `yo code` to generate a TypeScript VS Code extension
- Target minimum VS Code engine version `^1.93.0` (chat participant API stabilized)
- Set up webpack bundling
- Configure `.vscodeignore`
- Initialize as a public GitHub repository with `MIT` license

### Step 1.2 — Open source project files
- **`LICENSE`** — MIT license
- **`README.md`** — Project description, features, installation, usage, configuration reference, contributing link, license badge
- **`CONTRIBUTING.md`** — How to set up the dev environment, run tests, submit PRs, and report issues. Code style expectations (TypeScript strict, ESLint config)
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant v2.1
- **`CHANGELOG.md`** — Keep a Changelog format, updated on each release
- **`.github/ISSUE_TEMPLATE/`** — Bug report and feature request templates
- **`.github/PULL_REQUEST_TEMPLATE.md`** — PR checklist (tests pass, lint clean, changelog updated)
- **`.github/workflows/ci.yml`** — GitHub Actions: lint, build, unit tests, integration tests (via `xvfb-run`), Snyk scan
- **`.github/workflows/release.yml`** — GitHub Actions: on tag push, `vsce package` → publish to VS Code Marketplace + Open VSX Registry, create GitHub Release with `.vsix` asset

### Step 1.3 — package.json contributions
- **Commands:**
  - `chat-commit.saveSession` — "Chat Commit: Save Current Chat Session"
  - `chat-commit.listSessions` — "Chat Commit: Browse Saved Sessions"
  - `chat-commit.deleteSession` — "Chat Commit: Delete Saved Session"
- **Configuration settings:**
  - `chat-commit.storagePath` (string, default: `.chat`) — folder relative to workspace root
  - `chat-commit.autoSaveOnCommit` (boolean, default: false) — auto-save active session on git commit
  - `chat-commit.includeInGitignore` (boolean, default: false) — optionally gitignore the .chat folder
  - **Resume context settings:**
    - `chat-commit.resume.maxTurns` (number, default: 50) — max turns to inject when resuming
    - `chat-commit.resume.overflowStrategy` (enum, default: `summarize`) — `summarize`, `truncate`, `recent-only`
    - `chat-commit.resume.maxContextChars` (number, default: 80000) — hard cap on total injected characters
  - **Save bloat settings:**
    - `chat-commit.save.maxFileSize` (string, default: `1mb`) — max size per saved session file
    - `chat-commit.save.overflowStrategy` (enum, default: `split`) — `split`, `truncateOldest`, `warn`
    - `chat-commit.save.stripToolOutput` (boolean, default: false) — strip verbose tool call outputs
    - `chat-commit.save.maxSavedSessions` (number, default: 0 = unlimited) — max session files in `.chat/`
    - `chat-commit.save.pruneAction` (enum, default: `archive`) — `archive` or `delete`
- **Chat Participant:**
  - id: `chat-commit.resume`, name: `chat-commit`, description: "Resume a saved chat session"
  - commands: `resume`, `list`
- **Menus:** Add "Save Chat Session" to `chat/context` menu or command palette

### Step 1.4 — Extension activation events
- Activate lazily via `onCommand` for each command
- The chat participant (`chat-commit.resume`) automatically activates the extension when invoked — no explicit event needed in VS Code ≥1.93
- **No `*` activation** — the extension has no reason to run until the user interacts with it
- Add `onStartupFinished` for `autoSaveOnCommit` — in `activate()`, check the setting and only register the git listener if enabled; otherwise return immediately

### Step 1.5 — Entry point stub
- Create `src/extension.ts` with empty `activate()` / `deactivate()` functions
- Verify the extension compiles, bundles, and loads in the Extension Host (`F5`)

**Deliverable:** Extension installs, activates on command, shows commands in palette. No functionality yet.

---

## Phase 2: Types & Core Utilities (Completed)

> **Goal:** All shared data structures and pure utility functions, fully unit-tested.

### Step 2.1 — TypeScript types (`src/types.ts`)
- Define `ChatSession`, `GitContext`, `RequestTurn`, `ResponseTurn`, `ToolCall`, `SessionMeta`
- Define type guards and validation functions (e.g., `isChatSession()`, `isValidTurn()`)

### Step 2.2 — Utilities (`src/utils.ts`)
- `slugify(title: string): string` — convert title to filename-safe slug
- `formatTimestamp(date: Date): string` — produce `YYYY-MM-DDTHH-mm` format
- `parseFileSize(size: string): number` — convert `"1mb"` → `1048576`

### Step 2.3 — Fuzzy matching (`src/utils.ts`)
- `fuzzyMatchSessions(query: string, sessions: SessionMeta[]): ScoredSession[]`
- Scoring tiers: exact (100), prefix (80), substring (60), word-boundary (40), character-order (20), no match (0)
- Case-insensitive, sorted by score then `savedAt` descending
- See **Fuzzy Matching** reference section for full algorithm and behavior rules

### Step 2.4 — Unit tests for types & utilities
- Test slugify edge cases (unicode, special chars, long strings)
- Test timestamp formatting
- Test parseFileSize with various units (`500kb`, `1mb`, `2mb`, invalid input)
- Full fuzzy matching test matrix (exact, prefix, substring, word-boundary, fuzzy, no match)

**Deliverable:** `src/types.ts`, `src/utils.ts`, `test/unit/types.test.ts`, `test/unit/utils.test.ts` — all tests pass.

---

## Phase 3: Git Integration (Completed)

> **Goal:** A self-contained module for reading git metadata, resilient to missing repos.

### Step 3.1 — Git extension API wrapper (`src/gitIntegration.ts`)
- Access the built-in `vscode.git` extension API
- `getGitContext(workspaceFolder: Uri): Promise<GitContext | null>` — returns `{ branch, commit, dirty }` or `null` if git unavailable
- Match workspace folder URI to the correct repository via `repo.rootUri`

### Step 3.2 — Graceful degradation
- If `vscode.git` extension isn't installed/active → return `null`, show info message on first occurrence
- If workspace has no git repo → return `null`

### Step 3.3 — Unit tests
- Mock `vscode.git` API, test metadata extraction
- Test null handling when git unavailable

**Deliverable:** `src/gitIntegration.ts`, `test/unit/gitIntegration.test.ts` — git metadata works or gracefully returns null.

---

## Phase 4: Session Reader (Completed)

> **Goal:** Read and parse Copilot's internal session storage. This is the fragile layer — isolate it.

### Step 4.1 — Locate Copilot session storage (`src/sessionReader.ts`)
- Derive path from `context.storageUri`: go up from `workspaceStorage/{workspaceId}/{extensionId}` → into `chatSessions/`
- Handle "directory not found" gracefully with info message

### Step 4.2 — Read and parse session files
- Read `.json` and `.jsonl` files from the `chatSessions/` directory
- Parse into internal session structures: extract turns (user prompts, assistant responses, tool invocations, file references)
- Skip corrupt files with a warning in the output channel; never crash on a single bad file

### Step 4.3 — Version detection layer
- Detect the internal format structure and handle known versions
- On unknown format: show error with VS Code version, link to file an issue, return empty list

### Step 4.4 — Determine active/most-recent session
- Sort parsed sessions by `lastMessageDate`
- Return sorted session list for upstream to present in QuickPick

### Step 4.5 — Test fixtures
- Create `test/fixtures/` with sample session files based on observed real structures
- Test each known format version via fixture files

**Deliverable:** `src/sessionReader.ts`, `test/fixtures/*.json`, `test/unit/sessionReader.test.ts` — can read real Copilot sessions or fail gracefully.

---

## Phase 5: Session Writer & Store (Completed)

> **Goal:** Transform parsed sessions into the save format and write to `.chat/`.

### Step 5.1 — Transform to save format (`src/sessionWriter.ts`)
- Map internal Copilot session data → `ChatSession` JSON schema:
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
- Enrich with git metadata from `gitIntegration`
- Auto-generate title from first user prompt (truncated) or accept user-provided title
- Generate `markdownSummary` field (see **Markdown Summary Generation** reference section)

### Step 5.2 — Session store CRUD (`src/sessionStore.ts`)
- Create `.chat/` directory if it doesn't exist
- File naming: `{timestamp}-{slugified-title}.json`
- Atomic writes: write to temp file, then rename
- Read a session back from `.chat/` by filename or fuzzy search
- List all sessions with metadata (title, date, turn count, git context)

### Step 5.3 — Unit tests
- Test JSON schema output matches expected structure
- Test title generation from various prompt inputs
- Test file naming with slugify + timestamp
- Test atomic write behavior (temp-then-rename)
- Test markdown summary generation format and truncation rules

**Deliverable:** `src/sessionWriter.ts`, `src/sessionStore.ts`, unit tests — can transform and persist sessions.

---

## Phase 6: Save Command

> **Goal:** The user can save a chat session end-to-end. First user-facing feature.

### Step 6.1 — Register the save command
- Wire `chat-commit.saveSession` in `src/extension.ts`
- Call `sessionReader` → present QuickPick → call `sessionWriter` → call `sessionStore`

### Step 6.2 — QuickPick session selection
- Present list of available Copilot sessions sorted by most recent
- Display: first prompt line (truncated), date, turn count
- Allow user to rename the title before saving

### Step 6.3 — Register list and delete commands
- `chat-commit.listSessions` — QuickPick showing all saved sessions with metadata (title, date, branch, commit SHA, turn count)
- `chat-commit.deleteSession` — soft-delete (move to `.chat/.trash/`) or hard-delete with confirmation

### Step 6.4 — Integration test: save round-trip
- Save a mock session → read back → verify JSON structure matches schema
- Verify git metadata captured correctly (using real git repo in temp dir)

**Deliverable:** User can run "Chat Commit: Save Current Chat Session" from the command palette and see the JSON file appear in `.chat/`. Can browse and delete sessions.

---

## Phase 7: Chat Participant & Resume

> **Goal:** The user can resume a saved session via `@chat-commit /resume`.

### Step 7.1 — Register the chat participant (`src/chatParticipant.ts`)
- Register `@chat-commit` via `vscode.chat.createChatParticipant()`
- Route `/resume` and `/list` commands to handlers

### Step 7.2 — `/list` command
- Read all sessions from `sessionStore`
- Format as a list in the chat response with metadata (title, date, branch, turn count)

### Step 7.3 — `/resume` command
- Accept session name/query as argument
- Use `fuzzyMatchSessions` to find matching session(s)
  - Single match (score ≥ 60) → auto-select and load
  - Multiple matches → present sorted list with clickable command buttons
  - No matches → error message with suggestion to use `/list`
  - No query → show QuickPick of all sessions
- Load session JSON (single file for now — multi-part in Phase 8)
- Build context prompt: "The following is a previous conversation that the user wants to continue:" + chronological turns
- Stream context summary via `stream.markdown()` showing what was loaded

### Step 7.4 — Context injection for follow-up turns
- On subsequent turns (detected via `context.history`), re-inject loaded session context
- Use `request.model.sendRequest()` or similar to prepend saved turns as prior context

### Step 7.5 — Integration test: resume flow
- Save a session → resume via chat participant → verify context prompt format
- Test fuzzy matching with various query inputs

**Deliverable:** User can type `@chat-commit /resume fix-auth-bug` and get the saved conversation injected as context. Follow-up messages retain context.

---

## Phase 8: Bloat Controls

> **Goal:** Handle large sessions gracefully on both save and resume sides.

### Step 8.1 — Save-side: strip tool output
- When `save.stripToolOutput` is true, replace tool call output bodies with `"[output stripped — N chars]"` before serialization
- Tool call names and summaries preserved

### Step 8.2 — Save-side: size limits & split
- After serialization, check against `save.maxFileSize`
- **`split`** strategy: chunk into part files (`-part1.json`, `-part2.json`, ...) with linking metadata (`part`, `totalParts`, `previousPartFile`, `nextPartFile`)
- **`truncateOldest`** strategy: drop oldest turns until within size limit
- **`warn`** strategy: save as-is, show warning notification

### Step 8.3 — Resume-side: multi-part reassembly
- When loading a session, detect part files and reassemble all parts in order

### Step 8.4 — Resume-side: context overflow strategies
- Check turn count against `resume.maxTurns` and character length against `resume.maxContextChars`
- **`summarize`**: Send older turns to the LLM with a "summarize this conversation so far" prompt; use summary as preamble, recent turns verbatim. Fall back to `truncate` on LLM error.
- **`truncate`**: Silently drop oldest turns until within limits
- **`recent-only`**: Load only last N turns, prepend note: *"Earlier turns omitted (M total)"*
- Re-apply limits on each follow-up turn (budget covers saved + new turns)

### Step 8.5 — Unit & integration tests
- `split`: 1.5MB session with `maxFileSize=1mb` → 2 part files, linked correctly
- `truncateOldest`: 100 turns, `500kb` limit → oldest turns dropped, remaining fit
- `warn`: Oversized session saved as-is, warning returned
- `stripToolOutput`: Tool output replaced with summary placeholders
- Multi-part reassembly: save a split session → resume → verify all parts loaded and ordered
- Each resume overflow strategy tested with 100+ turn session

**Deliverable:** Large sessions handled gracefully — split on save, reassembled on resume, context trimmed to fit LLM limits.

---

## Phase 9: Auto-Save & Session Pruning

> **Goal:** Automatic save triggers and storage housekeeping.

### Step 9.1 — Auto-save on commit
- When `autoSaveOnCommit` is enabled, watch `git.repositories[*].state.onDidChange` for HEAD changes
- Debounce to avoid saving on micro-state changes (staging, etc.)
- Only save if new turns exist since last save (tracked via turn count or content hash)
- On listener error: log to output channel, disable auto-save for the session with a warning

### Step 9.2 — Session pruning
- After each save, check `save.maxSavedSessions`
- When exceeded, apply `save.pruneAction`:
  - **`archive`**: move oldest sessions to `.chat/.archive/`
  - **`delete`**: permanently remove oldest sessions

### Step 9.3 — Integration tests
- Enable `autoSaveOnCommit`, make a commit in test repo → verify session saved
- Set `maxSavedSessions=2`, save 4 → verify 2 archived/deleted

**Deliverable:** Sessions auto-save on commit. Old sessions automatically archived or deleted per config.

---

## Phase 10: Polish & Multi-Root

> **Goal:** Configuration validation, multi-root support, and final polish.

### Step 10.1 — Configuration validation
- Read settings via `vscode.workspace.getConfiguration('chat-commit')`
- Validate `storagePath` (must be relative, within workspace)
- Validate numeric settings (positive integers)
- Validate `maxFileSize` format (`500kb`, `1mb`, etc.)

### Step 10.2 — Multi-root workspace support
- **On manual save**: use workspace folder of active editor's file; if no file open, prompt via QuickPick
- **On auto-save**: use workspace folder of the repository that committed
- **On resume/list**: search `.chat/` across all workspace folders, prefix results with folder name for disambiguation (e.g., *"[backend] fix-auth-bug"*)
- Settings can be configured per workspace folder via `.vscode/settings.json`
- See **Multi-Root Workspace Handling** reference section for full details

### Step 10.3 — .gitignore management
- If `includeInGitignore` is true, add `.chat/` to `.gitignore`
- Otherwise, leave it tracked (default — the whole point is source control)

### Step 10.4 — Session explorer tree view (stretch)
- `chat-commit.sessionExplorer` — sidebar panel listing saved sessions
- Click to preview session metadata; double-click to resume

### Step 10.5 — Status bar indicator (stretch)
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
- `LICENSE` — MIT license
- `README.md` — Project overview, installation, usage, configuration, contributing
- `CONTRIBUTING.md` — Dev setup, testing, PR guidelines
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- `CHANGELOG.md` — Release history (Keep a Changelog format)
- `.github/ISSUE_TEMPLATE/` — Bug report and feature request templates
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist
- `.github/workflows/ci.yml` — CI pipeline (lint, build, test, Snyk scan)
- `.github/workflows/release.yml` — Publish to VS Code Marketplace + Open VSX on tag push

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
- **Open source (MIT):** The extension is developed and published as an open source project. Contributions welcome via GitHub PRs. Published to the VS Code Marketplace and Open VSX Registry.
- **Personal-use origin, community-maintained:** Started as a personal tool. No complex collaboration features like conflict resolution or merge strategies for `.chat/` files — sessions are append-only snapshots. Community contributions may expand scope over time.
- **Scope boundary — excluded:** No support for non-Copilot chats, no web UI, no cross-repo session syncing, no chat search/indexing.

---

## Risks & Mitigations

1. **Copilot internal format changes** — Implement a format version detector in `sessionReader.ts`. If unknown format, show a clear error message with the VS Code version and link to file an issue. Consider contributing a feature request to VS Code for a public chat export API.
2. **Large session files in repo** — Fully configurable via `save.maxFileSize` (split/truncate/warn), `save.stripToolOutput` (remove verbose tool output), and `save.maxSavedSessions` + `save.pruneAction` (archive/delete oldest). Defaults are conservative (1 MB max, no stripping, unlimited sessions).
3. **Chat participant context window limits on resume** — Fully configurable via `resume.maxTurns`, `resume.maxContextChars`, and `resume.overflowStrategy` (summarize/truncate/recent-only). Defaults target ~80K chars / 50 turns with summarization as the fallback.
4. **Open source maintenance burden** — Mitigated by clear contribution guidelines (`CONTRIBUTING.md`), issue templates, PR templates, and automated CI. Semantic versioning and a changelog keep releases predictable. The `CODEOWNERS` file can gate merges on maintainer review.
