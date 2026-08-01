---
title: "Wiki Index"
type: index
created: 2026-04-12
updated: 2026-07-30
---

# Session Control Wiki Index

Master catalog of all wiki pages for the **session-control** VS Code extension.

---

## Overview
- [Project Overview](overview.md) — High-level summary of multi-provider saving, resuming, analysis, and project-scoped auto-save

## Architecture
- [Architecture](architecture.md) — System design: provider adapters, per-workspace controllers, save/upsert, resume, diagnostics, and storage
- [Session Format](session-format.md) — JSON schema for saved chat sessions, field definitions, and examples

## Entities
- [Save System](save-system.md) — Provider adapters, manual snapshots, reliable auto-save reconciliation, diagnostics, and durable upserts
- [Resume System](resume-system.md) — Chat participant that loads saved sessions as LLM context
- [Chat Participant](chat-participant.md) — The `@session-control` VS Code chat participant: registration, commands, UX
- [Git Integration](git-integration.md) — Git metadata capture, branch/SHA tracking

## Concepts
- [Configuration](configuration.md) — Storage, provider paths, auto-save selection/migration, privacy, bloat, resume, and pruning settings

## Reference
- [File Manifest](file-manifest.md) — Implemented source files, auto-save ownership, roles, dependencies, and command contributions
- [Open VSX Listing — Audit & Rewrite](open-vsx-listing.md) — Phase 2 Step 1 listing audit, keyword plan, and rewrite rationale for the Open VSX / VS Marketplace listings

## Source Summaries
- [Source: PLAN.md](source-plan.md) — Initial project plan covering all phases, architecture, and implementation details

---

*Last updated: 2026-07-30 — 11 pages*
