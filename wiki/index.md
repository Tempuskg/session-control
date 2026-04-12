---
title: "Wiki Index"
type: index
created: 2026-04-12
updated: 2026-04-12
---

# Chat-Commit Wiki Index

Master catalog of all wiki pages for the **chat-commit** VS Code extension.

---

## Overview
- [Project Overview](overview.md) — High-level summary of what chat-commit is and why it exists

## Architecture
- [Architecture](architecture.md) — System design: save system, resume system, storage format, and how they connect
- [Session Format](session-format.md) — JSON schema for saved chat sessions, field definitions, and examples

## Entities
- [Save System](save-system.md) — Subsystem for reading, transforming, and persisting Copilot chat sessions
- [Resume System](resume-system.md) — Chat participant that loads saved sessions as LLM context
- [Chat Participant](chat-participant.md) — The `@chat-commit` VS Code chat participant: registration, commands, UX
- [Git Integration](git-integration.md) — Git metadata capture, auto-save on commit, branch/SHA tracking

## Concepts
- [Configuration](configuration.md) — All user-facing settings: storage path, bloat controls, resume limits, pruning

## Reference
- [File Manifest](file-manifest.md) — Planned source files, their roles, and dependencies

## Source Summaries
- [Source: PLAN.md](source-plan.md) — Initial project plan covering all phases, architecture, and implementation details

---

*Last updated: 2026-04-12 — 10 pages*
