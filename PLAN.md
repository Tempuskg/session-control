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
  1. Search `.chat/` folder for matching session file (fuzzy match on title/filename)
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
- Handle multi-root workspaces (save to the workspace folder of the active file)

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
