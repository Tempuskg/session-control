---
name: "VS Code Extension Release"
description: "Use when versioning, packaging, publishing, or documenting a Session Control release. Covers choosing the bump level, patch bumps, explicit version sets, the CHANGELOG cut, pre-release docs and smoke checks, VS Marketplace, Open VSX, and release workflow expectations."
---

# VS Code Extension Release

- This repo is a VS Code extension published as `darrenjmcleod.session-control`.
- This is the only customer-facing extension install. If discussing Pro or licensing, describe it as capability that ships through `session-control`, not as a separate `session-control-pro` marketplace extension.
- Choose the bump from `CHANGELOG.md` `[Unreleased]`: patch when it has only `Fixed` entries, minor when it has `Added` or user-visible `Changed` entries. State the chosen level and the reason in the closeout.
- For patch bumps, prefer `npm run version:build`. It updates `package.json` and `package-lock.json`. The README VS Marketplace badge reads `listing` instead of a version, so no README badge change is expected; do not change the badge back to a version number.
- For explicit version sets, use the documented `npm version <version> --no-git-tag-version` path and verify only the expected release files.
- Cut the release in `CHANGELOG.md` by inserting `## [<version>] - <YYYY-MM-DD>` directly below an empty `## [Unreleased]` heading.
- Before cutting a release, search `README.md` for descriptions of each surface named in `[Unreleased]` and update any that are stale. If `[Unreleased]` changes chat, picker, or command UX, install the packaged VSIX (`code --install-extension <vsix> --force`, then Developer: Reload Window) and smoke test it before any tag push. Otherwise list the smoke test under Unverified and do not recommend publication.
- Release-relevant files are `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, and `scripts/bump-package-version.cjs`. Check `.github/workflows/release.yml` only when publish automation itself changes.
- Treat direct VS Marketplace or Open VSX publication, manual release-workflow dispatch, and pushing a `v*` tag as the same external publication boundary. A generic request to "do a release" authorizes versioning, validation, and local VSIX preparation only; before executing any publication trigger, state that the VSIX contains the bundled Pro companion payload and obtain explicit authorization for both marketplace destinations.
- For a normal release, prefer the repository's pushed-tag workflow after the release commit is on synchronized `main`: create an annotated `v<version>` tag and push only that tag. The workflow validates the repository, packages once, publishes the same VSIX to VS Marketplace and Open VSX, and creates the GitHub release. Reserve local `npx @vscode/vsce` and `npx ovsx` publication for an explicitly requested manual fallback.
- Use PowerShell examples by default on Windows unless the user explicitly asks for another shell.
- Re-read the current version and workspace state before release steps, especially on resumed chats.
- Keep versioning guidance separate from commit or tag advice; do not assume automatic git tags or commits unless the user explicitly requests them.
- In the closeout, list changed release files, commands run, remaining unpublished steps, and anything not yet verified.
