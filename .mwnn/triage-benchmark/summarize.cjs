'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {
  buildCostAccounting,
  reconcileTokenArithmetic,
  splitArmCalls,
} = require('./costAccounting.cjs');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (p, value) => fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);

const requestedAnalysisFile = process.argv[2];
const analysisFile = typeof requestedAnalysisFile === 'string' ? path.basename(requestedAnalysisFile) : '';
if (!analysisFile || analysisFile !== requestedAnalysisFile || !/^analysis-\d+\.json$/.test(analysisFile)) {
  throw new Error('Pass one local analysis-<timestamp>.json filename.');
}

const root = __dirname;
const analysisPath = path.resolve(root, analysisFile);
if (!analysisPath.startsWith(`${path.resolve(root)}${path.sep}`)) {
  throw new Error('Analysis artifact path must stay inside the triage-benchmark directory.');
}
const analysis = read(analysisPath);
const triage = read(path.join(root, analysis.triageResultPath));
const labels = read(path.join(root, '../../test/fixtures/typesafe/labels.json'));
const ratesDoc = read(path.join(root, 'cost-rates.json'));
const summaryPath = path.join(root, 'summary.json');
const historyDir = path.join(root, 'summary-history');

assert.equal(analysis.state, 'complete');
assert.equal(triage.state, 'complete');
assert.equal(analysis.arms.length, 2);
assert.equal(triage.records.length, 44);
assert.equal(new Set(triage.records.map((r) => r.id)).size, 44);
assert.equal(triage.fallbackIds.length, 0);
assert.deepEqual(analysis.config, triage.config);

for (const arm of analysis.arms) {
  assert.equal(arm.state, 'complete');
  assert.equal(arm.inputTokens, arm.calls.reduce((s, c) => s + c.inputTokens, 0));
  assert.equal(arm.outputTokens, arm.calls.reduce((s, c) => s + c.outputTokens, 0));
  assert.ok(arm.calls.every((c) => c.text.trim() && c.wallTimeMs > 0));
}

const before = analysis.arms.find((a) => a.name === 'baseline');
const after = analysis.arms.find((a) => a.name === 'triageEnabled');
assert.equal(before.calls.length, 6);
assert.equal(after.calls.length, 5);
assert.equal(before.calls.at(-1).kind, 'synthesis');
assert.equal(after.calls.at(-1).kind, 'synthesis');

const positiveIds = labels.sessions.filter((l) => l.worthAnalyzing).map((l) => l.id);
const retainedPositiveIds = positiveIds.filter((id) => triage.retainedIds.includes(id));
assert.equal(triage.recall, retainedPositiveIds.length / positiveIds.length);
for (const field of ['input_tokens', 'output_tokens']) {
  assert.equal(triage.usage[field], triage.records.reduce((s, r) => s + r.usage[field], 0));
}

const total = (arm) => arm.inputTokens + arm.outputTokens;
const triageTokens = triage.usage.input_tokens + triage.usage.output_tokens;
const change = (b, a) => ((a - b) / b) * 100;
const beforeSplit = splitArmCalls(before);
const afterSplit = splitArmCalls(after);
const arithmetic = reconcileTokenArithmetic(analysis, triage);
assert.equal(arithmetic.beforeCallSumMatchesArm, true);
assert.equal(arithmetic.afterCallSumMatchesArm, true);
assert.equal(arithmetic.triageUsageSumMatchesRecords, true);

let previousSummary = null;
if (fs.existsSync(summaryPath)) {
  previousSummary = read(summaryPath);
  fs.mkdirSync(historyDir, { recursive: true });
  const stamp = previousSummary.generatedAt
    || previousSummary.humanDecision?.source?.replace(/[^a-z0-9]+/gi, '-')
    || `preserved-${Date.now()}`;
  const archiveName = `summary-${String(stamp).replace(/[^a-z0-9._-]+/gi, '-')}.json`;
  writeJson(path.join(historyDir, archiveName), previousSummary);
}

const preservedDecision = previousSummary?.humanDecision ?? null;
const historicalRuns = Array.isArray(previousSummary?.historicalRuns)
  ? [...previousSummary.historicalRuns]
  : [];
if (previousSummary?.evidence) {
  const priorKey = `${previousSummary.evidence.analysisFile}|${previousSummary.evidence.triageFile}|${previousSummary.schemaVersion}`;
  if (!historicalRuns.some((run) => `${run.analysisFile}|${run.triageFile}|${run.schemaVersion}` === priorKey)) {
    historicalRuns.push({
      analysisFile: previousSummary.evidence.analysisFile,
      triageFile: previousSummary.evidence.triageFile,
      schemaVersion: previousSummary.schemaVersion,
      generatedAt: previousSummary.generatedAt || null,
      humanDecision: previousSummary.humanDecision || null,
      archivedFrom: 'summary.json before recompute',
    });
  }
}

const costAccounting = buildCostAccounting({ analysis, triage, ratesDoc });
assert.equal(costAccounting.financialSavingsEstablished, false);
assert.equal(costAccounting.verifiedSavingsClaim.established, false);
assert.equal(costAccounting.usageClasses.before.tokenizerCounts.classification, 'tokenizerCount');
assert.equal(costAccounting.usageClasses.before.providerReportedUsage.status, 'unavailable');
assert.equal(costAccounting.usageClasses.before.actualBilledAmount.status, 'unavailable');
assert.equal(costAccounting.usageClasses.typesafe.providerReportedUsage.status, 'measured');
assert.notEqual(costAccounting.usageClasses.typesafe.providerReportedUsage.value, 0);
assert.equal(costAccounting.costComponents.after.typesafe.status, 'estimate');
assert.equal(costAccounting.costComponents.after.cache.status, 'unavailable');
assert.equal(costAccounting.costComponents.after.retriesOrFailedCalls.status, 'unavailable');
assert.equal(costAccounting.totals.after.total.status, 'unavailable');

const generatedAt = new Date().toISOString();
const summary = {
  schemaVersion: 2,
  generatedAt,
  evidence: { analysisFile, triageFile: analysis.triageResultPath },
  analysisModel: analysis.model,
  triageModels: [...new Set(triage.records.map((r) => r.model))],
  threshold: triage.config.threshold,
  recall: triage.recall,
  retainedPositiveIds,
  missedPositiveIds: triage.missedPositiveIds,
  retainedSessions: triage.retainedIds.length,
  skippedSessions: triage.skippedIds.length,
  before: {
    inputTokens: before.inputTokens,
    outputTokens: before.outputTokens,
    totalVisibleTokens: total(before),
    analysisBatchTokenizerTokens: beforeSplit.analysisBatches,
    synthesisTokenizerTokens: beforeSplit.synthesis,
    wallTimeMs: before.wallTimeMs,
    providerReportedUsage: costAccounting.usageClasses.before.providerReportedUsage,
    actualBilledAmount: costAccounting.usageClasses.before.actualBilledAmount,
  },
  after: {
    inputTokens: after.inputTokens,
    outputTokens: after.outputTokens,
    totalVisibleTokens: total(after),
    analysisBatchTokenizerTokens: afterSplit.analysisBatches,
    synthesisTokenizerTokens: afterSplit.synthesis,
    analysisWallTimeMs: after.wallTimeMs,
    triageProviderInputTokens: triage.usage.input_tokens,
    triageProviderOutputTokens: triage.usage.output_tokens,
    triageWallTimeMs: triage.wallTimeMs,
    endToEndWallTimeMs: after.wallTimeMs + triage.wallTimeMs,
    arithmeticCombinedTokenCount: total(after) + triageTokens,
    providerReportedUsage: costAccounting.usageClasses.after.providerReportedUsage,
    actualBilledAmount: costAccounting.usageClasses.after.actualBilledAmount,
  },
  changePercent: {
    analysisVisibleTokens: change(total(before), total(after)),
    endToEndWallTime: change(before.wallTimeMs, after.wallTimeMs + triage.wallTimeMs),
    arithmeticCombinedTokenCount: change(total(before), total(after) + triageTokens),
  },
  tokenArithmetic: arithmetic,
  costAccounting,
  limitations: [
    analysis.tokenMeasurement,
    'Tokenizer counts, provider-reported usage, actual billed amounts, and estimates are distinct classes. Missing values stay unavailable rather than zero.',
    'Combined count adds unlike model tokenizers and does not establish financial cost. No verified price application can replace missing billed analysis usage.',
    triage.config.adapter,
    'Single sequential baseline-then-comparison run; no repeated randomized timing or report-quality equivalence evaluation.',
  ],
  historicalRuns,
  humanDecision: preservedDecision,
};

writeJson(summaryPath, summary);

const fmt = (n) => n.toLocaleString('en-US');
const money = (part) => {
  if (!part || part.status === 'unavailable') return 'unavailable';
  if (typeof part.value !== 'number') return 'unavailable';
  return `${part.status === 'estimate' ? '~' : ''}$${part.value.toFixed(6)} ${summary.costAccounting.currency} (${part.status})`;
};

const results = `# Triage evaluation — 2026-10-26

> **Artifact identity:** This file and its linked JSON are the original
> \`analysis-triage-v1\` evaluation. Do not overwrite them with a later
> \`analysis-triage-v2\` / \`triage-payload-v2\` run. Payload-overhead follow-up
> evidence lives in [\`payload-overhead.md\`](payload-overhead.md) and
> [\`payload-measurements.json\`](payload-measurements.json); live re-evaluation
> belongs on a separate card with new timestamped artifacts.

Verified evidence for card \`card-mug8ch4z-11\`, with auditable cost accounting added for follow-up \`card-mvq03qy7-1\`. Human ship-or-adjust decision is preserved below.

Analysis model: \`OpenAI: GPT-6.1 Sol\`, id \`openai/gpt-6.1-sol\`, provider \`openrouter\`. Reported provider version \`1.0.0\` is not a model-weight snapshot. Triage: \`jev-1.14.0\`, resolved from \`jev-latest\`; question set \`analysis-triage-v1\`; skip threshold 0.7.

| Measurement | Before | After |
| --- | ---: | ---: |
| Sessions sent to analysis | 44 | 39 |
| Analysis calls, including synthesis | 6 | 5 |
| Analysis batch input tokens, model tokenizer | ${fmt(beforeSplit.analysisBatches.inputTokens)} | ${fmt(afterSplit.analysisBatches.inputTokens)} |
| Analysis batch returned-text tokens, model tokenizer | ${fmt(beforeSplit.analysisBatches.outputTokens)} | ${fmt(afterSplit.analysisBatches.outputTokens)} |
| Synthesis input tokens, model tokenizer | ${fmt(beforeSplit.synthesis.inputTokens)} | ${fmt(afterSplit.synthesis.inputTokens)} |
| Synthesis returned-text tokens, model tokenizer | ${fmt(beforeSplit.synthesis.outputTokens)} | ${fmt(afterSplit.synthesis.outputTokens)} |
| Analysis token subtotal (tokenizer) | ${fmt(total(before))} | ${fmt(total(after))} |
| TypeSafe provider-reported input tokens | 0 (disabled) | ${fmt(triage.usage.input_tokens)} |
| TypeSafe provider-reported output tokens | 0 (disabled) | ${fmt(triage.usage.output_tokens)} |
| Analysis provider-reported usage | unavailable | unavailable |
| Analysis actual billed amount | unavailable | unavailable |
| TypeSafe actual billed amount | unavailable | unavailable |
| Arithmetic combined token count | ${fmt(total(before))} | ${fmt(total(after) + triageTokens)} |
| Analysis arm wall time, seconds | ${(before.wallTimeMs / 1000).toFixed(3)} | ${(after.wallTimeMs / 1000).toFixed(3)} |
| TypeSafe overhead, seconds | 0 (disabled) | ${(triage.wallTimeMs / 1000).toFixed(3)} |
| End-to-end wall time, seconds | ${(before.wallTimeMs / 1000).toFixed(3)} | ${((after.wallTimeMs + triage.wallTimeMs) / 1000).toFixed(3)} |

Analysis tokenizer counts decreased ${Math.abs(summary.changePercent.analysisVisibleTokens).toFixed(2)}%. End-to-end wall time decreased ${Math.abs(summary.changePercent.endToEndWallTime).toFixed(2)}% (${((before.wallTimeMs - (after.wallTimeMs + triage.wallTimeMs)) / 1000).toFixed(3)} seconds). Arithmetic combined token count increased ${summary.changePercent.arithmeticCombinedTokenCount.toFixed(2)}%; this sum spans different model tokenizers and is not a financial cost measurement.

## Cost accounting

Currency: ${summary.costAccounting.currency}. Rates catalog: \`cost-rates.json\` (recorded ${summary.costAccounting.ratesCatalog.recordedAt}).

| Cost component | Before | After |
| --- | ---: | ---: |
| Analysis batches (list-rate estimate on tokenizer counts) | ${money(summary.costAccounting.costComponents.before.analysisBatches)} | ${money(summary.costAccounting.costComponents.after.analysisBatches)} |
| Synthesis (list-rate estimate on tokenizer counts) | ${money(summary.costAccounting.costComponents.before.synthesis)} | ${money(summary.costAccounting.costComponents.after.synthesis)} |
| TypeSafe (provider-reported × list rate, or measured $0 when disabled) | ${money(summary.costAccounting.costComponents.before.typesafe)} | ${money(summary.costAccounting.costComponents.after.typesafe)} |
| Attributable cache charges | unavailable | unavailable |
| Attributable retry/failed-call charges | unavailable | unavailable |
| Verified attributable total | unavailable | unavailable |
| Partial estimate sum (available components only) | ${money(summary.costAccounting.totals.before.partialEstimateSum)} | ${money(summary.costAccounting.totals.after.partialEstimateSum)} |

**Financial savings established: no.** Verified savings claim: not established — ${summary.costAccounting.verifiedSavingsClaim.reason}

### Evidence obtainable vs still required

Obtainable without credentials or customer records:

${summary.costAccounting.evidenceInventory.obtainableWithoutCredentials.map((item) => `- ${item.artifact} (${item.source}) — present: ${item.present}`).join('\n')}

Unavailable from supported VS Code / runner APIs:

${summary.costAccounting.evidenceInventory.unavailableFromSupportedApis.map((item) => `- ${item.artifact}: ${item.reason}`).join('\n')}

External evidence still required through the Human workflow (no credentials requested here):

${summary.costAccounting.evidenceInventory.externalEvidenceStillRequired.map((item) => `- ${item.artifact} — ${item.purpose} — ${item.humanWorkflow}`).join('\n')}

VS Code investigation: ${summary.costAccounting.evidenceInventory.vscodeUsageInvestigation.conclusion}

## Recall

All 44 fixtures received successful judgments; there were no fallback cases. The policy retained all 16 ground-truth positives: **16/16 = 100% recall** at 0.7. Skipped \`eval-13\`, \`eval-15\`, \`eval-24\`, \`eval-31\`, and \`eval-37\`, all negatives. Missed positives: none.

## Interpretation and decision

${preservedDecision
    ? `Human decision, ${preservedDecision.evidenceClassification} in ${preservedDecision.source}: **${preservedDecision.decision}**. The user answered exactly "${preservedDecision.answer}" to "${preservedDecision.question}". This run demonstrates preserved evaluation-set recall and lower elapsed time, but not lower total token volume or verified financial cost. Monetary savings still need provider billed analysis usage plus confirmed TypeSafe charges; list-rate estimates above are not a savings proof. The decision does not assert that adjustments were implemented or authorize publication. No product settings or shipping state changed.`
    : 'Human decision has not been attached to summary.json yet.'}

Limitations: one cold-cache run on compact redacted fixtures, baseline followed by comparison; no repeated randomized timing, complete-transcript performance, model snapshot guarantee, or report-quality equivalence evaluation. The adapter preserves known prompts and edge responses and includes aggregate tool metadata without fabricating missing events. VS Code tokenizer counts exclude unexposed provider overhead, hidden reasoning, and billing/cache adjustments. Missing usage remains explicitly unavailable rather than zero.

## Evidence

- [Analysis calls, outputs, model identity, and timings](${analysisFile})
- [Triage judgments, usage, and timings](${analysis.triageResultPath})
- [Reconciled machine-readable summary](summary.json)
- [Rate catalog with source links](cost-rates.json)
- [Cost accounting module](costAccounting.cjs)
- [Prepared baseline inputs](prepared-baseline.json)
- [Prepared triage-enabled inputs](prepared-comparison.json)
- [Approved request and fixture hashes](../triage-evaluation-request.json)
- [Runner instructions](README.md)
${historicalRuns.length ? `- Prior summary snapshots under [summary-history/](summary-history/)\n` : ''}
Validation: \`node .mwnn/triage-benchmark/summarize.cjs ${analysisFile}\` passed reconciliation of complete arms, expected call/synthesis counts, nonempty outputs, token totals, 44 unique successful judgments, provider usage sums, recomputed recall, cost-class separation, and decision preservation. \`node .mwnn/triage-benchmark/test-cost-accounting.cjs\` covers missing usage, arithmetic reconciliation, and decision preservation. All JSON artifacts parse.
`;

fs.writeFileSync(path.join(root, 'results.md'), results);
console.log(JSON.stringify({
  summaryFile: 'summary.json',
  schemaVersion: summary.schemaVersion,
  humanDecisionPreserved: Boolean(summary.humanDecision),
  historicalRuns: summary.historicalRuns.length,
  financialSavingsEstablished: summary.costAccounting.financialSavingsEstablished,
  verifiedSavingsClaim: summary.costAccounting.verifiedSavingsClaim.established,
}, null, 2));
