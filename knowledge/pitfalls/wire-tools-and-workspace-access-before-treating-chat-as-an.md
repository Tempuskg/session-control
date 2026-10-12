---
type: Pitfall
title: Wire tools and workspace access before treating chat as an agent
description: "A plain language-model call cannot inspect workspace files or use tools unless an agent, tool, or MCP flow explicitly wires them in."
tags: [agent-architecture, workspace-access, tool-use, mcp, coding-agent]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md
source_commits: []
provider: codex
confidence: 0.98
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:ea31af6e5011a55cca16abd0360a85f49a067d83e60f5ae106d84582299d61d9"
---
## Symptom

The workflow reports that “workspace files and tools will not be available.”

## Root cause

The chat participant uses a plain `request.model.sendRequest` call rather than a tool-enabled agent, tool, or MCP flow. A plain language-model request does not provide coding-agent capabilities such as workspace inspection or tool use.

## Fix or workaround

Before implementing agent behavior, verify how the request is wired. Use a tool-enabled agent, tool, or MCP flow with workspace access. If access remains unavailable, request full access, ask for the required files to be pasted, or generate a handoff prompt.

# Citations
1. [Session 019f34aa-0cf5-73b2-b89a-4893db4ce55a](../sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md)
