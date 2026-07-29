---
id: card-ms1vnrbi-2
title: in saved sessions show which sessions have been analyzed
column: col-mqycuy1w-4
position: 0
assignee: { kind: human }
createdAt: 1785075158286
updatedAt: 1785078045731
---

## Description
The Saved Sessions tree view (`SessionExplorerProvider` in `src/sessionExplorer.ts`) currently shows every saved session identically — there is no way to tell which sessions have already been included in a chat-analysis report and which still need analysis. The analysis store already records analyzed sessions in `<storageDirectory>/analysis/index.json` (`analyzedSessions` entries with `sessionId`, `rootFileName`, `fingerprint`, `analyzedAt`, and `reportPath`), so the data exists; it just isn't surfaced in the tree.

Add a per-session "analyzed" indicator to the Saved Sessions view: when rendering each `SessionExplorerSessionItem`, match the session against the workspace's analysis index (by `sessionId` and/or `rootFileName` — matching must not require reading full session bodies during tree render) and visually distinguish analyzed sessions, e.g. a distinct icon or a suffix in the item description, with the analyzed date in the tooltip. Sessions with no analysis index present render unchanged. The tree must reflect a newly completed analysis after its existing refresh triggers (visibility change or explicit refresh) without requiring a window reload.

## Acceptance criteria
- [x] A session whose entry exists in the workspace's `analysis/index.json` renders in the Saved Sessions view with a visible "analyzed" indicator (icon and/or description text) that distinguishes it from unanalyzed sessions.
- [x] The tooltip of an analyzed session item includes when it was analyzed (from the index entry's `analyzedAt`).
- [x] A session with no matching index entry renders exactly as today (no indicator, no behavior change).
- [x] A workspace with no `analysis/` directory or an unreadable/invalid index renders the tree without errors and without indicators (graceful fallback, no thrown error surfaced to the user).
- [x] Determining analyzed status reads only the analysis index — it does not load full session JSON bodies per tree item.
- [x] After an analysis run records new sessions, a tree refresh (existing visibility-change or manual refresh path) shows the new indicators without reloading the window.
- [x] Multi-workspace layouts resolve analyzed status per workspace storage directory — a session analyzed in workspace A does not show as analyzed in workspace B.
- [x] Unit tests cover: analyzed session gets the indicator, unanalyzed session does not, missing/invalid index falls back cleanly, and multi-part saves (session files sharing a `rootFileName`) are matched consistently.
- [x] Existing test suite passes (`npm test`).

## Activity
### 2026-07-26T14:19:51.894Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-26T14:24:34.864Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-26T14:32:00.000Z - Implemented by Claude Code
Added the per-session analyzed indicator to the Saved Sessions view in `src/sessionExplorer.ts`:
- New exported `readAnalysisIndexForExplorer(storageDirectory)` reads `<storage>/analysis/index.json` read-only (no directory creation) and returns `null` on missing, unreadable, or schema-invalid indexes — graceful fallback with no error surfaced.
- New exported `findAnalyzedEntry(entries, session)` matches index entries by `sessionId` (part files of a split session share one id, so multi-part saves stay consistent) or by `rootFileName`, preferring the entry with the latest `analyzedAt` when several match.
- `SessionExplorerGroup` now carries `analyzedSessions` from the per-workspace index (loaded in `listSessionExplorerGroups` alongside `listSessions`, so multi-root workspaces resolve status per storage directory and every existing refresh trigger re-reads the index). `SessionExplorerSessionItem` renders analyzed sessions with a `· analyzed` description suffix, a `charts.green`-tinted `comment-discussion` icon, and `Analyzed: <analyzedAt>` in the tooltip; unanalyzed sessions keep the exact prior rendering. No full session bodies are read for status.
- Tests: seven new cases in `test/unit/sessionExplorer.test.ts` (indicator present/absent, missing/null index, multi-part shared id, per-workspace isolation, matcher behavior, and real-filesystem reader tests for missing/invalid/valid index files); `test/unit/extensionDeleteFlow.test.ts` updated for the new group field. `CHANGELOG.md` updated under Unreleased.
- Verification: `npm run compile-tests`, `npm run lint`, `npm run compile`, and `npm test` all pass (272 passing).
STATUS: DONE

### 2026-07-26T15:05:00.000Z - Follow-up: composable analyzed/harvested badges (Claude Code)
Per user feedback, an icon color alone cannot express the analyzed/harvested combinations, so the indicator was reworked into composable text badges. The item description now reads `<n> turns · analyzed`, `<n> turns · harvested`, or `<n> turns · analyzed · harvested`, with `Analyzed:`/`Harvested:` dated lines in the tooltip; the icon stays plain. Harvested status is read read-only from Session Control Pro's `<storage>/harvest/index.json` (new minimal `HarvestIndex` types/guards in `src/types.ts`, `readHarvestIndexForExplorer` + `findHarvestedEntry` in `src/sessionExplorer.ts`, matched by `sessionId`, same graceful-null fallback and per-workspace resolution as the analysis index). Tests extended (`npm test`: 276 passing); lint and webpack build pass.
STATUS: DONE

### 2026-07-26T15:20:00.000Z - Follow-up: glanceable per-state icons (Claude Code)
Added distinct icon shapes per state combination on top of the text badges: plain `comment-discussion` (untouched), green `graph` (analyzed), orange `book` (harvested), purple `library` (analyzed + harvested). Shape carries the distinction; the tint is secondary reinforcement, so combinations stay unambiguous without color. Icon-id assertions added to the analyzed/harvested/both tests. `npm run compile-tests`, `npm run lint`, `npm run compile`, and `npm test` (276 passing) all pass.
STATUS: DONE
