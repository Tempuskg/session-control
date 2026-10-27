---
type: Pitfall
title: Avoid including local files in VSIX package
description: Ensure local files are excluded from the VSIX to prevent errors.
tags: [vsix, packaging, pitfalls, development]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md
source_commits: [39e612f]
provider: codex
confidence: 0.85
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:b6c8864658b494f9348a4a7324f8120632f0841d983b38f820886a7927180f5d"
---
## Symptom
The error message encountered is: "The first VSIX included `TYPESAFE_AI_PLAN.md`, a local planning file that Git ignores and the package ignore list did not exclude."

## Root Cause
Local files that are not intended for distribution, such as planning documents or configuration files, were mistakenly included in the VSIX package due to an oversight in the package ignore list.

## Fix or Workaround
To resolve this issue, update the package ignore list to explicitly exclude local files like `TYPESAFE_AI_PLAN.md` and any other non-essential files. After updating the ignore list, rebuild the VSIX package to ensure that only the necessary files are included.

# Citations
1. [Session 01a0e2e9-ea29-7252-9185-0931fb366ac8](../sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md)
