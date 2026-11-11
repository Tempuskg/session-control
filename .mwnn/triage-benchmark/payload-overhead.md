# Triage payload overhead diagnosis — card-mvq03qy7-2

This document records the production-versus-fixture payload diagnosis and the
documented reduction shipped for follow-up live evaluation. It does **not**
claim preserved model recall or financial savings. Character counts are local
JSON size measurements of triage `state` objects only.

## Version identity

| Field | Original evaluation (2026-10-26) | Revised implementation |
| --- | --- | --- |
| Question / cache version | `analysis-triage-v1` | `analysis-triage-v2` |
| Payload shape | `summaryOnly` evidence blob + first/last turns | `triage-payload-v2` (summary, tools, userPrompts, first/last) |
| Fixture adapter summary | Full fixture JSON stringified into `markdownSummary` | Counts + tools metadata only (no prompt/response duplication) |
| Skip threshold | 0.7 | 0.7 (unchanged) |

Original live artifacts remain authoritative for the v1 run and must not be
renamed or overwritten:

- `results.md`, `summary.json`, `triage-1793062000319.json`, `analysis-1793062329161.json`
- `prepared-baseline.json`, `prepared-comparison.json`

A later live evaluation must write **new** timestamped triage/analysis JSON and
must record `analysis-triage-v2` / `triage-payload-v2` in its config so it cannot
be mistaken for the original run.

## Diagnosis

### Adapter duplication (fixture-only)

The compact-fixture adapter used by the original evaluation stuffed
`JSON.stringify(fixture)` into `markdownSummary`. That fixture already contains
`userPrompts`, `firstResponse`, and `lastResponse`, which the adapter also
materializes as turns / edge turns. Holding the **legacy** production builder
fixed and switching only the adapter summary removes ~40% of fixture triage
state characters. That overhead is **not** present in production sessions,
whose `markdownSummary` is a real chat summary rather than the full fixture.

### Production payload overhead

The legacy production builder sent `buildSessionEvidence(..., 'summaryOnly')`
plus separate `firstTurn` / `lastTurn`. The summaryOnly evidence blob includes
session headers and a transcript tail that largely duplicates `lastTurn`, and it
omits middle user prompts that matter for friction / instruction-violation
signals. Replacing that blob with a lean `summary` + aggregate `tools` + clipped
`userPrompts` + edges reduces production-shaped state by ~28% while keeping
those signals.

## Reproducible measurements

Rebuild the local library, then measure:

```powershell
node .mwnn/triage-benchmark/build.cjs
node .mwnn/triage-benchmark/measure-payload.cjs
```

Machine-readable output: [`payload-measurements.json`](payload-measurements.json).

### Recorded totals (44 sessions, JSON-encoded state chars)

| Path | Total chars | Avg | Reduction vs paired before |
| --- | ---: | ---: | ---: |
| eval-v1: full-fixture adapter + legacy builder | 187,002 | 4,250 | — |
| adapter-only fix + legacy builder | 112,309 | 2,552 | 39.94% (adapter duplication isolated) |
| eval-v2: revised adapter + `triage-payload-v2` | 81,376 | 1,849 | 56.48% vs eval-v1 |
| production-shaped + legacy builder | 92,042 | 2,092 | — |
| production-shaped + `triage-payload-v2` | 66,633 | 1,514 | 27.61% |

Exact numbers are taken from `payload-measurements.json` at measurement time; re-run
the script after further payload edits.

## What this prepares (and does not claim)

- Ready for a separate live evaluation card using `analysis-triage-v2` /
  `triage-payload-v2`, threshold 0.7, cold cache (v1 judgments must not be reused).
- Offline prep artifact for that card: `prepared-baseline-analysis-triage-v2.json`.
  Live triage success will write `prepared-comparison-analysis-triage-v2.json` and a
  new `triage-<timestamp>.json`; the editor helper prefers those versioned files.
- No claim that synthetic payload shrinkage preserves TypeSafe recall.
- No claim of financial savings from character counts or from the original v1 token table.
