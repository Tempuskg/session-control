---
type: Reference
title: Pro modules must export `registerProFeatures()`
description: Runtime contract for loading Pro features and providing license-aware integration context.
tags: [vscode, pro-module, runtime-loading, licensing]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.93
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:b6fe6b9f19e92da0f5d49d1d4436252e143ac4ff117715454ca8209c4c0f1bee"
---
A Pro module loaded by `session-control` must export `registerProFeatures()`. During activation, the extension resolves `@tempuskg/session-control-pro`, validates that export, and invokes it with a context exposing `hasProLicense()` and `showUpgradePrompt()`. If the package cannot be resolved, the extension continues in free-only mode.

## Provenance

The session identified this contract while tracing why the Harvest Knowledge command was unavailable. The free extension’s `loader.ts` dynamically resolves the Pro package, validates `registerProFeatures()`, and passes the license-aware context to the Pro implementation.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
