---
name: "AI Control File Implement"
description: "Use when implementing saved analysis recommendations, generated implementation handoffs, or AI-control-file workflow changes in this repo. Covers AGENTS.md, .github/copilot-instructions.md, repository-local instruction files, prompt files, agent files, and skills."
applyTo:
  - "AGENTS.md"
  - ".github/copilot-instructions.md"
  - ".github/instructions/**/*.instructions.md"
  - ".github/prompts/**/*.prompt.md"
  - ".github/agents/**/*.agent.md"
  - ".github/skills/**/SKILL.md"
---

# AI Control File Implementation

- Read `AGENTS.md`, `.github/copilot-instructions.md`, and any user-named analysis report before the first edit. Read `package.json` only when the task depends on commands, contribution points, versioning, or release metadata.
- Start the first implementation reply with `External instructions:` followed by each user-referenced out-of-repo instruction file and one status: `accessible/applied`, `accessible/ignored`, `inaccessible`, or `out-of-scope`. If none were referenced, say `External instructions: none`.
- Inspect `git status --short` and `git diff -- <candidate AI files>` before editing.
- Before the first edit, use at most one repo-wide search and one targeted search. Skip directory listings or wildcard scans when exact AI-control-file paths are already known.
- If the current surface lacks tool or workspace access, use handoff-first behavior instead of claiming direct implementation.
- Make the smallest safe AI-control-file edit in the same turn. If that is not possible, return one concrete blocker and one recovery path.
- Keep saved-analysis implementation changes scoped to repository-local AI control files unless the report explicitly expands scope.
- Do not create or update Copilot memory or user-level repo notes during repository-local AI-control-file analysis or implementation. Persist durable guidance only in repo-local AI control files.
- Defer repo-wide documentation sweeps until names and UX are stable unless an append-only log rule requires an immediate update.
- Avoid reading unrelated prompt or policy files unless the active task depends on them.
- After the first substantive edit, run one focused validation action before widening scope. Use touched-file diagnostics first, then the smallest relevant repo command.
- After the first focused validation, continue implementing the remaining explicitly requested in-scope AI-control-file items in the same request. Stop only if scope expands or a concrete blocker appears.
- End implementation replies with `Status`, `Changed files`, `Commands run`, `Results`, `Blockers`, `Unverified`, and `Next step`.
- In multi-repo workspaces, return per-repo closeouts first and keep assumptions isolated per repository.