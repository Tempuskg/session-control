'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const analysisFile = process.argv[2];
if (!analysisFile || path.basename(analysisFile) !== analysisFile || !/^analysis-\d+\.json$/.test(analysisFile)) throw new Error('Pass one local analysis-<timestamp>.json filename.');
const analysis = read(path.join(__dirname, analysisFile));
const triage = read(path.join(__dirname, analysis.triageResultPath));
const labels = read(path.join(__dirname, '../../test/fixtures/typesafe/labels.json'));
assert.equal(analysis.state, 'complete'); assert.equal(triage.state, 'complete');
assert.equal(analysis.arms.length, 2); assert.equal(triage.records.length, 44);
assert.equal(new Set(triage.records.map(r => r.id)).size, 44);
assert.equal(triage.fallbackIds.length, 0);
assert.deepEqual(analysis.config, triage.config);
for (const arm of analysis.arms) {
  assert.equal(arm.state, 'complete');
  assert.equal(arm.inputTokens, arm.calls.reduce((s, c) => s + c.inputTokens, 0));
  assert.equal(arm.outputTokens, arm.calls.reduce((s, c) => s + c.outputTokens, 0));
  assert.ok(arm.calls.every(c => c.text.trim() && c.wallTimeMs > 0));
}
const before = analysis.arms.find(a => a.name === 'baseline');
const after = analysis.arms.find(a => a.name === 'triageEnabled');
assert.equal(before.calls.length, 6); assert.equal(after.calls.length, 5);
assert.equal(before.calls.at(-1).kind, 'synthesis'); assert.equal(after.calls.at(-1).kind, 'synthesis');
const positiveIds = labels.sessions.filter(l => l.worthAnalyzing).map(l => l.id);
const retainedPositiveIds = positiveIds.filter(id => triage.retainedIds.includes(id));
assert.equal(triage.recall, retainedPositiveIds.length / positiveIds.length);
for (const field of ['input_tokens', 'output_tokens']) assert.equal(triage.usage[field], triage.records.reduce((s, r) => s + r.usage[field], 0));
const total = arm => arm.inputTokens + arm.outputTokens;
const triageTokens = triage.usage.input_tokens + triage.usage.output_tokens;
const change = (b, a) => (a - b) / b * 100;
const summary = { schemaVersion: 1, evidence: { analysisFile, triageFile: analysis.triageResultPath },
  analysisModel: analysis.model, triageModels: [...new Set(triage.records.map(r => r.model))],
  threshold: triage.config.threshold, recall: triage.recall, retainedPositiveIds, missedPositiveIds: triage.missedPositiveIds,
  retainedSessions: triage.retainedIds.length, skippedSessions: triage.skippedIds.length,
  before: { inputTokens: before.inputTokens, outputTokens: before.outputTokens, totalVisibleTokens: total(before), wallTimeMs: before.wallTimeMs },
  after: { inputTokens: after.inputTokens, outputTokens: after.outputTokens, totalVisibleTokens: total(after), analysisWallTimeMs: after.wallTimeMs,
    triageProviderInputTokens: triage.usage.input_tokens, triageProviderOutputTokens: triage.usage.output_tokens,
    triageWallTimeMs: triage.wallTimeMs, endToEndWallTimeMs: after.wallTimeMs + triage.wallTimeMs,
    arithmeticCombinedTokenCount: total(after) + triageTokens },
  changePercent: { analysisVisibleTokens: change(total(before), total(after)),
    endToEndWallTime: change(before.wallTimeMs, after.wallTimeMs + triage.wallTimeMs),
    arithmeticCombinedTokenCount: change(total(before), total(after) + triageTokens) },
  limitations: [analysis.tokenMeasurement,
    'Combined count adds unlike model tokenizers and does not establish financial cost. No verified price or provider billed analysis usage.',
    triage.config.adapter,
    'Single sequential baseline-then-comparison run; no repeated randomized timing or report-quality equivalence evaluation.'],
  humanDecision: null };
fs.writeFileSync(path.join(__dirname, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
