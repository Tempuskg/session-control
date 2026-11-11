# Triage evaluation — 2026-10-26

> **Artifact identity:** This file and its linked JSON are the original
> `analysis-triage-v1` evaluation. Do not overwrite them with a later
> `analysis-triage-v2` / `triage-payload-v2` run. Payload-overhead follow-up
> evidence lives in [`payload-overhead.md`](payload-overhead.md) and
> [`payload-measurements.json`](payload-measurements.json); live re-evaluation
> belongs on a separate card with new timestamped artifacts.

Verified evidence for card `card-mug8ch4z-11`, with auditable cost accounting added for follow-up `card-mvq03qy7-1`. Human ship-or-adjust decision is preserved below.

Analysis model: `OpenAI: GPT-6.1 Sol`, id `openai/gpt-6.1-sol`, provider `openrouter`. Reported provider version `1.0.0` is not a model-weight snapshot. Triage: `jev-1.14.0`, resolved from `jev-latest`; question set `analysis-triage-v1`; skip threshold 0.7.

| Measurement | Before | After |
| --- | ---: | ---: |
| Sessions sent to analysis | 44 | 39 |
| Analysis calls, including synthesis | 6 | 5 |
| Analysis batch input tokens, model tokenizer | 91,351 | 69,668 |
| Analysis batch returned-text tokens, model tokenizer | 8,623 | 6,479 |
| Synthesis input tokens, model tokenizer | 17,190 | 15,041 |
| Synthesis returned-text tokens, model tokenizer | 3,263 | 2,897 |
| Analysis token subtotal (tokenizer) | 120,427 | 94,085 |
| TypeSafe provider-reported input tokens | 0 (disabled) | 76,385 |
| TypeSafe provider-reported output tokens | 0 (disabled) | 4,180 |
| Analysis provider-reported usage | unavailable | unavailable |
| Analysis actual billed amount | unavailable | unavailable |
| TypeSafe actual billed amount | unavailable | unavailable |
| Arithmetic combined token count | 120,427 | 174,650 |
| Analysis arm wall time, seconds | 272.993 | 205.635 |
| TypeSafe overhead, seconds | 0 (disabled) | 1.448 |
| End-to-end wall time, seconds | 272.993 | 207.083 |

Analysis tokenizer counts decreased 21.87%. End-to-end wall time decreased 24.14% (65.910 seconds). Arithmetic combined token count increased 45.03%; this sum spans different model tokenizers and is not a financial cost measurement.

## Cost accounting

Currency: USD. Rates catalog: `cost-rates.json` (recorded 2026-11-08).

| Cost component | Before | After |
| --- | ---: | ---: |
| Analysis batches (list-rate estimate on tokenizer counts) | ~$0.268932 USD (estimate) | ~$0.204126 USD (estimate) |
| Synthesis (list-rate estimate on tokenizer counts) | ~$0.067010 USD (estimate) | ~$0.059052 USD (estimate) |
| TypeSafe (provider-reported × list rate, or measured $0 when disabled) | $0.000000 USD (measured) | ~$0.003208 USD (estimate) |
| Attributable cache charges | unavailable | unavailable |
| Attributable retry/failed-call charges | unavailable | unavailable |
| Verified attributable total | unavailable | unavailable |
| Partial estimate sum (available components only) | ~$0.335942 USD (estimate) | ~$0.266386 USD (estimate) |

**Financial savings established: no.** Verified savings claim: not established — Unavailable cost components prevent a verified savings claim: before.cache, before.retriesOrFailedCalls, after.cache, after.retriesOrFailedCalls, before.actualBilledAmount, after.actualBilledAmount, typesafe.actualBilledAmount.

### Evidence obtainable vs still required

Obtainable without credentials or customer records:

- analysis tokenizer counts (vscode.LanguageModelChat.countTokens via editor helper) — present: true
- analysis model identity (vscode.lm.selectChatModels match fields) — present: true
- TypeSafe provider-reported usage (systemOne response.usage on successful records) — present: true
- TypeSafe returned model ids (systemOne response.model) — present: true
- TypeSafe cache treatment note (triage.cache field) — present: true
- TypeSafe retry configuration (run.cjs TypeSafeClient({ retry: { maxRetries: 0 } })) — present: true
- published list rates with source URLs (cost-rates.json) — present: true

Unavailable from supported VS Code / runner APIs:

- VS Code / OpenRouter provider-reported analysis usage: LanguageModelChatResponse has text/stream only; no usage or billing fields in @types/vscode LanguageModelChat API.
- actual billed analysis amount: No extension API exposes invoice or statement charges for LanguageModelChat calls.
- analysis cache-read/write token counts: Not exposed by VS Code LM API for this path.
- analysis retry/failed-call billed usage: Not exposed by VS Code LM API; helper does not invent failed-call charges.

External evidence still required through the Human workflow (no credentials requested here):

- OpenRouter or Copilot/OpenAI account statement covering analysis-1793062329161.json wall-clock window — Confirm actual billed analysis (+ synthesis) charges, cache adjustments, and any retries. — Export or screenshot the provider usage/billing page for 2026-10-27T00:52:09Z–2026-10-27T01:00:07Z without sharing credentials or unrelated customer records.
- TypeSafe console usage/billing export for triage-1793062000319.json — Confirm that provider-reported input tokens × list rate matched the account charge for this run. — Export the TypeSafe organization Usage/Billing view for 2026-10-27T00:46:40Z–2026-10-27T00:46:41Z, redacting account identity if needed.

VS Code investigation: Tokenizer counts may be recorded as tokenizerCount evidence. They must not be substituted as actualBilled amounts.

## Recall

All 44 fixtures received successful judgments; there were no fallback cases. The policy retained all 16 ground-truth positives: **16/16 = 100% recall** at 0.7. Skipped `eval-13`, `eval-15`, `eval-24`, `eval-31`, and `eval-37`, all negatives. Missed positives: none.

## Interpretation and decision

Human decision, user-reported in interview chat, 2026-10-26: **adjust before shipping as a cost-saving feature**. The user answered exactly "Yes" to "Do you agree with recording that as your decision?". This run demonstrates preserved evaluation-set recall and lower elapsed time, but not lower total token volume or verified financial cost. Monetary savings still need provider billed analysis usage plus confirmed TypeSafe charges; list-rate estimates above are not a savings proof. The decision does not assert that adjustments were implemented or authorize publication. No product settings or shipping state changed.

Limitations: one cold-cache run on compact redacted fixtures, baseline followed by comparison; no repeated randomized timing, complete-transcript performance, model snapshot guarantee, or report-quality equivalence evaluation. The adapter preserves known prompts and edge responses and includes aggregate tool metadata without fabricating missing events. VS Code tokenizer counts exclude unexposed provider overhead, hidden reasoning, and billing/cache adjustments. Missing usage remains explicitly unavailable rather than zero.

## Evidence

- [Analysis calls, outputs, model identity, and timings](analysis-1793062329161.json)
- [Triage judgments, usage, and timings](triage-1793062000319.json)
- [Reconciled machine-readable summary](summary.json)
- [Rate catalog with source links](cost-rates.json)
- [Cost accounting module](costAccounting.cjs)
- [Prepared baseline inputs](prepared-baseline.json)
- [Prepared triage-enabled inputs](prepared-comparison.json)
- [Approved request and fixture hashes](../triage-evaluation-request.json)
- [Runner instructions](README.md)
- Prior summary snapshots under [summary-history/](summary-history/)

Validation: `node .mwnn/triage-benchmark/summarize.cjs analysis-1793062329161.json` passed reconciliation of complete arms, expected call/synthesis counts, nonempty outputs, token totals, 44 unique successful judgments, provider usage sums, recomputed recall, cost-class separation, and decision preservation. `node .mwnn/triage-benchmark/test-cost-accounting.cjs` covers missing usage, arithmetic reconciliation, and decision preservation. All JSON artifacts parse.
