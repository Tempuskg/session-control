---
type: Decision
title: Reuse the analysis provider selector for implementation commands
description: Use the analysis provider picker for implementation so users select the actual model or agent that performs the work.
tags: [provider-selection, implementation, analysis, vscode, user-experience]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f5151-24e1-70d0-b894-79031a7e0788.md
source_commits: [028655e]
provider: codex
confidence: 0.98
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:6f534cfe543fccdbd1ac33a59c14e6bc0b08b07dfbefff29b96592d8f4b92737"
---
# Context

The `/implement` command and “Implement Latest Analysis” previously asked users to choose between generic destinations such as “Chat” and “Coding Agent.” This was inconsistent with analysis, where users select the actual provider or model.

# Options considered

1. Keep the generic Chat-versus-Coding-Agent picker and clarify its labels.
2. Rename the existing implementation choices without changing their behavior.
3. Reuse the analysis provider picker for implementation.

# Decision

Use the same provider selector for analysis and implementation. The picker presents available VS Code models and installed external providers such as Codex, Claude Code, and Cursor. The selected provider receives the implementation handoff through its corresponding execution path.

# Consequences

- `/implement` and “Implement Latest Analysis” have consistent provider-selection behavior with analysis.
- Users can choose the actual provider that performs the implementation.
- External providers appear only when their supported chat commands are installed.
- The previous generic Chat/Coding Agent destination picker and its underlying target enum are removed.
- VS Code model selections use the VS Code Chat handoff, while external providers use their existing provider handoff flow.

# Citations
1. [Session 019f5151-24e1-70d0-b894-79031a7e0788](../sessions/019f5151-24e1-70d0-b894-79031a7e0788.md)
