---
type: Playbook
title: Run the full repository validation sequence before handoff
description: "Compile, test, lint, and inspect the final diff before handing off a repository change."
tags: [validation, testing, linting, handoff]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f5151-24e1-70d0-b894-79031a7e0788.md
source_commits: [028655e]
provider: codex
confidence: 0.9
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:55bd47c004feb7457b14b15c51759a0f43e2d0305883bd5fc9afa27f64303973"
---
# Preconditions

- The implementation changes are complete.
- The repository’s npm scripts and test suite are available.
- Any unrelated worktree changes have been identified and must be preserved.

# Steps

1. Compile the test code with `npm.cmd run compile-tests`.
2. Compile the extension with `npm.cmd run compile`.
3. Run the repository’s test entry point with `npm.cmd test`; do not substitute a direct Node test invocation.
4. Run lint with `npm.cmd run lint`.
5. Check the diff for whitespace errors with `git diff --check`.
6. Review the final diff to confirm the patch is limited to the intended changes and record any unverified manual checks, such as visible UI smoke tests.

# Expected outcome

Compilation succeeds, the full test suite passes, lint is clean, `git diff --check` reports no issues, and the final diff is suitable for handoff.

# Citations
1. [Session 019f5151-24e1-70d0-b894-79031a7e0788](../sessions/019f5151-24e1-70d0-b894-79031a7e0788.md)
