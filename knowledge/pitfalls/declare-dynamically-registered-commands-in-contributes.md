---
type: Pitfall
title: Declare dynamically registered commands in `contributes.commands`
description: Runtime registration alone does not make a VS Code command discoverable; declare it in the extension manifest.
tags: [vscode, extension-manifest, command-palette, runtime-registration]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.99
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:3000d9dfa02240eb142d8150ab5a96a483a6635207ad036453fadb8751c37909"
---
# Symptom

A runtime-loaded Pro module registers a command, but it does not appear in VS Code’s Command Palette, even after a valid license is entered. The reported symptom was: “there is a harvest knowlege pro command and I have entered the pro license but I don't so the harvest knowledge command”.

# Root Cause

`vscode.commands.registerCommand('session-control-pro.harvestKnowledge', ...)` creates the runtime handler but does not declare the command to VS Code’s discovery UI. The Pro code is a plain npm module, not a separate VS Code extension with its own manifest. License activation also does not create manifest contributions.

# Fix

Declare `session-control-pro.harvestKnowledge` under the host extension’s `contributes.commands` in `package.json`, using the intended title `Harvest Knowledge to OKF Bundle`. If Command Palette visibility is explicitly controlled, add a matching `contributes.menus.commandPalette` entry. Keep the runtime registration in the Pro module and ensure that module is shipped and resolvable.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
