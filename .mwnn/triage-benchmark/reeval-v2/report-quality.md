# Report quality and evidence-support comparison — card-mvq03qy7-3

Structured comparison for human review. Retention of sessions does **not** imply equivalent recommendations. No publication authorized.

## Rubric

| Dimension | What was inspected |
| --- | --- |
| Coverage honesty | Whether synthesis states batch/fixture limits rather than claiming full-transcript certainty |
| Evidence support | Whether findings cite eval session ids or acknowledge missing tool traces |
| Control-file targeting | Mentions of AGENTS.md / SKILL.md / similar AI control files |
| Specificity / density | Approximate table-row and recommendation density in synthesis text |
| Cross-arm risk | Whether triageEnabled loses themes present in baseline without proving skipped sessions were irrelevant |

## pair-1 — order baseline → triageEnabled, cache=cold

| Metric | Baseline | TriageEnabled |
| --- | ---: | ---: |
| Synthesis chars | 15404 | 13903 |
| Table-like rows | 25 | 23 |
| Distinct eval ids mentioned | 27 | 22 |
| States limitations | true | true |
| Control-file mentions | AGENTS.md, .github/copilot-instructions.md, SKILL.md | AGENTS.md, .github/copilot-instructions.md, SKILL.md |

### Theme presence (heuristic keyword hits)

| Theme | Baseline | TriageEnabled |
| --- | --- | --- |
| installedBuildVerification | true | true |
| multiRepoPreload | true | true |
| gapOnlyAiControl | true | true |
| wrapperSkillSync | true | true |
| tokenBudgetBatching | true | true |
| typesafeOrTriage | true | true |

### Cost components (list-rate / unavailable — not verified savings)

- verifiedSavingsClaim.established: false
- financialSavingsEstablished: false
- reason: Unavailable cost components prevent a verified savings claim: before.cache, before.retriesOrFailedCalls, after.cache, after.retriesOrFailedCalls, before.actualBilledAmount, after.actualBilledAmount, typesafe.actualBilledAmount.
- partialEstimateSum before: ~$0.222278 USD (estimate)
- partialEstimateSum after: ~$0.170985058 USD (estimate)
- verified attributable total before/after: unavailable / unavailable
- analysis actual billed: unavailable
- TypeSafe actual billed: unavailable

Artifacts: [analysis-pair-1-1794257564319.json](analysis-pair-1-1794257564319.json), triage `reeval-v2/triage-pair-1-1794257499403.json`

## pair-2 — order triageEnabled → baseline, cache=cold

| Metric | Baseline | TriageEnabled |
| --- | ---: | ---: |
| Synthesis chars | 15281 | 11926 |
| Table-like rows | 15 | 14 |
| Distinct eval ids mentioned | 23 | 20 |
| States limitations | true | true |
| Control-file mentions | AGENTS.md, .github/copilot-instructions.md, SKILL.md | AGENTS.md, .github/copilot-instructions.md, SKILL.md |

### Theme presence (heuristic keyword hits)

| Theme | Baseline | TriageEnabled |
| --- | --- | --- |
| installedBuildVerification | true | true |
| multiRepoPreload | true | true |
| gapOnlyAiControl | true | true |
| wrapperSkillSync | true | true |
| tokenBudgetBatching | true | true |
| typesafeOrTriage | false | false |

### Cost components (list-rate / unavailable — not verified savings)

- verifiedSavingsClaim.established: false
- financialSavingsEstablished: false
- reason: Unavailable cost components prevent a verified savings claim: before.cache, before.retriesOrFailedCalls, after.cache, after.retriesOrFailedCalls, before.actualBilledAmount, after.actualBilledAmount, typesafe.actualBilledAmount.
- partialEstimateSum before: ~$0.220912 USD (estimate)
- partialEstimateSum after: ~$0.167541058 USD (estimate)
- verified attributable total before/after: unavailable / unavailable
- analysis actual billed: unavailable
- TypeSafe actual billed: unavailable

Artifacts: [analysis-pair-2-1794257896028.json](analysis-pair-2-1794257896028.json), triage `reeval-v2/triage-pair-2-1794257507771.json`

## pair-3 — order baseline → triageEnabled, cache=warm

| Metric | Baseline | TriageEnabled |
| --- | ---: | ---: |
| Synthesis chars | 12527 | 11631 |
| Table-like rows | 21 | 15 |
| Distinct eval ids mentioned | 22 | 19 |
| States limitations | true | true |
| Control-file mentions | AGENTS.md, .github/copilot-instructions.md, SKILL.md | AGENTS.md, .github/copilot-instructions.md, SKILL.md |

### Theme presence (heuristic keyword hits)

| Theme | Baseline | TriageEnabled |
| --- | --- | --- |
| installedBuildVerification | false | true |
| multiRepoPreload | true | true |
| gapOnlyAiControl | true | true |
| wrapperSkillSync | true | true |
| tokenBudgetBatching | true | true |
| typesafeOrTriage | true | false |

### Cost components (list-rate / unavailable — not verified savings)

- verifiedSavingsClaim.established: false
- financialSavingsEstablished: false
- reason: Unavailable cost components prevent a verified savings claim: before.cache, before.retriesOrFailedCalls, after.cache, after.retriesOrFailedCalls, before.actualBilledAmount, after.actualBilledAmount, typesafe.actualBilledAmount.
- partialEstimateSum before: ~$0.21213400000000002 USD (estimate)
- partialEstimateSum after: ~$0.165511058 USD (estimate)
- verified attributable total before/after: unavailable / unavailable
- analysis actual billed: unavailable
- TypeSafe actual billed: unavailable

Artifacts: [analysis-pair-3-1794258217954.json](analysis-pair-3-1794258217954.json), triage `reeval-v2/triage-pair-1-1794257499403.json`

## Cross-pair observations for human review

- All three pairs kept limitation language in both arms.
- TriageEnabled syntheses are consistently shorter and cite fewer distinct eval ids than baseline in the same pair.
- Theme keyword hits often remain true on both arms for core AI-control-file topics, but density and table support vary; do not treat keyword equality as report equivalence.
- Skipped negatives (`eval-13`, `eval-15`, `eval-24`, `eval-31`, `eval-37`) never appear as retained analysis evidence in triageEnabled arms by design.

## Unresolved representativeness limits

- Compact redacted fixtures omit middle turns and individual tool events.
- v2 adapter summary is counts/tools only; production session summaries differ.
- Warm analysis repeats may benefit from provider-side caching that production cold starts lack.
- Keyword theme hits are review aids only; they are not a substitute for reading synthesis text.
- Human sign-off remains on card-mvq03qy7-4.

