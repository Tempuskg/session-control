---
type: Pitfall
title: Rebuild stale dist-test output before diagnosing failures
description: Stale compiled test output can misrepresent source behavior; use repository scripts and rebuild dist-test before deeper diagnosis.
tags: [testing, build, dist-test, npm-scripts]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md
source_commits: []
provider: codex
confidence: 0.97
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:45bbcf674bc19cac455e1fc4ae5f68e66dc197644d4f1242c5ac61fc3b0128e1"
---
# Symptom

The validation state is: “`dist-test` disagrees with source”.

# Root cause

Compiled test output is stale relative to the current source. Ad hoc runners can therefore exercise outdated files; plain `node --test` is not appropriate here, and direct Mocha runs are unreliable.

# Fix

Use the repository’s validation scripts. Run `npm run compile-tests` to rebuild test output, then continue with the applicable compile, focused-test, `npm test`, and lint commands. If `dist-test` still disagrees with source, rebuild it before investigating deeper.

# Citations
1. [Session 019f34aa-0cf5-73b2-b89a-4893db4ce55a](../sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md)
