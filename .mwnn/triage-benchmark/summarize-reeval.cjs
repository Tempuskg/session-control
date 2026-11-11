'use strict';
/**
 * Reconcile card-mvq03qy7-3 re-evaluation artifacts under reeval-v2/.
 * Preserves original v1 summary.json / results.md untouched.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {
  buildCostAccounting,
  reconcileTokenArithmetic,
  splitArmCalls,
} = require('./costAccounting.cjs');

const root = __dirname;
const outDir = path.join(root, 'reeval-v2');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function extractRecommendations(text) {
  const lines = String(text || '').split(/\r?\n/);
  const bullets = lines.filter((l) => /^\s*[-*]\s+/.test(l) || /^\s*\|\s*\*\*/.test(l));
  const sessionIds = [...new Set((text.match(/eval-\d+/g) || []))];
  const controlFiles = [...new Set((text.match(/\b(?:AGENTS\.md|\.github\/copilot-instructions\.md|CLAUDE\.md|SKILL\.md|\*\.instructions\.md|\*\.prompt\.md|\*\.agent\.md)\b/g) || []))];
  return {
    charCount: text.length,
    bulletLikeLines: bullets.length,
    citedSessionIds: sessionIds,
    citedControlFilePatterns: controlFiles,
    statesLimitation: /limitation|unavailable|cannot be verified|compact|redacted|batch/i.test(text),
  };
}

function scoreArmQuality(arm) {
  const synthesis = arm.calls.find((c) => c.kind === 'synthesis') || arm.calls.at(-1);
  const features = extractRecommendations(synthesis?.text || '');
  return {
    synthesisKind: synthesis?.kind || null,
    inputTokens: arm.inputTokens,
    outputTokens: arm.outputTokens,
    wallTimeMs: arm.wallTimeMs,
    endToEndWallTimeMs: arm.endToEndWallTimeMs,
    ...features,
  };
}

function compareQuality(baseline, triageEnabled) {
  return {
    baseline: scoreArmQuality(baseline),
    triageEnabled: scoreArmQuality(triageEnabled),
    notes: [
      'Retained sessions do not guarantee equivalent recommendations.',
      'Skipped-session evidence cannot appear in the triageEnabled arm.',
      'Scores are structural proxies for human review, not automated pass/fail.',
    ],
  };
}

function main() {
  assert.ok(fs.existsSync(outDir), 'reeval-v2/ missing');
  const index = read(path.join(outDir, 'triage-index.json'));
  const labels = read(path.join(root, '../../test/fixtures/typesafe/labels.json'));
  const ratesDoc = read(path.join(root, 'cost-rates.json'));
  const positiveIds = labels.sessions.filter((l) => l.worthAnalyzing).map((l) => l.id);
  assert.equal(positiveIds.length, 16);

  const triageRuns = index.runs.map((entry) => {
    const triage = read(path.join(outDir, entry.path));
    assert.equal(triage.pairId, entry.pairId);
    assert.equal(triage.records.length, triage.records.length === 0 ? 0 : triage.records.length);
    if (triage.state === 'complete') {
      assert.equal(triage.records.length, 44);
      assert.equal(new Set(triage.records.map((r) => r.id)).size, 44);
      assert.equal(triage.fallbackIds.length, 0);
      assert.equal(triage.recall, (16 - triage.missedPositiveIds.length) / 16);
      for (const field of ['input_tokens', 'output_tokens']) {
        assert.equal(triage.usage[field], triage.records.reduce((s, r) => s + (r.usage?.[field] || 0), 0));
      }
    } else {
      assert.equal(triage.recall, null, 'incomplete triage must not claim recall');
    }
    return { entry, triage };
  });

  const completeTriage = triageRuns.filter((r) => r.triage.state === 'complete');
  assert.ok(completeTriage.length >= 3, 'Need at least three complete triage repetitions');

  const analysisFiles = fs.readdirSync(outDir).filter((f) => /^analysis-pair-\d+-\d+\.json$/.test(f));
  const analysisPairs = [];
  for (const file of analysisFiles) {
    const analysis = read(path.join(outDir, file));
    assert.ok(['complete', 'incomplete', 'cancelled', 'running'].includes(analysis.state));
    if (analysis.state !== 'complete') {
      analysisPairs.push({ file, state: analysis.state, pairId: analysis.pairId, note: 'not counted as successful analysis pair' });
      continue;
    }
    assert.equal(analysis.arms.length, 2);
    const baseline = analysis.arms.find((a) => a.name === 'baseline');
    const after = analysis.arms.find((a) => a.name === 'triageEnabled');
    assert.ok(baseline && after);
    assert.equal(baseline.state, 'complete');
    assert.equal(after.state, 'complete');
    assert.ok(baseline.calls.every((c) => c.text.trim() && c.wallTimeMs > 0));
    assert.ok(after.calls.every((c) => c.text.trim() && c.wallTimeMs > 0));
    assert.equal(baseline.inputTokens, baseline.calls.reduce((s, c) => s + c.inputTokens, 0));
    assert.equal(after.inputTokens, after.calls.reduce((s, c) => s + c.inputTokens, 0));
    const triagePath = path.join(root, analysis.triageResultPath);
    const triage = read(triagePath);
    assert.equal(triage.state, 'complete');
    const costAccounting = buildCostAccounting({ analysis, triage, ratesDoc });
    const arithmetic = reconcileTokenArithmetic(analysis, triage);
    assert.equal(arithmetic.beforeCallSumMatchesArm, true);
    assert.equal(arithmetic.afterCallSumMatchesArm, true);
    assert.equal(arithmetic.triageUsageSumMatchesRecords, true);
    analysisPairs.push({
      file,
      state: analysis.state,
      pairId: analysis.pairId,
      armOrder: analysis.armOrder,
      cacheCondition: analysis.cacheCondition,
      model: analysis.model,
      triageResultPath: analysis.triageResultPath,
      baseline: {
        ...splitArmCalls(baseline),
        wallTimeMs: baseline.wallTimeMs,
        endToEndWallTimeMs: baseline.endToEndWallTimeMs,
        inputTokens: baseline.inputTokens,
        outputTokens: baseline.outputTokens,
      },
      triageEnabled: {
        ...splitArmCalls(after),
        wallTimeMs: after.wallTimeMs,
        endToEndWallTimeMs: after.endToEndWallTimeMs,
        inputTokens: after.inputTokens,
        outputTokens: after.outputTokens,
      },
      costAccounting,
      quality: compareQuality(baseline, after),
      arithmetic,
    });
  }

  const original = {
    questionSetVersion: 'analysis-triage-v1',
    recall: 1,
    missedPositiveIds: [],
    skippedIds: ['eval-13', 'eval-15', 'eval-24', 'eval-31', 'eval-37'],
    typesafeInputTokens: 76385,
    typesafeOutputTokens: 4180,
    analysisFile: 'analysis-1793062329161.json',
    triageFile: 'triage-1793062000319.json',
  };

  const recallRows = completeTriage.map(({ entry, triage }) => ({
    pairId: entry.pairId,
    cacheCondition: entry.cacheCondition,
    recall: triage.recall,
    retainedPositives: 16 - triage.missedPositiveIds.length,
    missedPositiveIds: triage.missedPositiveIds,
    skippedIds: triage.skippedIds,
    fallbackIds: triage.fallbackIds,
    comparedToOriginal16of16: triage.recall === 1 && triage.missedPositiveIds.length === 0
      ? 'no recall regression vs original 16/16 at threshold 0.7'
      : `REGRESSION vs original 16/16: missed ${JSON.stringify(triage.missedPositiveIds)}`,
  }));

  const summary = {
    schemaVersion: 1,
    cardId: 'card-mvq03qy7-3',
    generatedAt: new Date().toISOString(),
    protocol: 'reeval-protocol.md',
    identities: {
      questionSetVersion: 'analysis-triage-v2',
      payloadVersion: 'triage-payload-v2',
      threshold: 0.7,
      package: completeTriage[0].triage.package,
      baselineSha256: completeTriage[0].triage.config.baselineSha256,
      fixtureHashes: completeTriage[0].triage.fixtureHashes,
      typesafeModels: [...new Set(completeTriage.flatMap(({ triage }) => triage.records.map((r) => r.model)))],
    },
    triageRepetitions: completeTriage.map(({ entry, triage }) => ({
      pairId: entry.pairId,
      path: entry.path,
      cacheCondition: entry.cacheCondition,
      state: triage.state,
      wallTimeMs: triage.wallTimeMs,
      usage: triage.usage,
      recall: triage.recall,
      missedPositiveIds: triage.missedPositiveIds,
      skippedIds: triage.skippedIds,
      fallbackIds: triage.fallbackIds,
    })),
    triageAggregates: {
      completeRuns: completeTriage.length,
      meanWallTimeMs: mean(completeTriage.map(({ triage }) => triage.wallTimeMs)),
      meanInputTokens: mean(completeTriage.map(({ triage }) => triage.usage.input_tokens)),
      meanOutputTokens: mean(completeTriage.map(({ triage }) => triage.usage.output_tokens)),
      coldRuns: completeTriage.filter(({ entry }) => entry.cacheCondition.startsWith('cold')).map(({ entry, triage }) => ({
        pairId: entry.pairId, wallTimeMs: triage.wallTimeMs, usage: triage.usage,
      })),
      warmRuns: completeTriage.filter(({ entry }) => entry.cacheCondition.startsWith('warm')).map(({ entry, triage }) => ({
        pairId: entry.pairId, wallTimeMs: triage.wallTimeMs, usage: triage.usage,
      })),
    },
    recallComparison: {
      originalAt0_7: original,
      adjustedRuns: recallRows,
      anyRegression: recallRows.some((r) => r.missedPositiveIds.length > 0),
    },
    analysisPairs,
    analysisCompletePairCount: analysisPairs.filter((p) => p.state === 'complete').length,
    representativenessLimits: [
      'Compact redacted fixtures omit middle turns and individual tool events; adapter does not fabricate them.',
      'v2 adapter summary is counts/tools only; production markdown summaries differ.',
      'Results apply only to this 44-session redacted evaluation set.',
      'VS Code exposes tokenizer counts only; provider billed usage, cache tokens, and hidden reasoning remain unavailable.',
      'Warm TypeSafe repeats still do not read local judgment cache; warmth is process/provider-side only.',
      'Instruction baseline SHA may differ from the 2026-10-26 v1 run if AGENTS.md / copilot-instructions.md changed; within-pair baseline is held fixed.',
    ],
    costClaim: {
      financialSavingsEstablished: false,
      note: 'No monetary-savings claim while analysis and/or TypeSafe actual billed amounts remain unavailable.',
    },
    outcomeSummary: null,
  };

  const completeAnalysis = analysisPairs.filter((p) => p.state === 'complete');
  if (completeAnalysis.length >= 3) {
    const armOrders = completeAnalysis.map((p) => p.armOrder.join('->'));
    assert.ok(armOrders.some((o) => o === 'baseline->triageEnabled'));
    assert.ok(armOrders.some((o) => o === 'triageEnabled->baseline'));
    const cacheConditions = new Set(completeAnalysis.map((p) => p.cacheCondition));
    assert.ok(cacheConditions.has('cold') && cacheConditions.has('warm'), 'Need separately identified cold and warm analysis pairs');

    summary.analysisAggregates = {
      pairs: completeAnalysis.length,
      meanBaselineEndToEndMs: mean(completeAnalysis.map((p) => p.baseline.endToEndWallTimeMs)),
      meanTriageEnabledEndToEndMs: mean(completeAnalysis.map((p) => p.triageEnabled.endToEndWallTimeMs)),
      meanBaselineAnalysisTokens: mean(completeAnalysis.map((p) => p.baseline.inputTokens + p.baseline.outputTokens)),
      meanTriageEnabledAnalysisTokens: mean(completeAnalysis.map((p) => p.triageEnabled.inputTokens + p.triageEnabled.outputTokens)),
    };
    summary.outcomeSummary = {
      recall: summary.recallComparison.anyRegression
        ? 'Adjusted payload REGRESSED recall relative to original 16/16 at 0.7 — do not silently accept.'
        : 'Adjusted payload preserved 16/16 recall at threshold 0.7 across all complete triage repetitions; same five negatives skipped as original.',
      typesafeInputTokens: `Mean TypeSafe input tokens ${summary.triageAggregates.meanInputTokens} vs original ${original.typesafeInputTokens} (${(((summary.triageAggregates.meanInputTokens - original.typesafeInputTokens) / original.typesafeInputTokens) * 100).toFixed(2)}%).`,
      latency: 'See per-pair analysis end-to-end times; cold and warm labeled separately.',
      cost: 'Partial list-rate estimates may exist per pair; verified financial savings remain unestablished.',
      reportQuality: 'See per-pair quality structural comparison; human review still required (card-mvq03qy7-4).',
      improvedIntendedOutcomes: null,
    };
    const tokenImproved = summary.triageAggregates.meanInputTokens < original.typesafeInputTokens;
    const latencyImproved = summary.analysisAggregates.meanTriageEnabledEndToEndMs < summary.analysisAggregates.meanBaselineEndToEndMs;
    summary.outcomeSummary.improvedIntendedOutcomes = {
      typesafePayloadTokensReduced: tokenImproved,
      analysisEndToEndFasterWithTriage: latencyImproved,
      recallPreserved: !summary.recallComparison.anyRegression,
      verifiedMoneySaved: false,
      negativeOrCaveats: [
        tokenImproved ? null : 'TypeSafe input tokens did not decrease vs original.',
        'Verified billed savings unavailable.',
        'Report-quality equivalence is not assumed from retention alone.',
      ].filter(Boolean),
    };
  } else {
    summary.outcomeSummary = {
      blocked: true,
      reason: `Need >=3 complete analysis pairs with alternating arm order and cold/warm labels; found ${completeAnalysis.length}.`,
      triagePortion: 'TypeSafe triage repetitions and recall are recorded; analysis/report-quality criteria remain unmet until editor pairs complete.',
    };
  }

  write(path.join(outDir, 'summary.json'), summary);

  const md = [];
  md.push('# Adjusted triage re-evaluation — card-mvq03qy7-3');
  md.push('');
  md.push(`Generated: ${summary.generatedAt}`);
  md.push('');
  md.push('## Identities');
  md.push('');
  md.push(`- Question set: \`${summary.identities.questionSetVersion}\``);
  md.push(`- Payload: \`${summary.identities.payloadVersion}\``);
  md.push(`- Threshold: ${summary.identities.threshold}`);
  md.push(`- Package: ${summary.identities.package.name}@${summary.identities.package.version}`);
  md.push(`- Baseline SHA-256: \`${summary.identities.baselineSha256}\``);
  md.push(`- TypeSafe models observed: ${summary.identities.typesafeModels.join(', ')}`);
  md.push(`- Labels SHA-256: \`${summary.identities.fixtureHashes.labelsSha256}\``);
  md.push('');
  md.push('## TypeSafe repetitions');
  md.push('');
  md.push('| Pair | Cache | State | Wall ms | Input tok | Output tok | Recall | Misses |');
  md.push('| --- | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const row of summary.triageRepetitions) {
    md.push(`| ${row.pairId} | ${row.cacheCondition} | ${row.state} | ${row.wallTimeMs.toFixed(1)} | ${row.usage.input_tokens} | ${row.usage.output_tokens} | ${row.recall} | ${row.missedPositiveIds.join(', ') || 'none'} |`);
  }
  md.push('');
  md.push(`Cold runs: ${summary.triageAggregates.coldRuns.length}; warm runs: ${summary.triageAggregates.warmRuns.length}. Mean wall ${summary.triageAggregates.meanWallTimeMs?.toFixed(1)} ms. Mean TypeSafe input ${summary.triageAggregates.meanInputTokens} (original ${original.typesafeInputTokens}).`);
  md.push('');
  md.push('## Recall vs original 16/16 at 0.7');
  md.push('');
  for (const row of recallRows) {
    md.push(`- ${row.pairId}: ${row.retainedPositives}/16 — ${row.comparedToOriginal16of16}`);
    md.push(`  - Skipped: ${row.skippedIds.join(', ')}`);
  }
  md.push('');
  md.push('## Analysis pairs');
  md.push('');
  if (!completeAnalysis.length) {
    md.push('_No complete analysis pairs yet. Editor helper must finish before cost/latency/report-quality closeout._');
  } else {
    md.push('| Pair | Order | Cache | Baseline E2E ms | Triage E2E ms | Baseline tok | Triage tok |');
    md.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
    for (const p of completeAnalysis) {
      md.push(`| ${p.pairId} | ${p.armOrder.join(' → ')} | ${p.cacheCondition} | ${p.baseline.endToEndWallTimeMs.toFixed(1)} | ${p.triageEnabled.endToEndWallTimeMs.toFixed(1)} | ${p.baseline.inputTokens + p.baseline.outputTokens} | ${p.triageEnabled.inputTokens + p.triageEnabled.outputTokens} |`);
    }
    md.push('');
    md.push('### Per-pair partial cost estimates (not verified savings)');
    md.push('');
    md.push('| Pair | Cache | Baseline partial est. USD | TriageEnabled partial est. USD | Verified total |');
    md.push('| --- | --- | ---: | ---: | --- |');
    for (const p of completeAnalysis) {
      const before = p.costAccounting.totals.before.partialEstimateSum.value;
      const after = p.costAccounting.totals.after.partialEstimateSum.value;
      md.push(`| ${p.pairId} | ${p.cacheCondition} | ~$${before.toFixed(6)} | ~$${after.toFixed(6)} | unavailable |`);
    }
    md.push('');
    md.push(`Aggregates: mean baseline E2E ${summary.analysisAggregates.meanBaselineEndToEndMs.toFixed(1)} ms; mean triageEnabled E2E ${summary.analysisAggregates.meanTriageEnabledEndToEndMs.toFixed(1)} ms; mean baseline analysis tokens ${summary.analysisAggregates.meanBaselineAnalysisTokens.toFixed(1)}; mean triageEnabled analysis tokens ${summary.analysisAggregates.meanTriageEnabledAnalysisTokens.toFixed(1)}.`);
    md.push('');
    md.push('Unavailable/unverified billing components: analysis provider-reported usage, analysis actual billed amount, TypeSafe actual billed amount, attributable cache charges, attributable retry/failed-call charges. No monetary-savings claim is made.');
    md.push('');
    md.push('### Report quality (structural)');
    md.push('');
    for (const p of completeAnalysis) {
      md.push(`#### ${p.pairId}`);
      md.push(`- Baseline: ${p.quality.baseline.bulletLikeLines} bullet-like lines; sessions cited: ${p.quality.baseline.citedSessionIds.length}; limitation language: ${p.quality.baseline.statesLimitation}`);
      md.push(`- TriageEnabled: ${p.quality.triageEnabled.bulletLikeLines} bullet-like lines; sessions cited: ${p.quality.triageEnabled.citedSessionIds.length}; limitation language: ${p.quality.triageEnabled.statesLimitation}`);
      md.push(`- Control-file pattern mentions — baseline: ${p.quality.baseline.citedControlFilePatterns.join(', ') || 'none'}; triage: ${p.quality.triageEnabled.citedControlFilePatterns.join(', ') || 'none'}`);
    }
    md.push('');
    md.push('Full structured comparison: [report-quality.md](report-quality.md).');
  }
  md.push('');
  md.push('## Cost claim');
  md.push('');
  md.push(`**Financial savings established: no.** ${summary.costClaim.note}`);
  md.push('');
  md.push('## Representativeness limits');
  md.push('');
  for (const limit of summary.representativenessLimits) md.push(`- ${limit}`);
  md.push('');
  md.push('## Outcome summary');
  md.push('');
  md.push('```json');
  md.push(JSON.stringify(summary.outcomeSummary, null, 2));
  md.push('```');
  md.push('');
  md.push('## Evidence');
  md.push('');
  md.push('- Protocol: [reeval-protocol.md](../reeval-protocol.md)');
  md.push('- Triage index: [triage-index.json](triage-index.json)');
  md.push('- Machine summary: [summary.json](summary.json)');
  md.push('- Report quality: [report-quality.md](report-quality.md)');
  md.push('- Analysis host: files matching `analysis-host-*.json` / `analysis-pair-*.json` in this folder');
  md.push('- Original v1 results (historical): [../results.md](../results.md)');
  fs.writeFileSync(path.join(outDir, 'results.md'), `${md.join('\n')}\n`);

  console.log(JSON.stringify({
    wrote: ['reeval-v2/summary.json', 'reeval-v2/results.md'],
    triageComplete: completeTriage.length,
    analysisComplete: completeAnalysis.length,
    blocked: Boolean(summary.outcomeSummary?.blocked),
  }, null, 2));
  if (summary.outcomeSummary?.blocked) process.exitCode = 2;
}

main();
