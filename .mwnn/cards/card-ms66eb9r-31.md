---
id: card-ms66eb9r-31
title: Document VS Code and CLI Copilot auto-save
column: col-mqycuy1w-4
position: -25000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785446194596
dependsOn: [card-ms66eb9r-10, card-ms66eb9r-11, card-ms66eb9r-14]
---

## Description
Update `README.md` with separate setup, source, project-matching, and diagnostic guidance for VS Code Copilot Chat and GitHub Copilot CLI.

## Acceptance criteria
- [x] README guidance clearly distinguishes the two Copilot acquisition sources and their path/configuration behavior.
- [x] The documented promise matches the implemented project-scoped auto-save behavior and limitations.
- [x] At least one targeted validation for the documented surface is green before the README changes are finalized.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-6/item-1::document-vscode-and-cli-copilot-auto-save`
Source item: Phase 6 item 1 — Update `README.md` with separate VS Code Copilot and Copilot CLI instructions.

### 2026-07-30T16:37:47.917Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T16:37:48.174Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T20:09:07.452Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30 - Documented VS Code and CLI Copilot auto-save
Updated `README.md` with workspace-scoped setup, independent `copilot-vscode` and `copilot-cli` acquisition paths, project-matching rules, timing and restart limitations, and metadata-safe diagnostic guidance. Corrected the configuration reference so `session-control.save.provider` is explicitly manual-only and documented `session-control.copilot.homePath` plus `session-control.autoSave.providers`.

Targeted validation passed: `git diff --check -- README.md`. The final README diff was also reviewed against `package.json`, `src/extension.ts`, `src/copilotWorkspaceStore.ts`, `src/copilotCliSessionReader.ts`, and `src/autoSaveController.ts`.

STATUS: DONE

### 2026-07-30T21:11:01.268Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T21:11:01.500Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
