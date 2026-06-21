---
name: github-instructions-command-surface-rename-instructions
description: "Imported repository guidance from .github/instructions/command-surface-rename.instructions.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.github/instructions/command-surface-rename.instructions.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

# Command Surface Rename

- Decide up front whether the rename applies to slash commands, command-palette commands, follow-up labels, prompt text, docs, tests, and AI control files.
- Inventory at minimum: `package.json` command and chat-participant declarations, `src/chatParticipant.ts`, `src/extension.ts`, nearby tests, `README.md`, `wiki/`, plans, and repository-local AI control files.
- Ask before removing compatibility aliases. Default to keeping aliases, fallback wording, or transitional prompts until explicit removal is requested.
- When reusing a previously removed or renamed command name, compare the old and new semantics explicitly and ask before repurposing the old name for different behavior. State which aliases remain and which were removed.
- After edits, run one stale-reference sweep across both the old and new names before reporting done.
- Prefer focused validation: touched-file diagnostics first, then `npm run compile-tests` or `npm run compile` for changed TypeScript surfaces, then relevant tests, then a Development Host smoke test when the rename changes user-facing command flows.
- Defer repo-wide README, wiki, and changelog sweeps until names and UX are stable unless the request explicitly includes docs or an append-only log requires immediate updates.
- In the closeout, state which surfaces were renamed, which aliases remain, and what was validated.
