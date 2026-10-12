---
type: Decision
title: Use one selected execution provider for all eligible `.chat` sessions
description: Let users choose the execution provider for analysis while keeping every eligible session in the workspace’s `.chat` folders in scope.
tags: [analysis, execution-provider, chat-sessions, provider-selection, implementation]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f5151-24e1-70d0-b894-79031a7e0788.md
source_commits: [028655e]
provider: codex
confidence: 0.99
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:08a43963b16db55be7f62996b21a9658d0a6ddbb79845d92f0bcc29cdf36f545"
---
# Context

The extension distinguishes between a saved session’s source provider and the provider used to perform analysis. The source provider identifies where a `.chat` session came from; it must not determine which sessions are analyzed.

Users need to choose the execution provider or model for analysis. Eligibility may still depend on the selected timeframe or needs-analysis mode, but provider filtering must not exclude otherwise eligible sessions.

# Options Considered

1. Use the current or first available language model and analyze all sessions. This preserves broad scope but does not let users choose the execution provider.

2. Filter sessions by their saved source provider. This was rejected because the requirement is to select who performs the analysis, not which sessions are included.

3. Offer a generic “Chat” versus “Coding Agent” destination picker for implementation. This was rejected as confusing because it hides the actual provider choice.

4. Present the actual execution providers in a shared picker and keep all eligible sessions in scope. This was selected.

# Decision

`/analyze` and command-palette analysis must prompt for an execution provider or model, then analyze every eligible saved session in the open workspace’s `.chat` folders regardless of source provider.

The picker may include direct `LanguageModelChat` entries and installed external providers such as Codex, Claude Code, and Cursor when their supported chat commands are registered. Direct models run the analysis in process; external providers receive a workspace-aware analysis handoff.

The same provider picker is reused by `/implement` and “Implement Latest Analysis,” replacing the separate Chat-versus-Agent destination choice.

# Consequences

Users choose who performs the analysis without narrowing the session set. Codex, Claude Code, and Cursor appear only when their extensions expose the supported commands. Analysis and implementation now use consistent provider-selection semantics.

# Citations
1. [Session 019f5151-24e1-70d0-b894-79031a7e0788](../sessions/019f5151-24e1-70d0-b894-79031a7e0788.md)
