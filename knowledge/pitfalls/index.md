# Pitfall

- [Avoid sibling `file:` dependencies when packaging VS Code extensions](avoid-sibling-file-dependencies-when-packaging-vs-code.md) - A sibling file dependency can create an out-of-tree symlink that makes vsce fail while scanning extension dependencies.
- [Declare dynamically registered commands in `contributes.commands`](declare-dynamically-registered-commands-in-contributes.md) - Runtime registration alone does not make a VS Code command discoverable; declare it in the extension manifest.
- [Do not look for Codex or Claude in `LanguageModelChat`](do-not-look-for-codex-or-claude-in-languagemodelchat.md) - External agent providers may not register `LanguageModelChat` models; discover their chat commands and hand off prompts instead.
- [Dynamically Resolved Dependencies Must Be Shipped in the VSIX](dynamically-resolved-dependencies-must-be-shipped-in-the.md) - Webpack cannot bundle dependencies resolved through runtime variables, so required package files must be included in the VSIX.
- [Exclude Private-Code Sourcemaps from VSIX Packages](exclude-private-code-sourcemaps-from-vsix-packages.md) - When a VSIX ships private compiled code, whitelist only runtime files so sourcemaps cannot reveal near-original TypeScript.
- [Rebuild stale dist-test output before diagnosing failures](rebuild-stale-dist-test-output-before-diagnosing-failures.md) - Stale compiled test output can misrepresent source behavior; use repository scripts and rebuild dist-test before deeper diagnosis.
- [Wire tools and workspace access before treating chat as an agent](wire-tools-and-workspace-access-before-treating-chat-as-an.md) - A plain language-model call cannot inspect workspace files or use tools unless an agent, tool, or MCP flow explicitly wires them in.
