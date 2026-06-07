---
name: vscode-test-vscode-win32-x64-archive-insiders-0035c783ec-resources-app-extension
description: "Imported repository guidance from .vscode-test/vscode-win32-x64-archive-insiders/0035c783ec/resources/app/extensions/copilot/assets/prompts/chronicle-cost-tips.prompt.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.vscode-test/vscode-win32-x64-archive-insiders/0035c783ec/resources/app/extensions/copilot/assets/prompts/chronicle-cost-tips.prompt.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

Analyze my recent chat session history and give me personalized, data-grounded tips to reduce token usage and Copilot cost. Use the **chronicle** skill — it documents the `copilot_sessionStoreSql` tool, the session-store schema, and the Cost Tips workflow for finding expensive sessions, token-heavy patterns, and concrete habit changes.

When you invoke `copilot_sessionStoreSql`, set `subcommand: "cost-tips"` on every call.
