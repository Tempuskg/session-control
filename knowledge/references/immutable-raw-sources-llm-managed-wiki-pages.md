---
type: Reference
title: "Immutable Raw Sources, LLM-Managed Wiki Pages"
description: Separate immutable source files from the LLM-maintained wiki so source evidence remains stable while derived pages can evolve.
tags: [raw-sources, immutability, wiki, llm-managed]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md
source_commits: []
provider: codex
confidence: 0.94
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:b9d1e3a75f8bcbe72f0c5da259602b1bc0ac04cb1cfe07e39b12b2cf6ad4485d"
---
# Immutable Raw Sources, LLM-Managed Wiki Pages

Keep source documents in `raw/` as an immutable evidence layer: the LLM may read them but must never modify them. Keep generated and maintained knowledge pages in `wiki/`, which the LLM owns and may create, update, or delete while humans read and browse the results.

## Provenance

This separation is defined by the Session Control Wiki directory layout and Layers instructions in the cited session excerpt.

# Citations
1. [Session 019f34aa-0cf5-73b2-b89a-4893db4ce55a](../sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md)
