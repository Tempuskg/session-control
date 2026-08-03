---
title: "Open VSX Listing — Audit & Rewrite"
type: reference
created: 2026-06-28
updated: 2026-08-02
status: Step 1 + Step 2 shipped in v1.3.4; Step 3 (overview restructure) drafted 2026-08-02, awaiting release
---

# Open VSX Listing — Audit & Rewrite

The listing is rendered from the public `session-control` repo (`e:\chat-commit`) — Open VSX
pulls `README.md` for the body and `package.json` `description` / `keywords` for the search
surface. This document is the agent draft; the human owner approves and ships via the existing
release flow (tag push → `release.yml` publishes the same VSIX to VS Marketplace and Open VSX).

---

## 1. Why this matters (the 100:1 reframe)

From the monetization analysis:

- **~2,000 installs on Open VSX vs ~20 on the VS Code Marketplace** for the same extension,
  published simultaneously. The typical ratio runs the other way (Marketplace beats Open VSX
  50:1 or worse). The inversion is the most important signal in the dataset.
- Microsoft's ToS forbids non-VS-Code editors (Cursor, Windsurf, VSCodium, Codium, Positron,
  Trae, …) from pulling from the official Marketplace. Those editors are forced to use Open VSX.
- The audience is therefore **polyglot AI-tooling power users on forks**, not stock VS Code +
  Copilot users. They are already comfortable paying $20/mo for Cursor / Windsurf / Claude /
  Codex and are the target for the upcoming $7–10/mo Pro tier.

**Conclusion:** Open VSX is the primary distribution channel. Listing copy should lead with the
non-VS-Code audience and surface keywords those users actually search for.

---

## 2. Pre-rewrite snapshot (audit)

### 2.1 `package.json` (v1.3.3)

- `displayName`: `Session Control`
- `description`: *"Save and resume GitHub Copilot, Cursor, Codex, and Claude Code chat sessions
  linked to git commits"*
- `categories`: `["Other", "SCM Providers"]`
- `keywords`: `["copilot", "cursor", "codex", "claude-code", "claude", "chat", "git",
  "session", "resume"]`

### 2.2 `README.md` (current)

- Hero line: *"A VS Code extension that saves GitHub Copilot, Cursor, local Codex, and Claude
  Code chat sessions as structured JSON files in your repository, linked to git commits and
  branches."*
- No screenshots, no GIF.
- Features list is feature-shaped, not benefit-shaped.
- Phrase "VS Code extension" appears in the hero — fine for Marketplace, suboptimal for the
  Cursor / Windsurf / VSCodium audience that already knows the host is VS-Code-compatible.

### 2.3 Audit findings against the Phase 2 Step 1 brief

| Brief criterion | Current state | Verdict |
| :-- | :-- | :-- |
| Target keywords: `cursor`, `claude code`, `codex`, `windsurf`, `chat history`, `session manager`, `ai sessions`, `cross-ide` | `copilot`, `cursor`, `codex`, `claude-code`, `claude`, `chat`, `git`, `session`, `resume` | ⚠️ Missing `windsurf`, `chat history`, `session manager`, `ai sessions`, `cross-ide` |
| Lead with *"Save your Cursor / Claude Code / Codex chat history across git commits"* | Leads with "GitHub Copilot" first | ❌ Wrong audience first |
| Highlight cross-IDE / multi-assistant story | Mentioned in features but buried below "Provider choice" jargon | ⚠️ Buried |
| Privacy posture (local-first, never leaves machine unless user syncs) | Privacy warning exists for public repos, no positive privacy framing | ⚠️ Missing positive frame |
| Screenshots / short GIF in listing | None | ❌ Phase 2 Step 2 (separate todo) |
| Honest capability surface (no over-promising) | Feature claims match `CHANGELOG.md` v1.3.x | ✅ Accurate |

---

## 3. Rewrite strategy

Three lanes, in priority order:

1. **`package.json` `description` + `keywords`** — these power Open VSX search ranking and the
   one-line summary shown in search results. Highest leverage, lowest risk.
2. **`README.md` hero + first screen** — what the user sees above the fold on the Open VSX
   listing page. Lead with the Cursor / Claude Code / Codex / Windsurf audience and the
   benefit, not the implementation.
3. **`README.md` body** — keep the existing accurate feature documentation, but reorder so the
   cross-IDE story and the local-first privacy posture come before the long configuration
   table. Leave docs/configuration depth intact for users who scroll.

### 3.1 Keyword plan (Open VSX search surface)

Keep all existing keywords (they already rank). Add the missing brief-mandated keywords plus a
few high-intent long-tail terms users actually type:

- Add: `windsurf`, `chat-history`, `session-manager`, `ai-sessions`, `cross-ide`, `ai-chat`,
  `agent`, `transcript`, `history`, `vscodium`.
- Keep: `copilot`, `cursor`, `codex`, `claude-code`, `claude`, `chat`, `git`, `session`,
  `resume`.

Open VSX honors lowercase hyphenated tokens; matches the existing style.

### 3.2 New `description` (≤ 200 chars, Open VSX-friendly)

> Save your Cursor, Claude Code, Codex, and Copilot chat history across git commits. Cross-IDE
> session manager that keeps every AI conversation in your repo, locally.

That string is 195 characters, leads with the actual audience, mentions all four supported
providers in audience-priority order, and seeds the target keywords (`chat history`,
`cross-IDE`, `session manager`, `git`, `locally`).

### 3.3 New README hero

> # Session Control
>
> **Save your Cursor, Claude Code, Codex, and GitHub Copilot chat history across git commits.**
>
> Session Control is a cross-IDE session manager for AI chats. Every conversation with Cursor
> Agent, Claude Code, Codex, or Copilot can be captured as a structured JSON file in your repo,
> linked to the branch and commit it belongs to, and resumed later as context in a new chat.
>
> Your conversations never leave your machine — they live next to the code they produced, in
> source control you already trust.

Replaces the current "A VS Code extension that saves GitHub Copilot…" framing. The new hero:

- Leads with the audience-priority provider order (Cursor, Claude, Codex, then Copilot).
- Uses the exact phrase "chat history across git commits" from the brief.
- Frames the product as a **session manager**, not "an extension".
- Surfaces the local-first / source-control privacy posture in the hero rather than burying it
  in a warning box below.
- Keeps every claim factually consistent with the v1.3.3 feature set documented in
  `CHANGELOG.md`.

### 3.4 What the rewrite intentionally does *not* do

- Does **not** mention pricing, Pro, license keys, or any not-yet-shipped feature. Phase 2 Step
  1 ships before Phase 1 billing infra and Phase 3 Pro features.
- Does **not** remove or weaken the existing public-repo privacy warning. That stays as-is.
- Does **not** alter the configuration table, command list, or any documented behavior.
- Does **not** touch `displayName`, `publisher`, `version`, `repository`, `categories`, or the
  release workflow. Categories stay `Other` + `SCM Providers` (the closest accurate fit; Open
  VSX does not have an "AI" category that matches).

---

## 3.5 Phase 2 Step 2 — Screenshots + GIF (shipped in v1.3.4)

The brief tags Step 2 as 🤖 agent-suitable for the markup and 🤝 human-led for the captures.
The human owner captured the five assets (2026-07-04) and they now live in `media/screenshots/`;
the `screenshots:pending` comment markers were removed from `README.md` so the `## Screenshots`
section renders live on both listings as of v1.3.4.

### 3.5.1 Required assets

Five files under `media/screenshots/`. Filenames are case-sensitive on the marketplace CDNs and
must match the `README.md` markup exactly:

| File | Type | Target dims | Max size | Purpose |
| :-- | :-- | :-- | :-- | :-- |
| `demo.gif` | Animated GIF | 1280×800 | ≤ 5 MB | Save → browse → resume hero loop (~12 s) |
| `save-session.png` | PNG | 1280×800 | ≤ 400 KB | *Save Current Chat Session* in the Command Palette + new `.chat/<slug>.json` visible |
| `resume-session.png` | PNG | 1280×800 | ≤ 400 KB | `@session-control /resume cursor-debug-loop` selected in VS Code Chat |
| `session-explorer.png` | PNG | 1280×800 | ≤ 400 KB | Session Control activity-bar view, sessions grouped per workspace |
| `provider-picker.png` | PNG | 1280×800 | ≤ 400 KB | *Save Session From Provider…* quick pick showing Cursor / Claude / Codex / Copilot |

Detailed capture script, OS/UI prep, and privacy sweep live in `media/screenshots/README.md`.

### 3.5.2 Listing image-URL strategy

VS Marketplace and Open VSX render the listing README on their own domains and only resolve
**absolute** image URLs. The README uses the canonical raw GitHub URL pattern:

```
https://raw.githubusercontent.com/tempuskg/session-control/main/media/screenshots/<file>
```

This resolves the moment the files are committed to `main`. The same files also ship inside
the VSIX (`media/**` is not in `.vscodeignore`), so an offline-viewer rendering of the README
also works.

### 3.5.3 Why the markup is comment-wrapped right now

If the README image references go live before the human captures the visuals, the Open VSX
listing renders **broken-image icons** until the next deploy. That is worse than no images at
all. The markup is therefore wrapped in:

```html
<!-- screenshots:pending — remove this line and the matching closer after committing PNG/GIF assets to media/screenshots/

  ...image markup...

screenshots:pending -->
```

Going live is a deliberate one-step uncomment: delete both `screenshots:pending` lines after
the five files are committed.

### 3.5.4 What Step 2 intentionally does *not* do

- Does **not** commit dummy PNG placeholders to the repo. Placeholders would ship inside every
  VSIX install and waste bytes; the comment-wrapping is cleaner.
- Does **not** auto-publish the live screenshots. Going live is human-owned: capture, commit,
  uncomment, tag a release.
- Does **not** modify VS Marketplace `galleryBanner` or any other badge / theme settings.

---

## 3.6 Phase 2 Step 3 — Overview structure (drafted 2026-08-02, unreleased)

Steps 1 and 2 fixed *what the listing says* and *what it shows*. They did not fix **how much it
says**. By v1.3.6 the README had grown to 419 lines, of which roughly 145 were auto-save
internals: per-source acquisition contracts, the Cursor CLI persistence contract, VS Code
profile / Remote SSH / dev container / WSL boundaries, and the diagnostics report field list.

That content is accurate and worth keeping, but on a store overview it sits between the pitch
and the configuration table, so a visitor evaluating the extension scrolls through an
engineering spec. Step 3 is a structural edit only — no claim was weakened, removed, or added.

### 3.6.1 Changes

| Change | Rationale |
| :-- | :-- |
| Moved the deep auto-save reference verbatim into `docs/auto-save.md`, linked from a short README auto-save section | Keeps the contract documentation intact and findable without spending the listing's mid-page real estate on it |
| Added a **Quick start** section (save → browse → resume) directly under the hero | The listing had no three-step path; Installation sat at line 90, below Features and Requirements |
| Added a **Commands** table | The command surface was previously only discoverable by reading Usage prose |
| Replaced the hardcoded `VS Marketplace-v1.3.6` badge with a static link label; added a dynamic Open VSX downloads badge | The hardcoded badge went stale on every release and had to be hand-edited. Shields' `visual-studio-marketplace/v` badge is **retired** (renders "retired badge"), and `vsmarketplacebadges.dev` — which does work — is an unofficial host whose outage would render a broken image on the listing. The Open VSX badge already shows the live version for the primary channel, so the Marketplace badge carries no version. |
| Moved Requirements and Installation below the pitch, and noted that each requirement applies only to the provider being used | Reads as prerequisites for a feature, not barriers to installing |
| Merged the viewer / resume-from-viewer / viewer-command sections into one | Three sections described one feature |

Result: 419 → 293 lines. The privacy warning, the full configuration table, and every
documented behavior are unchanged.

### 3.6.2 Packaging note

`docs/**` is added to `.vscodeignore`. `vsce` derives base content URLs from `repository` and
rewrites relative README links to `https://github.com/tempuskg/session-control/blob/HEAD/<path>`
at package time — verified against the published v1.3.6 readme, where `CONTRIBUTING.md` and
`LICENSE` are already rewritten. The `docs/auto-save.md` link therefore resolves on both
listings without shipping the file inside the VSIX.

### 3.6.3 Known gap — Pro commands are undocumented on the listing

`package.json` v1.3.6 contributes `session-control.enterProLicenseKey`,
`clearProLicenseKey`, `showProLicenseStatus`, `session-control-pro.harvestKnowledge`, and
`harvestSessionFromExplorer`. A user who installs the extension sees **Session Control Pro:**
entries in the Command Palette with no explanation anywhere in the overview. Step 1 deliberately
excluded Pro copy because billing had not shipped; that premise has now changed. Writing the Pro
section is human-owned (pricing, availability, and tier boundaries are not agent-inferable) and
is tracked as a separate item rather than being drafted here.

---

## 4. Approval & ship checklist

Human owner: review and approve before the next release.

### Step 1 — listing copy + keywords

- [x] Sign off on the new `description` string (Section 3.2).
- [x] Sign off on the new README hero (Section 3.3).
- [x] Confirm the keyword additions in Section 3.1 are acceptable for both Open VSX and the
      residual VS Marketplace listing.
- [x] Decide whether to ship this as a patch (`1.3.4`) or wait and bundle with Phase 2 Step 2
      (screenshots + GIF) under `1.4.0`.
- [ ] After version bump, push the `v*` tag. `release.yml` publishes the same VSIX to VS
      Marketplace and Open VSX.
- [ ] After the next release lands, re-check Open VSX search ranking for `cursor chat history`,
      `claude code session`, `cross-ide ai`, and `windsurf chat`. These are the brief's
      acceptance signals.

### Step 3 — overview structure

- [x] Move the deep auto-save reference into `docs/auto-save.md` without losing content.
- [x] Add Quick start + Commands table; fix the stale hardcoded version badge.
- [x] Verify `vsce ls` excludes `docs/**` and still ships README + all five screenshot assets.
- [ ] Human owner: review the restructured README before the next release.
- [ ] Decide whether the Pro command surface (Section 3.6.3) gets listing copy this release.
- [ ] Bump version and push the `v*` tag — the overview only changes on the next publish.

### Step 2 — screenshots + GIF

- [x] README `## Screenshots` section drafted with absolute URLs and alt text (Section 3.5).
- [x] `media/screenshots/README.md` capture brief drafted with per-shot scripts and privacy
      sweep.
- [x] Markup comment-wrapped to prevent broken-image rendering on the live listing until the
      five files exist.
- [x] Capture `demo.gif`, `save-session.png`, `resume-session.png`, `session-explorer.png`, and
      `provider-picker.png` per the brief in `media/screenshots/README.md`.
- [x] Commit the five files to `media/screenshots/`.
- [x] Delete both `screenshots:pending` comment marker lines in `README.md` to make the markup
      live.
- [x] Bump version (recommended bundle with Step 1 copy changes under `1.3.4`) and push the
      `v*` tag.
- [ ] Spot-check both listings render the visuals correctly (Open VSX + VS Marketplace).

---

## 5. Related deferred items (do not block these steps)

- **Phase 2 Step 3** — VS Marketplace listing re-check + stock-VS-Code smoke test. Same copy
  changes apply; the 30-minute smoke test is the human-owned piece.
- **Phase 2 Step 4** — landing page. Out of scope for this repo.

Append an entry to `wiki/log.md` whenever this draft is revised.
