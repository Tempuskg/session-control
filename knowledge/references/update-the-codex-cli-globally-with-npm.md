---
type: Reference
title: Update the Codex CLI Globally with npm
description: Update a global npm installation of Codex CLI and verify its version on Windows.
tags: [codex-cli, npm, windows, updates]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f5151-b96b-7782-a7ba-93bc29e6217a.md
source_commits: [028655e]
provider: codex
confidence: 0.78
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:74d3f7a877c50b54b15f3c322df0afa6ba4752e4690942de84e7854b9f913fec"
---
A global npm installation of Codex CLI can be updated with:

`npm install -g @openai/codex@latest`

On Windows PowerShell, verify the installation with `codex.cmd --version`. If npm permissions fail, run PowerShell as Administrator or configure npm global installs to use a user-owned directory. If PowerShell blocks `codex --version`, use `codex.cmd --version` instead.

# Provenance

The session identified Codex as a global npm installation of `@openai/codex`, installed at version `0.142.5`, and verified the Windows-safe version command.

# Citations
1. [Session 019f5151-b96b-7782-a7ba-93bc29e6217a](../sessions/019f5151-b96b-7782-a7ba-93bc29e6217a.md)
