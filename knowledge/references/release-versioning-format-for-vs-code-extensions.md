---
type: Reference
title: Release Versioning Format for VS Code Extensions
description: Guidelines for versioning and publishing VS Code extensions.
tags: [release, versioning, vscode, extension, publishing]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md
source_commits: [39e612f]
provider: codex
confidence: 0.7
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:34395aa5d53275a8a95f3b8d371c3e26e090a317f57d5dc5fec1149455176f3c"
---
## Description
This document outlines the process for versioning and publishing VS Code extensions, including how to determine version numbers, prepare release notes, and manage dependencies.

## Acceptance criteria
- [ ] Version number is correctly inferred based on changes.
- [ ] Release notes are prepared and accurate.
- [ ] All tests pass before publishing.
- [ ] The release is successfully published to both marketplaces.

## Activity
- The release candidate is validated and versioned at `1.4.0`.
- All tests, including TypeScript and extension tests, pass.
- The release commit is pushed to `main` and tagged as `v1.4.0`.
- The release is published to VS Marketplace and Open VSX.

# Citations
1. [Session 01a0e2e9-ea29-7252-9185-0931fb366ac8](../sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md)
