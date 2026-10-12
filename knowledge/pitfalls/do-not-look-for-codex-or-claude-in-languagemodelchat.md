---
type: Pitfall
title: Do not look for Codex or Claude in `LanguageModelChat`
description: External agent providers may not register `LanguageModelChat` models; discover their chat commands and hand off prompts instead.
tags: [vscode, language-models, provider-discovery, codex, claude-code]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f5151-24e1-70d0-b894-79031a7e0788.md
source_commits: [028655e]
provider: codex
confidence: 0.99
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:88406ea34ad732574e4be348210e905737df4a456f349af7c32d3c46cb861df9"
---
# Symptom

> “I don't see codex or claude code in the provider selection”

# Root cause

The provider picker was populated only from VS Code’s `LanguageModelChat` API. Codex and Claude Code did not contribute models through that API because they operate as external agent providers exposed through chat commands.

# Fix or workaround

Treat direct `LanguageModelChat` models and external agent providers as separate provider types. Discover Codex and Claude Code through their installed chat commands, then open the selected agent’s chat and hand off the workspace-aware prompt. Use `LanguageModelChat` only for providers that register models through that API.

# Citations
1. [Session 019f5151-24e1-70d0-b894-79031a7e0788](../sessions/019f5151-24e1-70d0-b894-79031a7e0788.md)
