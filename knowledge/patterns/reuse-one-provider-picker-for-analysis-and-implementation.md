---
type: CodePattern
title: Reuse One Provider Picker for Analysis and Implementation
description: "Share one provider picker between analysis and implementation commands so provider discovery, labels, and handoff behavior stay consistent."
tags: [provider-selection, command-palette, vscode-chat, coding-agents]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/019f5151-24e1-70d0-b894-79031a7e0788.md
source_commits: [028655e]
provider: codex
confidence: 0.94
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:7864de026792bf49cb126f5f9729bc2cd6984effff1e0ff381c32cbd269192ff"
---
Use this pattern when slash commands and command-palette commands need identical execution-provider choices. Centralize provider discovery and QuickPick item construction, passing the operation only to vary action wording. The picker represents the execution target, not a source-session filter: analysis still considers all eligible sessions in workspace `.chat` folders. Include available VS Code language models and installed Codex, Claude Code, and Cursor agents when their chat commands are available. Route host-model choices through VS Code Chat and external choices through the existing agent handoff.

# Examples

```typescript
type Operation = "analyze" | "implement";

function providerItems(operation: Operation) {
  const verb = operation === "analyze" ? "analyze" : "implement";

  return discoverProviders().map((provider) => ({
    label: provider.label,
    description:
      provider.kind === "external-agent"
        ? `Use ${provider.label} to ${verb} the workspace`
        : `Use ${provider.label} for ${verb} in VS Code Chat`,
    provider,
  }));
}

async function chooseProvider(operation: Operation) {
  return showQuickPick(providerItems(operation), {
    placeHolder: `Choose a provider to ${operation}`,
  });
}

async function runOperation(operation: Operation, prompt: string) {
  const choice = await chooseProvider(operation);
  if (!choice) return;

  if (choice.provider.kind === "external-agent") {
    return handoffToAgent(choice.provider, prompt);
  }

  return openVSCodeChat(choice.provider.model, prompt);
}

registerSlashCommand("/analyze", () =>
  runOperation("analyze", buildAnalysisPromptFromAllEligibleSessions()),
);

registerSlashCommand("/implement", () =>
  runOperation("implement", buildImplementationPrompt()),
);

registerCommand("Implement Latest Analysis", () =>
  runOperation("implement", buildLatestAnalysisPrompt()),
);
```

# Citations
1. [Session 019f5151-24e1-70d0-b894-79031a7e0788](../sessions/019f5151-24e1-70d0-b894-79031a7e0788.md)
