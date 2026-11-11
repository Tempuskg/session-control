# Adjusted triage re-evaluation protocol — card-mvq03qy7-3

Written protocol for repeating the baseline evaluation against the same 44
redacted labeled fixtures after `analysis-triage-v2` / `triage-payload-v2`
payload adjustments and auditable cost accounting. No publication is authorized.

## Fixed comparison identity (hold within each pair)

| Field | Value |
| --- | --- |
| Fixtures / labels | Same approved set in `.mwnn/triage-evaluation-request.json` (44 sessions, 16 positives) |
| Label SHA-256 | `3704f1c9b678608fefc46c5a54aecd75a1c56a94e2f91c1d1eff916de504cc69` |
| Analysis model display name | `GPT-6.1 Sol` (exact runtime id recorded per analysis artifact) |
| Prompt version | `5` |
| Question / cache version | `analysis-triage-v2` |
| Payload version | `triage-payload-v2` |
| Batch char budget | `48000` (`DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET`) |
| Skip threshold | `0.7` (unchanged from original; not raised for savings) |
| Instruction baseline | Concatenation of `AGENTS.md` + `.github/copilot-instructions.md`; SHA recorded in each prepared config as `baselineSha256` |
| TypeSafe configured model | `jev-latest` (resolved runtime id recorded per successful record) |
| TypeSafe retries | `maxRetries: 0` |
| Local judgment cache | Never read on evaluation runs |

Original v1 artifacts (`results.md`, `summary.json`, `triage-1793062000319.json`,
`analysis-1793062329161.json`) are historical and must not be overwritten.
All re-eval outputs live under `reeval-v2/` with new timestamps.

## External-call scope

External calls on these 44 redacted fixtures (TypeSafe + in-editor GPT-6.1 Sol
analysis) were approved 2026-10-26 and remain the evaluation scope for this
card. Any destination, dataset, or publication beyond that scope requires a new
explicit human approval. This card does not authorize Marketplace publication
or product setting changes.

## Paired repetitions (minimum three)

Each **pair** measures both arms against the same prepared inputs and the same
analysis model object within one editor session:

- **baseline** — triage disabled; all 44 sessions batched for analysis
- **triageEnabled** — sessions retained by the paired TypeSafe plan (+ TypeSafe
  wall time included in end-to-end)

### Alternating arm order (reduce baseline-first bias)

| Pair id | Arm order | Analysis cache condition | TypeSafe cache condition |
| --- | --- | --- | --- |
| pair-1 | baseline → triageEnabled | `cold` (first analysis pair in host) | `cold-no-judgment-cache` (first live triage process) |
| pair-2 | triageEnabled → baseline | `cold` (new prompts / first pass of reverse order) | `warm-immediate-repeat` (second consecutive live triage) |
| pair-3 | baseline → triageEnabled | `warm` (immediate repeat of pair-1 prompt set in same host) | `warm-immediate-repeat` (third consecutive live triage) |

Cold and warm observations are labeled separately and never mixed in a single
aggregate latency claim. Incomplete, cancelled, or all-fallback triage runs are
recorded as failures and **must not** be counted as successful model recall.

## Measurements required per pair / run

1. End-to-end wall time (analysis arm + TypeSafe overhead when triage enabled)
2. Analysis tokenizer input/output tokens per call (VS Code `countTokens`)
3. TypeSafe provider-reported usage and returned model ids
4. Cost components via `costAccounting.cjs` — label unavailable billed amounts;
   make no monetary-savings claim while billed components remain unavailable
5. Recall = retained positives / 16; list every missed positive id
6. Synthesis recommendation quality / evidence support (structured rubric)
7. Exact runtime identities: analysis model `{name,id,vendor,version}`, TypeSafe
   `response.model`, package version, question/payload versions, hashes

## Report-quality rubric (human-reviewable)

For each complete pair, score baseline vs triageEnabled synthesis on:

| Dimension | Question |
| --- | --- |
| Recommendation specificity | Names concrete AI-control-file targets vs vague advice |
| Evidence support | Cites session ids / observable fixture evidence vs unsupported claims |
| Gap discipline | Avoids recommending items already covered by supplied baseline instructions |
| Coverage honesty | States batch/fixture limitations rather than claiming full-transcript certainty |
| Regression risk | Loses a high-value finding present in the other arm without evidence that the skipped sessions were irrelevant |

Retained sessions do **not** imply equivalent reports. Skipped-session content
cannot be assumed recoverable.

## Representativeness limits (compact-fixture adapter)

Document unresolved limits in the re-eval report:

- Fixtures are already compact/redacted; omitted middle turns and individual tool
  events are unavailable and must not be fabricated
- Adapter summary is counts/tools only under v2; production summaries differ
- Results apply to this redacted evaluation set only
- VS Code exposes tokenizer counts, not provider billed usage / cache tokens
- Single-host warm repeats are not a statistical cache study

## Commands (PowerShell, repo root)

```powershell
node .mwnn/triage-benchmark/build.cjs
node .mwnn/triage-benchmark/run.cjs
node .mwnn/triage-benchmark/run-reeval.cjs --live --pair pair-1 --cacheCondition cold-no-judgment-cache
node .mwnn/triage-benchmark/run-reeval.cjs --live --pair pair-2 --cacheCondition warm-immediate-repeat
node .mwnn/triage-benchmark/run-reeval.cjs --live --pair pair-3 --cacheCondition warm-immediate-repeat
# After prepared comparison exists, launch editor helper for analysis pairs
# (requires explicit existing-profile approval per README when not already granted):
# code --new-window --extensionDevelopmentPath="E:\chat-commit\.mwnn\triage-benchmark\editor" "E:\chat-commit"
node .mwnn/triage-benchmark/summarize-reeval.cjs
```

## Success / failure rules

- `recall` is non-null only when triage `state === 'complete'` and every session
  has a successful judgment (no fallbacks counted as model decisions)
- Failed/incomplete runs stay in evidence with `state` preserved; they are
  excluded from successful recall aggregates
- Reconcile JSON validity, id counts, token sums, and cost totals before DONE
