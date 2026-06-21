---
name: github-instructions-repo-validation-instructions
description: "Imported repository guidance from .github/instructions/repo-validation.instructions.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.github/instructions/repo-validation.instructions.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

# Repo Validation

- Start with touched-file diagnostics.
- On Windows PowerShell, do not use `&&` in `Shell` commands. For stop-on-failure sequences, either run separate `Shell` calls or use PowerShell-safe chaining such as `cmd1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; cmd2`.
- If test TypeScript changed, or if compiled tests may be stale, run `npm run compile-tests` before diagnosing behavior from `dist-test/`.
- If source TypeScript changed, run `npm run compile` before broader test passes.
- Prefer the smallest relevant test or behavior check before `npm test`.
- Use `npm test` after focused checks when the change spans multiple units or before handing off a broader verification result.
- Run `npm run lint` after behavior is stable or before commit-ready closeout.
- Finish chat, command, or viewer UX changes with a Development Host smoke test when the environment allows it.
- Do not use plain `node --test`, and treat direct Mocha runs as unreliable in this repo.
- If `dist-test/` disagrees with the source tree, rebuild before diagnosing deeper.
- In the closeout, list the exact checks run and any remaining unverified areas.
