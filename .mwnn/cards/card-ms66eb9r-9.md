---
id: card-ms66eb9r-9
title: Inject auto-save controller dependencies
column: col-mqycuy1w-4
position: -10000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785415151039
dependsOn: [card-ms66eb9r-6]
---

## Description
Make controller scheduling, hashing, source reads, storage writes, and user notifications dependency-injected so timing and failure paths are deterministic in tests.

## Acceptance criteria
- [x] Scheduling, hashing, source reads, storage, and notifications can be replaced in focused tests.
- [x] Optional dependencies follow strict optional-property typing and are omitted rather than passed as `undefined`.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-1/item-4::inject-auto-save-controller-dependencies`
Source item: Phase 1 item 4 — Make scheduling, hashing, source reads, storage, and notifications dependency-injected for tests.

### 2026-07-30T03:47:39.781Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T03:47:40.218Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T04:00:56.438Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T06:34:10.279-06:00 - Auto-save controller dependencies injected
Added an injected SHA-256 hashing seam to the controller checkpoint flow while preserving the current turn-count behavior and leaving semantic revision content to its later card. Focused controller tests now replace and observe scheduling, hashing, source reads, storage writes and cleanup, logging, and warning notifications. Optional dependency overrides remain omitted when absent and compile under exact optional-property typing.

`npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The cached VS Code 1.93 extension-host run passed 302 tests, including both focused controller tests; its sole failure is the pre-existing Copilot CLI watcher regression owned by `card-ms66eb9r-4`.

STATUS: DONE

### 2026-07-30T12:34:22.562Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T12:34:22.808Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
