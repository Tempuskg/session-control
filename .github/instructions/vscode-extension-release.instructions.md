---
name: "VS Code Extension Release"
description: "Use when versioning, packaging, publishing, or documenting a Session Control release. Covers patch bumps, explicit version sets, README badge sync, VS Marketplace, Open VSX, and release workflow expectations."
---

# VS Code Extension Release

- This repo is a VS Code extension published as `darrenjmcleod.session-control`.
- This is the only customer-facing extension install. If discussing Pro or licensing, describe it as capability that ships through `session-control`, not as a separate `session-control-pro` marketplace extension.
- For patch bumps, prefer `npm run version:build`. It updates `package.json`, `package-lock.json`, and the VS Marketplace badge in `README.md`.
- For explicit version sets, use the documented `npm version <version> --no-git-tag-version` path and verify only the expected release files.
- Release-relevant files are `package.json`, `package-lock.json`, `README.md`, and `scripts/bump-package-version.cjs`. Check `.github/workflows/release.yml` only when publish automation itself changes.
- Treat direct VS Marketplace or Open VSX publication, manual release-workflow dispatch, and pushing a `v*` tag as the same external publication boundary. A generic request to "do a release" authorizes versioning, validation, and local VSIX preparation only; before executing any publication trigger, state that the VSIX contains the bundled Pro companion payload and obtain explicit authorization for both marketplace destinations.
- For a normal release, prefer the repository's pushed-tag workflow after the release commit is on synchronized `main`: create an annotated `v<version>` tag and push only that tag. The workflow validates the repository, packages once, publishes the same VSIX to VS Marketplace and Open VSX, and creates the GitHub release. Reserve local `npx @vscode/vsce` and `npx ovsx` publication for an explicitly requested manual fallback.
- Use PowerShell examples by default on Windows unless the user explicitly asks for another shell.
- Re-read the current version and workspace state before release steps, especially on resumed chats.
- Keep versioning guidance separate from commit or tag advice; do not assume automatic git tags or commits unless the user explicitly requests them.
- In the closeout, list changed release files, commands run, remaining unpublished steps, and anything not yet verified.
