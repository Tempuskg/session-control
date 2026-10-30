# Session Control MCP server

Session Control ships a small stdio [MCP](https://modelcontextprotocol.io) server, so Claude Code, Cursor, Codex, and other MCP clients can list and resume the chat sessions saved in your repo's `.chat/` folder. It runs on plain Node.js (18 or later) and does not need VS Code running.

It exposes two tools:

| Tool | Input | What it does |
| --- | --- | --- |
| `list_sessions` | `query` (optional string), `limit` (optional number, default 20, max 100) | Lists saved sessions newest first as JSON: id, title, date, branch, short commit, turn count, provider, and workspace folder. `query` filters by title, id, or branch substring. |
| `resume_session` | `session` (required string: id, or a title) | Returns the session transcript as context, trimmed to the resume limits. Ambiguous titles return candidate ids to retry with. |

These match the `#savedSessions` and `#resumeSession` language-model tools in VS Code. Analysis stays in VS Code, because it uses VS Code language models.

## Where the server is

The server is `dist/mcpServer.js` inside the installed extension:

- VS Code: `~/.vscode/extensions/darrenjmcleod.session-control-<version>/dist/mcpServer.js`
- Cursor: `~/.cursor/extensions/darrenjmcleod.session-control-<version>/dist/mcpServer.js`

On Windows, `~` is `C:\Users\<you>`. The folder name includes the extension version, so update the path in your MCP config after the extension updates.

To get a version-independent `session-control-mcp` command instead, build it from a clone of the repository: `npm install`, `npm run compile`, then `npm install -g .`.

The examples below use `/path/to/mcpServer.js`; replace it with your path (or use `session-control-mcp` as the command with no `node` argument).

## Options

| Option | Environment variable | Default |
| --- | --- | --- |
| `--root <path>` (repeat for several roots) | `SESSION_CONTROL_ROOTS` (separated by `:`, or `;` on Windows) | The directory the client starts the server in |
| `--storage-path <path>` (relative to each root) | `SESSION_CONTROL_STORAGE_PATH` | `.chat` |
| `--max-turns <n>` | `SESSION_CONTROL_RESUME_MAX_TURNS` | `50` |
| `--max-context-chars <n>` | `SESSION_CONTROL_RESUME_MAX_CONTEXT_CHARS` | `80000` |
| `--overflow-strategy <summarize\|truncate\|recent-only\|relevant>` | `SESSION_CONTROL_RESUME_OVERFLOW_STRATEGY` | `summarize` |

Options override environment variables. The defaults match the extension's `session-control.storagePath` and `session-control.resume.*` settings; the server does not read VS Code settings, so pass the same values if you changed them. `relevant` needs TypeSafe in VS Code, so the server falls back to `summarize`, as the extension does when TypeSafe is off.

Pass `--root` when you can. Not every client starts stdio servers in your project folder.

## Claude Code

Add it to one project (writes `.mcp.json`, which you can commit):

```sh
claude mcp add --scope project session-control -- node /path/to/mcpServer.js --root .
```

Or add it to `.mcp.json` yourself:

```json
{
  "mcpServers": {
    "session-control": {
      "command": "node",
      "args": ["/path/to/mcpServer.js", "--root", "."]
    }
  }
}
```

Then ask, for example, "list my saved sessions" or "resume the session about the login form". Check the connection with `/mcp`.

## Cursor

Add it to `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "session-control": {
      "command": "node",
      "args": ["/path/to/mcpServer.js", "--root", "${workspaceFolder}"]
    }
  }
}
```

## Codex

Add it to `~/.codex/config.toml`:

```toml
[mcp_servers.session-control]
command = "node"
args = ["/path/to/mcpServer.js", "--root", "/path/to/your/repo"]
```

Or from the command line: `codex mcp add session-control -- node /path/to/mcpServer.js --root /path/to/your/repo`.

## Troubleshooting

- Run `node /path/to/mcpServer.js --help` to check the path and see the options.
- The server writes one startup line to stderr naming the folders it reads. Protocol messages go to stdout only.
- If `list_sessions` says no sessions were found, check that `--root` points at the folder that contains `.chat/`.
