# Follow-up mentions — week of Mon 2026-11-02

Short, relevant mentions for **Cursor Discord**, **Codex GitHub Discussions**, and the
**Anthropic / Claude Discord** (Anthropic's public community surface for project sharing). These
are not launch posts. Post only in the week of Mon 2026-11-02, after the main launch sequence
(dev.to → r/cursor → r/ClaudeAI → Show HN), and only in a showcase / share channel or a thread
where the mention genuinely helps.

**Before posting any of the three:**

1. Replace `[YouTube demo link]` with the published demo URL (`docs/launch/demo-script.md`).
2. Re-check the $49 price, the first-100 cap, and the four lifetime exclusions against the Polar
   checkout and `sessioncontrol.dev/terms` that morning. If the cap is already reached, drop the
   founders paragraph and point only at regular Pro pricing (or skip the paid mention).
3. Do not add any claim that content never leaves the machine. Knowledge Harvesting sends the
   selected sessions to the AI provider the user chooses. Answer privacy questions from the FAQ in
   `docs/launch/show-hn.md`.
4. Skim the live channel rules / topic / pinned message on posting day and update the "Self-promotion
   rule" note below if anything changed.
5. Human rewrite before paste; stay around to answer replies.

---

## 1. Cursor Discord

**Where:** Official Cursor Discord (`discord.com/servers/cursor-1074847526655643750`). Prefer a
showcase / share-your-work channel if one exists; otherwise a relevant help thread where saving
Cursor chat history is already the topic. Do not spray the same text into `#general` and every
support channel.

### Self-promotion rule

Checked 2026-10-24. **No Cursor Discord–specific self-promotion rule was found in public sources**
(Discord server listing and web search). Discord's platform guidelines ban unsolicited bulk spam.
The closest official Cursor guidance is on the **Cursor Community Forum**
(`forum.cursor.com/guidelines` → Self-Promotion): share projects built with/for Cursor; contribute
first; be upfront about paid products; keep links relevant; do not drop product links in unrelated
threads. On posting day, read the Discord `#rules` / channel topics and prefer any `#showcase` (or
equivalent) channel the server designates.

### Draft

```text
Disclosure: I made this, and there's an optional paid tier.

I kept losing the "why" behind code Cursor wrote — chats lived in workspace storage on one machine, not next to the commit. Session Control is a free MIT VS Code/Open VSX extension that saves Cursor (and Copilot / Claude Code / Codex) sessions as plain JSON under .chat/ in the repo, tied to the branch and commit.

Optional Pro adds Knowledge Harvesting: you pick sessions, they are sent to the AI model you choose, and it drafts a Markdown knowledge bundle in knowledge/ for you to review before anything is written. Content leaves your machine for that step (to your chosen provider), and for /analyze — not "nothing leaves your machine."

Founders Lifetime is $49 one time for the first 100 buyers. Lifetime covers Pro features inside the Session Control extension. It does not include the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, or the Knowledge Pack marketplace.

Demo: [YouTube demo link] · https://sessioncontrol.dev · feedback welcome, especially on the Cursor transcript path.
```

---

## 2. Codex GitHub Discussions

**Where:** `https://github.com/openai/codex/discussions` — open a short **Show and tell** / General
post (or reply in a relevant existing thread). Lead on Codex session history, not a cross-post of
the Show HN body.

### Self-promotion rule

Checked 2026-10-24. The openai/codex welcome discussion (#181) invites questions, ideas, and
engagement; **it does not state a separate self-promotion policy**. GitHub's Community Code of
Conduct applies: links must add relevant context; do not post unsolicited links to your own
projects on other users' threads; do not post links only to drive traffic. GitHub Acceptable Use
limits advertising so promotional marketing is not the primary focus of content. Draft compliance:
own top-level (or clearly relevant) post with disclosure, Codex-shaped problem framing, and a
request for feedback — not drive-by comments under unrelated threads.

### Draft

```text
Disclosure: I built this; free core is MIT, optional paid Pro.

I use Codex alongside other assistants on the same repos. Each keeps its own chat history, so the conversation that explained a change was hard to find later and wasn't tied to the commit. Session Control is a free VS Code/Open VSX extension that saves Codex (and Copilot / Cursor / Claude Code) sessions as JSON under .chat/ next to the code, with branch + commit metadata.

Pro's Knowledge Harvesting sends the sessions you select to the AI model you pick (including a logged-in Codex CLI/chat path when you choose it) and drafts a linked knowledge/ bundle you review before write. That step is not local-only: session content goes to your chosen provider.

Founders Lifetime: $49 one-time, first 100 buyers. Lifetime is Pro features inside the Session Control extension only — it excludes the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, and the Knowledge Pack marketplace.

Repo/demo: https://github.com/tempuskg/session-control · [YouTube demo link] · pricing: https://sessioncontrol.dev
Curious how people keep Codex session context across machines today — what am I missing?
```

---

## 3. Anthropic forums (Claude Discord)

**Where:** Anthropic's public community page (`claude.com/community`) points project sharing to
**Claude Discord**. Anthropic's own cookbook issue guidelines name Discord
**`#share-your-project`** (`anthropic.com/discord`) as the place to showcase community projects.
Post there (or the live equivalent channel name on posting day). Do not treat this as a second
r/ClaudeAI launch post.

### Self-promotion rule

Checked 2026-10-24. **No detailed Anthropic Discord self-promotion percentage rule was found in
public sources.** Anthropic explicitly invites sharing projects built with Claude in Discord
`#share-your-project` (claude-cookbooks ISSUE_GUIDELINES) and on the community page. Discord
platform guidelines still ban spam / unsolicited bulk messages. On posting day, read `#rules` and
the `#share-your-project` topic; stay in that channel; disclose that you made it and that a paid
tier exists; keep the free-to-try MIT core up front.

### Draft

```text
Disclosure: I made this. Free MIT core; optional paid Pro.

I kept losing Claude Code context across sessions — history lived under ~/.claude/projects/ on one machine, not next to the commit. Session Control is a free VS Code/Open VSX extension that saves Claude Code (and Copilot / Cursor / Codex) sessions as plain JSON under .chat/ in the repo, with branch and commit recorded.

Pro Knowledge Harvesting: you select sessions, they are sent to the AI model you choose (including Claude Code when you pick that path), and it drafts a knowledge/ Markdown bundle you review line-by-line before anything is written. Harvesting is not "nothing leaves your machine" — selected session content goes to your chosen provider.

Founders Lifetime is $49 one time for the first 100 buyers. Lifetime covers Pro inside the Session Control extension. It does not include the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, or the Knowledge Pack marketplace.

Demo: [YouTube demo link] · https://sessioncontrol.dev · happy to hear how others persist Claude Code sessions across machines.
```

---

## Checks against the drafting card

- Three short drafts, one per channel (Cursor Discord, Codex GitHub Discussions, Anthropic/Claude
  Discord).
- Each draft body states $49 founders lifetime, first 100 buyers, and all four lifetime exclusions
  (GitHub App companion; hosted sync or team tier; self-hosted enterprise license; Knowledge Pack
  marketplace).
- No "nothing leaves your machine" claim; each draft says Knowledge Harvesting sends selected
  sessions to the chosen AI provider.
- Each section notes the channel's self-promotion rule, or that none was found, with sources dated
  2026-10-24.
