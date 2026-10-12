---
type: Reference
title: "Patch Version Bumps: Use npm run version:build"
description: Use the repository script for patch bumps and the documented no-tag/no-commit npm version path for explicit version changes.
tags: [versioning, release, npm, vscode-extension]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md
source_commits: []
provider: codex
confidence: 0.92
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:a84bd608a829700745ed7b0feea9837146e08c97228d10fbeafc6f2f782ae3c0"
---
For the `chat-commit` VS Code extension, use `npm run version:build` for patch version bumps. For explicit version changes, use the repository’s documented exact `npm version` path without automatically creating a Git tag or commit. Versioning tasks should verify only the expected release files: `package.json`, `package-lock.json`, `README.md`, and `scripts/bump-package-version.cjs`.

Provenance: This guidance is stated in the repository’s `AGENTS.md` instructions captured in the cited session.

# Citations
1. [Session 019f34aa-0cf5-73b2-b89a-4893db4ce55a](../sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md)
