---
type: Decision
title: Route Pro Capabilities Through the Single Extension Install
description: Ship Pro capabilities as companion functionality loaded by the single customer-facing extension install.
tags: [architecture, packaging, release, vscode-extension]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md
source_commits: []
provider: codex
confidence: 0.99
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:daeb8a5698b73677ff8aa88f4616b2dfb42053594589967b00a92e1fcc37fb8c"
---
# Route Pro Capabilities Through the Single Extension Install

## Context

The session-control project is a VS Code extension with a single customer-facing shipping model. Pro or license-layer functionality must be delivered as companion package functionality within that extension.

## Options considered

1. Ship Pro as a separate `session-control-pro` extension that users install or configure independently.
2. Ship one `session-control` extension and load Pro capabilities through it as companion package functionality.

## Decision

Use one customer-facing `session-control` extension install. Do not direct users to install, configure, or search for a standalone `session-control-pro` extension.

## Consequences

Users have one extension to install and maintain. Pro and license-layer implementation must integrate with the main extension’s loading and packaging model. User-facing documentation, instructions, and release guidance must preserve this single-install model.

# Citations
1. [Session 019f34aa-0cf5-73b2-b89a-4893db4ce55a](../sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md)
