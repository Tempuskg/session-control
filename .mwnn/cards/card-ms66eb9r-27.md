---
id: card-ms66eb9r-27
title: Migrate legacy provider override semantics
column: col-mqycuy1w-4
position: -27000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785447691495
dependsOn: [card-ms66eb9r-26]
---

## Description
If legacy explicit provider behavior must be retained, migrate it once into the new auto-save provider array instead of maintaining two sources of truth.

## Acceptance criteria
- [x] Legacy auto-save provider intent is migrated at most once into `autoSave.providers`.
- [x] No competing runtime auto-save provider selection remains.
- [x] Migration never enables auto-save globally or for a workspace where it was disabled.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-5/item-2::migrate-legacy-provider-override-semantics`
Source item: Phase 5 item 2 — Migrate legacy provider override semantics.

### 2026-07-30T19:10:49.025Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T19:10:49.557Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T21:22:55.049Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T15:40:07-06:00 - Migrated legacy provider override semantics
Added an activation-time, scope-preserving migration that copies an effective legacy provider into `autoSave.providers` only for workspaces whose auto-save switch is already enabled. A durable scope marker prevents repeat migration, explicit new provider arrays remain authoritative, and migration completes before auto-save controllers start. Removed the obsolete runtime `getSaveProvider` dependency so auto-save selection comes only from `autoSave.providers`.

Validation passed: `npm run compile-tests`, `npm run compile`, the cached VS Code 1.93 `npm test` run (351 passing), `npm run lint`, the stale-reference sweep, and `git diff --check`.

STATUS: DONE

### 2026-07-30T21:40:20.765Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T21:40:20.989Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
