---
type: Decision
title: Decision on @session-control participant and MCP server implementation
description: Decision made on the legacy status of the @session-control participant and the implementation of an MCP server.
tags: [decision, implementation, mcp, agent, legacy]
timestamp: "2026-10-30T14:01:42.428Z"
source_sessions:
  - /sessions/0b24b7f8-055c-487b-a803-fd56867c1c5d.md
source_commits: [f2ac1e3]
provider: claude-code
confidence: 0.9
harvested_by: session-control-pro@1.11.0+harvest-v1
content_hash: "sha256:057592af1888bfd86067f9d25cb172d6647f9559c5a6894afcba69e2e3fee0ce"
---
## Context
The decision revolves around the future of the `@session-control` chat participant in light of new tools that have been developed. The tools now cover certain functionalities, but the `/implement` command remains unsupported. The implications of keeping, deprecating, or removing the `@session-control` participant, as well as the decision on implementing an MCP server and a custom `.agent.md` agent, were discussed.

## Options Considered
1. **@session-control participant:**
   - Keep and mark as legacy.
   - Deprecate with a future removal target.
   - Remove immediately.

2. **MCP server:**
   - Go ahead with the implementation.
   - No-go on the MCP server.

3. **Custom .agent.md agent:**
   - Go ahead with the custom agent.
   - No-go on the custom agent, opting for a tool instead.

## Decision
1. **@session-control participant:** Keep it and mark it as legacy. The README, CHANGELOG, and listing will prioritize the new tools.
2. **MCP server:** Go ahead with a standalone server that covers list and resume functionalities only.
3. **Custom .agent.md agent:** No-go on the custom agent. Instead, a `session-control_getImplementationPrompt` tool will be created.

## Consequences
- The `@session-control` participant remains available for legacy users, ensuring no disruption while transitioning to new tools.
- The MCP server will provide broader access to functionalities for users of Cursor, Claude Code, and Codex, while keeping the analyze function within VS Code.
- The decision against a custom agent simplifies maintenance and leverages existing tools for implementation handoffs.

# Citations
1. [Session 0b24b7f8-055c-487b-a803-fd56867c1c5d](../sessions/0b24b7f8-055c-487b-a803-fd56867c1c5d.md)
