# Local triage evaluation

Owner: `card-mug8ch4z-11` (original live eval). Payload-overhead adjustment: `card-mvq03qy7-2`. External calls on the 44 redacted fixtures were approved in interview chat on 2026-10-26. No publication or change to the installed Session Control extension is authorized.

The tooling imports current production questions, evidence builder, policy, batching, and prompts into a local library. `vscode-shim.cjs` only satisfies unused command-registration imports for standalone execution. It is not used for model calls in the editor helper.

## Version identity (do not confuse runs)

| Run | Question / cache version | Payload | Artifacts |
| --- | --- | --- | --- |
| Original evaluation 2026-10-26 | `analysis-triage-v1` | summaryOnly evidence + edges; full fixture JSON in adapter summary | `results.md`, `summary.json`, `triage-1793062000319.json`, `analysis-1793062329161.json` |
| Payload reduction (implementation) | `analysis-triage-v2` | `triage-payload-v2`; adapter summary is counts/tools only | [`payload-overhead.md`](payload-overhead.md), [`payload-measurements.json`](payload-measurements.json) |
| Adjusted re-evaluation (card-mvq03qy7-3) | `analysis-triage-v2` | `triage-payload-v2`; 3 paired reps, alt arm order, cold/warm labeled | [`reeval-v2/`](reeval-v2/), [`reeval-protocol.md`](reeval-protocol.md) |

Preserve the original evaluation artifacts. A later live re-run must create new timestamped JSON and must record `analysis-triage-v2` / `triage-payload-v2`. Character-count reductions are not TypeSafe token savings and do not establish recall.

## Preparation and standalone triage

From the repository root, in PowerShell:

```powershell
node .mwnn/triage-benchmark/build.cjs
node .mwnn/triage-benchmark/measure-payload.cjs
node .mwnn/triage-benchmark/run.cjs
node .mwnn/triage-benchmark/run.cjs --live
```

`measure-payload.cjs` compares legacy vs revised triage state sizes without network calls. Preparation verifies fixture and label hashes against the approved request and sends no requests. Offline prep writes `prepared-baseline-<questionSetVersion>.json` (for example `prepared-baseline-analysis-triage-v2.json`) and does not overwrite the original `prepared-baseline.json`. `--live` needs `TYPESAFE_API_KEY` in the process environment; never paste its value into chat, files, or command text. Every run writes a new timestamped triage artifact and, on success, `prepared-comparison-<questionSetVersion>.json`. The first API call probes access; errors stop further scheduling and leave recall null. Incomplete runs never qualify as recall evidence. Successful requests record provider-reported usage and returned model ids. Do not count an all-fallback plan as successful triage recall. No existing judgment cache is read. A v2 live run requires a separate evaluation card; do not overwrite v1 artifacts.

`triage-1793061991570.json` is an incomplete sandbox network failure, not a benchmark result. `triage-1793062000319.json` is the complete 44-session run. Its measured recall at 0.7 is 16/16, with five negatives skipped. Its provider model is `jev-1.14.0`.

## Remaining GPT-6.1 Sol comparison

The local editor helper selects exactly one direct-request model matching the user-reported display name `GPT-6.1 Sol`. It does not substitute a model or accept a `copilotcli` entry. Ambiguous/unavailable selection writes model-discovery evidence and sends no analysis requests. It compares five prepared baseline batches plus synthesis with four triage-enabled batches plus synthesis, using the same baseline and model object. It preserves model identity, model tokenizer counts, returned text, timings, errors, and partial results. All measurements remain subject to runtime verification.

A fresh isolated VS Code profile lacks the user's Copilot authentication and installed chat providers. `.github/instructions/repo-validation.instructions.md` therefore requires asking before launching the helper against the existing editor profile. After that specific approval, the planned command is:

```powershell
code --new-window --extensionDevelopmentPath="E:\chat-commit\.mwnn\triage-benchmark\editor" "E:\chat-commit"
```

The helper starts the approved evaluation once on activation, protected by `editor-auto-launch-v2.claim` against duplicate paid runs after reloads. The helper can also be invoked inside its Development Host through `MWNN: Run Approved Triage Benchmark`. It does not install an extension or change Session Control settings. Runtime provider consent or authentication may still require the user. Do not stop or kill Code/other editor processes. Do not pass `--extensionTestsPath` against an existing Code instance: VS Code rejects that launch.

## Cost accounting

Follow-up owner: `card-mvq03qy7-1`. After a complete analysis artifact exists:

```powershell
node .mwnn/triage-benchmark/summarize.cjs analysis-1793062329161.json
node .mwnn/triage-benchmark/test-cost-accounting.cjs
```

`summarize.cjs` recomputes `summary.json` and `results.md`, archives the previous summary under `summary-history/`, and preserves any recorded `humanDecision`. `costAccounting.cjs` separates tokenizer counts, provider-reported usage, actual billed amounts, and estimates. Missing values stay `unavailable` with `value: null` rather than `0`. List rates live in `cost-rates.json` with effective dates and authoritative source URLs. See [cost-evidence.md](cost-evidence.md).

Verified financial savings remain unestablished until Human-workflow billing exports reconcile analysis and TypeSafe charges. Partial list-rate estimates must not be presented as savings proof.

## Adjusted re-evaluation (card-mvq03qy7-3)

After payload v2 and cost accounting, the adjusted live re-evaluation lives under
[`reeval-v2/`](reeval-v2/) and follows [`reeval-protocol.md`](reeval-protocol.md).
It does **not** overwrite v1 `results.md` / `summary.json`.

```powershell
node .mwnn/triage-benchmark/build.cjs
node .mwnn/triage-benchmark/run.cjs
node .mwnn/triage-benchmark/run-reeval.cjs --live --pair pair-1 --cacheCondition cold-no-judgment-cache
node .mwnn/triage-benchmark/run-reeval.cjs --live --pair pair-2 --cacheCondition warm-immediate-repeat
node .mwnn/triage-benchmark/run-reeval.cjs --live --pair pair-3 --cacheCondition warm-immediate-repeat
# Then Development Host analysis pairs (existing profile required for GPT-6.1 Sol):
# code --new-window --extensionDevelopmentPath="E:\chat-commit\.mwnn\triage-benchmark\editor" "E:\chat-commit"
node .mwnn/triage-benchmark/summarize-reeval.cjs
node .mwnn/triage-benchmark/write-report-quality.cjs
```

Primary outputs: [`reeval-v2/results.md`](reeval-v2/results.md),
[`reeval-v2/summary.json`](reeval-v2/summary.json),
[`reeval-v2/report-quality.md`](reeval-v2/report-quality.md).

## Interpretation limits

- Fixtures are already compact redacted evidence. The adapter preserves recorded user-prompt order and edge responses, leaves unavailable timestamps/tools empty, and includes original counts/tool summaries in the fixture summary. It does not recreate omitted transcript or individual tool events. Results apply to this redacted evaluation set.
- The installed VS Code API exposes text streams and `countTokens`, not provider billed usage. Input-message and returned-text tokenizer counts must be labeled as such. Hidden reasoning, system overhead, and provider cache/billing usage remain unknown; never report them as zero or claim measured financial savings.
- Triage time and provider tokens are reported separately; end-to-end comparison time includes measured triage overhead. Cold-cache and warm-cache observations must stay labeled separately; a single cold run is not a warm-cache test.
- Inspect per-session results and misses, reconcile all ids/counts and parse all JSON, then request the human ship-or-adjust decision. Do not mark the card Done while any criterion or material exception remains open.

