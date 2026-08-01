---
id: card-ms66eb9r-18
title: Settle and retry active provider writes
column: col-mqycuy1w-4
position: -17000
assignee: { kind: human }
createdAt: 1785335058063
updatedAt: 1785424595919
dependsOn: [card-ms66eb9r-6, card-ms66eb9r-9]
---

## Description
Debounce provider event bursts, wait for stable source revisions, and retry recognized incomplete JSON or JSONL writes before saving settled content.

## Acceptance criteria
- [x] Source content is stable across bounded reads before it is saved.
- [x] Recognized incomplete JSON/JSONL failures retry with bounded backoff.
- [x] An event arriving during a save schedules one trailing reconciliation.
- [x] A normally completed local response is saved within the 15-second target.

## Activity
### 2026-07-29 - Imported from project chat auto-save plan
Import key: `e:/chat-commit/project_chat_autosave_plan.md::implementation-phases/phase-3/item-4::settle-and-retry-active-provider-writes`
Source item: Phase 3 item 4 — Add settle/retry behavior for streaming and atomic provider writes.

### 2026-07-30T12:39:14.903Z - AI loop advanced this card
Moved to "Ready".

### 2026-07-30T12:39:16.718Z - AI loop advanced this card
Moved to "In Progress".

### 2026-07-30T14:51:11.044Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-30T15:07:00.000Z - Settled and retried active provider writes
Added bounded revision settlement before saves, finite backoff for recognized incomplete JSON/JSONL reads, and serialized per-source reconciliation with one coalesced trailing pass for events received during a save. Provider candidates now carry stable source revisions, with a deterministic normalized-session fallback, and the production 5-second debounce plus 250 ms settle read saves a normal response at 5.25 seconds in the fake-clock test.

Added focused controller coverage for changing, stable, and never-settling revisions; incomplete JSONL recovery; trailing reconciliation; and the 15-second target. `npm run compile-tests`, `npm run compile`, and `npm run lint` passed. The cached VS Code 1.93 extension-host run passed all 331 tests; the first installed-host attempt was blocked before test execution by VS Code's updater mutex.

STATUS: DONE

### 2026-07-30T15:08:26.602Z - AI loop advanced this card
Moved to "Verify".

### 2026-07-30T15:08:26.913Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
