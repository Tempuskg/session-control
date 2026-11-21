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

## Human review decisions

- 2026-11-14 — User-reported in the coworking interview for [card-mvq03qy7-4](../../cards/card-mvq03qy7-4.md). Asked "Do you approve retaining **0.7**, requiring **16/16 positive retention on this evaluation set**?" The person answered exactly "yes". Approved threshold is 0.7 with all 16 labeled positives required to be retained on this evaluation set. Remaining product sign-off decisions, including report quality, shipping disposition and approved claims, are pending. Publication requires separate explicit authorization.
- 2026-11-14 — User-reported in the same interview. Asked "Are these report-quality tradeoffs acceptable for shipping, or should they require further adjustment?" after describing shorter reports, fewer cited sessions, changed recommendations, and one triage report claiming all-44 coverage despite retaining 39. Answer exactly "these are acceptable". The disclosed report-quality tradeoffs are accepted for shipping the evaluated version. Overall shipping disposition and approved claims remain pending. Semantic equivalence remains unmeasured.
- 2026-11-14 — User-reported in the same interview. Asked "Do you approve this claim wording for the card’s required human sign-off?" Answer exactly "Yes". Approved claims are limited to the 44 compact redacted fixtures, session-control 1.12.1, GPT-6.1 Sol and jev-1.14.0. Elapsed time including triage fell 24.69% and 27.14% in runs labeled cold, and 23.93% in the warm repeat. TypeSafe input tokens fell 37.75% against the original payload. Financial savings remain unestablished because billed costs are unavailable. Cache labels reflect run procedure; the warm analysis repeat reused the first triage run's overhead. No monetary-savings claim is approved. Overall product shipping decision remains pending.
- 2026-11-15 — User-reported final product sign-off in the same interview. Asked "Do you approve this ship decision and rationale, with release preparation and validation as the next action?" Answer exactly "Yes". Decision is **ship the evaluated adjusted feature at threshold 0.7**, based on 16/16 positive retention, observed speed improvements and accepted report-quality tradeoffs. Accepted evaluation limitations include compact fixtures, procedural cache labels, reused triage overhead and unmeasured semantic equivalence. Billing remains unavailable; approved claim wording above continues to state that financial savings are unestablished. Next action is repository release preparation and validation, carrying forward the failed independent-verification handoff as a validation workflow gap. Marketplace publication requires separate explicit authorization. The original 2026-10-26 adjust decision remains historical evidence. Earlier generated summary statements and dated notes about pending sign-off describe the state before this final human decision.
