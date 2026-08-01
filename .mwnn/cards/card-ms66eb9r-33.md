---
id: card-ms66eb9r-33
title: Align PLAN.md with the shipping auto-save scope
column: col-mqycuy1w-4
position: -36000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785466225954
dependsOn: [card-ms66eb9r-14, card-ms66eb9r-20, card-ms66eb9r-25, card-ms66eb9r-27, card-ms66eb9r-28, card-ms66eb9r-29, card-ms66eb9r-30]
---

## Description
Update `PLAN.md` so its scope boundary and auto-save description match the implemented all-source, project-scoped shipping behavior.

## Acceptance criteria
- [x] Old non-Copilot or host-selected auto-save statements no longer contradict the implemented source matrix.
- [x] The plan continues to describe one customer-facing `session-control` extension install.
- [x] At least one targeted validation for the implemented surface is green before synchronization.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-6/item-3::align-plan-md-with-the-shipping-auto-save-scope`
Source item: Phase 6 item 3 — Update `PLAN.md` so its old non-Copilot scope boundary and auto-save description no longer contradict the shipping product.

### 2026-07-30T23:41:33.088Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T23:41:33.760Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T23:45:17.549Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30 - Completed by Codex
Updated `PLAN.md` to describe opt-in, workspace-scoped auto-save across VS Code Copilot Chat, GitHub Copilot CLI, Codex CLI, Claude Code, and Cursor CLI; removed the obsolete commit-triggered, host-selected, and non-Copilot exclusions; documented durable per-project controllers/upserts and source-failure isolation; and preserved the single customer-facing `session-control` extension install. Before synchronizing the plan, `npm test` completed successfully with 365 passing tests, including the all-provider/no-host-exclusion and per-workspace controller cases. Final `git diff --check -- PLAN.md` and the focused PLAN scope validation also passed.

STATUS: DONE

### 2026-07-31T00:12:31.409Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-31T00:12:31.746Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
