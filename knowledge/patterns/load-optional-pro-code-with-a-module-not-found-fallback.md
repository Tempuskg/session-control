---
type: CodePattern
title: Load Optional Pro Code with a MODULE_NOT_FOUND Fallback
description: Dynamically activate Pro features while keeping the base extension usable when the optional package is unavailable.
tags: [typescript, optional-dependency, module-loading, vscode-extension]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.95
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:29bbc7e2df3648181cb612f869b8a1f28e6865b4ffbdbab17d4f5f650d483d73"
---
Use this pattern when a base extension should activate an optional Pro package at runtime. Resolve and load the package dynamically; if it is unavailable, continue in free-only mode. Validate the expected registration function before invoking it.

# Examples

```typescript
type ProContext = {
  hasProLicense: () => boolean;
  showUpgradePrompt: () => void;
};

type ProModule = {
  registerProFeatures: (context: ProContext) => void;
};

export function activateProFeatures(context: ProContext): void {
  const packageName = "@tempuskg/session-control-pro";

  try {
    const packagePath = require.resolve(packageName);
    const pro = require(packagePath) as Partial<ProModule>;

    if (typeof pro.registerProFeatures === "function") {
      pro.registerProFeatures(context);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "MODULE_NOT_FOUND"
    ) {
      return; // Optional package is absent; keep the base extension active.
    }

    throw error;
  }
}
```

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
