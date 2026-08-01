---
id: card-ms66eb9r-11
title: Harden VS Code Copilot source validation
column: col-mqycuy1w-4
position: -13000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785419367398
dependsOn: [card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Harden VS Code Copilot workspace-store location, validation, project routing, format handling, and diagnostic reporting.

## Acceptance criteria
- [x] The resolved workspace store is validated before use and reported in diagnostics.
- [x] Single-root, multi-root, profile, and remote-host behavior is explicitly tested or reported as unsupported.
- [x] Ambiguous workspace ownership fails closed instead of following the active editor.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-2/item-2::harden-vscode-copilot-source-validation`
Source item: Phase 2 item 2 — Harden VS Code Copilot workspace-store validation and diagnostics.

### 2026-07-30T12:39:13.821Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:15.702Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T13:16:12.091Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T07:35:37.209-06:00 - Hardened VS Code Copilot workspace-store validation
Added a fail-closed locator that validates local `workspaceStorage/<workspace-id>` ownership and directory shape before creating the VS Code Copilot watcher. Diagnostics now retain the resolved store and `chatSessions` paths, validation status/reason, workspace/host/profile modes, path existence, and supported JSON/JSONL formats. Single-root, multi-root ambiguity, named profiles, remote-host rejection, invalid layouts, and missing store directories are covered by focused tests; the extension-host suite passed 318 tests, and compile plus lint passed.

STATUS: DONE

### 2026-07-30T13:35:50.036Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T13:35:50.243Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
