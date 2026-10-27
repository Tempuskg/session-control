---
type: Decision
title: Authorize publication of release v1.4.0 to both marketplaces
description: Decision to publish the validated release to both VS Marketplace and Open VSX.
tags: [release, publication, decision, marketplace, v1.4.0]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md
source_commits: [39e612f]
provider: codex
confidence: 0.8
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:a4a3211da99dadcaaa2131b7d63d98c8ce13f88d28bc696327d38cee64807e93"
---
## Context
The validated `1.4.0` VSIX includes the bundled `@tempuskg/session-control-pro` companion payload. Publishing requires pushing commit `4550887` to `main`, then pushing annotated tag `v1.4.0`; the tag workflow publishes the same VSIX to VS Marketplace and Open VSX and creates a GitHub Release.

## Options Considered
1. **Publish to both marketplaces**: Proceed with the release as planned.
2. **Do not publish**: Hold off on the release for further review.

## Decision
Authorize publication to both marketplaces.

## Consequences
The release candidate `1.4.0` will be published to both the VS Marketplace and Open VSX, ensuring that users have access to the latest features and improvements.

# Citations
1. [Session 01a0e2e9-ea29-7252-9185-0931fb366ac8](../sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md)
