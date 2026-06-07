---
name: github-instructions-saved-chat-analysis-instructions
description: "Imported repository guidance from .github/instructions/saved-chat-analysis.instructions.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.github/instructions/saved-chat-analysis.instructions.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

# Saved Chat Analysis

- Keep changes scoped to repository-local AI control files unless the current report or user explicitly expands scope.
- Read the referenced report, `AGENTS.md`, `.github/copilot-instructions.md`, and any relevant local instruction files before the first edit.
- For repository-local AI-control-file analysis, do not read user-profile prompt files, workspaceStorage memories, Copilot memory, or other non-repository customization artifacts unless the user explicitly puts them in scope. Treat them as out-of-scope for gap comparison.
- Before emitting gap-only recommendations, load `AGENTS.md`, `.github/copilot-instructions.md`, and the relevant local `*.instructions.md`, `*.prompt.md`, `*.agent.md`, and `SKILL.md` files. Summarize the existing guidance by theme, emit only net-new gaps with a target file and exact instruction text, and say the comparison is incomplete if relevant file contents are missing.
- Start with `git status --short` and a scoped `git diff -- <candidate AI files>` before editing.
- Update prompt scope, prompt version, report or index provenance, and status labels together when the change affects saved-analysis metadata.
- Keep planned, shipped, partial, blocked, and manual-smoke-only states distinct in summaries and saved-analysis follow-ups.
- If a generated implementation prompt is executed with full workspace access, restate the operative user request before editing.
- Validate with touched-file diagnostics first, then the smallest command that exercises the changed analysis workflow when executable validation exists.
- If evidence is insufficient for a broader change, say so and stop at the AI-control-file boundary.
