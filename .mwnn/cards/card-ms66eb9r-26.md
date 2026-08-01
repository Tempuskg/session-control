---
id: card-ms66eb9r-26
title: Add all-provider auto-save settings
column: col-mqycuy1w-4
position: -23000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785438648129
dependsOn: [card-ms66eb9r-10, card-ms66eb9r-11, card-ms66eb9r-12, card-ms66eb9r-13]
---

## Description
Add `session-control.autoSave.providers` and the GitHub Copilot CLI home override while keeping the existing workspace-scoped enable switch.

## Acceptance criteria
- [x] Enabled auto-save defaults to all four saved provider values without host-based exclusion.
- [x] Copilot CLI home resolution honors configured override, `COPILOT_HOME`, then `~/.copilot`.
- [x] `session-control.save.provider` remains a manual provider preference and no longer silently narrows auto-save.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-5/item-1::add-all-provider-auto-save-settings`
Source item: Phase 5 item 1 — Add all-provider auto-save configuration and Copilot CLI home configuration.

### 2026-07-30T14:42:01.146Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T14:42:02.484Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T17:35:59.988Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T12:59:41.2606799-06:00 - Added all-provider auto-save settings
Added resource-scoped `session-control.autoSave.providers` with all four providers as the default and `session-control.copilot.homePath` with configured, `COPILOT_HOME`, then `~/.copilot` resolution. Auto-save provider resolution and lifecycle reloads now use only the dedicated auto-save setting, while `session-control.save.provider` remains a manual preference. Added manifest, resolver, lifecycle, and all-provider listener coverage.

Validation passed: `npm run compile-tests`, `npm run compile`, the cached VS Code 1.93 `npm test` run (344 passing), `npm run lint`, package JSON parsing, and `git diff --check`.

STATUS: DONE

### 2026-07-30T19:00:04.623Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T19:00:04.851Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
