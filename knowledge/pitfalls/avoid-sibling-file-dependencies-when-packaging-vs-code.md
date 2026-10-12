---
type: Pitfall
title: "Avoid sibling `file:` dependencies when packaging VS Code extensions"
description: A sibling file dependency can create an out-of-tree symlink that makes vsce fail while scanning extension dependencies.
tags: [vscode, vsce, extension-packaging, file-dependency, symlink]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.98
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:3bf5b63480d95555723c94c378549879fa1e8cc88eb6c3e08eb1d6807c19412a"
---
When `npx @vscode/vsce package` fails with:

> `invalid relative path: extension/../session-control-pro/node_modules/@eslint/js/README.md`

the extension likely declares a sibling dependency such as `"@tempuskg/session-control-pro": "file:../session-control-pro"`.

The `file:` dependency creates a symlink under `node_modules` that resolves outside the extension project. `vsce` follows that link during its default dependency-detection scan and cannot compute a valid path inside the VSIX.

Remove the sibling `file:` dependency from committed `package.json` and `package-lock.json`. For local testing, use a temporary link or another install method that does not modify committed manifests. For distribution, use a registry-published package instead. If webpack already bundles the required code and `.vscodeignore` excludes `node_modules/**`, `npx @vscode/vsce package --no-dependencies` is also a packaging workaround.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
