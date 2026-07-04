# Session Control — Marketplace Screenshots Capture Brief

This folder ships **inside the VSIX** so screenshots that the listing README references resolve
on both Open VSX and the VS Code Marketplace. The README markup is already in place (see
`README.md` → `## Screenshots`). The files below are what the human owner needs to capture and
commit.

> **Status:** ✅ Complete (2026-07-04). All five assets are captured and committed, the
> `screenshots:pending` markers were removed from the top-level `README.md`, and the visuals
> ship with v1.3.4. This brief is kept for reference when re-capturing after UI changes.

## Required files

Place all files in this folder (`media/screenshots/`). Filenames are case-sensitive on Open VSX
CDNs and must match the README markup exactly.

| File | Type | Dimensions (target) | Max size | Purpose |
| :-- | :-- | :-- | :-- | :-- |
| `demo.gif` | Animated GIF | 1280×800 (or 1600×1000) | ≤ 5 MB | Hero animation: save → browse → resume in one ~12-second loop |
| `save-session.png` | PNG | 1280×800 | ≤ 400 KB | Command Palette running *Save Current Chat Session* with a `.chat/*.json` visible in the explorer |
| `resume-session.png` | PNG | 1280×800 | ≤ 400 KB | VS Code Chat showing `@session-control /resume <name>` selected, with the participant's resume confirmation |
| `session-explorer.png` | PNG | 1280×800 | ≤ 400 KB | Session Control activity bar view showing saved sessions grouped by workspace folder |
| `provider-picker.png` | PNG | 1280×800 | ≤ 400 KB | *Save Session From Provider…* quick pick offering Copilot / Cursor / Codex / Claude Code |

If the editor window can be sized to 1600×1000 retina-clean, prefer that — Open VSX and VS
Marketplace both downscale gracefully. Hard upper limit per VS Marketplace policy is 1MB per
static image and 5MB for animated GIFs; staying under the targets above keeps install size
sensible.

## Pre-capture checklist (do once before any shot)

1. **Pick a clean demo workspace.** A small repo with 1–2 saved sessions already in `.chat/`.
   Sessions with concrete-looking titles read better than `untitled-1`. Suggested titles:
   - `refactor-auth-middleware`
   - `cursor-debug-loop`
   - `claude-skill-import-fix`
2. **VS Code window setup:**
   - Theme: **Dark+** (default dark). Forks render best in dark on a dark Open VSX page.
   - Zoom: `editor.zoomLevel: 1` so command-palette text is readable when downscaled.
   - Hide the minimap (`"editor.minimap.enabled": false`) for the explorer / chat shots.
   - Hide breadcrumbs and the status bar tray on non-Session-Control items where possible.
   - Workspace name should be a generic short name (no client / employer in the title bar).
3. **Crop / safe-area:** keep the Session Control surface in the **left two-thirds** of the
   frame so the hover captions in the README pair cleanly when displayed side-by-side.
4. **Privacy sweep before commit:**
   - Title bar must not show a private path (rename the folder for the capture or shoot it
     inside a temp folder).
   - No tokens, license keys, secrets, or email addresses anywhere in chat output, terminal,
     or the file tree.
   - Avoid showing real OS usernames in `C:\Users\…` — either capture inside a folder near the
     drive root or blur post-shot.
5. **GIF tooling:** ScreenToGif (Windows, free) is the lowest-friction option. Target 15 fps,
   palette 128 colors, dithering off. Trim aggressive idle frames to keep size under 5 MB.

## Per-shot scripts

### `demo.gif` (≤ 12 s, the hero loop)

Single loop, no audio. Recommended beats:

1. (0.0–2.0 s) VS Code Chat with a Copilot answer visible. Cursor focus on the **Save Current
   Chat Session** command in the palette. Trigger it.
2. (2.0–4.0 s) Briefly show the new `.chat/<slug>.json` appearing in the explorer tree.
3. (4.0–7.0 s) Open the Session Control activity bar view and click one entry. Show the saved
   session preview opening.
4. (7.0–10.0 s) Open the chat panel, type `@session-control /resume <slug>`, hit Enter.
5. (10.0–12.0 s) Show the participant's "Loaded N turns" confirmation, then loop.

### `save-session.png`

Frame the Command Palette mid-typing on `Session Control: Save Current Chat Session`. Leave
the file explorer open on the left so a fresh `.chat/<slug>.json` is visible in the tree.

### `resume-session.png`

Chat panel selected. Show `@session-control /resume cursor-debug-loop` typed in the input box,
caret active. If you can include the prior turn or the participant's `Loaded N turns from
<title>.` confirmation immediately above, even better.

### `session-explorer.png`

Activity bar **Session Control** view focused. Expand at least one workspace folder so two or
three sessions are visible. Hover one row so the inline action icons (open, resume, delete)
render — this signals interactivity better than a static row.

### `provider-picker.png`

Run **Session Control: Save Session From Provider…** and capture the four-option quick pick.
Cursor / Claude Code / Codex / Copilot should all be visible. Highlight Cursor or Claude Code
(not Copilot) — the listing is targeted at the Open VSX audience that uses those forks.

## After capture

1. Commit the five files to `media/screenshots/`. No size-related `.vscodeignore` rule is
   needed; `media/**` already ships in the VSIX (`.vscodeignore` only excludes source, tests,
   wiki, and dev metadata).
2. In the top-level `README.md` → `## Screenshots`, **delete the two `screenshots:pending`
   marker lines** that wrap the image block. They are the opening `<!-- screenshots:pending …`
   and the trailing `screenshots:pending -->`. Removing both makes the staged markup live.
3. Cut a patch release (`npm version 1.3.4 --no-git-tag-version` → push the `v*` tag) so the
   same VSIX that publishes to VS Marketplace and Open VSX includes the bundled assets. The
   listing pages pull the README images via the absolute `raw.githubusercontent.com/.../main/`
   URLs in `README.md`, so they resolve as soon as the commits land on `main` — but the release
   tag is the trigger you want for any text changes anyway.
4. Spot-check both listings: <https://open-vsx.org/extension/darrenjmcleod/session-control> and
   <https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control>.
5. Sign off the Step 2 row in `wiki/open-vsx-listing.md` → §4 approval checklist.

## Files currently present in this folder

All five image assets are checked in alongside this brief: `demo.gif` (~2.4 MB),
`save-session.png`, `resume-session.png`, `session-explorer.png`, and `provider-picker.png`
(each well under the 400 KB static-image target). They are referenced from the top-level
`README.md` `## Screenshots` section and render on the Open VSX and VS Marketplace listing
pages as of v1.3.4.
