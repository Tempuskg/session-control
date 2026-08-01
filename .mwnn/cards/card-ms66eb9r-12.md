---
id: card-ms66eb9r-12
title: Add strict revisions to Codex and Claude sources
column: col-mqycuy1w-4
position: -14000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785420936761
dependsOn: [card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Adapt the existing Codex CLI and Claude Code readers to emit stable content revisions and require positive project ownership for unattended auto-save.

## Acceptance criteria
- [x] Both readers emit stable source revisions derived from transcript content.
- [x] Ambiguous or mismatched `cwd` sessions are skipped instead of falling back to all sessions.
- [x] Claude sidechain/subagent exclusions and existing supported path overrides remain intact.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-2/item-3::add-strict-revisions-to-codex-and-claude-sources`
Source item: Phase 2 item 3 — Adapt Codex and Claude Code readers to emit stable revisions and strict project matches.

### 2026-07-30T12:39:14.061Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:15.943Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T13:35:51.151Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T08:01:00.971-06:00 - Added strict Codex and Claude source revisions
Added line-ending-normalized, dependency-injected SHA-256 `sourceRevision` values to both transcript readers. Unattended auto-save now requires an overlapping `cwd` for Codex and Claude Code, while manual imports remain unchanged.

Preserved configured provider home paths plus Claude Code sidechain and subagent exclusions. `npm run compile-tests`, `npm run compile`, and `npm run lint` passed; the repository-supported extension-host suite passed all 321 tests against cached VS Code 1.93.

STATUS: DONE

### 2026-07-30T14:01:17.586Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T14:01:17.791Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
