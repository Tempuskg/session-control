---
title: "Project Overview"
type: overview
created: 2026-04-12
updated: 2026-04-12
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

**Chat-Commit** is a VS Code extension that saves GitHub Copilot Chat sessions as structured JSON files into a configurable `.chat/` folder in the repo, linked to git commits and branches. Users can resume saved chats via a `@chat-commit` chat participant that loads prior conversation as LLM context.

## Core Value Proposition

Chat sessions with Copilot are ephemeral — they disappear when VS Code is closed or when context is lost. Chat-Commit bridges this gap by:

1. **Persisting conversations** — Saving chat sessions as JSON files alongside the code they relate to.
2. **Linking to git context** — Each saved session captures the branch, commit SHA, and dirty state, tying the conversation to a point in the codebase's history.
3. **Enabling resumption** — A chat participant (`@chat-commit`) can reload a saved session and inject it as context into a new conversation, allowing the LLM to "remember" prior work.
4. **Living in source control** — Sessions are stored as files in the repo (`.chat/`), meaning they can be reviewed in PRs, shared with teammates, and versioned alongside code.

## Two Subsystems

The extension has two main subsystems:

- **[Save System](save-system.md)** — Reads Copilot's internal session storage, transforms it, and writes structured JSON to `.chat/`.
- **[Resume System](resume-system.md)** — A registered [Chat Participant](chat-participant.md) (`@chat-commit`) that loads saved sessions and injects them as LLM context.

## Implementation Phases

The plan is organized into four phases:

| Phase | Focus | Key Deliverables |
|-------|-------|-----------------|
| 1 | Scaffolding | Extension scaffold, `package.json` contributions, commands, settings, chat participant registration |
| 2 | Save System | Session reading, transformation, file writing, bloat controls, auto-save on commit |
| 3 | Resume System | Chat participant handler, context injection, session selection UX, follow-up context management |
| 4 | Polish | Configuration handling, gitignore management, session management commands, status bar |

## Key Design Decisions

- **JSON as primary format** — Machine-parseable for resume; markdown summary embedded for human review.
- **Minimum VS Code `^1.93.0`** — Chat participant API stabilized at this version.
- **Manual save + optional auto-save** — Auto-save on commit is opt-in, manual save is the primary workflow.
- **Relies on internal Copilot storage format** — A version-detection layer handles format changes gracefully.

## Open Questions

> ⚠️ Note: The approach of reading Copilot's internal session files is fragile — the format could change without notice between VS Code versions. The plan acknowledges this and calls for a version-detection layer, but this remains the primary risk.
