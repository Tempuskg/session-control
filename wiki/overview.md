---
title: "Project Overview"
type: overview
created: 2026-04-12
updated: 2026-07-30
sources:
  - raw/plan.md
tags:
  - architecture
  - overview
related:
  - wiki/architecture.md
  - wiki/save-system.md
  - wiki/resume-system.md
---

# Project Overview

**Session Control** is an open source (MIT-licensed) VS Code extension that saves supported Copilot, Cursor, Codex, and Claude Code sessions as structured JSON files in a configurable repository folder, linked to git commits and branches. Users can save explicitly or opt into project-scoped automatic snapshots, resume saved chats via the `@session-control` participant, and analyze saved history for recurring workflow and coding-agent insights. It is published to the VS Code Marketplace and Open VSX Registry.

## Core Value Proposition

Assistant chat history is fragmented across editors and local CLI stores and can be lost or separated from the code it affected. Session Control bridges this gap by:

1. **Persisting conversations** — Saving chat sessions as JSON files alongside the code they relate to.
2. **Linking to git context** — Each saved session captures the branch, commit SHA, and dirty state, tying the conversation to a point in the codebase's history.
3. **Enabling resumption** — A chat participant (`@session-control`) can reload a saved session and inject it as context into a new conversation, allowing the LLM to "remember" prior work.
4. **Analyzing workflow patterns** — Saved sessions can be re-read by the chat participant to identify repeated tool misuse, inefficiencies, and coding-agent preload insights across repositories, with persisted owner-workspace, repository, and source-session provenance for later follow-up or coding-agent handoff.
5. **Living in source control** — Sessions and analysis artifacts are stored as files in the repo (`.chat/`), meaning they can be reviewed in PRs, shared with teammates, and versioned alongside code.

## Main Subsystems

The extension has three main user-facing subsystems:

- **[Save System](save-system.md)** — Reads provider-specific local stores, normalizes sessions, and writes manual snapshots or ownership-scoped automatic upserts.
- **[Resume System](resume-system.md)** — A registered [Chat Participant](chat-participant.md) (`@session-control`) that loads saved sessions, injects them as LLM context, and analyzes saved chat history.
- **Session Viewer** — An HTML webview panel that renders saved sessions as formatted conversations. Accessible from the Session Explorer sidebar or by opening a session JSON file and clicking the editor title preview button.

## Implementation Phases

The plan is organized into ten incremental phases, each delivering a testable milestone:

| Phase | Focus | Key Deliverable |
|-------|-------|------------------|
| 1 | Project Scaffolding | Buildable extension with package.json, open source files, CI/CD |
| 2 | Types & Core Utilities | `types.ts`, `utils.ts` (slugify, fuzzy matching), unit tests |
| 3 | Git Integration | `gitIntegration.ts` with graceful degradation |
| 4 | Session Reader | Read Copilot internal storage with version detection |
| 5 | Session Writer & Store | Transform to JSON, write to `.chat/`, atomic writes |
| 6 | Save Command | End-to-end save flow — first user-facing feature |
| 7 | Chat Participant & Resume | `@session-control /resume` and `/list` commands |
| 8 | Bloat Controls | Split files, strip output, context overflow strategies |
| 9 | Auto-Save & Pruning | Auto-save on chat response, session archival/deletion |
| 10 | Polish & Multi-Root | Multi-root support, config validation, tree view, status bar ✓ |

## Key Design Decisions

- **JSON as primary format** — Machine-parseable for resume; markdown summary embedded for human review.
- **Minimum VS Code `^1.93.0`** — Chat participant API stabilized at this version.
- **Manual save + optional project auto-save** — Manual selection remains explicit. Auto-save is off by default, scoped per workspace folder, and monitors all selected provider groups concurrently after positive project matching.
- **Auto-save is an upsert** — Semantic revisions and durable checkpoints maintain one current automatic file set per source session; manual snapshots are never replacement candidates.
- **Read-only provider adapters** — Provider stores, hooks, settings, indexes, and retention state are not modified. Unclear ownership fails closed and remains diagnosable.
- **Analysis artifacts stay separate and auditable** — Markdown reports and fingerprint indexes live under `.chat/analysis/`, with repository-context and source-session provenance stored outside the saved chat JSON schema.
- **Local transcript contracts have limits** — Provider formats and paths can change, and only stores visible to the running extension host and active VS Code profile can be monitored.
- **Open source (MIT)** — Developed publicly on GitHub with contribution guidelines, issue templates, CI/CD pipelines, and automated publishing.

## Open Questions

> ⚠️ Note: Provider transcript formats and locations are not stable public APIs. The adapters are isolated, fixture-backed, and diagnosable, but remote/profile boundaries, missing local transcripts, or provider format changes can make an individual source unavailable without stopping the others.
