---
name: "Saved Chat Analysis"
description: "Use when implementing or updating saved chat analysis flows, analysis reports, implementation handoffs, or report status and provenance handling in Session Control."
---

# Saved Chat Analysis

- Keep changes scoped to repository-local AI control files unless the current report or user explicitly expands scope.
- Read the referenced report, `AGENTS.md`, `.github/copilot-instructions.md`, and any relevant local instruction files before the first edit.
- Start with `git status --short` and a scoped `git diff -- <candidate AI files>` before editing.
- Update prompt scope, prompt version, report or index provenance, and status labels together when the change affects saved-analysis metadata.
- Keep planned, shipped, partial, blocked, and manual-smoke-only states distinct in summaries and saved-analysis follow-ups.
- If a generated implementation prompt is executed with full workspace access, restate the operative user request before editing.
- Validate with touched-file diagnostics first, then the smallest command that exercises the changed analysis workflow when executable validation exists.
- If evidence is insufficient for a broader change, say so and stop at the AI-control-file boundary.