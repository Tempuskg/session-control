---
type: CodePattern
title: Omit absent optional properties instead of passing undefined
description: "In strict optional-property code, leave optional keys out when no value is available instead of assigning them undefined."
tags: [typescript, optional-properties, strict-typing, object-shapes]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md
source_commits: []
provider: codex
confidence: 0.96
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:eb2d0497d6ecd16a58158214a1d0c48dd583c0cf8243bf487a177b3e217240ad"
---
When constructing an object with an optional property, omit that property when no value is available. This represents absence without explicitly passing `undefined`.

# Examples

```typescript
type Options = {
  required: string;
  optional?: string;
};

const options: Options = {
  required: "value",
};
```

# Citations
1. [Session 019f34aa-0cf5-73b2-b89a-4893db4ce55a](../sessions/019f34aa-0cf5-73b2-b89a-4893db4ce55a.md)
