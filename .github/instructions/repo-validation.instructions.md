---
name: "Repo Validation"
description: "Use when validating Session Control changes or deciding the smallest correct check after edits. Covers diagnostics, compile-tests, compile, focused tests, npm test, npm run lint, and Development Host smoke tests."
---

# Repo Validation

- Start with touched-file diagnostics.
- If test TypeScript changed, or if compiled tests may be stale, run `npm run compile-tests` before diagnosing behavior from `dist-test/`.
- If source TypeScript changed, run `npm run compile` before broader test passes.
- Prefer the smallest relevant test or behavior check before `npm test`.
- Use `npm test` after focused checks when the change spans multiple units or before handing off a broader verification result.
- Run `npm run lint` after behavior is stable or before commit-ready closeout.
- Finish chat, command, or viewer UX changes with a Development Host smoke test when the environment allows it.
- Do not use plain `node --test`, and treat direct Mocha runs as unreliable in this repo.
- If `dist-test/` disagrees with the source tree, rebuild before diagnosing deeper.
- In the closeout, list the exact checks run and any remaining unverified areas.