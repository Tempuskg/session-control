# Session Control Wiki — Schema & Conventions

This file defines how the LLM maintains the wiki for the **session-control** VS Code extension project. It is the authoritative reference for structure, workflows, and conventions.

## Coding Agent Workflow

For `/implement`, `/proceed`, direct implementation requests, or generated implementation handoffs in this repo:

1. Read `AGENTS.md`, `.github/copilot-instructions.md`, any repo-local AI control files, and any referenced analysis report before the first edit. Read `package.json` only when the task depends on commands, contribution points, versioning, or release metadata.
2. Acknowledge any user-referenced external instruction file and state whether it is accessible from the current workspace, applied, ignored, or out of repo scope.
3. Run `git status --short` and a scoped `git diff -- <candidate files>` before broad diagnostics or edits.
4. Before the first edit, use at most one repo-wide search and one targeted search. Prefer owner-file reads over broad exploration, skip directory listings when exact paths are already known, and avoid subagents unless blocked or intentionally parallelized.
5. If a request implies coding-agent behavior or implementation handoff, first verify whether the design uses a plain `request.model.sendRequest` call or a tool-enabled agent, tool, or MCP flow. If it is plain LM, warn that workspace files and tools will not be available before implementing.
6. After preflight, make the smallest safe edit in the same turn or state one concrete blocker. Investigation-only implementation turns are not sufficient.
7. Once an owner file is identified, stop adjacent filename fishing and only reopen the same hotspot with a new hypothesis.
8. If workspace access is unavailable, reply once with the blocker and one recovery path: request full access, ask for pasted files, or generate a handoff prompt. Reuse a fresh referenced analysis report for `/handoff`; do not require `/analyze` again unless no current report exists.
9. Validate in this order when applicable: touched-file diagnostics, `npm run compile-tests`, `npm run compile`, focused relevant tests, `npm test`, `npm run lint`, then a Development Host smoke test for interactive behavior. Do not use plain `node --test`, and treat direct Mocha runs as unreliable in this repo. If `dist-test` disagrees with source, rebuild before diagnosing deeper.
10. For renames, enumerate slash commands, command-palette commands, followup labels, prompt text, tests, docs/wiki, plans, and AI control files. Ask whether the rename applies to all surfaces before editing. Do one final stale-reference sweep before reporting done.
11. Delay `README`, `wiki`, and `CHANGELOG` edits until command names and UX are stable unless the user explicitly asks for docs now.
12. Batch progress into milestone summaries instead of progress-only narration unless blocked or waiting for input.
13. Analysis recommendations may target only repository-local AI control files: `AGENTS.md`, `.github/copilot-instructions.md`, and when present `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`, and similar local AI instruction files. If evidence is insufficient, say so instead of recommending source, test, build, or general documentation changes.
14. When multiple repositories are open, record repo name, branch or commit, dirty state, workspace scope, source-of-truth repo, artifact owner, and shared contract owner before acting.
15. Re-read local AI instructions in every repo, and re-read `package.json` only when the task depends on repo metadata such as commands, contribution points, versioning, or release flow. Do not reuse commands, conventions, or assumptions from memory or another repo.
16. Do not create or update Copilot memory or user-level repo notes during repository-local AI-control-file analysis or implementation. Persist durable guidance only in repo-local AI control files.
17. Use memory or auxiliary tool reads only when the retrieved state changes the next step. Prefer targeted existence checks over broad wildcard scans.

## Quick Start / Known Constraints

- Before entering `chat-commit`, start with `AGENTS.md`, `.github/copilot-instructions.md`, and the latest referenced analysis report. Read `package.json` only when the task depends on commands, contribution points, versioning, or release metadata.
- Start with `git status --short`, then a scoped `git diff -- <candidate files>` before broader diagnostics.
- Common owner files for session-control and chat-command work are `src/chatParticipant.ts`, `src/analysisStore.ts`, `src/sessionAnalysis.ts`, `src/analysisOrchestrator.ts`, `src/extension.ts`, `src/types.ts`, `package.json`, and the nearest unit tests.
- `src/chatParticipant.ts` is a hotspot; interactive chat or command changes need a Development Host smoke test.
- Validate in this order when applicable: touched-file diagnostics, `npm run compile-tests`, `npm run compile`, focused relevant tests, `npm test`, `npm run lint`, then a Development Host smoke test.
- Check both the current implementation handoff command surface and command-palette surfaces for drift before closing rename or command work.
- For plan-only or AI-control-only requests, update only plan/control files and explicitly state that implementation code did not change.
- Use plain relative file paths in summaries and handoffs.
- Strict optional-property typing is active in this repo, so omit optional keys rather than passing `undefined`.
- Plain chat participants are not coding agents unless tool and workspace access are explicitly wired.
- Repo type: VS Code extension. For patch version bumps, prefer `npm run version:build`. For explicit version sets, use the documented exact `npm version` path without automatic git tag or commit creation.
- Release-relevant files are `package.json`, `package-lock.json`, `README.md`, and `scripts/bump-package-version.cjs`. Verify only the expected release files for versioning tasks.
- On resumed chats, re-read the current version and workspace state before release steps, and prefer repo scripts or repo-local AI skills over generic CLI advice.
- Evidenced local AI files here are `AGENTS.md` and `.github/copilot-instructions.md`; `CLAUDE.md` was not evidenced.

- Defer `README.md`, `wiki/`, `CHANGELOG.md`, and plan/status-file sync until the changed surface passes one green targeted validation step, unless the user explicitly asks for docs now or an append-only log rule requires immediate logging.

## Multi-Repo Preload Packet

- Record repo name, branch or commit, dirty state, workspace scope, source-of-truth repo, artifact owner, and shared contract owner for each open repository before acting.
- Re-read local AI instructions and `package.json` in every repository before applying repo-specific rules.
- Keep assumptions, persistence rules, validation results, and closeouts isolated per repository until the user explicitly asks for cross-repo synthesis.
- Do not carry command names, validation commands, or capability assumptions from memory or another repository.

---

## Directory Layout

```
session-control/
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
