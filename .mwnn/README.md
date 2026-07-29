# MWNN Kanban board files

This folder is the source of truth for the MWNN Kanban board in this workspace.

## Files

- `columns.json` stores the ordered column layout, roles, and WIP or reverse-WIP limits.
- `cards/<card-id>.md` stores one card per markdown file with frontmatter for column, position, assignee, dependencies (`dependsOn`), and timestamps.
- `README.md` documents the contract for humans and AI agents editing the board directly.

## Card workflow

1. Find work in `cards/*.md`, usually filtering for `assignee: { kind: ai, ... }` when an AI agent is involved.
2. Add or update the `## Activity` section to claim work and report progress.
3. Update the `## Description` and `## Acceptance criteria` sections as the slice becomes better defined or completes.
4. Move a card by editing its `column` and `position` frontmatter values.
5. Respect column `wipLimit` values and the Ready column `reverseWip` minimum from `columns.json`.

The extension watches this folder and reloads the board after external edits.
