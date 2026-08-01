---
id: card-ms66eb9r-32
title: Update the unreleased changelog
column: col-mqycuy1w-4
position: -35000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785456347649
dependsOn: [card-ms66eb9r-14, card-ms66eb9r-20, card-ms66eb9r-25, card-ms66eb9r-27, card-ms66eb9r-28, card-ms66eb9r-29, card-ms66eb9r-30]
---

## Description
Update `CHANGELOG.md` under `[Unreleased]` after the implemented auto-save surface has passed a targeted validation step.

## Acceptance criteria
- [x] The Unreleased entry accurately summarizes supported sources, reliability, upsert, settings, diagnostics, and privacy changes.
- [x] The entry does not claim unsupported Cursor, profile, or remote behavior.
- [x] At least one targeted validation for the changed surface is green before the changelog update.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-6/item-2::update-the-unreleased-changelog`
Source item: Phase 6 item 2 — Update `CHANGELOG.md` under `[Unreleased]`.

### 2026-07-30T23:41:32.867Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T23:41:33.547Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T23:41:34.813Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T23:45:03.425Z - Codex completed the unreleased changelog
Expanded `[Unreleased]` with the implemented local auto-save source matrix, reliability and recovery behavior, durable atomic upserts, provider settings and migration, metadata-only diagnostics, privacy opt-in, and explicit Cursor/profile/remote boundaries.

Validation: `npm run compile-tests`; `npm test` (365 passing, including the auto-save controller, adapters, workspace manager, diagnostics, privacy, upsert, and Explorer refresh coverage); `git diff --check -- CHANGELOG.md`; and a line-numbered re-read of the edited Unreleased section.

STATUS: DONE

### 2026-07-30T23:45:16.332Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T23:45:16.696Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
