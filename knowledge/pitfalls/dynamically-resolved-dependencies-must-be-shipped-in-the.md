---
type: Pitfall
title: Dynamically Resolved Dependencies Must Be Shipped in the VSIX
description: "Webpack cannot bundle dependencies resolved through runtime variables, so required package files must be included in the VSIX."
tags: [vsix, webpack, node-modules, vscode-extension, packaging]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.99
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:888c99e84d390600f6ca69024c8656f8192a9e0ed3929f5a4bb4a1acaf81c9fc"
---
## Symptom

The bundle remains 211.45 KB, and webpack lists `marked` but not `@tempuskg/session-control-pro`. A local check may also show `"Cannot find module 'vscode'"`; outside the VS Code Extension Host, that message is expected and is unrelated to package resolution.

## Root Cause

`loader.ts` calls `nodeRequire.resolve(specifier)`, where `specifier` is a runtime variable. Webpack only bundles statically analyzable literal imports or `require` calls, so declaring the dependency in `package.json` does not inline it into `dist/extension.js`.

The extension’s `.vscodeignore` also excludes `node_modules/**`, preventing the dynamically resolved package from being shipped in the VSIX.

## Fix or Workaround

Declare the package as a real dependency and configure the release workflow to authenticate to its package registry before running `npm ci`. In `.vscodeignore`, carve out only the files required at runtime: `node_modules/@tempuskg/session-control-pro/package.json` and `node_modules/@tempuskg/session-control-pro/dist/index.js`.

Exclude sourcemaps and stale build artifacts so private implementation code is not unnecessarily exposed. Verify the packaged VSIX by extracting it and confirming that `require.resolve('@tempuskg/session-control-pro')` succeeds from the installed layout.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
