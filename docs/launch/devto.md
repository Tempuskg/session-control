# dev.to launch post — Session Control founders launch

**Publishes:** Sun 2026-10-25 on `dev.to/tempuskg`. **Framing:** build story, not a pitch (from
`docs/marketing-plan.md` §8 Phase 2 and §9). The free product, the cross-IDE angle and the
local-first angle come first; the founders offer is one section near the end.

**Before publishing:**

1. Replace the `YOUTUBE DEMO EMBED` placeholder with the published video URL (script:
   `docs/launch/demo-script.md`). dev.to embeds YouTube with `{% embed <url> %}`.
2. Re-check the $49 price, the $29/year and $4/month prices, the 100-buyer cap and the four exclusions against the Polar checkout and
   `sessioncontrol.dev/terms` on the morning of publishing.
3. Re-check the Open VSX download share against the live registries. Use "roughly 9 out of 10
   downloads", never the 100:1 figure (marketing plan §1).
4. Do not add any claim that session content never leaves the machine. Knowledge Harvesting and `/analyze`
   send the selected sessions to the AI provider the user picks. Answer privacy comments from the
   FAQ in `docs/launch/show-hn.md`.
5. Paste everything below the line into the dev.to editor, front matter included, and flip
   `published` to `true` only when posting.

---

```markdown
---
title: How I built a cross-IDE session manager for Cursor, Claude Code, and Codex users
published: false
description: Four AI coding assistants, four separate chat histories. Here's how I built one local history that lives in the repo, next to the commit it explains.
tags: vscode, ai, productivity, opensource
---

I use GitHub Copilot, Claude Code and Codex on the same repos, and Cursor on some of them. For a while that felt like a superpower. Then I came back to a module I'd written a month earlier, found a strange workaround in it, and couldn't remember why it was there.

The reason existed. It was in a chat. I just didn't know which assistant I'd been using that day, on which machine, or whether that tool still kept history that far back.

Every assistant keeps its own history, in its own format, in its own store, on one machine. None of them link a conversation to the commit it produced. So the most useful design document I had, the actual conversation where a decision got made, was the one thing I couldn't find.

This post is about how I built [Session Control](https://sessioncontrol.dev), a free, MIT-licensed VS Code extension that fixes that for me, and what I learned reading four different assistants' transcript formats.

<!-- YOUTUBE DEMO EMBED: replace this comment with {% embed https://www.youtube.com/watch?v=VIDEO_ID %} once the 85-second demo is published. Do not publish with this comment still here. -->

## The idea: treat a chat like a build artifact

The design came down to one sentence: save the chat as a file next to the code, tie it to the commit, and let Git do everything else.

That choice removed most of the hard problems before I wrote any code:

- **Sync** is `git push`. **History** is `git log`. **Access control** is whoever can read the repo.
- **Storage format** is plain JSON under `.chat/`, so you can `cat` it, grep it, or diff it.
- **No server.** There's no Session Control account, cloud, or telemetry. Saving, browsing, resuming and auto-save read local transcript files and write local files, with no network calls of their own.

Each saved session records the branch and commit SHA it was saved on. That's the part I wanted most: the chat that explains a diff sits beside the diff, and it survives switching tools.

If you'd rather not commit the transcripts, one setting adds `.chat/` to `.gitignore`. That matters more than it sounds. Saved sessions are full transcripts, including tool calls and terminal output, so they can contain local paths and file contents. Review them before pushing to a public repo.

## Reading four assistants' histories

Here's the less glamorous part: none of these tools were designed to have their history read by anyone else, and they all store it differently.

**Claude Code** writes one JSONL file per session under `~/.claude/projects/`, in a folder named after the workspace path with every non-alphanumeric character replaced by `-`. That makes it straightforward to find the sessions for the current workspace, and JSONL makes it easy to stream.

**Codex** writes JSONL session files under `~/.codex/sessions`, but that store is machine-wide. An early version read every file and filtered afterwards, which meant loading every project's history into memory just to show one workspace's sessions. The fix was to read the head of each file, identify the owning workspace, and skip the body entirely when it doesn't match.

**Cursor** has more than one store: chat sessions in VS Code-style workspace storage, and agent transcripts under `~/.cursor/projects/<project>/agent-transcripts`. One "Cursor" provider is really a few readers behind one picker entry.

**GitHub Copilot Chat** was the one that kept me honest. Its per-workspace `chatSessions` folder used to hold one JSON document per session. Newer VS Code builds write a JSONL log instead: a first record with a full snapshot, then records that patch individual properties and splice arrays. To get the current session, you replay the log. When a VS Code update changes the shape again, the reader logs "Skipped unrecognized session format" with the VS Code version, rather than guessing and saving a mangled transcript.

Lessons from that part:

1. **Treat every format as a moving target.** Each reader has fixture tests built from real transcripts, and unknown formats are skipped with a log line rather than half-parsed.
2. **Filter early.** Machine-wide stores need workspace filtering before the expensive read, not after.
3. **Normalize to one model.** Every reader produces the same session shape, so saving, viewing, resuming and searching don't care where a chat came from.

## Resume, auto-save, and the Session Explorer

Once sessions are normalized, the rest builds on top:

- **Auto-save** watches the provider stores for a workspace and saves new sessions as you work.
- **The Session Explorer** in the sidebar lists saved sessions by workspace folder, and opens them in a viewer.
- **Resume** loads a saved transcript as context in a new chat, which is how a Claude Code conversation becomes the starting point of a Copilot one, or the other way round.

It runs in VS Code and, through Open VSX, in Cursor, Windsurf, VSCodium, Positron and Trae. Roughly 9 out of 10 of its downloads come from Open VSX, which told me early on that the people who want this are mostly the ones running more than one assistant.

**All of that is free, and it stays free.** It's MIT-licensed, and I've committed publicly that I won't move any shipped free feature behind a license.

## The part I'm charging for: turning chats into knowledge

Saving chats solved "where is that conversation". It didn't solve "my next agent session repeats the same mistake". The fix for a weird build error is in a saved session, but a new agent in that repo doesn't read `.chat/`.

So I built Session Control Pro. It isn't a separate extension. It ships inside the same extension and unlocks with a license key.

Its main feature is **Knowledge Harvesting**. You pick saved sessions, and they're sent to the AI model **you choose**: a VS Code chat model (usually a Copilot model), your logged-in Claude Code CLI, or your logged-in Codex CLI. To be precise about this, because it matters: harvesting is not local inference. The sessions you select go to that provider, under your existing agreement with them, the same as if you'd pasted them into that chat yourself. The picker shows which model and provider will receive the content before anything is sent. Nothing goes to me, because I don't run a server that could receive it.

The model distills the sessions into a linked Markdown knowledge bundle under `knowledge/`: pitfalls, decisions and playbooks, each citing the session it came from. Before anything is written, a review panel shows every candidate page and its exact line diff. You can drop candidates, and nothing touches disk until you click **Write changes**. Harvest also scans the pages it's about to write for common secret patterns and refuses to write if it finds any. That's a safety net, not a guarantee.

The last step is the one that made it useful: harvest adds a short pointer to `AGENTS.md` or your other agent instruction files. Your agents already read those, so the next session in that repo starts by reading what earlier sessions learned.

Pro also adds cross-workspace session search, exporting a session as a Cursor rule, Claude Code skill, Copilot instructions file or `AGENTS.md` section, skill sync across assistants, and push/pull of sessions to a private Git repo you own.

## Founders lifetime: $49, first 100 buyers

For launch there's a **Founders Lifetime** license: **$49, one time, for the first 100 buyers only.** After that, Pro is $29/year or $4/month.

To be clear about what "lifetime" means: it covers the Pro features inside the Session Control extension. It **does not include** the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, or the Knowledge Pack marketplace, if and when any of those exist. If they ship, they're priced separately. Full terms are at [sessioncontrol.dev/terms](https://sessioncontrol.dev/terms).

## What I'd do differently

- **Write the reader fixture tests first.** Every format change I caught early was caught by a fixture built from a real transcript.
- **Be precise about privacy from day one.** "Local-first" is true for the data: sessions and knowledge are plain files in your repo, and Git is the only sync. It is not true for the AI features, which send what you select to the model you pick. Saying exactly that is better than a slogan.
- **Don't build a server until someone asks for one.** Git already did the syncing, history, and permissions.

## Try it

Search **Session Control** in the Extensions view of VS Code, Cursor, Windsurf or VSCodium. The free features need no account and no key. Pricing and terms are at [sessioncontrol.dev](https://sessioncontrol.dev), and the source is on [GitHub](https://github.com/tempuskg/session-control).

I'd especially like to hear from people who can't send code to third-party clouds: is "plain files in the repo, and you pick the model" enough, or what would you need to see?
```
