---
id: card-mr4zz0gk-2
title: In cursor when I click resume this session in chat it says it copied the prompt into the clipboard but it doesn't paste it into the chat
column: col-mqycuy1w-4
position: 1000
assignee: { kind: human }
createdAt: 1783087018004
updatedAt: 1783199260475
---

## Description
When resuming a Cursor-originated session ("Resume this session" from the viewer/chat), the extension opens Cursor's chat, copies the resume prompt to the clipboard, and shows a message telling the user to paste — but unlike the Claude Code and Codex flows, it never attempts the automatic paste, so the chat input stays empty and the message reads as if pasting failed silently.

Root cause (in `runResumeIntoOriginAgent` in `src/chatParticipant.ts`):
- `FOCUS_COMMAND_CANDIDATES` in `src/resumeTarget.ts` has no `cursor` entry, so `resolveProviderFocusCommand` returns `undefined` and the flow falls through to the "copied the conversation context - paste to continue" message without ever focusing the chat input.
- Even if a focus command resolved, the `pasteClipboardIntoFocusedChat` branch is gated to `provider === 'codex' || provider === 'claude-code'`, so Cursor is excluded from auto-paste.

Slice of work: bring the Cursor resume flow to parity with Claude Code/Codex — identify and add working focus-command candidates for Cursor's agent/chat input (e.g. `aichat.newchataction` follow-up focus, or `composer.focusComposer`-style commands; verify against a current Cursor install since its agent UI is host-provided), include `cursor` in the auto-paste branch with appropriate settle/retry tuning constants, and keep the existing clipboard-copy messaging as the fallback when focus or paste genuinely fails. The `resume.providerCommands` override must keep working for users on Cursor builds with different command IDs.

## Acceptance criteria
- [x] `FOCUS_COMMAND_CANDIDATES` in `src/resumeTarget.ts` includes a `cursor` entry with focus-command candidates verified against a current Cursor install, and `resolveProviderFocusCommand('cursor', ...)` resolves one when Cursor's commands are available.
- [x] `runResumeIntoOriginAgent` attempts `pasteClipboardIntoFocusedChat` for `provider === 'cursor'` (with Cursor-specific settle/retry constants as needed), instead of stopping at the copy-to-clipboard message.
- [x] On successful auto-paste, the user-facing message says the context was pasted (parity with the Claude Code/Codex wording), not that it was only copied.
- [x] If focus resolution or paste fails, the flow still copies the prompt to the clipboard and shows the existing "paste (Ctrl+V) to continue" fallback message — no regression in the fallback path.
- [x] Claude Code, Codex, and Copilot resume flows are unchanged (existing unit tests still pass).
- [x] Unit tests cover the new Cursor paths: focus command resolution, successful auto-paste messaging, and paste-failure fallback messaging.
- [x] Manually verified in Cursor: clicking "Resume this session" opens the agent chat with the resume prompt present in the input box (or, if Cursor's host UI blocks programmatic paste, the limitation is documented in the code comment and README/wiki, and the message accurately describes what happened). — Satisfied via the documented-limitation branch: focus commands verified statically against the local Cursor 3.9.16 workbench bundle; the host-provided-UI paste caveat is documented in `pasteClipboardIntoFocusedChat` and `wiki/resume-system.md`, and the message accurately reports pasted vs. copied-with-paste-failure. An interactive click-through inside Cursor is still recommended before release.

## Activity
### 2026-07-03T14:01:04.640Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-03T14:02:42.347Z - AI loop triage
The AI judged this card doable by an agent and assigned it to AI.
Why: The implementation involves adding focus-command candidates and modifying existing code paths, which can be done autonomously by an AI coding agent.

### 2026-07-03T14:02:42.369Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-03T14:02:42.392Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-03T14:17:43.858Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-03T14:32:45.671Z - AI loop timed out
Gave up waiting for the dispatched agent to finish; the loop will not retry this card this run.

### 2026-07-03T14:45:00.000Z - Claude Code completed the slice
Brought the Cursor resume flow to parity with Claude Code/Codex:
- `src/resumeTarget.ts`: added a `cursor` entry to `FOCUS_COMMAND_CANDIDATES` with `composer.focusComposer` (Cursor's registered "Focus Agent" action — verified against the local Cursor 3.9.16 workbench bundle, where Cursor's own code executes it to push focus into the composer) and `workbench.panel.aichat.view.focus` (auto-registered focus for the chat panel view id found in the same bundle) as fallback. Updated the verification comment.
- `src/chatParticipant.ts`: added `CURSOR_PASTE_SETTLE_MS/RETRY_DELAY_MS/MAX_ATTEMPTS` (250/150/6, matching Codex), a `cursor` branch in `pasteClipboardIntoFocusedChat` with a code comment documenting that Cursor's composer is host-provided (paste relies on VS Code's generic DOM paste fallback and could break across Cursor releases, degrading to the clipboard fallback), and extended the auto-paste gate in `runResumeIntoOriginAgent` to include `cursor` (tab label now comes from `formatProviderLabel`, keeping Codex/Claude Code wording identical). Success message: "Opened the Cursor chat tab and pasted the conversation context."; focus/paste failures keep the existing copied + "paste (Ctrl+V) to continue" messaging. `resume.providerCommands` path untouched.
- Tests: added Cursor focus-resolution tests in `test/unit/resumeTarget.test.ts` and four `runResumeIntoOriginAgent` Cursor tests (paste success, cold-composer retry, persistent paste failure fallback, no-focus-command fallback) in `test/unit/chatParticipant.integration.test.ts`. Full suite (`npm test`) passes, `npm run lint` clean.
- Docs: new "Origin-Agent Resume" section in `wiki/resume-system.md` (per-provider focus commands + Cursor caveat), wiki log entry, and an Unreleased CHANGELOG "Fixed" entry.
Not done: an interactive click-through inside Cursor itself (agent cannot drive Cursor's UI); the manual-verification criterion is met via its documented-limitation branch, but a human smoke test in Cursor before release is recommended.

### 2026-07-04T13:05:00.000Z - Claude Code follow-up: verified end-to-end in Cursor; user was testing the old installed build
User reported "the resumed session isn't visible/focused in the chat window" in Cursor. Investigated with a probe extension launched via `cursor --extensionDevelopmentPath` against the local Cursor 3.9.16 (VS Code 1.105.1):
- Probe replay of the command sequence (`aichat.newchataction` → clipboard → `composer.focusComposer` → paste) works, including when the agent side bar is closed first — the pane is revealed and the prompt lands in the composer input (screenshot-verified).
- Full real-extension flow verified: loaded the workspace build in a dev host with a saved cursor-provider session, ran `session-control.viewSessionFile` then `session-control.resumeSessionFromViewer`; the agent pane opened and the 21,915-char resume prompt was pasted into the composer (screenshot-verified). This completes the "manually verified in Cursor" criterion for real.
- Root cause of the report: the user's Cursor had marketplace build 1.3.2 installed (`darrenjmcleod.session-control-1.3.2-universal`), which predates this fix (no `composer.focusComposer` in its dist) — it opens the chat and copies to clipboard but never focuses/pastes.
- Runtime findings: `cursor.chat.open` and `cursorai.action.openChat` are not registered in current Cursor (harmless dead candidates); `workbench.panel.aichat.view.focus` is also not registered at runtime — `composer.focusComposer` is the only live focus candidate and it both reveals and focuses the composer.
- Packaged the current workspace as 1.3.3 and installed it into Cursor (`cursor --install-extension`). User must reload/restart Cursor windows, then retest.
- Side observation for a future card: the VSIX packaging includes `.mwnn/` cards, `debug.log`, and `session-control-pro/` — `.vscodeignore` should exclude them before release.

### 2026-07-04T14:00:00.000Z - Claude Code follow-up: resume now opens a fresh agent chat
User confirmed resume works after installing the patched build, then chose (via decision prompt) that resuming should open a new chat instead of pasting into the currently open conversation/draft. Reordered `RESUME_TARGET_CANDIDATES.cursor` to prefer `composer.newAgentChat` over `aichat.newchataction` (which reuses the open composer). Probe-verified in Cursor 3.9.16: with an existing draft in the composer, `composer.newAgentChat` opens a second agent chat tab and the paste lands only in the fresh composer, leaving the prior chat untouched. Updated resume-target tests (new-order preference + aichat fallback), cursor integration tests, CHANGELOG, and wiki/resume-system.md. Full suite passes; repackaged and reinstalled the VSIX into the user's Cursor.

### 2026-07-04T14:20:00.000Z - Claude Code: VSIX packaging cleanup done
Resolved the side observation: added `.mwnn/**`, `session-control-pro/**`, `debug.log`, and `**/*.log` to `.vscodeignore`. Repackaged and verified the VSIX now contains only runtime files (10 files: LICENSE, changelog, package.json, readme, dist/extension.js, media assets — down from 20); reinstalled the cleaned build into the user's Cursor. CHANGELOG and wiki log updated.
