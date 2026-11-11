# Adjusted triage re-evaluation — card-mvq03qy7-3

Generated: 2026-11-09T21:12:43.953Z

## Identities

- Question set: `analysis-triage-v2`
- Payload: `triage-payload-v2`
- Threshold: 0.7
- Package: session-control@1.12.1
- Baseline SHA-256: `b38cdc346ac97d6d2d34f766d51b9fd2ff571f4b4e984aa4232dcf46708dbe73`
- TypeSafe models observed: jev-1.14.0
- Labels SHA-256: `3704f1c9b678608fefc46c5a54aecd75a1c56a94e2f91c1d1eff916de504cc69`

## TypeSafe repetitions

| Pair | Cache | State | Wall ms | Input tok | Output tok | Recall | Misses |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| pair-1 | cold-no-judgment-cache | complete | 1246.5 | 47549 | 4180 | 1 | none |
| pair-2 | warm-immediate-repeat | complete | 1254.5 | 47549 | 4180 | 1 | none |
| pair-3 | warm-immediate-repeat | complete | 1154.9 | 47549 | 4180 | 1 | none |

Cold runs: 1; warm runs: 2. Mean wall 1218.6 ms. Mean TypeSafe input 47549 (original 76385).

## Recall vs original 16/16 at 0.7

- pair-1: 16/16 — no recall regression vs original 16/16 at threshold 0.7
  - Skipped: eval-13, eval-15, eval-24, eval-31, eval-37
- pair-2: 16/16 — no recall regression vs original 16/16 at threshold 0.7
  - Skipped: eval-13, eval-15, eval-24, eval-31, eval-37
- pair-3: 16/16 — no recall regression vs original 16/16 at threshold 0.7
  - Skipped: eval-13, eval-15, eval-24, eval-31, eval-37

## Analysis pairs

| Pair | Order | Cache | Baseline E2E ms | Triage E2E ms | Baseline tok | Triage tok |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| pair-1 | baseline → triageEnabled | cold | 192609.4 | 140332.5 | 76387 | 57602 |
| pair-2 | triageEnabled → baseline | cold | 184343.9 | 138832.7 | 76256 | 57236 |
| pair-3 | baseline → triageEnabled | warm | 173623.7 | 132066.7 | 75115 | 56945 |

### Per-pair partial cost estimates (not verified savings)

| Pair | Cache | Baseline partial est. USD | TriageEnabled partial est. USD | Verified total |
| --- | --- | ---: | ---: | --- |
| pair-1 | cold | ~$0.222278 | ~$0.170985 | unavailable |
| pair-2 | cold | ~$0.220912 | ~$0.167541 | unavailable |
| pair-3 | warm | ~$0.212134 | ~$0.165511 | unavailable |

Aggregates: mean baseline E2E 183525.7 ms; mean triageEnabled E2E 137077.3 ms; mean baseline analysis tokens 75919.3; mean triageEnabled analysis tokens 57261.0.

Unavailable/unverified billing components: analysis provider-reported usage, analysis actual billed amount, TypeSafe actual billed amount, attributable cache charges, attributable retry/failed-call charges. No monetary-savings claim is made.

### Report quality (structural)

#### pair-1
- Baseline: 12 bullet-like lines; sessions cited: 27; limitation language: true
- TriageEnabled: 4 bullet-like lines; sessions cited: 22; limitation language: true
- Control-file pattern mentions — baseline: AGENTS.md, SKILL.md; triage: AGENTS.md, SKILL.md
#### pair-2
- Baseline: 30 bullet-like lines; sessions cited: 23; limitation language: true
- TriageEnabled: 0 bullet-like lines; sessions cited: 20; limitation language: true
- Control-file pattern mentions — baseline: AGENTS.md, SKILL.md; triage: AGENTS.md, SKILL.md
#### pair-3
- Baseline: 0 bullet-like lines; sessions cited: 22; limitation language: true
- TriageEnabled: 10 bullet-like lines; sessions cited: 19; limitation language: true
- Control-file pattern mentions — baseline: AGENTS.md, SKILL.md; triage: AGENTS.md, SKILL.md

Full structured comparison: [report-quality.md](report-quality.md).

## Cost claim

**Financial savings established: no.** No monetary-savings claim while analysis and/or TypeSafe actual billed amounts remain unavailable.

## Representativeness limits

- Compact redacted fixtures omit middle turns and individual tool events; adapter does not fabricate them.
- v2 adapter summary is counts/tools only; production markdown summaries differ.
- Results apply only to this 44-session redacted evaluation set.
- VS Code exposes tokenizer counts only; provider billed usage, cache tokens, and hidden reasoning remain unavailable.
- Warm TypeSafe repeats still do not read local judgment cache; warmth is process/provider-side only.
- Instruction baseline SHA may differ from the 2026-10-26 v1 run if AGENTS.md / copilot-instructions.md changed; within-pair baseline is held fixed.

## Outcome summary

```json
{
  "recall": "Adjusted payload preserved 16/16 recall at threshold 0.7 across all complete triage repetitions; same five negatives skipped as original.",
  "typesafeInputTokens": "Mean TypeSafe input tokens 47549 vs original 76385 (-37.75%).",
  "latency": "See per-pair analysis end-to-end times; cold and warm labeled separately.",
  "cost": "Partial list-rate estimates may exist per pair; verified financial savings remain unestablished.",
  "reportQuality": "See per-pair quality structural comparison; human review still required (card-mvq03qy7-4).",
  "improvedIntendedOutcomes": {
    "typesafePayloadTokensReduced": true,
    "analysisEndToEndFasterWithTriage": true,
    "recallPreserved": true,
    "verifiedMoneySaved": false,
    "negativeOrCaveats": [
      "Verified billed savings unavailable.",
      "Report-quality equivalence is not assumed from retention alone."
    ]
  }
}
```

## Evidence

- Protocol: [reeval-protocol.md](../reeval-protocol.md)
- Triage index: [triage-index.json](triage-index.json)
- Machine summary: [summary.json](summary.json)
- Report quality: [report-quality.md](report-quality.md)
- Analysis host: files matching `analysis-host-*.json` / `analysis-pair-*.json` in this folder
- Original v1 results (historical): [../results.md](../results.md)
