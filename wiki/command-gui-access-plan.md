---
title: "Command GUI Access Plan"
type: analysis
created: 2026-10-04
updated: 2026-10-04
sources:
  - package.json
  - src/extension.ts
  - src/chatParticipant.ts
  - src/sessionExplorer.ts
  - src/pro/upgrade.ts
  - src/pro/loader.ts
tags:
  - ux
  - vscode-api
  - chat-participant
  - architecture
related:
  - wiki/chat-participant.md
  - wiki/file-manifest.md
  - wiki/configuration.md
---

# Command GUI Access Plan

This plan lists every Session Control command surface and decides which commands should get more GUI entry points. It covers analysis and planning only. No source, test, `package.json` or README changes come from this page. The follow-up items at the end are sized so that each one can become its own MWNN card.

Snapshot: `package.json` at version 1.6.0 on `main` (`f2c5ebe`), checked on 2026-10-04.

## Current surface model

- **Command palette.** VS Code shows every contributed command in the palette unless a `menus.commandPalette` entry hides it with `when`. Only four commands are hidden today (`when: "false"`): `analyzeSessionFromExplorer`, `reanalyzeSessionFromExplorer`, `harvestSessionFromExplorer` and `exportSessionToControlFile`. `upgradeToPro` appears only when `!session-control.hasProLicense`. Every other command appears in the palette, including the explorer-only and viewer-only ones.
- **`view/title`** on the `session-control.sessionExplorer` view (Saved Sessions):
  - Navigation icons: refresh, sort and Pro search.
  - Overflow group `gitSync`: Pro push and pull.
- **`editor/title`**:
  - `viewSessionFile` appears when a session JSON or JSONL file is active (`session-control.isSessionFile`).
  - Resume and continue appear when the Session Viewer webview is active.
- **`view/item/context`** on session tree items:
  - Inline actions: open, analyze or reanalyze (depending on `viewItem`), Pro harvest and delete.
  - Right-click: only Pro export, in group `pro@1`.
  - Workspace nodes (`session-control.workspace`) have no actions.
- **Status bar:** one item, the auto-save indicator. Clicking it runs `toggleAutoSave` (`src/extension.ts`, `createStatusBarItem`).
- **Keybindings:** none contributed.
- **Welcome / empty-view content:** none contributed (`viewsWelcome` is absent).
- **Chat:** `@session-control` declares `/resume`, `/list`, `/analyze` and `/implement`. The participant also accepts an undeclared `handoff` command (`PARTICIPANT_COMMANDS` in `src/chatParticipant.ts`), which routes to the implement flow. Slash-less prompts are routed by TypeSafe.
- **Pro gating:**
  - The `session-control-pro.*` commands are registered only by the companion package (`@tempuskg/session-control-pro`), which the extension loads through `src/pro/loader.ts`. License checks run inside each handler through the `hasProLicense` and `showUpgradePrompt` contract.
  - Core publishes one context key, `session-control.hasProLicense`.
  - No context key reports whether the companion package loaded. As a result, Pro `view/title` buttons (search, push, pull) and the Pro inline harvest action stay visible even when the package is missing. Clicking them then fails with "command not found". This was not checked at runtime here; a Development Host check on a build without Pro would confirm it.

> ⚠️ Note: `session-control.deleteSessionFromExplorer` is visible in the palette. Its handler (`runDeleteSessionFromExplorerCommand`) reads `item.label` without a guard, so running it from the palette with no tree item should throw a `TypeError`. Follow-up **F1** fixes this by hiding it from the palette.

## Inventory and classification

Surface column codes:

- **P** — palette
- **VT** — `view/title` (nav = navigation icon, ovf = overflow menu)
- **ET** — `editor/title`
- **TC** — tree context (inline = hover icon, ctx = right-click)
- **SB** — status bar
- **KB** — keybinding
- **Chat** — chat slash command

Classification values: **Add** = add GUI access, **Keep** = keep as-is, **Hide** = hide or de-emphasize.

### Core commands (`session-control.*`)

| # | Command | Title | Current surfaces | Class | Rationale |
|---|---|---|---|---|---|
| 1 | `saveSessionFromProvider` | Save Session... | P | **Add** | This is the main manual action, but it has no button. The Saved Sessions view should offer it as a title icon and as empty-view content. |
| 2 | `listSessions` | Browse Saved Sessions | P, Chat (`/list` equivalent) | Keep | The Saved Sessions view is already its GUI. The palette quick pick is the keyboard path. |
| 3 | `deleteSession` | Delete Saved Session | P | Keep | This is a palette quick-pick path. The tree already has per-item delete. |
| 4 | `refreshSessionExplorer` | Refresh Session Explorer | P, VT nav@1 | Keep | Already a title icon. It works from the palette. |
| 5 | `sortSessionExplorer` | Sort Saved Sessions... | P, VT nav@2 | Keep | Already a title icon. It works from the palette. |
| 6 | `openSessionFromExplorer` | Open Saved Session | P, TC inline@1, tree item click | **Hide** | Run without an item, it falls back to the same picker as `listSessions`, so its palette entry duplicates #2. |
| 7 | `viewSessionFile` | View Session | P, ET navigation | **Hide** | It only works when a session file is active. Its palette entry should be gated the same way as `editor/title`. |
| 8 | `resumeSessionFromViewer` | Resume This Session in Chat | P, ET navigation | **Hide** | Viewer-only. From the palette without a viewer it only shows "No session viewer is currently open". |
| 9 | `continueSessionWithProvider` | Continue This Session In... | P, ET navigation | **Hide** | Viewer-only, for the same reason as #8. |
| 10 | `analyzeSavedChats` | Analyze Saved Chats | P, Chat (`/analyze` equivalent) | **Add** | This is a primary workflow, but outside chat its only entry point is the palette. It already has an icon (`$(search-sparkle)`). |
| 11 | `implementLatestAnalysis` | Implement Latest Analysis | P, Chat (`/implement` equivalent) | **Add** | It is the next step after #10 and is also palette-only. It already has an icon (`$(sparkle)`). |
| 12 | `importCopilotSkillsToCursor` | Import Copilot Guidance as Cursor Skills | P | Keep | One-time setup that is rarely run. The palette is enough. |
| 13 | `importCopilotSkillsToCodex` | Import Copilot Guidance as Codex Skills | P | Keep | Same as #12. |
| 14 | `importCopilotSkillsToClaudeCode` | Import Copilot Guidance as Claude Code Skills | P | Keep | Same as #12. |
| 15 | `deleteSessionFromExplorer` | Delete Saved Session | P, TC inline@4 | **Hide** | It needs a tree item, so running it from the palette crashes (see the note above). It also duplicates #3's title. Also mirror it into the right-click menu (F3). |
| 16 | `analyzeSessionFromExplorer` | Analyze This Session | TC inline@2 (palette hidden) | Keep | Correctly scoped already. It gains a right-click mirror in F3. |
| 17 | `reanalyzeSessionFromExplorer` | Reanalyze This Session | TC inline@2 (palette hidden) | Keep | Same as #16. |
| 18 | `toggleAutoSave` | Toggle Auto-Save on Chat Response | P, SB click | Keep | The status bar item is already its GUI. |
| 19 | `diagnoseAutoSave` | Diagnose Auto-Save | P | **Add** | Users reach for it when the auto-save status looks wrong. It should be one click away from that indicator. |
| 20 | `cleanupOrphanedParts` | Clean Up Orphaned Session Part Files | P | **Add** (low) | This is maintenance for the Saved Sessions store. It fits in the view's overflow menu. |
| 21 | `setTypeSafeApiKey` | Set TypeSafe API Key | P | Keep | Credential setup. The palette is the conventional place for it. |
| 22 | `clearTypeSafeApiKey` | Clear TypeSafe API Key | P | Keep | Rare destructive credential action. Keeping it in the palette only is appropriate. |
| 23 | `upgradeToPro` | Get Session Control Pro | P (`!hasProLicense`) | **Add** | Purchase entry point. It should appear in the view's overflow menu while unlicensed, and nowhere once licensed. |
| 24 | `enterProLicenseKey` | Enter Pro License Key | P | **Add** | Buyers need to find it right after purchase, next to #23. |
| 25 | `clearProLicenseKey` | Clear Pro License Key | P | Keep | Rare destructive action. Palette only. |
| 26 | `showProLicenseStatus` | Show Pro License Status | P | Keep | Diagnostic. Palette only is fine. Consider it for the menu in F4 if support requests show demand. |

### Pro commands (`session-control-pro.*`, registered by the companion package)

| # | Command | Title | Current surfaces | Class | Rationale |
|---|---|---|---|---|---|
| 27 | `harvestKnowledge` | Harvest Knowledge to OKF Bundle | P | **Add** | A workspace-level Pro action with no GUI. It fits in the Saved Sessions overflow menu. |
| 28 | `harvestDocument` | Import and Harvest Word Document... | P | **Add** | Works on a file, so the natural entry point is the Explorer right-click menu on `.docx` files. |
| 29 | `harvestSessionFromExplorer` | Harvest This Session | TC inline@3 (palette hidden) | Keep | Correctly scoped. It only needs the Pro-loaded gate (F2) and a right-click mirror (F3). |
| 30 | `searchSessions` | Search Saved Sessions (All Workspaces) | P, VT nav@3 | Keep | Already a title icon. It only needs the Pro-loaded gate (F2). |
| 31 | `exportSessionToControlFile` | Export Session to AI Control File... | TC ctx `pro@1` (palette hidden) | Keep | Correctly scoped. It only needs the Pro-loaded gate (F2). |
| 32 | `syncAiSkills` | Sync AI Skills Across Assistants | P | **Add** (low) | A workspace-level Pro action with no GUI. Put it in the overflow menu next to #27. |
| 33 | `gitSyncPush` | Push Saved Sessions to Git | P, VT ovf `gitSync@1` | Keep | Already in the overflow menu. It only needs the Pro-loaded gate (F2). |
| 34 | `gitSyncPull` | Pull Saved Sessions from Git | P, VT ovf `gitSync@2` | Keep | Same as #33. |

### Chat slash commands (`@session-control`)

| Command | Current surfaces | Non-chat equivalent | Class | Rationale |
|---|---|---|---|---|
| `/resume` | Chat | Partial: Session Viewer "Resume This Session in Chat" (#8, editor title) | Keep | The viewer covers resuming one opened session. Picking from a list and resuming happens only in chat; F6 covers a tree-item path. |
| `/list` | Chat | Yes: `listSessions` (#2) and the Saved Sessions view | Keep | Fully covered outside chat. |
| `/analyze` | Chat, slash-less TypeSafe routing | Yes: `analyzeSavedChats` (#10), but palette only | Keep (add GUI via #10) | The GUI gap belongs to the command, not the slash command. |
| `/implement` | Chat, slash-less TypeSafe routing | Yes: `implementLatestAnalysis` (#11), but palette only | Keep (add GUI via #11) | Same as `/analyze`. |
| `handoff` (undeclared) | Chat only (typed or routed) | Same flow as `/implement` (#11) | Keep (de-emphasized) | An undeclared alias for `/implement`. Do not declare it, so the slash menu does not show two entries for one flow. |

## Chat-only workflows

No workflow is strictly chat-only. Every slash command maps to a contributed command:

- `/list` → `listSessions`
- `/analyze` → `analyzeSavedChats`
- `/implement` and `handoff` → `implementLatestAnalysis`
- `/resume` → the Session Viewer's resume action

There are two practical gaps:

1. **`/analyze` and `/implement`** have non-chat equivalents that only exist in the palette. Outside chat, users who never open the palette cannot find them. F1 adds them to the Saved Sessions view.
2. **`/resume` from a list** has no one-step GUI path. Today a user opens a session in the viewer and then clicks Resume. A tree-item "Resume in Chat" action would need a new command (F6).

Free-text, timeframe-scoped analysis is richer in chat, because the prompt text feeds `resolveSelection`. The command path calls the same resolver with an empty prompt, so it reaches the same flow.

## Proposed surfaces for "Add" commands

All `view/title` entries below use `when: view == session-control.sessionExplorer`. Overflow groups sort lexicographically, so the menu order is `2_analysis`, `3_autosave`, `4_knowledge`, `9_pro`, then the existing `gitSync`. Renaming `gitSync` to `5_gitSync` is optional; if it is renamed, include that in F4.

| # | Command | Proposed surface | `when` clause | Pro gating |
|---|---|---|---|---|
| 1 | `saveSessionFromProvider` | `view/title` `navigation@0` (needs a `$(save)` icon added to the contribution). Also a `viewsWelcome` button `[Save Session](command:session-control.saveSessionFromProvider)` on the empty view. | `view == session-control.sessionExplorer` | None |
| 10 | `analyzeSavedChats` | `view/title` overflow `2_analysis@1` (consider moving it to `navigation@4` if the overflow placement is undiscoverable in the smoke test) | `view == session-control.sessionExplorer` | None |
| 11 | `implementLatestAnalysis` | `view/title` overflow `2_analysis@2` | `view == session-control.sessionExplorer` (optional later: `&& session-control.hasAnalysis` once a context key exists) | None |
| 19 | `diagnoseAutoSave` | `view/title` overflow `3_autosave@2`, plus the status bar tooltip text "Click to toggle · run Diagnose Auto-Save from the Saved Sessions menu". F5 adds an optional status bar quick pick. | `view == session-control.sessionExplorer` | None |
| 20 | `cleanupOrphanedParts` | `view/title` overflow `3_autosave@3` | `view == session-control.sessionExplorer` | None |
| 23 | `upgradeToPro` | `view/title` overflow `9_pro@1`, plus a `viewsWelcome` line "Unlock search, Git sync and knowledge harvest — [Get Session Control Pro](command:session-control.upgradeToPro)" | `view == session-control.sessionExplorer && !session-control.hasProLicense` | Shown only while unlicensed |
| 24 | `enterProLicenseKey` | `view/title` overflow `9_pro@2` | `view == session-control.sessionExplorer && !session-control.hasProLicense` | Shown only while unlicensed |
| 27 | `harvestKnowledge` | `view/title` overflow `4_knowledge@1` | `view == session-control.sessionExplorer && session-control.proFeaturesLoaded` | Needs the new `proFeaturesLoaded` key (F2). The handler still enforces the license through `showUpgradePrompt`. |
| 28 | `harvestDocument` | `explorer/context` group `7_session-control@1` | `resourceExtname == .docx && session-control.proFeaturesLoaded` | Same as #27 |
| 32 | `syncAiSkills` | `view/title` overflow `4_knowledge@2` | `view == session-control.sessionExplorer && session-control.proFeaturesLoaded` | Same as #27 |

Pro buttons stay visible to unlicensed users when the companion package is loaded. That matches today's behavior, where the handler shows the upgrade prompt. They are hidden only when the package is missing, because the command would not exist.

## Proposed palette changes for "Hide" commands

| # | Command | `menus.commandPalette` change |
|---|---|---|
| 6 | `openSessionFromExplorer` | `when: "false"` |
| 7 | `viewSessionFile` | `when: "(resourceExtname == .json \|\| resourceExtname == .jsonl) && session-control.isSessionFile"` (same as `editor/title`) |
| 8 | `resumeSessionFromViewer` | `when: "activeWebviewPanelId == 'session-control.sessionViewer'"` |
| 9 | `continueSessionWithProvider` | `when: "activeWebviewPanelId == 'session-control.sessionViewer'"` |
| 15 | `deleteSessionFromExplorer` | `when: "false"` |

`openSessionFromExplorer` and `deleteSessionFromExplorer` are still invoked by tree clicks and inline icons. Hiding them from the palette does not affect those paths.

## Prioritized follow-up implementation items

Each item is scoped as one MWNN card. All of them touch `package.json` `contributes.menus` and possibly `contributes.viewsWelcome`. Per AGENTS.md, each item validates with `npm run compile-tests`, `npm run compile`, `npm test`, `npm run lint` and a Development Host smoke test of the menus. Each item defers README and wiki sync until that validation passes.

| Priority | ID | Item | Scope | Size | Depends on |
|---|---|---|---|---|---|
| P1 | **F1** | **Palette hygiene and analysis entry points** | Add the five `commandPalette` `when` clauses from the Hide table. Add `analyzeSavedChats` and `implementLatestAnalysis` to the Saved Sessions overflow (`2_analysis`). Add the `$(save)` icon to `saveSessionFromProvider` and place it at `navigation@0`. `package.json` only. | S | — |
| P1 | **F2** | **`session-control.proFeaturesLoaded` context key** | Have the core loader (`src/pro/loader.ts` and `activateProFeatures`) call `setContext('session-control.proFeaturesLoaded', true)` once the registrar loads, with a unit test. Add `&& session-control.proFeaturesLoaded` to the existing Pro `view/title` and `view/item/context` entries (search, push, pull, harvest, export). | S–M | — |
| P2 | **F3** | **Right-click mirrors for inline tree actions** | Add `view/item/context` non-inline entries for open (`1_open@1`), analyze and reanalyze (`2_analysis@1`), Pro harvest (`pro@2`) and delete (`9_delete@1`). Inline icons are hover-only and hard to reach by keyboard. `package.json` only. | S | F2 (for the harvest gate) |
| P2 | **F4** | **Pro and maintenance overflow entries** | Add `upgradeToPro` and `enterProLicenseKey` (`9_pro`, `!hasProLicense`), `harvestKnowledge` and `syncAiSkills` (`4_knowledge`, `proFeaturesLoaded`), and `diagnoseAutoSave` and `cleanupOrphanedParts` (`3_autosave`) to the Saved Sessions overflow menu. Add the `harvestDocument` `explorer/context` entry for `.docx` files. `package.json` only. | S | F2 |
| P3 | **F5** | **Welcome content for the empty Saved Sessions view** | Add `contributes.viewsWelcome` for `session-control.sessionExplorer`: Save Session button, a toggle auto-save link, and an upgrade link shown when `!session-control.hasProLicense`. Check whether the tree provider returns an empty root when there are no sessions, because welcome content only renders for an empty tree. | S–M | F1 |
| P3 | **F6** | **"Resume in Chat" tree action** | New command `session-control.resumeSessionFromExplorer` that reuses the viewer resume path for a tree item. Add it as an inline action, hidden from the palette, with unit tests. This closes the `/resume`-from-list GUI gap. | M | F3 |
| P4 | **F7** | **Status bar quick-pick menu (optional)** | Change the auto-save status bar click from a direct toggle to a quick pick: Toggle Auto-Save, Diagnose Auto-Save, Open Saved Sessions, Analyze Saved Chats. This needs a UX decision from a human first, because it changes established click behavior. | M | F4 |

## Related pages

- [Chat Participant](chat-participant.md) — slash command behavior
- [File Manifest](file-manifest.md) — command contributions by source file
- [Configuration](configuration.md) — auto-save settings behind the status bar item
