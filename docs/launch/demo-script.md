# YouTube demo script — Session Control founders launch

**Length:** 85 seconds (hard limit 90). **Format:** 1080p screen recording of VS Code, voice-over,
captions burned in. This video is embedded in every main-launch post (dev.to, r/cursor, r/ClaudeAI,
Show HN), so it must be accurate on its own without the post text.

**Story:** your AI chats disappear → save them → harvest them into a knowledge bundle → your next
agent session reads it → founders offer, with what lifetime does and does not cover.

## Recording setup

- Session Control 1.9.0 with Session Control Pro 0.9.0 bundled, Pro license entered beforehand
  (do not show the key or the license prompts).
- Use a real repository with at least five real saved sessions across two or more providers. Do
  not stage fake chats. Review every frame for secrets, tokens, customer names, and private paths
  before publishing. Saved sessions record full transcripts, including tool output.
- Dark theme, 125% zoom, notifications cleared, only the Session Control view and the editor open.
- Harvest with the in-editor **Chat** choice, because that path opens the review panel. Pre-run the
  harvest once off camera so you know how long preparation takes, then cut the wait in the edit.

## Shot list

| # | Time | Shot (on screen) | Narration (voice-over) |
|---|------|------------------|------------------------|
| 1 | 0:00–0:06 | Cold open: a long Copilot Chat thread scrolls past, then the chat panel is cleared. Caption: "Where did that fix go?" | "Every AI chat you have teaches you something about your codebase. Then it's gone." |
| 2 | 0:06–0:16 | Command Palette → **Session Control: Save Session...** → the provider picker shows Copilot, Codex, and Claude Code in VS Code (Cursor, Codex, and Claude Code in Cursor) → pick Claude Code → pick a session → a JSON file appears under `.chat/`. | "Session Control saves chats from Copilot, Cursor, Codex, and Claude Code into your repo, as plain files you own." |
| 3 | 0:16–0:22 | Run **Toggle Auto-Save on Chat Response** for the workspace folder, then show the **Session Explorer** filling with saved sessions grouped by workspace folder. | "Turn on auto-save and every project chat is saved as you work." |
| 4 | 0:22–0:28 | In the Session Explorer, click **Open Saved Session** on a session. In the session viewer, run **Resume This Session in Chat** from the title bar. The transcript loads as context in a new chat. | "Resume any session as context in a new chat. All of that is free." |
| 5 | 0:28–0:36 | Command Palette → **Session Control Pro: Harvest Knowledge to OKF Bundle** → choose the date scope containing the intended real demo sessions → **Everything in this range** (so repeat takes include previously harvested sessions) → choose **Chat** as the destination. Show the privacy prompt for one beat. | "Pro goes further. Harvest Knowledge sends the sessions you pick to the AI model you choose, and distills them…" |
| 6 | 0:36–0:50 | The **Review Knowledge Harvest** panel opens and prepares on its own. Scroll candidates: a pitfall, a decision, a playbook. Untick **Include** on one; the panel prepares again. Expand a file to show its unified line diff. | "…into pitfalls, decisions, and playbooks. You review every candidate and the exact line diff before anything is written." |
| 7 | 0:50–0:54 | Click **Write changes**. The new files appear under `knowledge/` in the Explorer. | "Nothing is written until you approve it." |
| 8 | 0:54–1:04 | Explorer: open `knowledge/index.md` in Markdown preview, click through to one pitfall page and its citation link back to the source session. Then open `AGENTS.md` and show the added knowledge pointer block. | "The result is a linked knowledge bundle in your repo, with citations back to the original chats, and a pointer your agents' instruction files already load." |
| 9 | 1:04–1:12 | New Claude Code or Copilot agent session in the same repo. Ask a question from an earlier chat; the agent opens `knowledge/index.md` and answers using the harvested pitfall. | "So your next agent session starts with what the last one learned." |
| 10 | 1:12–1:25 | End card on a plain background, held still. Text, exactly: **Session Control Pro — Founders Lifetime. $49, one time. First 100 buyers only.** Below, smaller: **Lifetime covers the Pro features inside the Session Control extension. It excludes the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, and the Knowledge Pack marketplace.** Footer: `sessioncontrol.dev` · "Search Session Control in the Extensions view". | "Founders lifetime is forty-nine dollars, one time, for the first one hundred buyers. Lifetime covers the Pro features in the extension. It does not include the GitHub App companion, a hosted sync or team tier, a self-hosted enterprise license, or the Knowledge Pack marketplace. Install Session Control, free, from the Marketplace." |

Total: 85 seconds. Narration is about 200 words, around 2.4 words per second. If a take runs long,
trim shot 3 or shot 4 first. Never trim shot 10, and keep its text on screen for at least 10
seconds so it can be read without sound.

## Accuracy checks before publishing

Every feature on screen ships in Session Control 1.9.0 with Pro 0.9.0. Commands are contributed by
`e:\chat-commit\package.json`, and the review panel wording comes from Pro's
`src/knowledgeReviewPanel.ts`:

| Shot | Feature | Shipped as |
|------|---------|------------|
| 2 | Save from four providers | `session-control.saveSessionFromProvider` — **Save Session...** |
| 3 | Auto-save, Session Explorer | `session-control.toggleAutoSave`, Session Explorer view |
| 4 | Resume as context | `session-control.openSessionFromExplorer`, then `session-control.resumeSessionFromViewer` (session viewer title bar) |
| 5 | Harvest with the shared chat-or-agent picker | `session-control-pro.harvestKnowledge` (Pro 0.8.0 picker) |
| 6–7 | Auto-preparing review panel, Include toggle, line diffs, **Write changes** | Pro 0.9.0 `knowledgeReviewPanel.ts`, `knowledgeLineDiff.ts` |
| 8 | `knowledge/` bundle with relative links and citations, instruction-file pointer | `knowledge.bundlePath` default `./knowledge`; `knowledgeInstructions.ts` |
| 10 | $49, first 100 buyers, four exclusions | Polar Founders checkout and `sessioncontrol.dev/terms` (verified 2026-10-11, card-mu6zm0m9-5) |

Do not:

- say or imply that "nothing leaves your machine". Harvesting sends the selected sessions to the
  model you choose. Shot 5 says so out loud.
- show a standalone "Session Control Pro" extension. Pro ships inside the one Session Control
  extension and unlocks with a license key.
- show the Agent handoff harvest path in place of shot 6. It does not open the review panel.
- show unreleased features, such as anything only on `main` after 1.9.0.
- change the price, the cap, or the exclusions list on the end card without updating the Polar
  checkout and the terms page first.
