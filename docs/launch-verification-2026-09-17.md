# Launch verification — listing images and stock VS Code smoke test

**Date:** 2026-09-17
**Version under test:** 1.3.13 (the version live on both registries)
**Verdict:** PASS on both registries and on the stock VS Code host.

Two launch gates were checked: that every listing image actually resolves from
raw.githubusercontent for both registry listings, and that the published extension
installs and saves a session on stock VS Code with stock Copilot — not just inside
the forks where day-to-day development happens.

---

## 1. Listing images

Both listings render the same README, so the check was done in two parts: fetch the
README each registry actually serves, then fetch every image URL it references.

### Open VSX — PASS

Listing: <https://open-vsx.org/extension/darrenjmcleod/session-control>
README served by the listing: `https://open-vsx.org/api/darrenjmcleod/session-control/1.3.13/file/readme.md` → HTTP 200, 20481 bytes.

### VS Marketplace — PASS

Listing: <https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.session-control>
README served by the listing (`Microsoft.VisualStudio.Services.Content.Details` asset) → HTTP 200, 20481 bytes.

The two README payloads are **byte-identical**, and each references exactly the same
five raw.githubusercontent image URLs — so a single image check covers both listings.

### Per-image results

Every URL was fetched in full, not just HEAD-checked; the SHA-256 of each response was
compared against the committed file, and the leading magic bytes were checked to rule
out an HTML error page served with a 200.

| Image | HTTP | Content-Type | Bytes | Magic | Matches repo file |
|---|---|---|---|---|---|
| `media/screenshots/demo.gif` | 200 | image/gif | 2,432,186 | `47494638` (GIF8) | yes |
| `media/screenshots/save-session.png` | 200 | image/png | 143,367 | `89504e47` (PNG) | yes |
| `media/screenshots/resume-session.png` | 200 | image/png | 146,358 | `89504e47` (PNG) | yes |
| `media/screenshots/session-explorer.png` | 200 | image/png | 124,515 | `89504e47` (PNG) | yes |
| `media/screenshots/provider-picker.png` | 200 | image/png | 150,340 | `89504e47` (PNG) | yes |

All five are served from `https://raw.githubusercontent.com/tempuskg/session-control/main/…`.

### Case sensitivity

The concern that motivated this check is real and was confirmed by negative control —
wrong-case variants of the shipped filenames 404:

- `.../Demo.GIF` → **HTTP 404**
- `.../Save-Session.png` → **HTTP 404**

The filenames referenced in the README match the repository exactly (all lowercase,
hyphenated), so the case-sensitive path is the one being served.

### Incidental finding

The VSIX published to each registry is byte-identical
(SHA-256 `079f6570fd128f0992abe64681a985d8767cb88a6ce2836b33f591a05674ea02`, 2,950,744 bytes),
so the two listings are serving the same artifact as well as the same README.

### What was not checked

Pixel rendering of each listing page in a browser. No browser tooling was available in
this environment. What was checked instead is strictly stronger for the failure mode in
question: the exact image URLs the live listings serve, and the exact bytes those URLs
return.

---

## 2. Stock VS Code smoke test — PASS

Run against a **pristine profile** (empty `--user-data-dir` and `--extensions-dir`), so
this is a genuine first-run path, not a reuse of a developer profile.

| Property | Value |
|---|---|
| Host | Visual Studio Code **1.138.0** (`appName` = `Visual Studio Code`, not a fork) |
| Extension | Installed from the **published Marketplace VSIX**, not a local build |
| Version loaded | 1.3.13 |
| Copilot | `GitHub.copilot-chat@0.66.0`, **built in** to this VS Code build (`resources/app/extensions/copilot`) |
| Profile | Clean `--user-data-dir` + `--extensions-dir`, no other user extensions |

### Results — 11 / 11 checks passed

| Check | Result | Detail |
|---|---|---|
| Host is stock VS Code ≥ 1.93 | PASS | 1.138.0 |
| Host is not a fork | PASS | `appName` = `Visual Studio Code` |
| Published VSIX installs into a clean profile | PASS | `darrenjmcleod.session-control@1.3.13` |
| Installed version is 1.3.13 | PASS | — |
| Stock Copilot Chat present on host | PASS | `GitHub.copilot-chat@0.66.0`, built-in |
| Activates without error on first run | PASS | 65 ms |
| Core commands registered | PASS | save / list / refresh / diagnose |
| Session Explorer refresh runs | PASS | — |
| **Saves a session to `.chat/`** | **PASS** | `2026-09-17T13-20-snapshot-patch-session.json` |
| Saved file is valid JSON | PASS | 1421 bytes |
| Saved session carries transcript content | PASS | 2 turns, title preserved |

The save was driven end to end through the real UI — the provider quick pick, the session
quick pick and the title prompt were each accepted through the workbench, exactly as a
user would. The resulting file records the right metadata and full transcript content:

```
version 1 | provider copilot | vscodeVersion 1.138.0 | totalTurns 2
git: { branch: main, commit: 4ab130fb…, dirty: false }
turn 0: type=request  participant=copilot  prompt + references
turn 1: type=response participant=copilot  content + toolCalls
```

No first-run failure was found. The hypothesis behind this card — that installs with no
reviews might be hiding a first-run break outside the forks — is **not supported**:
activation, command registration, the explorer view and the full save flow all work on a
clean stock install.

### Caveats

1. **The Copilot transcript was seeded, not generated live.** This environment has no
   GitHub sign-in (`No signed-in session resolved for resource: https://api.github.com`),
   so a real Copilot conversation could not be produced. Instead a transcript in VS Code's
   own snapshot-patch chat format was written into the workspace's real
   `workspaceStorage/<hash>/chatSessions/` directory — the exact location and format stock
   Copilot Chat writes. Everything downstream of that (storage resolution, parsing, the
   quick picks, git context capture, the write to `.chat/`) ran for real against the
   published build. What remains unproven is only Copilot's own act of writing the file.
2. **`github.copilot` (completions) could not be installed** on 1.138.0: it depends on
   `github.copilot-chat` 0.48.1, and VS Code refuses to downgrade the built-in 0.66.0.
   This is a VS Code/Marketplace packaging interaction and is unrelated to Session Control —
   Copilot Chat, which is what produces the chat storage this extension reads, is present
   and current as a built-in.
3. Tested on Windows only. macOS and Linux stock hosts were not covered.

---

## Summary

| Gate | Result |
|---|---|
| Open VSX listing images | **PASS** — 5/5 resolve, bytes match, case correct |
| VS Marketplace listing images | **PASS** — same README, same 5 URLs, same bytes |
| Stock VS Code 1.93+ install and save | **PASS** — 11/11 checks on a clean 1.138.0 profile |
| Stock Copilot present | **PASS** — built-in `GitHub.copilot-chat@0.66.0` |

Neither launch gate is blocked.
