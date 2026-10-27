---
type: Pitfall
title: Ensure correct contextValue for session rows in Pro package
description: Verify that the contextValue for session rows allows export and harvest commands.
tags: [pro-package, context-value, session-rows, export, harvest]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/1bff48ed-e135-435c-9bae-7e0e5bfe3425.md
source_commits: [213c52b]
provider: claude-code
confidence: 0.85
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:97f0ad99d3554efe93745d69a79bc55edf2fbba0c1413efc2c7489c503395da7"
---
The symptom of this pitfall is: **"Harvest This Session"** shows on analyzed rows where the handler refuses it. The root cause is that the Pro package's `resolveSavedSessionHarvestInvocation` matched `'session-control.session'` with strict equality, while an analyzed session row has `contextValue === 'session-control.session.analyzed'`. 

To fix this, ensure that the Pro package accepts the whole `session-control.session*` family, which allows both the harvest and the new export commands to function correctly. This requires the Pro release that widened the accepted `contextValue`.

# Citations
1. [Session 1bff48ed-e135-435c-9bae-7e0e5bfe3425](../sessions/1bff48ed-e135-435c-9bae-7e0e5bfe3425.md)
