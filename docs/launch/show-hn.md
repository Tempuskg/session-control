# Show HN post — Session Control founders launch

**Posts:** Fri 2026-10-30, morning US Eastern. **Submit URL:** `https://github.com/tempuskg/session-control`
(the repo, not the pricing page). Paste the body below into the text field, then post the first
comment straight away.

**Rules for the day** (from `docs/marketing-plan.md` §5 and §13): one shot, so title on the
local-first angle, not the AI angle. Stay at the keyboard for 6 hours after posting. Never argue,
concede real criticism, and answer from the FAQ below instead of improvising privacy claims.

**HN formatting:** HN renders plain text. No Markdown headings, bold, or bullet syntax. Blank lines
make paragraphs, `*text*` makes italics, and lines indented by two spaces render as code. The body
and first comment below are already written in that format.

**Status:** ready. Human review after a day of distance approved by Darren on 2026-10-26
(user-reported in coworking chat; card `card-mtt7s3gg-11`). Re-check the price, the cap, and the exclusions against the Polar checkout and
`sessioncontrol.dev/terms` on the morning of posting.

---

## Titles (pick one; both under HN's 80-character limit)

1. `Show HN: Session Control – keep your AI coding chats as plain files in your repo` (80 characters; HN counts the en dash as one)
2. `Show HN: Local-first chat history for Copilot, Cursor, Claude Code and Codex` (76 characters)

Recommendation: title 1. It says what you get and where it lives, and it does not lead on AI.
Title 2 is the fallback if title 1 reads as too long once typed into the submit form.

---

## Body

```text
Session Control is a free, MIT-licensed VS Code extension (also on Open VSX for Cursor, Windsurf and VSCodium) that saves your AI chat sessions from GitHub Copilot, Cursor, Claude Code and Codex into your repo as plain JSON files under .chat/.

Each saved session records the branch and commit it was saved on, so the chat that explains a diff lives next to the diff. You can browse sessions in a sidebar, open them in a viewer, turn on auto-save for a workspace, and resume any session as context in a new chat. It works across all four assistants, so switching tools no longer means losing the history.

There is no Session Control cloud, account, or telemetry. Saving, browsing, resuming and auto-save read local transcript files and write local files, with no network calls. Content leaves your machine only when you run a feature that sends it to an AI provider you choose (the free /analyze command and the Pro harvest below), or when you push to a Git remote you own. If you would rather not commit the sessions, one setting adds .chat/ to .gitignore.

That part is free and stays free. I'm not moving any shipped free feature behind the license.

I'm also selling an optional Pro layer, inside the same extension behind a license key. Its main feature is Knowledge Harvesting: you pick saved sessions, they are sent to the AI model you choose (a VS Code chat model, or your logged-in Claude Code or Codex CLI), and it distills them into a linked Markdown knowledge bundle in knowledge/ in your repo, with pitfalls, decisions and playbooks, each citing the session it came from. You review every candidate and the exact line diff before anything is written. It also adds a pointer to AGENTS.md or your other agent instruction files, so the next agent session in that repo reads what the last ones learned. Pro also has cross-workspace session search, export of a session to a Cursor rule, Claude Code skill or AGENTS.md section, skill sync across assistants, and push/pull of sessions to a private Git repo you own.

For launch there is a Founders Lifetime license: $49 one time, for the first 100 buyers only. Lifetime covers the Pro features inside the Session Control extension. It does not include the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, or the Knowledge Pack marketplace, if and when any of those exist.

Install: search "Session Control" in the Extensions view. 85-second demo: [YouTube link]. Pricing and terms: https://sessioncontrol.dev

I'd especially like feedback from people who can't send code to third-party clouds: is "plain files in the repo, you pick the model" enough, or what would you need to see?
```

Checks against the card: the free product comes first and fills the first four paragraphs; the
founders offer is in the sixth paragraph; the price, the cap, and all four exclusions are in the
body, not only at checkout; the privacy claim is scoped to the free path, and the harvest paragraph
says out loud that sessions go to the chosen model.

---

## First comment (post immediately after submitting)

```text
Maker here. Some background on why this exists.

I use Copilot, Claude Code and Codex on the same repos, sometimes Cursor too. Each one keeps its own chat history, in its own store, on one machine. When I came back to code a month later, the reasoning behind it was in a chat I couldn't find, in a tool I wasn't using that day. Commit messages don't hold that much context, and I didn't want to paste transcripts into a SaaS notes app to keep it.

So the idea was: treat the chat like any other build artifact. Save it as a file next to the code, tie it to the commit, and let Git do the syncing, history and access control. Your repo's permissions are the permissions.

A few things I was careful about:

- The free path has no network calls of its own: no account, no telemetry, no analytics. I can't see installs beyond the marketplace counters, and I measure sales only at the payment provider.
- Anything that sends content to a model says which model and provider before it runs, and only sends the sessions you selected.
- Saved transcripts include tool output, so they can contain paths, file contents and terminal output. The README has a warning about public repos, and there's a setting to gitignore .chat/.

Knowledge Harvesting is the paid part. It isn't local inference. It uses the model you already pay for, and sends the selected sessions to that provider. What it doesn't do is send anything to me. I don't run a server that sees your sessions.

Happy to answer anything, including "why would I pay for this".
```

HN turns `- ` lines into plain text, which is fine; they read as a list.

---

## FAQ for the thread

Answer in your own words, but keep the facts exactly as written here. If a question is not covered,
say "good question, let me check" and check the code before answering. Never say or imply "nothing
leaves your machine" about Pro or about `/analyze`.

### Where does my session data go when I harvest?

To the AI provider behind the model you pick in the harvest picker, and nowhere else. Session
Control shows you which model and provider will receive the content before anything is sent, and
only the sessions you selected are sent. The generated pages are written to `knowledge/` in your
workspace, after you review each candidate and its line diff. Nothing goes to Session Control,
because there is no Session Control server. The provider handles that content under your existing
agreement with them, the same as if you pasted it into that chat yourself.

### Which AI providers does harvest use?

Whichever one you choose, from what is already set up on your machine:

- **A VS Code chat model**, through VS Code's Language Model API. That is usually a GitHub Copilot
  model, and the picker shows the model name and vendor (for example, a Claude or GPT model via
  Copilot). Content goes to that vendor under your Copilot or extension terms.
- **Claude Code (CLI)**: sends content to Anthropic through your logged-in `claude` CLI.
- **Codex (CLI)**: sends content to OpenAI through your logged-in `codex` CLI.
- **An agent handoff** to Codex or Claude Code in the editor, where that agent does the harvest
  and you approve its changes there.

There is no Session Control API key and no hosted model. If none of those are configured, harvest
has nothing to send to.

### So it's not local-first?

The data is local-first: sessions and knowledge are plain files in your repo, and Git is the only
sync. The free features (save, browse, resume, auto-save) make no network calls. The AI features,
the free `/analyze` command and Pro's harvest and export, are not local inference. They send the
content you select to the model you choose. I'd rather be precise about that than claim more.

### Can I use a local model?

Only through the routes above. If a local model is exposed as a VS Code chat model by another
extension, it shows up in the picker like any other chat model. There is no built-in Ollama or
llama.cpp backend today. Don't promise one.

### Is there telemetry?

No. The extension has no analytics or telemetry. The network calls it can make are: requests to
the AI provider you choose when you run an AI feature, Git push/pull to the remote you configure for
Pro Git sync, license-key validation with the payment provider (Polar) when you enter and use a Pro
key, and, if you enable TypeSafe reranking for cross-workspace search, your query plus the title,
provider, workspace, date and snippet of the top 10 matches sent to the TypeSafe AI provider. The
free save/browse/resume/auto-save path makes none of these.

### What's in the saved files? Is it safe to commit them?

Full transcripts, including tool call inputs and outputs, so they can hold local paths, file
contents and terminal output. Review before committing to a public repo, or set
`session-control.includeInGitignore` to keep `.chat/` out of Git. Harvest scans the pages it is
about to write for common secret patterns (private keys, AWS and GitHub tokens, credential
assignments) and refuses to write if it finds any, but that is a safety net, not a guarantee. It does not clean the
saved sessions themselves.

### Is the free version going to get worse?

No. The free features are a public commitment on the landing page, not a trial. Pro only adds
commands. Moving a shipped free feature behind the license is something I've said I won't do.

### What does Founders Lifetime include, and what does it exclude?

$49 one time, for the first 100 buyers. It covers the Pro features inside the Session Control
extension. It excludes the GitHub App
companion, a hosted sync or team tier, a self-hosted enterprise license, and the Knowledge Pack
marketplace; if any of those ship, they are priced separately. The exact terms
are at `sessioncontrol.dev/terms`.

### Why is Pro closed source when the extension is MIT?

The free extension is MIT and stays that way. Pro is a separate, private package bundled into the
same extension and unlocked by a license key. That is how I can afford to keep working on the free
part.

### What happens if you disappear?

Your sessions are JSON and your knowledge bundle is Markdown, all in your repo. Nothing depends on
a server I run, so they stay readable in any editor. Reading knowledge bundles is a free feature.

### Why not just use each assistant's own history?

Native history is per-assistant and per-machine, and it isn't tied to commits. Session Control
spans all four assistants, travels with the repo, and records the branch and SHA, so you can find
the chat that explains a line of code.

### Does it work outside VS Code?

Yes, in VS-Code-compatible editors through Open VSX: Cursor, Windsurf, VSCodium, Positron and Trae.
Provider import needs that provider installed locally (for example, Claude Code for Claude Code
sessions).

### How is this different from Cursor rules or CLAUDE.md?

Those are instructions you write by hand. Harvest drafts knowledge pages from what actually
happened in your sessions, cites the source session, and adds a pointer to your existing
`AGENTS.md` or instruction files, so you don't have to maintain a second system. You still approve
every line.
