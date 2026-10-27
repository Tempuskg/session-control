---
type: Reference
title: Export Session to AI Control File Command Implementation Details
description: Details on implementing the export session command for AI control files.
tags: [export, session, ai, control, command]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/1bff48ed-e135-435c-9bae-7e0e5bfe3425.md
source_commits: [213c52b]
provider: claude-code
confidence: 0.8
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:25c7416ea729c6b1dea38b1613455181392a4c66133b24dc7ec7733c42b47caf"
---
The private Pro package now registers `session-control-pro.exportSessionToControlFile`, which turns one saved session into a reusable AI control file (`.cursor/rules/<slug>.mdc`, `.claude/skills/<slug>/SKILL.md`, `.github/instructions/<slug>.instructions.md`, or an `AGENTS.md` section). It is Phase 3B slot 2 of the monetization plan and it is implemented, tested, and gated by `hasProLicense()` on the Pro side.

The command is invisible until this repo contributes it. The Pro package cannot declare `contributes` — its own `packageBoundary` test asserts it has no `contributes`, `activationEvents`, or `publisher` key — so the command title and every menu entry live here, exactly as they already do for `session-control-pro.harvestSessionFromExplorer`.

**What to add to `package.json`:**

1. `contributes.commands` — a new entry next to the other Pro commands (around line 200):
   `session-control-pro.exportSessionToControlFile`, title `Export Session to AI Control File`, category `Session Control Pro`, and an icon only if it goes inline.
2. `contributes.menus.commandPalette` — the same entry with `"when": "false"`. The command needs a saved-session row argument; invoked bare from the palette it can only show its guidance message, which is what `harvestSessionFromExplorer` already does.
3. `contributes.menus["view/item/context"]` — a Saved Sessions row entry with `"when": "view == session-control.sessionExplorer && viewItem =~ /^session-control\\.session/"`. Prefer a non-inline group (the first one in this view; e.g. `"group": "1_export@1"`). The row already carries four inline icons (open, analyze/reanalyze, harvest, delete) and a fifth crowds it. Inline is the alternative if the owner would rather have one-click export.

**`contextValue` and the `when` clause — resolved on the Pro side (2026-09-18).** An analyzed session row has `contextValue === 'session-control.session.analyzed'` (`src/sessionExplorer.ts:249`), while the Pro package's `resolveSavedSessionHarvestInvocation` matched `'session-control.session'` with strict equality. The existing harvest entry's regex `when` therefore showed **Harvest This Session** on analyzed rows where the handler refused it. The Pro package now accepts the whole `session-control.session*` family, which fixes harvest and admits the new export, so the regex `when` clause above is the correct one to copy. This needs the same Pro release as the export command; on an older Pro build, exporting from an analyzed row still refuses.

**Also needs doing here:**

- Bump `@tempuskg/session-control-pro` to a release that contains the command. Done: the repo now pins `^0.5.0`, and the installed 0.5.0 contains both the command and the widened `contextValue` match. This card is no longer blocked; only the manifest, test and changelog work remains.
- Extend the manifest assertions in `test/unit/sessionExplorer.test.ts` (the `inline session actions use compact icons and keep delete rightmost` test reads `contributes.commands` and `view/item/context`) to cover the new contribution.
- `CHANGELOG.md` entry for the release that ships it.
- `wiki/open-vsx-listing.md` §3.6.3 already flags that Pro commands are undocumented on the marketplace listing. That copy is human-owned; do not draft it here, just do not make the gap bigger silently.

# Citations
1. [Session 1bff48ed-e135-435c-9bae-7e0e5bfe3425](../sessions/1bff48ed-e135-435c-9bae-7e0e5bfe3425.md)
