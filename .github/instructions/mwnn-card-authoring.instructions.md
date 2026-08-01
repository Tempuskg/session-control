---
name: "MWNN Card Authoring"
description: "Use when creating or editing MWNN Kanban board cards directly on disk as .mwnn/cards/<id>.md files (e.g. importing a plan, or any AI card generation). Covers the exact card-file frontmatter and section contract, id/position rules, and column mapping."
applyTo:
  - ".mwnn/cards/**/*.md"
  - ".mwnn/columns.json"
---

# MWNN Card Authoring

The MWNN Kanban board's source of truth is the workspace board folder (default
`.mwnn/`, configurable via `mwnn-kanban.boardFolder`). The extension watches that
folder and reloads the open board after external edits, so writing well-formed
card files is enough to add cards — do not call any API or command.

## Where cards live

- `<boardFolder>/columns.json` — ordered columns with `id`, `title`, `role`,
  `wipLimit`, `reverseWip`. Read it first to map a column to its `id`.
- `<boardFolder>/cards/<card-id>.md` — one card per file. The file's base name
  must equal the card's `id` (e.g. `card-abc123.md` holds `id: card-abc123`).
- Only touch files under the board folder. Never edit `columns.json` unless the
  task is explicitly about columns.

## Completion and re-dispatch preflight

Before creating, editing, or dispatching work for an existing card:

1. Read the card and `columns.json`; identify the card's current column `id`,
   title, and role. Do not infer status from the card title or from an old
   session summary.
2. Inspect the card's `## Activity` and every acceptance checkbox, then verify
   any claimed completion evidence in the repository (for example, the named
   files, focused tests, or build result).
3. If the card is in a done/completed column, or its acceptance criteria are
   already satisfied by current evidence, do not implement or dispatch it
   again. Preserve the existing card and record concise evidence in `Activity`
   only when the workflow requires a durable update.
4. If a prior dispatch is recorded but acceptance evidence is incomplete or
   contradictory, continue only with the unmet criteria and explain the gap in
   `Activity`; do not duplicate already completed work.
5. Create a new card only when the requested work is genuinely outside the
   existing card's scope. Link the new card to the existing card when a real
   dependency exists.

Treat acceptance evidence and the current board state as authoritative workflow
state. A prior assistant response, a timestamp, or an unchecked box by itself
does not prove completion.

## Card file shape

```md
---
id: card-abc123
title: Add login form
column: col-ready
position: 1000
assignee: { kind: ai }
createdAt: 1719360000000
updatedAt: 1719360000000
---

## Description
What the slice of work is.

## Acceptance criteria
- [ ] A verifiable condition

## Activity
```

### Frontmatter fields

- `id` (required) — unique across the whole board. Use `card-<base36-ms>-<n>`,
  e.g. `card-mqwtekyi-2`. Never reuse an id that already exists in `cards/`.
- `title` (required) — the card's one-line title.
- `column` (required) — a real column `id` from `columns.json` (e.g.
  `col-mqwk2njn-1`), **not** the column title.
- `position` (required) — an integer that orders the card within its column,
  ascending. New cards go **after** the current maximum position in that column,
  stepping by ~1000 (so if the column's largest position is 4000, use 5000, 6000,
  …). This preserves the order in which you write them.
- `createdAt` (required) — Unix epoch milliseconds.
- `updatedAt` (optional) — Unix epoch milliseconds; usually equal to `createdAt`
  for a new card. Omit the key entirely rather than writing an empty value.
- `assignee` (optional) — `{ kind: ai }`, `{ kind: ai, name: Codex }`, or
  `{ kind: human, name: Alice }`. Omit for unassigned.
- `dependsOn` (optional) — array of ids of other cards this card is blocked by,
  e.g. `[card-x, card-y]`. The card stays blocked until every listed card reaches
  a `done` column, and a blocked card cannot advance past the Ready column.
  Reference only ids that exist (or that you are creating in the same batch);
  never list the card's own id or form a cycle. Omit the key when empty.

### Scalar quoting (match the extension's parser)

Values are bare YAML-ish scalars. JSON-quote a `title` or any scalar when it is
empty, starts or ends with whitespace, or contains any of `:` `{` `}` `[` `]`
`"` `#`. Example: `title: "Refactor: split the store"`. Plain values need no
quotes: `title: Add login form`.

### Body sections

Always include these three level-2 headings in this order, even when empty:

- `## Description` — a concise explanation of the slice. A card counts as
  "defined" (for the Ready column's reverse-WIP) only when this is non-empty.
- `## Acceptance criteria` — a markdown checklist (`- [ ] …`) of verifiable
  conditions, or empty.
- `## Activity` — a dated log; leave empty for a freshly created card.

## Rules

- Keep files minimal and valid; a malformed file is skipped on reload.
- Preserve the order you intend by assigning ascending `position` values.
- Do not renumber or rewrite existing cards when adding new ones.
- After writing files, the extension reloads automatically — no command needed.
