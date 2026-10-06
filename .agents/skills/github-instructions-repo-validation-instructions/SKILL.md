---
name: github-instructions-repo-validation-instructions
description: "Imported repository guidance from .github/instructions/repo-validation.instructions.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.github/instructions/repo-validation.instructions.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

# Repo Validation

- Start with touched-file diagnostics.
- For plan- or documentation-only edits with no executable check, re-read the modified region and any adjacent section whose preservation or placement you claim before reporting `Unverified: none`; otherwise list that inspection as unverified.
- On Windows PowerShell, do not use `&&` in `Shell` commands. For stop-on-failure sequences, either run separate `Shell` calls or use PowerShell-safe chaining such as `cmd1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; cmd2`.
- If test TypeScript changed, or if compiled tests may be stale, run `npm run compile-tests` before diagnosing behavior from `dist-test/`.
- If source TypeScript changed, run `npm run compile` before broader test passes.
- Prefer the smallest relevant test or behavior check before `npm test`.
- Use `npm test` after focused checks when the change spans multiple units or before handing off a broader verification result.
- Run `npm run lint` after behavior is stable or before commit-ready closeout.
- Finish chat, command, or viewer UX changes with a Development Host smoke test when the environment allows it.
- When you launch a Development Host yourself, isolate it from the user's editor: pass a scratch `--user-data-dir` (for example, `code --new-window --user-data-dir <scratch>/profile --extensionDevelopmentPath=<repo> <scratch-workspace>`). Without a separate user data directory, the CLI attaches the Development Host to the user's running VS Code or Cursor main process. Never run `Stop-Process`, `taskkill`, or `CloseMainWindow()` on `Code.exe` or `Cursor.exe`, even when filtering by window title, because that can quit every editor window, including the agent's own. Close the Development Host from inside it (for example, a probe extension runs `workbench.action.closeWindow`), or ask the user to close it. A fresh profile lacks installed extensions such as Copilot Chat, so chat-dependent smoke tests need the user's own Development Host. If isolation is not possible, ask before launching an automated Development Host.
- When verifying menus or the palette with synthetic input, call `SetProcessDPIAware` before `SetCursorPos`, `mouse_event`, or `CopyFromScreen` so cursor coordinates match screenshot pixels. Bring the Development Host to the foreground and confirm its window title immediately before sending keys or clicks, because synthetic input goes to whichever window has focus. Prefer a probe extension that runs commands such as `<view-id>.focus`, and use synthetic input only for surfaces the API cannot query, such as `view/title` overflow menus.
- Do not use plain `node --test`, and treat direct Mocha runs as unreliable in this repo.
- If `dist-test/` disagrees with the source tree, rebuild before diagnosing deeper.
- In the closeout, list the exact checks run and any remaining unverified areas.
