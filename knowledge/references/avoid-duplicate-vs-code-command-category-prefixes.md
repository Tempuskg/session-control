---
type: Reference
title: Avoid Duplicate VS Code Command Category Prefixes
description: "VS Code renders commands as category plus title, so omit category text from the title to prevent duplicate prefixes."
tags: [vscode, command-palette, extension-manifest, command-titles, category-prefix]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.98
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:749ae26d19105e83b9cfe649bf562f154a1e08f3e0ef319d57fe658cc3fdb788"
---
VS Code displays command titles as `{category}: {title}` in the Command Palette. If the category is `Session Control Pro`, set the title to `Harvest Knowledge to OKF Bundle`, not `Session Control: Harvest Knowledge to OKF Bundle`; otherwise the category prefix is duplicated. Apply this change in the host extension’s `package.json`, and keep the packaged Pro repository’s manifest consistent.

## Provenance

The session identified the redundant `Session Control:` text in the host extension manifest and reported updating both repositories so the command displays as `Session Control Pro: Harvest Knowledge to OKF Bundle`.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
