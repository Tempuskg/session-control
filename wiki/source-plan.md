---
title: "Source: PLAN.md"
type: source-summary
created: 2026-04-12
updated: 2026-04-12
sources:
  - raw/plan.md
tags:
  - architecture
  - save-system
  - resume-system
  - configuration
  - phase-1
  - phase-2
  - phase-3
  - phase-4
related:
  - wiki/overview.md
  - wiki/architecture.md
  - wiki/save-system.md
  - wiki/resume-system.md
  - wiki/chat-participant.md
  - wiki/git-integration.md
  - wiki/session-format.md
  - wiki/configuration.md
  - wiki/file-manifest.md
---

# Source: PLAN.md

**Source**: [raw/plan.md](../raw/plan.md)  
**Type**: Project plan  
**Date**: 2026-04-12  

## Summary

The founding document for the chat-commit VS Code extension. Defines the complete project architecture, implementation phases, data formats, and configuration options.

## Key Takeaways

1. **Two subsystems**: Save System (reads Copilot internals, writes JSON to `.chat/`) and Resume System (`@chat-commit` chat participant that injects saved context).

2. **Storage format is JSON** with an embedded markdown summary. Files named `{timestamp}-{slug}.json` in `.chat/`.

3. **Fragile dependency**: The Save System reads from Copilot's undocumented internal session storage (`workspaceStorage/{id}/chatSessions/`). A version-detection layer is planned to mitigate.

4. **Extensive bloat controls**: Both save-side (file size limits, splitting, tool output stripping, session pruning) and resume-side (max turns, max chars, overflow strategies including LLM summarization).

5. **Four implementation phases**: scaffolding → save system → resume system → polish. Clean separation of concerns.

6. **Nine planned source files**: Clear module boundaries — reader, writer, store, participant, git integration, types, utils, plus entry point and manifest.

7. **VS Code `^1.93.0` minimum** for stable chat participant API.

## Information Extracted

This source provided the basis for all initial wiki pages:
- [Overview](overview.md) — project summary and value proposition
- [Architecture](architecture.md) — system design and data flow
- [Save System](save-system.md) — session reading, transformation, bloat controls
- [Resume System](resume-system.md) — context injection, overflow strategies
- [Chat Participant](chat-participant.md) — registration, commands, UX
- [Session Format](session-format.md) — JSON schema, TypeScript types
- [Git Integration](git-integration.md) — metadata capture, auto-save
- [Configuration](configuration.md) — all settings with defaults
- [File Manifest](file-manifest.md) — planned files and dependencies

## Gaps & Open Questions

- No discussion of **testing strategy** — unit tests, integration tests, mocking Copilot internals
- No mention of **error handling** patterns — what happens when Copilot storage is missing or corrupt
- No detail on **markdown summary generation** — how turns are formatted for the `markdownSummary` field
- No specification for **fuzzy matching** algorithm for session search
- **Multi-root workspace** handling is mentioned but not detailed
- No discussion of **extension activation events** — when does the extension activate
