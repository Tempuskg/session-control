---
name: github-instructions-vscode-extension-release-instructions
description: "Imported repository guidance from .github/instructions/vscode-extension-release.instructions.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.github/instructions/vscode-extension-release.instructions.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

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
