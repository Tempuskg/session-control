# Cost evidence inventory

Owner follow-up: `card-mvq03qy7-1`. Measurement run: `analysis-1793062329161.json` + `triage-1793062000319.json`.

This note records which cost evidence the workspace-local benchmark can obtain, and which artifacts still require a Human workflow export. It does **not** establish financial savings.

## Classification rules

| Class | Meaning | May be zero? |
| --- | --- | --- |
| `tokenizerCount` | VS Code `countTokens` on explicit request/response text | Yes, only if the measured text truly tokenizes to zero |
| `providerReported` | Provider API usage object (for example TypeSafe `usage`) | Yes, only when the provider reports zero |
| `actualBilled` | Invoice/statement charge attributable to the run | Yes, only with billed evidence; never invent zero for missing bills |
| `estimate` | Rate catalog × a non-billed usage class | Only as an explicitly labeled estimate |
| `unavailable` | No supported evidence | Value must be `null`, never `0` |

## Obtainable now

- Analysis model identity from VS Code (`name`, `id`, `vendor`, `version`)
- Analysis/synthesis tokenizer counts from `model.countTokens`
- Local analysis and triage wall times
- TypeSafe returned model ids and provider-reported `input_tokens` / `output_tokens`
- TypeSafe cold-cache treatment note and `maxRetries: 0` runner configuration
- Published list rates with effective dates and authoritative URLs in `cost-rates.json`

## Unavailable from supported APIs

- VS Code / OpenRouter provider-reported analysis usage (LM response has text/stream only)
- Actual billed analysis or synthesis amounts
- Analysis cache-read/write token counts
- Analysis retry or failed-call billed usage
- Invoice-confirmed TypeSafe charges for this run

## External evidence still required (Human workflow)

Do not request credentials or unrelated customer records.

1. Provider account usage/billing export covering `2026-10-27T00:52:09Z`–`2026-10-27T01:00:07Z` for `openai/gpt-6.1-sol` through OpenRouter (or the billing surface that actually charged the authenticated VS Code profile).
2. TypeSafe organization Usage/Billing export covering `2026-10-27T00:46:40Z`–`2026-10-27T00:46:41Z` for `jev-1.14.0`, sufficient to confirm whether provider-reported input tokens × $0.042 / 1M matched the account charge.

Until both exist and reconcile, `verifiedSavingsClaim.established` remains `false` and summaries must not claim financial savings.
