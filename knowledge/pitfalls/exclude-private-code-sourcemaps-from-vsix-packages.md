---
type: Pitfall
title: Exclude Private-Code Sourcemaps from VSIX Packages
description: "When a VSIX ships private compiled code, whitelist only runtime files so sourcemaps cannot reveal near-original TypeScript."
tags: [vsix, vscode-extension, sourcemaps, packaging, private-code]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.97
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:4aa1ac50c7ad031749ba6761fe9370f6165a7fc2aa6808eec3c496880a0d3107"
---
# Symptom

A packaged VSIX contains a private dependency’s `dist/index.js.map` alongside its runtime file. Sourcemaps “trivially unminify code back to near-original TypeScript,” exposing implementation details intended to remain private. The separate verification error `Cannot find module 'vscode'` was expected outside the VS Code Extension Host and is unrelated.

# Root Cause

`loader.ts` resolves the dependency with `nodeRequire.resolve(specifier)`, where `specifier` is a runtime variable that webpack cannot statically bundle. The dependency therefore must be physically included in the VSIX. A broad `.vscodeignore` carve-out from the blanket `node_modules/**` exclusion can accidentally include sourcemaps and stale build artifacts.

# Fix or Workaround

Keep the blanket `node_modules/**` exclusion, but whitelist only the dependency’s required `package.json` and `dist/index.js`. Exclude `dist/index.js.map`, stale `dist/extension.js`, and stale `dist/extension.js.map`. Build the VSIX, inspect its contents, and verify that the extracted layout still resolves the dependency at runtime.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
