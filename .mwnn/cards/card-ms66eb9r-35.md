---
id: card-ms66eb9r-35
title: Document Cursor CLI and remote limitations
column: col-mqycuy1w-4
position: -29000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785449528605
dependsOn: [card-ms66eb9r-13, card-ms66eb9r-28]
---

## Description
Document Cursor CLI's fixture-verified versions and persistence contract together with VS Code profile and remote-workspace source-location limitations.

## Acceptance criteria
- [x] Cursor CLI documentation names only fixture-verified versions and paths and preserves its experimental boundary where the contract is not stable.
- [x] Profile, Remote SSH, dev-container, and WSL limitations explain where provider and extension-host storage can diverge.
- [x] Unsupported topologies are described as diagnostic limitations rather than silently reading unrelated paths.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-6/item-5::document-cursor-cli-and-remote-limitations`
Source item: Phase 6 item 5 — Document Cursor CLI's verified versions/path contract and remote-workspace limitations.

### 2026-07-30T21:03:11.064Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T21:03:11.288Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T21:50:17.437Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30 - Documented Cursor CLI and remote storage boundaries
Updated `README.md` with the two fixture-verified Cursor CLI builds, the verified UUID-named JSONL path and append-on-resume contract, and an explicit experimental boundary for the undocumented persistence format. Added active-profile, Remote SSH, dev-container, and WSL guidance explaining extension-host versus provider storage, including fail-closed diagnostic behavior for unsupported mixed-host topologies. Verified the README with `git diff --check -- README.md` and a fixture-to-documentation assertion that reconciles the documented Cursor versions with `test/fixtures/cursor-cli/verified-session/contract.json`.

STATUS: DONE

### 2026-07-30T22:10:34.517Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T22:10:34.692Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
