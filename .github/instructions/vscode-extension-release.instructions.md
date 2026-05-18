---
name: "VS Code Extension Release"
description: "Use when versioning, packaging, publishing, or documenting a Session Control release. Covers patch bumps, explicit version sets, README badge sync, VS Marketplace, Open VSX, and release workflow expectations."
---

# VS Code Extension Release

- This repo is a VS Code extension published as `darrenjmcleod.session-control`.
- For patch bumps, prefer `npm run version:build`. It updates `package.json`, `package-lock.json`, and the VS Marketplace badge in `README.md`.
- For explicit version sets, use the documented `npm version <version> --no-git-tag-version` path and verify only the expected release files.
- Release-relevant files are `package.json`, `package-lock.json`, `README.md`, and `scripts/bump-package-version.cjs`. Check `.github/workflows/release.yml` only when publish automation itself changes.
- When asked how to publish, answer with this repo's flow first: package and publish to VS Code Marketplace with `npx @vscode/vsce`, publish the same VSIX to Open VSX with `npx ovsx publish`, and note that the GitHub workflow publishes from a pushed `v*` tag or a manual dispatch after lint, build, and test steps pass.
- Use PowerShell examples by default on Windows unless the user explicitly asks for another shell.
- Re-read the current version and workspace state before release steps, especially on resumed chats.
- Keep versioning guidance separate from commit or tag advice; do not assume automatic git tags or commits unless the user explicitly requests them.
- In the closeout, list changed release files, commands run, remaining unpublished steps, and anything not yet verified.