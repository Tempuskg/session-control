# Chat-Commit Wiki — Schema & Conventions

This file defines how the LLM maintains the wiki for the **chat-commit** VS Code extension project. It is the authoritative reference for structure, workflows, and conventions.

---

## Directory Layout

```
chat-commit/
├── AGENTS.md          # This file — wiki schema & LLM instructions
├── PLAN.md            # Original project plan (reference, not wiki-managed)
├── raw/               # Raw source documents (immutable, LLM reads only)
│   └── assets/        # Images, diagrams, attachments
├── wiki/              # LLM-maintained wiki (markdown files)
│   ├── index.md       # Master index of all wiki pages
│   ├── log.md         # Chronological log of wiki operations
│   ├── overview.md    # Project overview & synthesis
│   └── ...            # Entity, concept, and topic pages
└── src/               # (future) Extension source code
```

---

## Layers

### 1. Raw Sources (`raw/`)
- Immutable collection of source documents: plans, articles, research, transcripts, images.
- The LLM **reads** from `raw/` but **never modifies** files here.
- When adding a new source, place it in `raw/` with a descriptive filename.
- Images and attachments go in `raw/assets/`.

### 2. Wiki (`wiki/`)
- LLM-generated and LLM-maintained markdown files.
- The LLM **owns** this directory entirely — creates, updates, and deletes pages.
- The human reads and browses; the LLM writes and maintains.

### 3. Schema (`AGENTS.md`)
- This file. Defines conventions, page formats, and workflows.
- Co-evolved by human and LLM as the project grows.

---

## Page Conventions

### Filenames
- Lowercase, kebab-case: `save-system.md`, `session-format.md`
- Entity pages: named after the entity (e.g., `chat-participant.md`)
- Concept pages: named after the concept (e.g., `context-injection.md`)
- Source summaries: `source-{slugified-title}.md`

### Frontmatter
Every wiki page starts with YAML frontmatter:

```yaml
---
title: "Page Title"
type: overview | entity | concept | source-summary | comparison | analysis
created: 2026-04-12
updated: 2026-04-12
sources:
  - raw/plan.md
tags:
  - architecture
  - save-system
related:
  - wiki/overview.md
  - wiki/session-format.md
---
```

### Page Body
- Start with a `# Title` heading matching the frontmatter title.
- Use `## Section` headings for structure.
- Cross-reference other wiki pages using relative links: `[Session Format](session-format.md)`.
- Cite raw sources with relative paths: `[PLAN.md](../raw/plan.md)`.
- Flag contradictions or open questions with a `> ⚠️ Note:` blockquote.
- Keep pages focused — one entity or concept per page. Split if a page grows beyond ~300 lines.

---

## Special Files

### `wiki/index.md`
- Master catalog of all wiki pages.
- Organized by type (overview, entities, concepts, source summaries, analyses).
- Each entry: `- [Page Title](filename.md) — one-line summary`
- Updated on every ingest or page creation.
- The LLM reads this first when answering queries.

### `wiki/log.md`
- Append-only chronological log.
- Each entry format:
  ```
  ## [YYYY-MM-DD] operation | Subject
  Brief description of what was done.
  Pages touched: page1.md, page2.md, ...
  ```
- Operations: `ingest`, `query`, `lint`, `update`, `create`, `restructure`
- Parseable: `grep "^## \[" wiki/log.md | tail -5`

---

## Workflows

### Ingest a New Source
1. Human places source document in `raw/`.
2. LLM reads the source document.
3. LLM discusses key takeaways with the human.
4. LLM creates a source summary page in `wiki/` (type: `source-summary`).
5. LLM updates `wiki/index.md` with the new page.
6. LLM updates all relevant existing wiki pages (entity, concept, overview) with new information.
7. LLM flags any contradictions with existing wiki content.
8. LLM appends an entry to `wiki/log.md`.

### Query the Wiki
1. Human asks a question.
2. LLM reads `wiki/index.md` to identify relevant pages.
3. LLM reads relevant wiki pages.
4. LLM synthesizes an answer with citations to wiki pages and raw sources.
5. If the answer is substantial (comparison, analysis, new insight), LLM offers to file it as a new wiki page.
6. LLM appends a query entry to `wiki/log.md`.

### Lint the Wiki
1. LLM reviews all wiki pages for:
   - Contradictions between pages
   - Stale claims superseded by newer sources
   - Orphan pages with no inbound links
   - Important concepts mentioned but lacking their own page
   - Missing cross-references
   - Data gaps that could be filled
2. LLM reports findings and suggests fixes.
3. LLM applies fixes with human approval.
4. LLM appends a lint entry to `wiki/log.md`.

### Update a Page
1. When new information arrives (new source, query insight, lint finding):
2. LLM updates the relevant page's content.
3. LLM updates the `updated` field in frontmatter.
4. LLM adds/updates cross-references.
5. LLM updates `wiki/index.md` if the summary changed.

---

## Tags Vocabulary
Use these tags consistently across pages:

- `architecture` — system design, layers, components
- `save-system` — session saving, file writing, bloat control
- `resume-system` — session resuming, context injection
- `chat-participant` — VS Code chat participant API
- `session-format` — JSON schema, data structures
- `configuration` — user settings, options
- `git-integration` — git metadata, auto-save on commit
- `vscode-api` — VS Code extension APIs
- `ux` — user experience, UI, interactions
- `types` — TypeScript types and interfaces
- `phase-1` through `phase-4` — implementation phases

---

## Output Formats
Wiki content is primarily markdown. When useful, the LLM may also produce:
- **Comparison tables** — for feature comparisons, tradeoffs
- **Mermaid diagrams** — for architecture, flow charts (```mermaid blocks)
- **JSON examples** — for data format documentation

---

## Notes
- The wiki is version-controlled via git alongside the source code.
- At current scale (~1 source, <20 pages), the index file is sufficient for navigation. No embedding-based search needed yet.
- As the project grows, consider adding `qmd` or a simple search script.
