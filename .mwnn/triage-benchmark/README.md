# Local triage evaluation

Owner: `card-mug8ch4z-11`. External calls on the 44 redacted fixtures were approved in interview chat on 2026-10-26. No publication or change to the installed Session Control extension is authorized.

The tooling imports current production questions, evidence builder, policy, batching, and prompts into a local library. `vscode-shim.cjs` only satisfies unused command-registration imports for standalone execution. It is not used for model calls in the editor helper.

## Preparation and standalone triage

From the repository root, in PowerShell:

```powershell
node .mwnn/triage-benchmark/build.cjs
node .mwnn/triage-benchmark/run.cjs
node .mwnn/triage-benchmark/run.cjs --live
```

Preparation verifies fixture and label hashes against the approved request and sends no requests. `--live` needs `TYPESAFE_API_KEY` in the process environment; never paste its value into chat, files, or command text. Every run writes a new timestamped artifact. The first API call probes access; errors stop further scheduling and leave recall null. Incomplete runs never qualify as recall evidence. Successful requests record provider-reported usage and returned model ids. Do not count an all-fallback plan as successful triage recall. No existing judgment cache is read.

`triage-1793061991570.json` is an incomplete sandbox network failure, not a benchmark result. `triage-1793062000319.json` is the complete 44-session run. Its measured recall at 0.7 is 16/16, with five negatives skipped. Its provider model is `jev-1.14.0`.

## Remaining GPT-6.1 Sol comparison

The local editor helper selects exactly one direct-request model matching the user-reported display name `GPT-6.1 Sol`. It does not substitute a model or accept a `copilotcli` entry. Ambiguous/unavailable selection writes model-discovery evidence and sends no analysis requests. It compares five prepared baseline batches plus synthesis with four triage-enabled batches plus synthesis, using the same baseline and model object. It preserves model identity, model tokenizer counts, returned text, timings, errors, and partial results. All measurements remain subject to runtime verification.

A fresh isolated VS Code profile lacks the user's Copilot authentication and installed chat providers. `.github/instructions/repo-validation.instructions.md` therefore requires asking before launching the helper against the existing editor profile. After that specific approval, the planned command is:

```powershell
code --new-window --extensionDevelopmentPath="E:\chat-commit\.mwnn\triage-benchmark\editor" "E:\chat-commit"
```

The helper starts the approved evaluation once on activation, protected by `editor-auto-launch-v2.claim` against duplicate paid runs after reloads. The helper can also be invoked inside its Development Host through `MWNN: Run Approved Triage Benchmark`. It does not install an extension or change Session Control settings. Runtime provider consent or authentication may still require the user. Do not stop or kill Code/other editor processes. Do not pass `--extensionTestsPath` against an existing Code instance: VS Code rejects that launch.

## Interpretation limits

- Fixtures are already compact redacted evidence. The adapter preserves recorded user-prompt order and edge responses, leaves unavailable timestamps/tools empty, and includes original counts/tool summaries in the fixture summary. It does not recreate omitted transcript or individual tool events. Results apply to this redacted evaluation set.
- The installed VS Code API exposes text streams and `countTokens`, not provider billed usage. Input-message and returned-text tokenizer counts must be labeled as such. Hidden reasoning, system overhead, and provider cache/billing usage remain unknown; never report them as zero or claim measured financial savings.
- Triage time and provider tokens are reported separately; end-to-end comparison time includes measured triage overhead. The single cold-cache run is not a warm-cache test or a statistically robust timing estimate.
- Inspect per-session results and misses, reconcile all ids/counts and parse all JSON, then request the human ship-or-adjust decision. Do not mark the card Done while any criterion or material exception remains open.

