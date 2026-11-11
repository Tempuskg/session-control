'use strict';
/**
 * Focused checks for auditable cost accounting:
 * missing usage stays unavailable, arithmetic reconciles, decisions survive recompute.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  buildCostAccounting,
  reconcileTokenArithmetic,
  costFromTokens,
  findRate,
  UNAVAILABLE,
} = require('./costAccounting.cjs');

const root = __dirname;
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

const analysis = read(path.join(root, 'analysis-1793062329161.json'));
const triage = read(path.join(root, analysis.triageResultPath));
const ratesDoc = read(path.join(root, 'cost-rates.json'));

function section(name) {
  console.log(`ok - ${name}`);
}

// --- missing usage stays unavailable (never coerced to zero) ---
const accounting = buildCostAccounting({ analysis, triage, ratesDoc });
assert.equal(accounting.usageClasses.before.providerReportedUsage.status, 'unavailable');
assert.equal(accounting.usageClasses.before.providerReportedUsage.value, null);
assert.notEqual(accounting.usageClasses.before.providerReportedUsage.value, 0);
assert.equal(accounting.usageClasses.before.actualBilledAmount.status, 'unavailable');
assert.equal(accounting.usageClasses.after.actualBilledAmount.status, 'unavailable');
assert.equal(accounting.usageClasses.typesafe.actualBilledAmount.status, 'unavailable');
assert.equal(accounting.costComponents.after.cache.status, 'unavailable');
assert.equal(accounting.costComponents.after.retriesOrFailedCalls.status, 'unavailable');
assert.equal(accounting.totals.after.total.status, 'unavailable');
assert.equal(accounting.verifiedSavingsClaim.established, false);
assert.equal(accounting.financialSavingsEstablished, false);
assert.ok(Array.isArray(accounting.evidenceInventory.externalEvidenceStillRequired));
assert.ok(accounting.evidenceInventory.externalEvidenceStillRequired.length >= 1);
section('missing usage remains unavailable rather than zero');

const incompleteTriage = {
  ...triage,
  usage: undefined,
  records: triage.records.map(({ usage, ...rest }) => rest),
};
const missingUsageAccounting = buildCostAccounting({ analysis, triage: incompleteTriage, ratesDoc });
assert.equal(missingUsageAccounting.usageClasses.typesafe.providerReportedUsage.status, 'unavailable');
assert.equal(missingUsageAccounting.costComponents.after.typesafe.status, 'unavailable');
assert.equal(missingUsageAccounting.verifiedSavingsClaim.established, false);
section('absent TypeSafe usage blocks priced TypeSafe component');

// --- arithmetic reconciliation ---
const arithmetic = reconcileTokenArithmetic(analysis, triage);
assert.equal(arithmetic.beforeCallSumMatchesArm, true);
assert.equal(arithmetic.afterCallSumMatchesArm, true);
assert.equal(arithmetic.triageUsageSumMatchesRecords, true);
assert.equal(arithmetic.beforeVisibleTokens, 120427);
assert.equal(arithmetic.afterVisibleTokens, 94085);
assert.equal(arithmetic.triageProviderTokens, 80565);
assert.equal(arithmetic.arithmeticCombinedAfter, 174650);

const typesafeRate = findRate(ratesDoc.rates, {
  provider: 'typesafe',
  modelId: 'jev-1.14.0',
  component: 'input',
  asOf: '2026-10-27',
});
assert.ok(typesafeRate);
const expectedTypeSafe = costFromTokens(triage.usage.input_tokens, typesafeRate.amount);
assert.ok(Math.abs(accounting.costComponents.after.typesafe.value - expectedTypeSafe) < 1e-12);
assert.equal(accounting.costComponents.after.typesafe.status, 'estimate');
assert.ok(accounting.costComponents.after.typesafe.ratesUsed.includes(typesafeRate.id));

const openrouterIn = findRate(ratesDoc.rates, {
  provider: 'openrouter',
  modelId: 'openai/gpt-6.1-sol',
  component: 'input',
  asOf: '2026-10-27',
});
const openrouterOut = findRate(ratesDoc.rates, {
  provider: 'openrouter',
  modelId: 'openai/gpt-6.1-sol',
  component: 'output',
  asOf: '2026-10-27',
});
const beforeAnalysis = accounting.costComponents.before.analysisBatches.value;
const expectedBeforeAnalysis = costFromTokens(91351, openrouterIn.amount) + costFromTokens(8623, openrouterOut.amount);
assert.ok(Math.abs(beforeAnalysis - expectedBeforeAnalysis) < 1e-12);
section('arithmetic reconciliation of tokens and rate formulas');

assert.equal(UNAVAILABLE('x').value, null);
assert.equal(UNAVAILABLE('x').status, 'unavailable');

// --- decision preservation across summarize recompute ---
const summaryPath = path.join(root, 'summary.json');
const beforeSummary = read(summaryPath);
assert.ok(beforeSummary.humanDecision, 'fixture summary must already contain the adjust decision');
const decisionSnapshot = JSON.stringify(beforeSummary.humanDecision);

const first = spawnSync(process.execPath, [path.join(root, 'summarize.cjs'), 'analysis-1793062329161.json'], {
  cwd: path.join(root, '../..'),
  encoding: 'utf8',
});
assert.equal(first.status, 0, first.stderr || first.stdout);
const midSummary = read(summaryPath);
assert.equal(JSON.stringify(midSummary.humanDecision), decisionSnapshot);
assert.equal(midSummary.costAccounting.financialSavingsEstablished, false);
assert.equal(midSummary.schemaVersion, 2);

const second = spawnSync(process.execPath, [path.join(root, 'summarize.cjs'), 'analysis-1793062329161.json'], {
  cwd: path.join(root, '../..'),
  encoding: 'utf8',
});
assert.equal(second.status, 0, second.stderr || second.stdout);
const afterSummary = read(summaryPath);
assert.equal(JSON.stringify(afterSummary.humanDecision), decisionSnapshot);
assert.ok(Array.isArray(afterSummary.historicalRuns));
assert.ok(afterSummary.historicalRuns.length >= 1);
assert.ok(fs.existsSync(path.join(root, 'summary-history')));
const historyFiles = fs.readdirSync(path.join(root, 'summary-history')).filter((name) => name.endsWith('.json'));
assert.ok(historyFiles.length >= 1);
section('recompute preserves human decision and archives historical runs');

console.log(JSON.stringify({
  passed: 3,
  financialSavingsEstablished: afterSummary.costAccounting.financialSavingsEstablished,
  decision: afterSummary.humanDecision.decision,
}, null, 2));
