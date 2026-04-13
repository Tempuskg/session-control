---
title: "Project Overview"
type: overview
created: 2026-04-12
updated: 2026-04-13
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

**Session Control** is an open source (MIT-licensed) VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files into a configurable `.chat/` folder in the repo, linked to git commits and branches. Users can resume saved chats via a `@session-control` chat participant that loads prior conversation as LLM context. Published to the VS Code Marketplace and Open VSX Registry.

## Core Value Proposition

Chat sessions with Copilot are ephemeral — they disappear when VS Code is closed or when context is lost. Session Control bridges this gap by:

1. **Persisting conversations** — Saving chat sessions as JSON files alongside the code they relate to.
2. **Linking to git context** — Each saved session captures the branch, commit SHA, and dirty state, tying the conversation to a point in the codebase's history.
3. **Enabling resumption** — A chat participant (`@session-control`) can reload a saved session and inject it as context into a new conversation, allowing the LLM to "remember" prior work.
4. **Living in source control** — Sessions are stored as files in the repo (`.chat/`), meaning they can be reviewed in PRs, shared with teammates, and versioned alongside code.

## Two Subsystems

The extension has two main subsystems:

- **[Save System](save-system.md)** — Reads Copilot's internal session storage, transforms it, and writes structured JSON to `.chat/`.
- **[Resume System](resume-system.md)** — A registered [Chat Participant](chat-participant.md) (`@session-control`) that loads saved sessions and injects them as LLM context.
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
- **Manual save + optional auto-save** — Auto-save on chat response is opt-in; manual save is the primary workflow. The auto-save feature watches the Copilot storage directory for new turns and saves automatically with old-file cleanup.
- **Relies on internal Copilot storage format** — A version-detection layer handles format changes gracefully.
- **Open source (MIT)** — Developed publicly on GitHub with contribution guidelines, issue templates, CI/CD pipelines, and automated publishing.

## Open Questions

> ⚠️ Note: The approach of reading Copilot's internal session files is fragile — the format could change without notice between VS Code versions. The plan acknowledges this and calls for a version-detection layer, but this remains the primary risk.
