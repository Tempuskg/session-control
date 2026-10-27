# r/ClaudeAI post — Session Control founders launch

**Posts:** Thu 2026-10-29, 48 h after r/cursor (Tue 2026-10-27) and the day before Show HN
(Fri 2026-10-30). **Framing:** what I learned about keeping Claude Code's context across sessions,
with the tool as the answer. This is not a launch announcement (`docs/marketing-plan.md` §5 rank 3
and §9 Phase 2: "never the same day, never identical text"). This draft shares no paragraphs with
`reddit-cursor.md`, and it must stay that way.

## Subreddit rules check

Checked 2026-10-24 against dated quotes of the live r/ClaudeAI rules (ThreadFox read 2026-09-26;
Rule 7 "glowup" mod post and the Claude Project Showcase Discussion Hub on the sub corroborate
the same criteria). Direct `reddit.com/r/ClaudeAI/about/rules` still login-walls automated
clients, so skim the sidebar and pinned megathreads once logged in on posting morning.

**Rules that govern this post (self-promotion / showcase):**

1. **Rule 2 — Be relevant.** Claude / Claude Code only. Draft compliance: cold Claude Code
   sessions, `~/.claude/projects/`, `CLAUDE.md` / `.claude/rules` pointer.
2. **Rule 7 — Showcase your project in a way that helps educate and inspire others.** Promoting
   your project or paid service is **encouraged** if all of these hold (quoted paraphrase of the
   live rule text):
   - Clear that the project was built with Claude / Claude Code **by you** (or specifically for
     Claude)
   - Clear description of what was built, how Claude helped in detail, and what it does
   - **Project must be free to try and say so** (paid tiers OK)
   - Promotional language minimal
   - No referral / affiliate links (direct project link OK)
   - No job-seeking / resumes
   - **Feed posts require OP karma > 100** (ThreadFox 2026-09-26; earlier hub posts said ≥50 —
     use the stricter live number). If under the threshold, post only in the Project Showcase
     megathread.
   Draft compliance: disclosure + free MIT core in paragraph 1; "How Claude was used" + two
   real prompt lines; paid founders terms at the end with no Polar checkout URL; no referral
   links. Tone check: keep marketing speak low (Rule 7 glowup).
3. **Rule 9 — Use relevant post flair.** Prefer **Built with Claude** unless the live list has a
   better Project / Showcase flair. If a pinned Showcase hub says feed posts must go there, post
   in that megathread instead of (or as well as) a top-level post.
4. **Rule 3 — Be constructive / not duplicate spam.** Post once; never cross-post the r/cursor
   body. Before 2026-10-29, answer a few unrelated Claude Code questions so this isn't the
   account's only activity.
5. **Rules 4 / 8 — Megathreads.** Performance/bug rants go in megathreads, not here. N/A for this
   showcase post, but don't hijack those threads to promo.

Also apply: respectful (R1), no upvote manipulation (R10), Reddit-compliant (R12). Competitor
comparison homework (R6) is N/A unless the post starts ranking Claude vs others.

Sources (dated rule quotes + official sub posts): threadfox.vip/rules/claudeai (rules read
2026-09-26); r/ClaudeAI Rule 7 glowup mod announcement; Claude Project Showcase Discussion Hub
(updated 2026-09-05); Anthropic "Built with Claude" contest post (format precedent).

**Before posting:**

1. Logged-in skim of live r/ClaudeAI rules, sidebar, and pinned Showcase / megathread posts.
   Confirm Rule 7 bullet list and the current karma threshold. Update notes above if they differ.
   Pick flair (Built with Claude) or post inside the Showcase hub.
2. Confirm account total karma clears the feed threshold; otherwise Showcase megathread only.
3. Re-check the $49 price, the 100-buyer cap, the $29/year and $4/month prices and the four
   exclusions against the Polar checkout and `sessioncontrol.dev/terms` that morning. If the cap
   has already been reached, replace the founders paragraph with the regular prices.
4. Replace `[YouTube demo link]` with the published demo URL, and add one screenshot of the
   harvest review panel.
5. Do not add any claim that content never leaves the machine. Harvesting sends the selected
   sessions to the provider the user picks. If the user picks Claude Code, that provider is
   Anthropic. Answer privacy questions from the FAQ in `docs/launch/show-hn.md`.
6. Say explicitly in the body that the core is free to try (already present). Soften any leftover
   sales cadence. Show HN is the next day, so finish answering replies here on Thursday.

---

## Title

`Claude Code forgets everything between sessions. I built a free extension that keeps the sessions in the repo and turns them into notes the next session reads`

Fallback: `Built with Claude Code: saving Claude Code sessions next to the commit, then harvesting them into CLAUDE.md-linked notes`

## Body

```markdown
I built this, mostly in Claude Code sessions, and it has an optional paid tier. Pricing is at the end so you can skip it. The core is free and MIT-licensed.

**What kept going wrong.** Every new Claude Code session starts cold. I'd spend twenty minutes in one session finding out that our test runner has to be launched a particular way, and a week later a fresh session would hit the same wall and burn the same twenty minutes. The answer existed. It was sitting in a JSONL file under `~/.claude/projects/`, one of hundreds, and nothing pointed the new session at it. Adding things to `CLAUDE.md` by hand helped, but I only remembered to do it about half the time.

**Step one: keep the sessions.** Session Control is a VS Code extension (also on Open VSX for Cursor and the other forks). It finds the Claude Code transcripts for the open workspace, which live in the `~/.claude/projects/` folder named after the workspace path, and saves them as JSON under `.chat/` in the repo, stamped with the branch and commit. It does the same for Codex, Copilot and Cursor sessions, so a problem solved in one assistant can be resumed as context in another. Saving, browsing and resuming are local file operations, with no account or telemetry.

**Step two, the paid part: make the next session read them.** Knowledge Harvesting takes the sessions you select and sends them to the model you pick, which can be your logged-in `claude` CLI, so it runs on the Claude plan you already have. Be aware that this means the selected transcripts go to Anthropic, or to whichever provider you choose instead. That's the same as pasting them into a chat yourself. Nothing goes to me; there's no Session Control server. The model distills them into linked Markdown under `knowledge/` (pitfalls, decisions, playbooks), and every page cites its source session. A review panel shows a line diff for each page, and nothing is written until you approve. Last, it adds a short pointer in `CLAUDE.md` (or `.claude/rules/`) so the next Claude Code session knows the notes are there and reads them before starting.

That pointer turned out to be the bit that matters. Since I started using it, Claude Code opens a session in this repo by reading the pitfall about the test runner instead of rediscovering it.

**How Claude was used.** Most of the extension was written with Claude Code, and the saved sessions in the repo are the record of that. The harvest prompt took the most iteration. These two lines from it do most of the filtering:

> A durable concept must remain useful weeks from now. Skip routine back-and-forth, one-off answers, and facts already obvious from the repository.
>
> Pitfall: a non-obvious failure plus its identified cause, fix, or workaround.

Other Pro features: search across all your workspaces' sessions, export a session as a Claude Code skill (`.claude/skills/<name>/SKILL.md`), Cursor rule or `AGENTS.md` section, keep skills in sync across assistants, and move sessions between machines through a Git remote that only you control.

**Pricing.** There's a Founders Lifetime license at **$49 one time, limited to the first 100 buyers**. After that it's $29/year or $4/month. Lifetime covers the Pro features in the Session Control extension and **excludes** the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, and the Knowledge Pack marketplace, should any of them exist later. Full terms: https://sessioncontrol.dev/terms

Demo (85 s): [YouTube demo link] · Install: search "Session Control" in Extensions · Code: https://github.com/tempuskg/session-control

Question for heavy Claude Code users: how are you carrying context between sessions now? A hand-kept `CLAUDE.md`, memory files, something else? I'd like to know where this fits, or doesn't.
```

## Checks

- Leads on a Claude Code problem (cold sessions, `~/.claude/projects/` transcripts, `CLAUDE.md`).
  The product is in the third paragraph, and pricing is last.
- Paid tier disclosed in the first sentence. Follows the "Built with Claude" format: what, how, a
  demo, and a prompt.
- Founders offer in the body: $49, one time, first 100 buyers, and all four lifetime exclusions
  (GitHub App companion, hosted sync or team tier, self-hosted enterprise license, Knowledge Pack
  marketplace).
- Privacy: says that harvesting sends the selected sessions to Anthropic, or the chosen provider.
  The local claim is limited to saving, browsing and resuming. There is no claim that nothing
  leaves the machine.
- The two prompt lines are quoted verbatim from `session-control-pro/src/knowledgeHarvest.ts`
  (handoff prompt and classifier type lines, as of 0.9.0). Re-check them if the prompt changes
  before posting.
- Self-promo rules checked 2026-10-24: Rule 7 (showcase criteria, free-to-try, paid tiers OK,
  karma >100 for feed / else Showcase megathread) and Rule 9 (Built with Claude flair) are
  called out in the rules-check section.
- **Author to confirm:** the opening anecdote (twenty minutes lost to how the test runner has to
  be launched) and the follow-up line about Claude Code now reading that pitfall are drafted from
  this repo's own history (the `npm test` harness pitfall). Keep them only if they match your
  experience, and otherwise replace them with a real example. Reddit punishes invented stories.
- No paragraph is shared with `reddit-cursor.md`, `devto.md` or `show-hn.md`. A 6-word overlap
  check on 2026-10-22 found shared phrases only in the required founders terms (prices and the four
  exclusions), which must stay word-for-word accurate.
