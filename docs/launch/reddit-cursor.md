# r/cursor post — Session Control founders launch

**Posts:** Tue 2026-10-27, after the dev.to post (Sun 2026-10-25) and 48 h before r/ClaudeAI
(Thu 2026-10-29). **Framing:** a Cursor user's problem and how they solved it. This is not a launch
announcement (`docs/marketing-plan.md` §5 rank 3: "Must be genuine participation; a drive-by
launch post gets removed"). Never reuse text from `reddit-claudeai.md`. The two posts share no
paragraphs, and they must stay that way.

## Subreddit rules check

Checked 2026-10-24 against dated quotes of the live r/cursor rules (ThreadFox read 2026-10-11;
corroborated by Subriff and ChatterAPI rule lists as of mid-Oct 2026). Direct
`reddit.com/r/cursor/about/rules` still returns a login/redirect wall to automated clients, so
skim the sidebar once logged in on posting morning and update this section if anything changed.

**Rules that govern this post (noted in full where they affect copy or channel):**

1. **Rule 1 — Keep it relevant.** Content must relate to Cursor or AI-assisted coding. Draft
   compliance: leads on Cursor workspace storage + agent-transcripts and `.cursor/rules` export.
2. **Rule 6 — Limit self-promotion.** Sharing your own content is acceptable if relevant and
   valuable; **no more than 10% of your activity across Reddit** may be self-promotional; text
   posts need context; no bad-faith competitor spam. Draft compliance: disclosure in paragraph 1;
   problem → solution framing; build non-promo comment history in r/cursor before 2026-10-27 so
   this post stays under the 10% cap.
3. **Rule 7 — No paid content (hard conflict).** Quote: *Do not post paid content that you
   yourself own… No advertising the sale or exchange of accounts, credentials, or products. This
   is a forum, not a shopping site.* Draft compliance: the free MIT core is the lead; founders
   pricing is transparency, not a checkout CTA. **Before posting:** mod-mail asking whether a
   top-level post that discloses $49 founders / $29/yr / $4/mo (no Polar checkout link) is
   allowed, or whether this belongs only in the Weekly Cursor Project Showcase Thread (and
   whether that thread bans commercial/paid links). If mods say no to any paid mention, strip the
   Founders pricing block from the body and answer price only in comments if asked — do not post
   a sales pitch against Rule 7.
4. **Rule 8 — No spam.** No duplicates; search first. Post once; never paste the r/ClaudeAI text.
5. **Rule 9 — Write quality titles.** Clear, non-clickbait. Draft titles are long and literal;
   prefer the fallback if the form truncates.
6. **Rule 10 — Use flairs.** All posts need an appropriate flair. Pick from the live list
   (Discussion / Question are the usual non-showcase options). Prefer any Showcase / Project flair
   or the weekly megathread if the sidebar points there.
7. **Rule 11 — No slop.** No AI-generated or low-effort posts without substantial human input.
   Draft compliance: **rewrite this body in your own words before posting**; keep facts, drop
   AI cadence. Confirm anecdotes are real.

Also still apply: civil tone (R2), no misinformation on pricing/features (R4), provide context
(R5). Rules 3 (no rants) is N/A.

Sources (dated rule quotes, not a substitute for the live sidebar): threadfox.vip/rules/cursor
(rules read 2026-10-11); subriff.com/subreddit/cursor; chatterapi.com/r/cursor; Weekly Cursor
Project Showcase Thread on r/cursor.

**Before posting:**

1. Logged-in skim of live r/cursor rules + sidebar + any pinned showcase thread. Update notes
   above if Rule 6/7/11 text differs. Pick the flair (or post inside the weekly showcase).
2. Mod-mail about Rule 7 if still unsure; wait for a reply before a top-level paid disclosure.
3. Re-check the $49 price, the 100-buyer cap, the $29/year and $4/month prices and the four
   exclusions against the Polar checkout and `sessioncontrol.dev/terms` that morning. If the cap
   has already been reached, replace the founders section with the regular prices (or omit per
   mod guidance).
4. Replace `[YouTube demo link]` with the published demo URL (`docs/launch/demo-script.md`).
5. Do not add any claim that content never leaves the machine. Answer privacy questions from the
   FAQ in `docs/launch/show-hn.md`.
6. Human rewrite for Rule 11. Stay around for the first two hours and answer every reply within
   24 h (marketing plan §9 Phase 3).

---

## Title

`I kept losing the "why" behind code Cursor wrote, so I built a free extension that saves Cursor chats into the repo next to the commit`

Fallback, if that is too long for the form: `Made a free extension that saves Cursor chats and agent transcripts as files in your repo`

## Body

```markdown
Disclosure up front: I made this, and it has a paid tier, which is covered at the bottom. The part most of you would use is free and MIT-licensed.

My problem was this. Cursor's chat panel is great while you're in the session. Three weeks later I'd open a file, find some odd retry logic the agent wrote, and have no way to get back to the conversation that explained it. Cursor's history lives in its own workspace storage on that one machine. It isn't tied to a commit, and it isn't there at all when I open the same repo in Claude Code or Copilot, which I also use.

So I built **Session Control**, an extension (it installs from Open VSX, so it works in Cursor) that reads Cursor's stores and writes each session into your repo as a plain JSON file under `.chat/`. It reads both of them: the chat sessions in workspace storage, and the agent transcripts under `~/.cursor/projects/<project>/agent-transcripts`. Every saved session records the branch and commit SHA, so `git log` on a file can lead you back to the chat that produced it.

What the free version does in Cursor:

- **Auto-save** for a workspace, so you don't have to remember to save the good sessions
- **Session Explorer** in the sidebar, plus a viewer for reading old sessions
- **Resume** any saved session as context in a new chat, including sessions that started in Claude Code, Codex or Copilot
- One setting to gitignore `.chat/`, if you want the history kept locally but not committed

Saving, browsing, resuming and auto-save run locally and make no network calls of their own. There's no account and no telemetry. One warning: a transcript includes tool calls and terminal output, so read it before you push it to a public repo.

**The Cursor-specific bit I use most:** you can export a saved session as a Cursor rule into `.cursor/rules`. When a session finally gets an agent to follow the project's conventions, I turn it into a rule so the next agent starts there instead of rediscovering it. (Export is in the paid tier, described below.)

**The paid part, Session Control Pro.** It ships in the same extension and unlocks with a key. The main feature is Knowledge Harvesting. You select saved sessions, and they're **sent to an AI model you choose**: a VS Code chat model, or your logged-in Claude Code or Codex CLI. That provider turns them into Markdown notes under `knowledge/` covering pitfalls, decisions and playbooks, each linked to its source session. You review a line diff of every page before anything is written, and it adds a pointer to your agent instruction files so later agents read it. To be clear, this isn't local inference: your selected sessions go to that provider. They don't go to me, because I don't run a server. Pro also adds cross-workspace search, the rule/skill/`AGENTS.md` export above, and push/pull of sessions to a private Git repo you own.

**Founders pricing:** a lifetime Pro license is **$49 one time, for the first 100 buyers only**. After that it's $29/year or $4/month. "Lifetime" means the Pro features inside this extension. It **does not include** the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, or the Knowledge Pack marketplace, if any of those ever ship. Terms: https://sessioncontrol.dev/terms

85-second demo: [YouTube demo link]. Install: search "Session Control" in Cursor's Extensions view. Source: https://github.com/tempuskg/session-control

What I'd like to know from Cursor users is how you handle this today. Do you keep anything from old chats, or start fresh every time? And if a Cursor update breaks the reader (it has happened with other tools' formats), please tell me. It logs unknown formats instead of guessing, so the fix is usually quick.
```

## Checks

- Leads on a Cursor-specific problem and Cursor's own storage. The product comes in the third
  paragraph, and the offer near the end.
- Paid tier disclosed in the first sentence.
- Founders offer in the body: $49, one time, first 100 buyers, and all four lifetime exclusions
  (GitHub App companion, hosted sync or team tier, self-hosted enterprise license, Knowledge Pack
  marketplace).
- Privacy: the local claim is limited to save/browse/resume/auto-save. Harvesting is described as
  sending the selected sessions to the chosen provider. There is no claim that nothing leaves the
  machine.
- No paragraph is shared with `reddit-claudeai.md`, `devto.md` or `show-hn.md`.
- Self-promo rules checked 2026-10-24: Rules 6 (≤10% promo), 7 (No paid content — mod-mail /
  showcase path noted above), 8, 9, 10, 11 (No slop — human rewrite required) are called out in
  the rules-check section.
- **Author to confirm:** the "odd retry logic" anecdote is an illustration. Keep it only if it
  matches a real experience, and otherwise swap in a real one. Reddit punishes invented stories.
