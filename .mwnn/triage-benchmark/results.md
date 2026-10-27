# Triage evaluation — 2026-10-26

Verified evidence for card `card-mug8ch4z-11`. Human ship-or-adjust decision is recorded below.

Analysis model: `OpenAI: GPT-6.1 Sol`, id `openai/gpt-6.1-sol`, provider `openrouter`. Reported provider version `1.0.0` is not a model-weight snapshot. Triage: `jev-1.14.0`, resolved from `jev-latest`; question set `analysis-triage-v1`; skip threshold 0.7.

| Measurement | Before | After |
| --- | ---: | ---: |
| Sessions sent to analysis | 44 | 39 |
| Analysis calls, including synthesis | 6 | 5 |
| Analysis input tokens, model tokenizer | 108,541 | 84,709 |
| Analysis returned-text tokens, model tokenizer | 11,886 | 9,376 |
| Analysis token subtotal | 120,427 | 94,085 |
| TypeSafe provider-reported input tokens | 0 (disabled) | 76,385 |
| TypeSafe provider-reported output tokens | 0 (disabled) | 4,180 |
| Arithmetic combined token count | 120,427 | 174,650 |
| Analysis arm wall time, seconds | 272.993 | 205.635 |
| TypeSafe overhead, seconds | 0 (disabled) | 1.448 |
| End-to-end wall time, seconds | 272.993 | 207.083 |

Analysis tokenizer counts decreased 21.87%. End-to-end wall time decreased 24.14% (65.910 seconds). Arithmetic combined token count increased 45.03%; this sum spans different model tokenizers and is not a financial cost measurement.

## Recall

All 44 fixtures received successful judgments; there were no fallback cases. The policy retained all 16 ground-truth positives: **16/16 = 100% recall** at 0.7. Skipped `eval-13`, `eval-15`, `eval-24`, `eval-31`, and `eval-37`, all negatives. Missed positives: none.

## Interpretation and decision

Human decision, user-reported in interview chat on 2026-10-26: **adjust before shipping as a cost-saving feature**. The user answered exactly "Yes" to recording the preceding recommendation as their decision. This run demonstrates preserved evaluation-set recall and lower elapsed time, but not lower total token volume or verified financial cost. Monetary savings need provider billed analysis usage and appropriate prices, neither of which was measured here. The decision does not assert that adjustments were implemented or authorize publication. No product settings or shipping state changed.

Limitations: one cold-cache run on compact redacted fixtures, baseline followed by comparison; no repeated randomized timing, complete-transcript performance, model snapshot guarantee, or report-quality equivalence evaluation. The adapter preserves known prompts and edge responses and includes aggregate tool metadata without fabricating missing events. VS Code tokenizer counts exclude unexposed provider overhead, hidden reasoning, and billing/cache adjustments. These are explicit measurement limits, not zero usage.

## Evidence

- [Analysis calls, outputs, model identity, and timings](analysis-1793062329161.json)
- [Triage judgments, usage, and timings](triage-1793062000319.json)
- [Reconciled machine-readable summary](summary.json)
- [Prepared baseline inputs](prepared-baseline.json)
- [Prepared triage-enabled inputs](prepared-comparison.json)
- [Approved request and fixture hashes](../triage-evaluation-request.json)
- [Runner instructions](README.md)

Validation: `node .mwnn/triage-benchmark/summarize.cjs analysis-1793062329161.json` passed reconciliation of complete arms, expected call/synthesis counts, nonempty outputs, token totals, 44 unique successful judgments, provider usage sums, and recomputed recall. All JSON artifacts parse. Existing application source files and tests did not change in this coworking task.
