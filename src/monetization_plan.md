# Session Control Pro Private Code Start Guide

## Monetization-Optimized Execution Order

This section reorders the work in this document by shortest path to first dollar and highest expected return per hour of solo-maintainer time. Steps are tagged so it is obvious which ones a human must do personally vs. which can be delegated to a coding agent or automation.

### Legend

- 👤 Human-only — judgment, identity verification, banking, legal, marketing voice, pricing calls, channel relationships. Cannot be delegated.
- 🤝 Human-led, agent-assisted — human decides and approves; agent can draft, scaffold, or research.
- 🤖 Agent-suitable — code, packaging, refactors, listing copy iteration, tests. Safe to hand to an LLM agent with review.

The order below assumes the 100:1 Open VSX reframe from the analysis section is correct: the audience is polyglot AI-tooling users on Cursor / Claude Code / Codex / Windsurf, willing to pay $7–10/mo, and Open VSX is the primary channel.

### Phase 0 — Lock the contract (≤ 1 day, do before any code)

These cost nothing but prevent the most expensive mistake (gating something that is already free and burning trust with the existing ~2,000 install base).

- 👤 Write the frozen free contract. One paragraph. Lock save, import, resume, provider picker, basic browsing, basic per-repo history as permanently free. This is a trust commitment, not a code change.
- 👤 Write the first-wave Pro contract. One paragraph. Pick exactly one headline Pro feature for v1. Top candidate: Knowledge Harvesting (OKF) — analyze saved chat sessions and emit an Open Knowledge Format bundle of reusable concepts (playbooks, references, decisions, code patterns) into the user's repo. Alternative candidates: bidirectional skills bridge (Copilot ↔ Cursor ↔ Claude ↔ Codex) or Global Session Search. Do not pick more than one. See the "Knowledge Harvesting (OKF) — Pro Feature Spec" section below for the full design.
- 👤 Pick pricing. Decide on $7–10/mo individual and a founders-lifetime number ($79–$99). Decide whether to offer team pricing in v1 (recommend: no).
- 👤 Pick the billing provider. Choose Polar.sh or Lemon Squeezy (both merchant-of-record, both handle GST/VAT for a solo Canadian seller). Do not default to @riff-tech/code-checkout-vscode without comparing — it is not MOR.
- 🤝 Name the private package. Recommended: repo session-control-pro, package @tempuskg/session-control-pro. Agent can validate npm-name availability; human approves final name.

### Phase 1 — Revenue infrastructure (≤ 1 week, this is what actually unblocks money)

Counter-intuitively, payment plumbing comes before the Pro feature is built. If billing is not wired, even a finished Pro feature earns $0. This phase is the bottleneck.

- 👤 Create the billing account (Polar.sh or Lemon Squeezy). Identity verification, tax ID (Canadian GST/HST number or sole-proprietor info), bank account, payout method. Cannot be delegated.
- 👤 Create the private GitHub repo session-control-pro. Human owns the org and seat permissions.
- 👤 Create the private npm registry access (GitHub Packages or npm scoped private). Tokens must be issued by a human; agent can store them in .env and CI secrets afterward.
- 🤖 Scaffold the private package (package.json, tsconfig.json, src/index.ts, src/registerProFeatures.ts, src/types.ts, maintainer README.md). Pure boilerplate work.
- 🤖 Add the public-side Pro boundary in session-control. Create src/pro/contracts.ts, src/pro/loader.ts, src/pro/upgrade.ts. Define the ProFeatureRegistrar interface. Make the public extension load the private package only when available and degrade gracefully when absent.
- 🤖 Wire the license-check entrypoint. Single hasProLicense() + showUpgradePrompt() function pair. One place, not scattered. Stub returns false until billing returns a real key.
- 👤 Generate the first real license key end-to-end through Polar/Lemon Squeezy in a sandbox and verify it activates the stubbed Pro path on a test VS Code install. This validates the money pipe before any feature is built on top of it.

### Phase 2 — Distribution hygiene (parallel with Phase 1, ≤ 1 week)

Open VSX is your primary channel. Marketplace is residual. Optimize the channel that already brought you 2,000 users before you spend a single hour on the channel that brought 20.

- 🤝 Audit and rewrite the Open VSX listing. Agent drafts; human approves. Target keywords: cursor, claude code, codex, windsurf, chat history, session manager, ai sessions, cross-ide. Lead with "Save your Cursor / Claude Code / Codex chat history across git commits."
- 🤖 Add screenshots and a short GIF to the Open VSX listing. Agent can generate the README markup; human captures and approves the visuals.
- 🤝 Re-check the VS Code Marketplace listing. Same keyword work. Cheap; do not over-invest. 30-minute smoke test on stock VS Code + stock Copilot to confirm the extension activates correctly outside the forks (the 20-install number may partly be a residual-activation bug).
- 👤 Set up a minimal landing page (one page, no backend). Headline: "Your AI conversations never leave your machine — until you choose to sync." List free features, list the one Pro feature, link to checkout. A static site (GitHub Pages, Cloudflare Pages) is enough.
- 👤 Buy the domain if one is not already owned. Human-only by definition.

### Phase 3 — Ship the one Pro feature (≤ 2 weeks)

Now and only now do you build product. The infrastructure above means the day the feature lands, it is sellable the same hour.

- 🤝 Spec the v1 Pro feature in detail. If Knowledge Harvesting (OKF): define the extractor prompts, the OKF concept-type vocabulary used (e.g. Playbook, Reference, Decision, CodePattern, Pitfall), the target bundle path (default ./knowledge/), the merge / dedupe rules against existing concepts, and the log.md update convention. If skills-bridge: define the source-of-truth model, the four format mappings (.github/copilot-instructions.md ↔ .cursor/rules/ ↔ .claude/skills/ ↔ AGENTS.md / Codex prompts), and the conflict-resolution UX. Human owns the spec; agent can draft. The full OKF spec is in the "Knowledge Harvesting (OKF) — Pro Feature Spec" section below.
- 🤖 Implement the Pro command behind the Pro boundary. Register a single command (e.g. Session Control: Harvest Knowledge to OKF Bundle, Session Control: Sync AI Skills Across IDEs, or Session Control: Global Session Search).
- 🤖 Gate the command with the hasProLicense() check and route unlicensed users to one upgrade prompt — no nags, no timers.
- 🤖 Write tests for both paths (licensed and unlicensed) and for the graceful-degradation case when the private package is absent entirely.
- 🤝 Internal QA. Human installs the public extension fresh, with and without a license, on VS Code stock and on at least one fork (Cursor or VSCodium).

### Phase 4 — Launch and convert the existing install base (≤ 1 week)

The 2,000 Open VSX users are the warmest leads you will ever have. They installed and kept the extension before it cost anything.

- 👤 Announce the founders-lifetime offer ($79–$99, first 100 buyers). Post in: r/cursor, r/ClaudeAI, r/LocalLLaMA, Cursor Discord, Codex GitHub Discussions, Anthropic forums, Hacker News (Show HN), a short YouTube demo. Voice and timing are human decisions.
- 🤝 In-extension upgrade notice (one-time, dismissible, never nags). Agent implements; human writes the copy.
- 👤 Update README badges and CHANGELOG under the project's existing release process (scripts/bump-package-version.cjs or npm run version:build per repo conventions). The release click is human; the version bump can be agent-prepared.
- 👤 Reply personally to the first 20 paying customers. Single biggest retention lever a solo founder has. Cannot be delegated.

### Phase 5 — Validate before expanding (≥ 30 days of data before Phase 6)

Do not start Phase 6 until you have at least 30 days of paid-conversion data from Phase 4. Premature expansion is the most common solo-founder failure mode.

- 👤 Review conversion data weekly. Installs, upgrade-prompt views, checkout starts, checkout completes, refund rate, churn. Decide whether the one Pro feature is the right one or whether to swap.
- 👤 Decide go / no-go on a second Pro feature. Only add a second feature if conversion exceeds ~1.5% of weekly active installs. Otherwise iterate on the first.
- 🤝 Collect qualitative feedback from the first 20–50 paying users (email, Discord). Agent can summarize; human reads every reply.

### Phase 6 — Expand only after validation (months 2–6)

Each item below is independently profitable and can be sequenced based on observed demand. Do not start any of these in months 0–1.

- 🤝 Add the second Pro feature (likely the other of: skills-bridge / global search / sessions→skills exporter / user-owned-git sync).
- 👤 Self-hosted enterprise license ($1.5k–$5k/yr). Pricing, contract, and first sales call are human-only.
- 🤝 GitHub App companion ("Session Review") as a separate revenue stream. Agent builds; human owns the marketplace listing and pricing.
- 👤 "AI workflow audit" productized service ($499–$1,999). Pure human service offering using the existing analyze pipeline as the deliverable.
- 🤝 SaaS sync / team tier. Only after a clear ask from ≥ 10 paying customers. Backend work is agent-suitable; pricing and contracts are human.
- 🤝 Knowledge Pack marketplace (long-term, venture-shaped). Defer until base business is profitable.

### What never gets delegated

These are 👤 human-only regardless of how good agent tooling becomes:

- Pricing decisions and pricing changes.
- Identity verification, banking, tax registration.
- Final approval on any change to the free contract.
- First-customer outreach and replies.
- Public posts under the project's name on Reddit / HN / Discord (voice, ban risk, community judgment).
- Refund decisions and edge-case support calls.
- Legal: privacy policy, terms of service, refund policy.
- Domain and trademark.

### Anti-patterns to avoid (re-stated for the execution order)

- ❌ Building the Pro feature before billing is wired. You will sit on finished code with no way to charge.
- ❌ Polishing the VS Code Marketplace listing before the Open VSX listing. Wrong channel.
- ❌ Starting with SaaS sync, team features, or analytics. Premature backend.
- ❌ Gating multi-assistant support or the resume picker. Bait-and-switch on existing free users.
- ❌ Scattering license checks across the codebase. One entrypoint, one prompt.
- ❌ Spending a week comparing all five billing providers. Pick Polar or Lemon Squeezy, move on.

## Goal

Start a private Pro codebase without breaking the trust or maintainability of the existing free extension.

The recommended shape is:

- Keep session-control as the public extension repo.
- Keep the core save, import, and resume experience free.
- Put additive Pro features in a private package or private repo.
- Ship one extension install, not a separate free and Pro extension.

## Guardrails

Before touching code, lock in these rules:

- Keep current free behavior free.
- Keep provider support free.
- Keep Pro focused on power workflows, not basic compatibility.
- Keep the first Pro release small enough to maintain alone.

For Session Control, that means:

- Free: save, import, and resume across supported providers.
- Free: provider picker for resume targets such as Copilot, Codex, and Claude Code.
- Pro: global search, tags and notes, PR helper, cross-repo workflows, future team features.

## Recommended Architecture

Use a public extension repo + private Pro package model.

Why this is the best starting point:

- You keep one marketplace listing and one install surface.
- Free users still get a complete product.
- Pro code stays private.
- You avoid maintaining two separate extensions.

Target shape:

```
Public repo:  session-control
Private repo: session-control-pro

session-control
- src/
- src/pro/
- package.json

session-control-pro
- src/
- package.json
```

The public repo owns:

- the extension entrypoint
- free features
- shared session schema
- Pro interfaces and loaders

The private repo owns:

- Pro commands
- Pro panels
- Pro search and tagging logic
- license-aware Pro entrypoints

## Step By Step

### 1. Freeze the free contract

Write down exactly what will remain free before you create any private code.

Suggested free contract for Session Control:

- Save sessions from supported providers.
- Resume sessions into supported providers.
- Basic session browsing.
- Basic local per-repo history.
- Basic provider picker.

Suggested first-wave Pro contract:

- Global cross-repo search.
- Tags and notes.
- PR summary helper.
- Saved filters and pinned sessions.

This matters because once the boundary is fuzzy, Pro planning turns into drift.

### 2. Pick the private package name

Use a name that makes the relationship obvious.

Recommended:

- repo: session-control-pro
- package: @tempuskg/session-control-pro

Avoid vague names like premium, business, or internal-tools.

### 3. Create the private repo

Create a new private GitHub repo dedicated to Pro code.

Keep it small on day one:

- README.md
- package.json
- tsconfig.json
- src/index.ts
- src/registerProFeatures.ts
- src/types.ts

The first README.md should define:

- what Pro owns
- what stays in public
- how releases are consumed by the public extension

### 4. Decide how the public repo consumes Pro

Start with a private npm package consumed by the public extension.

That is usually cleaner than Git submodules or subtree sync for a solo maintainer.

Recommended flow:

- Publish @tempuskg/session-control-pro to a private registry.
- Install it in the public repo as a dependency.
- Load it only when available.

This gives you:

- a stable package boundary
- versioned Pro releases
- a simple rollback path

### 5. Add a tiny Pro boundary in the public repo

Before importing any real private code, define a narrow contract in the public repo.

Create a public-side interface for something like:

```typescript
export interface ProFeatureRegistrar {
  register(context: vscode.ExtensionContext): void;
}
```

The point is to keep the public repo in charge of:

- activation
- shared services
- extension lifecycle

And keep the private repo in charge of:

- extra commands
- extra views
- gated workflows

### 6. Keep the first Pro feature narrow

Do not start by moving a bunch of existing code behind a paywall.

Start with one Pro feature that is:

- clearly valuable
- self-contained
- easy to explain in one sentence

Best first candidate for Session Control:

- Global Session Search

Good second candidate:

- Tags and Notes

Avoid starting with:

- provider integrations
- resume provider picker
- basic import/save/resume flows

Those strengthen the product funnel and should keep feeding the free tier.

### 7. Build a no-license local stub first

Before wiring billing, get the private package loading cleanly in development.

Phase 1 behavior:

- public extension loads Pro package if installed
- Pro commands register successfully
- commands run without payment checks in local dev

This proves your packaging boundary before money enters the room.

### 8. Add a simple entitlement layer second

After the package boundary works, add a thin license check.

Keep the first version minimal:

```typescript
hasProLicense(): Promise<boolean>
showUpgradePrompt(): Promise<void>
```

Do not spread licensing checks all over the codebase.

Instead:

- check entitlement at the Pro command entrypoint
- route non-paying users to one upgrade flow

### 9. Keep the public repo resilient when Pro is absent

The public extension must still compile and run if the private Pro package is unavailable.

That means:

- no hard dependency in free flows
- no extension activation failure
- no broken commands for free users

The right mental model is:

- Pro is an optional capability layer
- free is the default product

### 10. Create a clear folder boundary in the public repo

Even before you add the private package, reserve a small public boundary such as:

```
src/pro/
- contracts.ts
- loader.ts
- upgrade.ts
```

Keep everything else in normal feature folders.

This helps later when you need to answer:

- what is public
- what is private
- what belongs to the shared model

### 11. Write the upgrade story before the feature story

Define the user-facing upgrade path early.

You want one clean message:

> Session Control Pro unlocks global search, tags, and PR helpers.

Then define where users see it:

- command palette upgrade command
- blocked Pro command prompt
- README comparison table

Avoid repeated nags, timers, or popups.

### 12. Treat provider support as shared foundation

Claude Code integration should make the free product stronger unless a specific Claude-only workflow is clearly premium.

Good free Claude work:

- import Claude Code sessions
- detect Claude Code sessions
- resume into Claude Code
- provider picker support

Possible Pro Claude work:

- cross-provider search including Claude
- compare Claude vs Copilot vs Codex answers
- provider-aware PR summaries

### 13. Set up release rules now

Decide this before the first private line of code:

- public repo can release without Pro
- Pro package can version independently
- marketplace release notes explain free vs Pro clearly

Recommended versioning rule:

- public extension version follows user-visible release cadence
- private package version follows internal compatibility changes

### 14. Add internal documentation for yourself

In the private repo, create a short maintainer doc covering:

- how to publish the package
- how the public repo installs it
- what secrets are needed
- how to test a Pro build locally

Future-you will thank present-you for this one.

### 15. Ship one Pro slice, then stop and review

Your first milestone should be:

- private package loads
- one Pro command exists
- one upgrade flow exists
- free extension still works unchanged

Do not start building teams, SaaS sync, analytics, or multiple Pro panels before this milestone is real.

## Suggested First Milestone

If you want the cleanest possible start, do this first:

1. Create private repo session-control-pro.
2. Publish private package @tempuskg/session-control-pro.
3. Add src/pro/contracts.ts and src/pro/loader.ts in the public repo.
4. Load the private package from the public extension.
5. Register one Pro command: Session Control: Global Session Search.
6. Gate that command with a single upgrade prompt.
7. Leave Claude Code integration and resume target picker in free.

## What Not To Do

- Do not make a separate Pro extension yet.
- Do not gate provider support.
- Do not move existing free features behind Pro.
- Do not start with cloud sync.
- Do not let licensing checks spread through free code paths.

## Knowledge Harvesting (OKF) — Pro Feature Spec

This is the recommended v1 Pro feature for Session Control. It turns the existing pile of saved chat sessions — which today are mostly write-only logs — into a durable, agent-readable knowledge corpus that lives in the user's own repo, in a standardized format anyone can read with cat.

### Why this is the right v1 Pro feature

- It compounds the free product instead of gating it. Saving sessions stays free. Browsing them stays free. Only the synthesis into a reusable bundle is Pro. Free users lose nothing they had yesterday.
- It is uniquely yours. Cursor, Copilot, Claude Code, and Codex do not produce structured cross-session knowledge bundles. None of them can, because none of them see across providers the way Session Control already does.
- It hits the actual audience. The 100:1 Open VSX audience is polyglot AI-tooling users. They have hundreds of sessions per repo across 3–4 assistants. The pain point is "I solved this six weeks ago in a Claude session and now I can't find it." OKF harvesting solves that directly.
- It is privacy-coherent with the brand. The bundle is written to the user's repo. Nothing leaves the machine. Matches the "Your AI conversations never leave your machine" wedge.
- The output is portable. OKF is plain markdown + YAML frontmatter. Bundles can be committed to git, shared across teams, indexed by any RAG system, or fed back to any AI assistant as context. Vendor-neutral by design.
- It strengthens the enterprise upsell. A self-hosted enterprise license (Phase 6 expansion) becomes "your org's AI knowledge corpus, captured automatically, kept on your infrastructure."

### What OKF is (one-paragraph summary for the spec reader)

Open Knowledge Format (OKF) v0.1 is a minimal Google-published spec for representing knowledge as a directory of markdown files with YAML frontmatter. A bundle is the directory. A concept is one markdown file with a required type: field and an optional title, description, resource, tags, and timestamp. Concepts cross-link with standard markdown links. index.md files give progressive disclosure; log.md files record change history. There is no schema registry, no required tooling, and unknown fields are preserved. If you can cat a file, you can read it; if you can git clone a repo, you can ship it.

### User-facing flow

1. User runs Session Control: Harvest Knowledge to OKF Bundle from the command palette (or @session-control /harvest from chat).
2. Extension picks a scope: current repo, current session, selected sessions from the explorer, or all sessions for this repo.
3. Extension shows a dry-run preview: proposed concepts (filename + type + title + one-line description), grouped by directory, with merge/skip/conflict indicators against any existing bundle.
4. User confirms; extension writes (or updates) the bundle at the configured path (default ./knowledge/).
5. Extension appends an entry to ./knowledge/log.md recording what was harvested, from which sessions, at what timestamp.
6. Extension surfaces a summary toast: "Harvested 14 new concepts, updated 3, skipped 22 duplicates. View bundle → ./knowledge/index.md".

### Default bundle layout

```
<repo-root>/knowledge/
├── index.md                       # Auto-generated progressive-disclosure index
├── log.md                         # Append-only harvest history
├── playbooks/                     # type: Playbook — multi-step procedures
│   ├── index.md
│   └── <slug>.md
├── decisions/                     # type: Decision — recorded architectural decisions
│   ├── index.md
│   └── <slug>.md
├── references/                    # type: Reference — facts, configs, snippets
│   ├── index.md
│   └── <slug>.md
├── patterns/                      # type: CodePattern — reusable code idioms
│   ├── index.md
│   └── <slug>.md
├── pitfalls/                      # type: Pitfall — known gotchas and their fixes
│   ├── index.md
│   └── <slug>.md
└── sessions/                      # type: SessionSummary — one summary per source session
    ├── index.md
    └── <session-id>.md
```

The directory layout is producer-defined per the OKF spec, so it can evolve. The list above is the default vocabulary the harvester ships with; users can override via configuration. sessions/ provides citation targets so every harvested concept can cite the session it came from.

### Concept frontmatter conventions

Every emitted concept follows OKF v0.1 §4.1. Required and recommended fields:

```yaml
---
type: Playbook                                # REQUIRED — one of the vocabulary types above
title: Resume a Cursor session into Copilot   # Recommended
description: Step-by-step procedure to bridge a Cursor chat into a Copilot resume target.
tags: [cursor, copilot, resume, cross-ide]
timestamp: 2026-06-26T15:20:00Z
# Session Control extensions (preserved per OKF §4.1 extensions rule):
source_sessions:
  - sessions/cursor-2026-06-12-abc123
  - sessions/copilot-2026-06-18-def456
source_commits:
  - 51201d6
provider: multi                                # copilot | cursor | claude-code | codex | multi
confidence: 0.82                               # extractor self-rated 0–1
harvested_by: session-control-pro@<version>
---
```

The non-spec keys (source_sessions, source_commits, provider, confidence, harvested_by) are producer-defined extensions that OKF explicitly permits, and consumers that do not understand them MUST preserve them on round-trip.

### Cross-linking rules

- Every harvested concept SHOULD cite the session(s) it was derived from using a # Citations section linking to /sessions/<id>.md per OKF §8.
- Concepts that reference other concepts use bundle-relative absolute links (/playbooks/foo.md) per OKF §5.1 — stable across moves.
- Broken links are tolerated per OKF §5.3 (a not-yet-written concept is a valid future target).

### Extraction pipeline (technical sketch)

1. **Source selection.** Use the existing sessionStore + sessionReader to enumerate sessions in scope.
2. **Chunking.** Split each session into request/response turns (the existing SavedTurn discriminated union already supports this).
3. **Classification.** Run a per-turn LLM call (user's configured model) with a tight prompt: "Does this turn contain durable knowledge worth extracting? If yes, classify as one of: Playbook | Decision | Reference | CodePattern | Pitfall | none."
4. **Synthesis.** For each non-none chunk, run a second LLM call that produces a self-contained markdown concept body plus YAML frontmatter. The prompt enforces OKF structure (frontmatter delimiters, required type, conventional # Examples / # Citations headings).
5. **Deduplication.** Hash the normalized body + frontmatter title. If a concept with the same slug exists, diff and offer merge/skip/replace. Reuse the existing analysisStore patterns for idempotent writes.
6. **Index regeneration.** Rebuild index.md files at every directory level by scanning frontmatter. Per OKF §6, entries should include the linked concept's description.
7. **Log append.** Append a dated entry to <bundle>/log.md per OKF §7, newest first, with the conventional **Creation** / **Update** prefix.

### Configuration surface

```json
// settings.json — under "session-control.knowledge"
{
  "session-control.knowledge.bundlePath": "./knowledge",
  "session-control.knowledge.conceptTypes": [
    "Playbook", "Decision", "Reference", "CodePattern", "Pitfall", "SessionSummary"
  ],
  "session-control.knowledge.minConfidence": 0.6,
  "session-control.knowledge.includeProviders": ["copilot", "cursor", "claude-code", "codex"],
  "session-control.knowledge.autoHarvestOnCommit": false,
  "session-control.knowledge.dryRun": true
}
```

### Free vs Pro split for this feature

| Capability | Free | Pro |
|---|---|---|
| View an existing OKF bundle in the session explorer | ✅ | ✅ |
| Manually copy text out of a session into a markdown note | ✅ | ✅ |
| Run Session Control: Harvest Knowledge to OKF Bundle | ❌ | ✅ |
| Auto-harvest on commit | ❌ | ✅ |
| Cross-repo harvest (aggregate bundle across repos) | ❌ | ✅ (later) |
| Sessions → AI-control-files reverse-export (.cursor/rules/, .claude/skills/, AGENTS.md) | ❌ | ✅ (later) |

Reading bundles stays free forever. Producing bundles is the Pro gate. This matches the "add capabilities, never subtract" rule.

### Validation and conformance

- The harvester MUST emit bundles that pass OKF §9 conformance: parseable frontmatter on every non-reserved .md, non-empty type field, reserved-filename rules honored.
- Ship a small okf-lint step inside the Pro package that runs after every harvest, surfaces non-conformance, and refuses to write a non-conformant bundle. This protects users from silently corrupting their knowledge repo.
- Declare the OKF version in the bundle root index.md via okf_version: "0.1" per OKF §11.

### Risks specific to this feature

- **Model quality.** Bad extractions are worse than no extractions. Mitigations: (a) minConfidence gate, (b) mandatory dry-run preview before first write, (c) every concept cites its source session so users can verify and (d) log.md makes harvests reversible via git.
- **Cost.** Extraction is LLM-token-heavy. Default to the user's already-configured Copilot / Cursor / Claude / Codex model — do not ship a separate API key requirement. Add a per-harvest token-cost estimate to the dry-run preview.
- **Privacy.** The harvester runs locally and writes locally; no network egress from the extension. State this prominently in the upgrade prompt and on the landing page.
- **Schema drift.** OKF is v0.1 / draft. Pin the implementation to v0.1 explicitly via okf_version and add a migration step when the spec bumps.

### Why this beats the alternative v1 candidates

| Candidate | Strength | Weakness |
|---|---|---|
| Knowledge Harvesting (OKF) | Compounds value, output portable, privacy story, enterprise-ready, vendor-neutral spec | LLM-cost-sensitive; extraction quality is the bar |
| Skills-bridge (Copilot ↔ Cursor ↔ Claude ↔ Codex) | Solves a real pain for polyglot users | Pure-glue feature; harder to charge $10/mo for "format conversion" |
| Global Session Search | Easy to ship | Commoditizable; any text indexer can replicate it |

Pick Knowledge Harvesting as the v1 Pro feature unless the dry-run quality bar cannot be met within Phase 3's two-week budget; in that case fall back to Skills-bridge, then Global Search.

## Decision Summary

The best way to start private Pro code for Session Control is:

- one public extension
- one private Pro package
- free provider support
- Pro power workflows
- one narrow first Pro feature

That gives you a much cleaner foundation than trying to split the whole product in half on day one.

## Strategy Analysis & Audience Insights

Consolidated from session do-you-agree-with-the-ranked-top-5-monetization-strategies-in-monetization-r-035232c7-b31 (Cursor, 2026-06-24, branch main, commit 51201d6). This section critiques the ranked top-5 strategies in Monetization_research..md against the actual shipping product and the install-channel data, then layers additional recommendations on top.

### TL;DR

The research's primary recommendation (freemium + Pro, code-checkout, $5–7/mo, SaaS later) is directionally correct but several of the specific Pro features it suggests would damage trust by gating capabilities the free extension already ships. The real Pro tier should be built around what is uniquely yours: the analyze / implement chat-participant pipeline, the cross-IDE skills bridge, and the commit-to-session linkage — not "multi-assistant," which is already part of the free product.

The single most important new data point: Open VSX has ~2,000 installs and the VS Code Marketplace has ~20 at the same time, a 100:1 ratio in the opposite direction of the usual pattern. That reframes everything below.

### Where the Ranked Top-5 Is Correct

- Freemium + Pro is the right primary model. Matches every successful VS Code extension business (GitLens+, Wallaby, Quokka, TabNine, Continue Pro).
- Do not degrade the free tier. Add capabilities, never subtract. This is the single rule that protects the existing organic install base.
- Subscriptions beat one-time for a tool that must track VS Code, Copilot, Cursor, Codex, and Claude API churn.
- SaaS sync / team as v2, not v1. Validate willingness-to-pay locally before burning months on a backend.
- Donations alone are weak. Correct.

### Where the Ranked Top-5 Is Wrong or Shallow

#### 1. Several proposed "Pro features" are already in the free product

The research repeatedly suggests gating multi-assistant support (Copilot + Cursor + Codex + Claude Code) and a PR / commit helper behind Pro. The extension's package.json description already reads: "Save and resume GitHub Copilot, Cursor, Codex, and Claude Code chat sessions linked to git commits."

- Multi-assistant is the free baseline. Gating it is bait-and-switch on existing users.
- analyzeSavedChats + implementLatestAnalysis is the existing session-to-action pipeline. Moving it to Pro would feel like a take-away.

#### 2. The research undervalues the real moat

Two genuinely differentiated surfaces are absent from the ranked list:

- @session-control /analyze + /implement chat-participant flow — Cursor and most other forks do not support chat participants, so this is structurally Copilot / VS Code-native. It is the most defensible thing shipping today.
- Skills-import bridge (importCopilotSkillsToCursor / …ToCodex / …ToClaudeCode) — bridging AI-control files across IDEs is exactly the pain teams hit when they adopt more than one assistant. The research missed this entirely.

#### 3. Distribution lever was buried (now superseded — see "100:1 Reframe")

Original critique: "VS Code Marketplace is where ~95% of paying devs live, publish there as step 1." That assumption was wrong for this product — see the channel-mix section below.

#### 4. Vendor lock-in on @riff-tech/code-checkout-vscode

The research pushes this in every section without comparing alternatives. Realistic options for a solo Canadian seller with a global dev audience:

| Option | Merchant-of-record | VAT / GST handled | Indie-friendly | Notes |
|---|---|---|---|---|
| @riff-tech/code-checkout-vscode | No (Stripe direct) | No | Yes | Fast to wire, but you handle global tax |
| Polar.sh | Yes | Yes | Excellent | Built for OSS / indie devs, low fees |
| Lemon Squeezy (Stripe-owned) | Yes | Yes | Yes | Mature, slightly higher fees |
| Paddle | Yes | Yes | OK | Best for higher ACV / B2B |
| Stripe direct + JWT license server | No | No | Yes (if you have infra) | Most control, most work |

For this case, merchant-of-record matters a lot — VAT / GST registration in 30+ jurisdictions will eat the year. Lean Polar or Lemon Squeezy over code-checkout.

#### 5. Pricing benchmarks were guesses, not data

"$5–7/mo individual" is repeated without a single comparable cited with real MRR. Useful real data points:

- GitLens+ — $4/mo individual, $20/user/mo team
- Wallaby.js — $200/yr individual, $300/user/yr team
- Tabnine Pro — $12/user/mo
- Continue Team — $20/user/mo
- Cursor Pro — $20/mo (sets the ceiling for individual-dev AI tooling)

Session Control is a sidecar to a primary AI tool, so it should price below the primary tool — but see the 100:1 reframe below for an upward revision.

### The 100:1 Reframe (Open VSX vs VS Code Marketplace)

Install mix: ~2,000 on Open VSX, ~20 on the VS Code Marketplace despite simultaneous publication. The typical ratio for the same extension runs the other direction (Marketplace beats Open VSX 50:1 or worse). The inversion is the most important signal in this whole analysis.

#### What the 100:1 ratio means

Microsoft's ToS forbids non-VS-Code editors (Cursor, Windsurf, VSCodium, Codium, Positron, Trae, etc.) from pulling from the official Marketplace — those editors are forced to use Open VSX. So when installs concentrate 100:1 on Open VSX:

The audience is not stock-VS-Code users. It is polyglot AI-tooling power users on forks.

This is internally consistent with the product. The people who need cross-assistant session management are people running 2–4 AI tools at once. Pure VS Code + Copilot users typically have one assistant and lean on Copilot's built-in history. The 20 Marketplace installs are probably residual cases — devs who tried Copilot, hit its history limits, and went looking. The bulk of the audience self-selected onto Cursor / Windsurf / Claude Code and discovered the extension via Open VSX.

#### How this rewrites the monetization plan

**Higher willingness to pay than originally assumed**

Cursor users pay $20/mo. Windsurf users pay. Claude Code users pay API. Codex CLI users pay API. This is not the "Copilot is free via my employer" crowd. They are already comfortable with monthly AI tooling spend.

Revised pricing target: $7–10/mo individual, $12–20/seat team. They have budget; the bar is being obviously worth it.

**Open VSX is the primary channel, not the Marketplace**

Reverse the earlier prioritization. Listing optimization, screenshots, GIFs, search keywords, and category placement on Open VSX matter more than on Marketplace. Marketplace stays as a residual channel.

**SEO / content should target the forks, not "VS Code"**

| Not this | This instead |
|---|---|
| "VS Code AI session manager" | "Save your Cursor chat history across git commits" |
| "Copilot chat history" | "Persistent memory for Claude Code, Codex, and Cursor sessions" |
| "How I monetized a VS Code extension" | "How I built a cross-IDE session manager for Cursor / Claude / Codex users" |

Content targets: r/cursor, r/ClaudeAI, r/LocalLLaMA, Cursor Discord, Codex GitHub Discussions, Anthropic forums — not r/vscode.

**The skills-bridge becomes the killer Pro feature**

For an audience juggling 3+ AI tools, the existing importCopilotSkillsToCursor / …ToCodex / …ToClaudeCode flow is the most valuable thing shipping. The Pro extension should be:

- Bidirectional skills sync (Cursor rules ↔ Claude skills ↔ Codex prompts ↔ Copilot instructions). One source of truth across all four IDEs. Genuinely painful for users today; nobody else builds it.
- Sessions → skills exporter ("turn this great Claude session into a reusable Cursor rule").
- Cross-provider analyze ("show me the patterns that recur in my Claude AND Cursor sessions for this repo").

These are non-leaky against the free product and uniquely valuable to the audience the data actually shows.

**Paywall infrastructure under Open VSX constraints**

The "pricing" / trial field in package.json is a VS Code Marketplace concept that Open VSX does not render. The paywall must run entirely inside the extension via a license-key flow.

- code-checkout works but is Marketplace-flavored — fine, not necessary.
- Polar.sh and Lemon Squeezy work identically well for Open VSX users. Both are MOR (handle global VAT / GST), which matters for a solo Canadian seller.
- The license-check code path is the same regardless of which marketplace the user installed from.

#### The 20 Marketplace installs are a data point, not a problem

Do not try to "fix" the Marketplace number — it is a symptom of audience composition, not a listing problem. Two cheap experiments are worth running anyway:

- Re-check the Marketplace listing for ranking on cursor, claude code, codex, chat history, session. If buried, fix keywords / description. Will not change the 100:1 but might double the 20.
- Verify the extension actually works on stock VS Code 1.93+ with stock Copilot — there is a chance something subtle activates differently outside the forks and Marketplace users churn after one try. Worth a 30-minute smoke test.

#### Data that would sharpen the next decision

The 100:1 ratio is the most important number on hand but still ambiguous without funnel data. The Open VSX dashboard gives downloads but not impressions or page views. The Marketplace publisher dashboard gives:

- Page impressions
- Page-view-to-install rate
- Search queries that landed on the listing
- Uninstalls / retention

That data would resolve whether Marketplace is "20 installs out of 50 page views" (listing fine, audience just is not there) versus "20 installs out of 5,000 page views" (listing / keywords broken). Very different actions.

### Additional Strategies (Beyond the Ranked Top-5)

Tailored to what is actually built, not generic VS Code monetization advice.

1. **"AI workflow audit" productized service ($499–$1,999).** Use the analyze output as the deliverable. Sell to engineering managers at orgs running Copilot Enterprise who have no visibility into how it is being used. Lead-gen: free extension → audit → retainer.
2. **GitHub App companion ("Session Review").** Post session summaries to PRs automatically. Separate marketplace, separate revenue stream, leverages the existing commit-to-session linkage. Could be the actual SaaS, not generic "sync."
3. **Sessions → AI-control-files exporter (Pro).** The extension already imports Copilot guidance into Cursor / Codex / Claude Code. The reverse (sessions → .cursor/rules/, .claude/skills/, AGENTS.md, *.instructions.md) is novel, non-leaky against current free, and a clean Pro gate.
   - **3a. Knowledge Harvesting → OKF bundle (Pro, recommended v1).** Analyze saved chat sessions and emit an Open Knowledge Format bundle (markdown + YAML frontmatter) of reusable concepts — playbooks, decisions, references, code patterns, pitfalls — into the user's own repo at ./knowledge/. Vendor-neutral, privacy-coherent (writes locally), portable across any RAG stack or AI assistant, and a clean Pro gate because reading bundles stays free while producing them is paid. See the "Knowledge Harvesting (OKF) — Pro Feature Spec" section earlier in this document for the full design.
4. **User-owned-Git sync (Pro, no SaaS required).** Let Pro users point at a private git remote for cross-machine session sync. Zero backend, infinite trust, ships in a weekend. Beats building auth + storage from scratch.
5. **Self-hosted enterprise license ($1.5k–$5k/yr).** For orgs that cannot let AI chat history leave their network. High margin, low support load once Pro exists.
6. **"Founders pricing" lifetime ($79–$99, first 100 buyers).** Bootstraps early MRR-equivalent cash, creates urgency, gives a public number to point at, does not cripple free.
7. **Affiliate / cross-promo with Continue.dev, Cline, etc.** Adjacent open-source AI tools without history features. Mutual install boost.
8. **GitHub Sponsors "Org" tier as B2B-lite.** Some procurement departments approve OSS sponsorships faster than per-seat licenses. Layer on top of Pro.
9. **"Knowledge Pack" marketplace (long-term).** Let users publish session-derived skill packs ("FastAPI testing pack", "Terraform debugging pack"). Take 20%. The only path to a venture-scale outcome from this codebase.
10. **Privacy-first marketing wedge.** Make it the headline: "Your AI conversations never leave your machine — until you choose to sync." This is a wedge against Cursor / Copilot themselves, who cannot credibly claim it.

### Revised 30-Day Plan

| Research's plan | Revised plan |
|---|---|
| Week 1: positioning + scope Pro | Week 1: Open VSX listing optimization + positioning around Cursor / Claude / Codex audience. Distribution channel hygiene before paywall. |
| Week 2: wire code-checkout, Stripe | Week 2: pick Polar or Lemon Squeezy (MOR), wire one Pro command (skills-bridge or sessions→skills exporter). |
| Week 3: UX + pricing + landing page | Week 3: landing page + "founders lifetime $79" offer to convert existing install base. Pricing $7–10/mo individual. |
| Week 4: launch + DEV.to post | Week 4: launch via r/cursor, r/ClaudeAI, Cursor Discord, HN Show HN, YouTube demo — not r/vscode or DEV.to-only. |

### Risks Underplayed by the Research

- **Microsoft moves into your lane.** Copilot is rumoured to be adding native chat history persistence. The moat must be cross-IDE + privacy + the analyze / implement pipeline, not just "save Copilot chats."
- **Open VSX vs VS Code Marketplace policy drift.** Marketplace terms restrict telemetry / payment patterns more than Open VSX. Read the current paid-extension policy before shipping.
- **Chat participant API stability.** The @session-control /analyze flow depends on a still-evolving API. Hedge by ensuring the same value is reachable via plain commands.
- **Tax / compliance for a solo Canadian seller.** Pick MOR billing now, not later.

### Strategic Shift Recap (from the chat session)

- Audience identity, confirmed by the 100:1 ratio: polyglot AI-tooling power users on Cursor / Windsurf / Claude Code / Codex / VSCodium — not stock-VS-Code users. Pricing, positioning, and channel selection all reflect that.
- Open VSX is the primary distribution channel. Do not waste cycles trying to fix the Marketplace number; it is a residual-audience symptom, not a listing failure.
- Higher pricing tolerance than initially estimated — $7–10/mo individual is defensible because these users already pay $20/mo for Cursor and / or API fees for Claude / Codex.
- Knowledge Harvesting (OKF) is the recommended v1 Pro feature, with the skills-bridge as the strong alternate. Harvesting analyzes saved chat sessions and emits an OKF bundle of reusable, vendor-neutral concepts into the user's repo — turning write-only session logs into a durable, agent-readable knowledge corpus. Both options are non-leaky against the current free product and uniquely valuable to the polyglot AI-tooling audience.
- Paywall must be in-extension (license-key flow) because Open VSX has no native trial / pricing UI. Polar.sh or Lemon Squeezy (both merchant-of-record) are the cleanest fits for a solo Canadian seller.
- Content / marketing channels: r/cursor, r/ClaudeAI, Cursor Discord, Codex GitHub Discussions — not r/vscode or DEV.to-only.

### Source

- Chat session: .chat/do-you-agree-with-the-ranked-top-5-monetization-strategies-in-monetization-r-035232c7-b31.json
- Provider: Cursor
- Branch / commit: main @ 51201d6 (dirty)
- Saved: 2026-06-24
- Referenced research: Monetization_research..md
