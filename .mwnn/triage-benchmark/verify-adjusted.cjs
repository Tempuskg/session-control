'use strict';
// Offline verification only. Original measurements and human decisions are read-only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const text = p => fs.readFileSync(p, 'utf8');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const b = p => path.join(__dirname, p);
const cardIds = [1, 2, 3].map(n => `card-mvq03qy7-${n}`);
function removeScratch(temp) {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.match(path.basename(temp), /^mwnn-(accounting|payload)-/);
  fs.rmSync(temp, { recursive: true, force: true });
}
function card(id) {
  const s = text(path.join(root, '.mwnn/cards', `${id}.md`));
  return { id, title: /^title: (.*)$/m.exec(s)[1],
    description: s.split('## Description')[1].split('## Acceptance criteria')[0].trim(),
    acceptanceCriteria: s.split('## Acceptance criteria')[1].split('## Activity')[0].trim(),
    dependsOn: /dependsOn: \[([^\]]+)\]/.exec(s)?.[1].split(',').map(x => x.trim()) ?? [] };
}
// Evaluate the installed webpack module without activating VS Code or modifying it.
// Fail closed if its entry structure changes; never substitute a homemade parser.
function installedVerifier() {
  const folder = process.env.MWNN_VERIFIER_DIR || 'C:/Users/darre/.vscode/extensions/darrenjmcleod.mwnn-kanban-1.0.15';
  const file = path.join(folder, 'dist/extension.js');
  let source = text(file);
  const needle = '}(4265);module.exports=n';
  assert.equal(source.split(needle).length, 2, 'Installed verifier bundle changed; inspect its contract again');
  source = source.replace(needle, '}(9125);module.exports=n');
  const box = { require: createRequire(file), module: { exports: {} }, process, Buffer,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(source, box, { filename: file });
  return { api: box.module.exports, file, sha256: sha(file), version: read(path.join(folder, 'package.json')).version };
}
function runScript(file, overrides = {}) {
  const outputs = {};
  const localRequire = createRequire(file);
  const fakeFs = { ...fs, writeFileSync(p, value) { outputs[path.resolve(p)] = String(value); } };
  const module = { exports: {} };
  const req = name => name === 'node:fs' ? fakeFs : overrides[name] ?? localRequire(name);
  req.main = module;
  vm.runInNewContext(text(file), { require: req, module, exports: module.exports,
    __dirname: path.dirname(file), __filename: file, console: { log() {} }, process: { ...process, exitCode: 0 }, Buffer }, { filename: file });
  return outputs;
}
const results = [];
async function criterion(group, index, fn) {
  const c = card(cardIds[group - 1]);
  const criterionText = c.acceptanceCriteria.split(/\r?\n/).filter(l => /^- \[[ x]\]/.test(l))[index - 1].slice(6);
  try { const evidence = await fn(); results.push({ cardId: c.id, criterion: index, text: criterionText, status: 'pass', evidence }); }
  catch (e) { results.push({ cardId: c.id, criterion: index, text: criterionText, status: 'fail', failure: e.stack }); }
}
async function main() {
  const selected = process.argv[2] || 'all';
  assert.ok(['all', 'accounting', 'payload', 'reeval'].includes(selected), 'Unknown verification group');
  const summary = read(b('reeval-v2/summary.json'));
  const rates = read(b('cost-rates.json'));
  const { buildCostAccounting } = require('./costAccounting.cjs');
  const index = read(b('reeval-v2/triage-index.json'));
  const triages = index.runs.map(r => read(b(`reeval-v2/${r.path}`)));
  const pairs = summary.analysisPairs.map(p => read(b(`reeval-v2/${p.file}`)));
  const verifier = installedVerifier();
  const profileText = text(path.join(root, '.mwnn/verification.json'));
  const profile = verifier.api.parseVerificationProfile(profileText);
  for (const id of [...cardIds, 'card-mwhqmgjl-1']) for (const t of verifier.api.criterionTexts(card(id))) {
    const mapping = profile.criteria.find(c => c.text === t);
    assert.ok(mapping && mapping.checks.length && !mapping.human, `Missing exact mapping: ${id}: ${t}`);
  }
  if (selected === 'all' || selected === 'accounting') {
    await criterion(1, 1, () => {
      const a = read(b('summary.json')).costAccounting;
      for (const arm of ['before', 'after']) {
        assert.equal(a.usageClasses[arm].providerReportedUsage.status, 'unavailable');
        assert.equal(a.usageClasses[arm].providerReportedUsage.value, null);
        assert.equal(a.usageClasses[arm].actualBilledAmount.value, null);
      }
      assert.equal(a.usageClasses.typesafe.providerReportedUsage.status, 'measured');
      assert.equal(a.usageClasses.typesafe.providerReportedUsage.classification, 'providerReported');
      assert.equal(a.usageClasses.before.tokenizerCounts.classification, 'tokenizerCount');
      assert.equal(a.usageClasses.typesafe.actualBilledAmount.value, null);
      return a.usageClasses;
    });
    await criterion(1, 2, () => {
      for (const p of pairs) {
        const t = read(b(p.triageResultPath));
        const a = buildCostAccounting({ analysis: p, triage: t, ratesDoc: rates });
        const before = p.arms.find(a => a.name === 'baseline');
        const after = p.arms.find(a => a.name === 'triageEnabled');
        const estimate = arm => arm.calls.reduce((s, c) => s + (c.inputTokens * 2 + c.outputTokens * 10) / 1e6, 0);
        assert.ok(Math.abs(a.totals.before.partialEstimateSum.value - estimate(before)) < 1e-10);
        assert.ok(Math.abs(a.totals.after.partialEstimateSum.value - estimate(after) - t.usage.input_tokens * 0.042 / 1e6) < 1e-10);
        for (const arm of ['before', 'after']) {
          assert.equal(a.totals[arm].total.value, null);
          assert.equal(a.costComponents[arm].cache.status, 'unavailable');
          assert.equal(a.costComponents[arm].retriesOrFailedCalls.status, 'unavailable');
        }
        assert.equal(a.financialSavingsEstablished, false);
        assert.equal(a.verifiedSavingsClaim.established, false);
      }
      assert.ok(rates.rates.every(r => r.effectiveFrom && r.authoritativeSource.startsWith('https://')));
      return 'All analysis batch/synthesis calls + TypeSafe reconcile with recorded USD list rates (2/10 and 0.042 per million); cache/retry and billed totals unavailable. Historical catalog arithmetic checked, current tariffs and invoices not verified.';
    });
    await criterion(1, 3, () => {
      // Execute the existing mutation-oriented regression suite in an isolated copy.
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwnn-accounting-'));
      try {
        const bench = path.join(temp, '.mwnn/triage-benchmark');
        const fixtureDir = path.join(temp, 'test/fixtures/typesafe');
        fs.mkdirSync(bench, { recursive: true }); fs.mkdirSync(fixtureDir, { recursive: true });
        fs.copyFileSync(path.join(root, 'test/fixtures/typesafe/labels.json'), path.join(fixtureDir, 'labels.json'));
        for (const f of ['test-cost-accounting.cjs', 'costAccounting.cjs', 'cost-rates.json', 'summarize.cjs', 'summary.json', 'analysis-1793062329161.json', 'triage-1793062000319.json']) fs.copyFileSync(b(f), path.join(bench, f));
        const run = spawnSync(process.execPath, [path.join(bench, 'test-cost-accounting.cjs')], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr + run.stdout);
        return run.stdout;
      } finally { removeScratch(temp); }
    });
    await criterion(1, 4, () => {
      const evidence = text(b('cost-evidence.md'));
      assert.ok(evidence.includes('External evidence still required (Human workflow)'));
      assert.ok(evidence.includes('Usage/Billing export') && evidence.includes('2026-10-27'));
      assert.equal(read(b('summary.json')).costAccounting.financialSavingsEstablished, false);
      return 'cost-evidence.md identifies precise model/time-window usage and billing exports; no credentials required. Adjusted run invoices also absent. Unknown billing is an accepted claim limitation, not a successful billing verification.';
    });
  }
  if (selected === 'all' || selected === 'payload') {
    await criterion(2, 1, async () => {
      // Build current source to scratch, then intercept measurement writes in memory.
      const webpack = require('webpack');
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwnn-payload-'));
      try {
        await new Promise((resolve, reject) => webpack({ context: root, target: 'node', mode: 'none', entry: b('library.cjs'),
          output: { path: temp, filename: 'library.cjs', library: { type: 'commonjs2' } },
          resolve: { extensions: ['.ts', '.js', '.cjs'], alias: { vscode: b('vscode-shim.cjs') } },
          module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] }
        }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString())) : resolve()));
        const outputs = runScript(b('measure-payload.cjs'), { './library.bundle.cjs': require(path.join(temp, 'library.cjs')) });
        const measured = JSON.parse(outputs[b('payload-measurements.json')]);
        const saved = read(b('payload-measurements.json'));
        assert.deepEqual(measured.rows, saved.rows);
        assert.deepEqual(measured.reductions, saved.reductions);
        return saved.reductions;
      } finally { removeScratch(temp); }
    });
    await criterion(2, 2, () => {
      const tests = text(path.join(root, 'test/unit/typesafeAnalysisTriage.test.ts'));
      assert.match(tests, /userPrompts/); assert.match(tests, /disabled/);
      assert.match(tests, /changed question-set or payload version misses the old cache entry/);
      assert.match(text(path.join(root, 'test/unit/typesafeJudgmentService.test.ts')), /cancel/i);
      return 'Mapped additionally to compile-tests, compile, repository-tests and lint commands. Existing production tests cover evidence signals, disabled/error/cancellation and judgment cache; their fresh results are recorded in validation logs.';
    });
    await criterion(2, 3, () => {
      for (const f of ['results.md', 'summary.json', 'triage-1793062000319.json', 'analysis-1793062329161.json', 'prepared-baseline.json', 'prepared-comparison.json']) assert.ok(fs.existsSync(b(f)));
      const src = text(path.join(root, 'src/typesafe/analysisTriage.ts'));
      assert.ok(src.includes("'analysis-triage-v2'") && src.includes("'triage-payload-v2'"));
      assert.equal(read(b('prepared-baseline-analysis-triage-v2.json')).config.threshold, 0.7);
      return 'Original v1 files retained; v2 prepared/config artifacts and current production question/cache/payload identities agree; threshold remains 0.7.';
    });
    await criterion(2, 4, () => {
      const doc = text(b('payload-overhead.md'));
      assert.ok(doc.includes('No claim that synthetic payload shrinkage preserves TypeSafe recall'));
      assert.ok(doc.includes('No claim of financial savings'));
      return 'Versioned preparation and separate live evidence exist; synthetic character reduction is not model recall or monetary savings.';
    });
  }
  if (selected === 'all' || selected === 'reeval') {
    await criterion(3, 1, () => {
      assert.equal(pairs.length, 3); assert.equal(triages.length, 3);
      const request = read(path.join(root, '.mwnn/triage-evaluation-request.json'));
      for (const f of request.fixtures) assert.equal(sha(path.resolve(root, f.path)), f.sha256);
      assert.equal(triages[0].fixtureHashes.fixturesSha256Concat,
        createHash('sha256').update(request.fixtures.map(f => f.sha256).join('')).digest('hex'));
      assert.equal(request.labels.sha256, sha(path.resolve(root, request.labels.path)));
      for (const [i, p] of pairs.entries()) {
        assert.equal(p.state, 'complete');
        assert.deepEqual(p.armOrder, i === 1 ? ['triageEnabled', 'baseline'] : ['baseline', 'triageEnabled']);
        assert.deepEqual(p.arms.map(a => a.name), p.armOrder);
        assert.equal(p.cacheCondition, i === 2 ? 'warm' : 'cold');
        assert.deepEqual(p.config, triages[i].config);
        assert.deepEqual(p.model, pairs[0].model);
        assert.equal(p.model.id, 'openai/gpt-6.1-sol'); assert.equal(p.model.version, '1.0.0');
        assert.equal(p.config.promptVersion, '5'); assert.equal(p.config.batchCharBudget, 48000);
        assert.equal(p.config.baselineSha256, summary.identities.baselineSha256);
        const t = triages[i];
        assert.equal(t.package.version, '1.12.1'); assert.equal(t.runtime.node, 'v24.22.1');
        assert.equal(t.package.typesafeSdk, '^0.6.0'); assert.equal(t.requestedModel, 'jev-latest');
        assert.equal(t.fixtureHashes.labelsSha256, sha(path.join(root, 'test/fixtures/typesafe/labels.json')));
        assert.deepEqual(t.fixtureHashes, triages[0].fixtureHashes);
        assert.equal(t.records.length, 44); assert.equal(new Set(t.records.map(r => r.id)).size, 44);
        assert.ok(t.records.every(r => r.state === 'success' && r.model === 'jev-1.14.0'));
        for (const r of t.records) assert.equal(r.fingerprint, request.fixtures.find(f => read(path.resolve(root, f.path)).id === r.id).sha256);
        assert.equal(t.cacheCondition, i === 0 ? 'cold-no-judgment-cache' : 'warm-immediate-repeat');
        assert.match(t.cacheNote, /never read/);
        for (const arm of p.arms) { assert.equal(arm.state, 'complete'); assert.ok(arm.calls.every(c => c.text.trim() && c.wallTimeMs > 0)); }
      }
      assert.equal(pairs[2].triageResultPath, pairs[0].triageResultPath);
      return '3 complete alternating pairs; 132 successful triage records; fixture bytes, fingerprints, label hash, configurations and model identities checked. Cache labels are procedural. Pair 3 analysis reuses pair 1 triage overhead; its separate triage repetition is not its attributed overhead. Provider version 1.0.0 is not a weight snapshot; SDK ^0.6.0 is a range.';
    });
    await criterion(3, 2, () => {
      const rows = [];
      for (const p of pairs) {
        const t = read(b(p.triageResultPath));
        assert.equal(p.triageWallTimeMs, t.wallTimeMs); assert.deepEqual(p.triageUsage, t.usage);
        for (const field of ['input_tokens', 'output_tokens']) assert.equal(t.usage[field], t.records.reduce((s, r) => s + r.usage[field], 0));
        for (const arm of p.arms) {
          for (const field of ['inputTokens', 'outputTokens', 'wallTimeMs']) {
            const sum = arm.calls.reduce((s, c) => s + c[field], 0);
            // Wall clocks may include local loop overhead; tokenizer sums must be exact.
            if (field !== 'wallTimeMs') assert.equal(arm[field], sum);
          }
          const expected = arm.wallTimeMs + (arm.name === 'triageEnabled' ? t.wallTimeMs : 0);
          assert.ok(Math.abs(arm.endToEndWallTimeMs - expected) < 1e-8);
          rows.push({ pairId: p.pairId, arm: arm.name, e2e: expected, tokens: arm.inputTokens + arm.outputTokens });
        }
      }
      for (const arm of ['baseline', 'triageEnabled']) {
        const rowsForArm = rows.filter(r => r.arm === arm);
        const key = arm === 'baseline' ? 'Baseline' : 'TriageEnabled';
        assert.equal(summary.analysisAggregates[`mean${key}EndToEndMs`], rowsForArm.reduce((s, r) => s + r.e2e, 0) / 3);
        assert.equal(summary.analysisAggregates[`mean${key}AnalysisTokens`], rowsForArm.reduce((s, r) => s + r.tokens, 0) / 3);
      }
      assert.equal(summary.costClaim.financialSavingsEstablished, false);
      return rows;
    });
    await criterion(3, 3, () => {
      const labels = read(path.join(root, 'test/fixtures/typesafe/labels.json'));
      const positives = labels.sessions.filter(s => s.worthAnalyzing).map(s => s.id);
      assert.equal(positives.length, 16);
      for (const t of [...triages, read(b('triage-1793062000319.json'))]) {
        assert.equal(t.state, 'complete'); assert.equal(t.fallbackIds.length, 0);
        const skips = t.records.filter(r => r.answers.trivial.noul >= 0.7).map(r => r.id);
        assert.deepEqual(skips, t.skippedIds);
        const misses = positives.filter(id => skips.includes(id));
        assert.deepEqual(misses, t.missedPositiveIds); assert.equal(misses.length, 0); assert.equal(t.recall, 1);
      }
      assert.ok(triages.every(t => t.config.threshold === 0.7));
      return 'Recomputed policy from raw judgments: 16/16 at 0.7 in original and all three v2 runs; misses [], skips eval-13/15/24/31/37. No fallback counted as recall.';
    });
    await criterion(3, 4, () => {
      const quality = [];
      for (const p of pairs) {
        const row = p.arms.map(a => {
          const synthesis = a.calls.find(c => c.kind === 'synthesis').text;
          return { arm: a.name, chars: synthesis.length, citations: new Set(synthesis.match(/eval-\d+/g)).size };
        });
        const expected = summary.analysisPairs.find(r => r.pairId === p.pairId).quality;
        for (const r of row) { assert.equal(r.chars, expected[r.arm].charCount); assert.equal(r.citations, expected[r.arm].citedSessionIds.length); }
        quality.push({ pair: p.pairId, arms: row });
      }
      const signoff = text(path.join(root, '.mwnn/cards/card-mvq03qy7-4.md'));
      assert.ok(signoff.includes('these are acceptable') && signoff.includes('ship the evaluated adjusted feature'));
      assert.match(signoff, /all.44/i); assert.match(signoff, /semantic equivalence/i);
      assert.match(text(b('reeval-v2/report-quality.md')), /not.*equivalent recommendations/i);
      return { quality, limits: 'Shorter triage reports cite fewer sessions (27→22, 23→20, 22→19); changed themes and false all-44 coverage claim remain accepted defects, not proof of semantic equivalence. Compact fixtures omit middle turns/tool events. Human acceptance is user-reported; no new sign-off or publication authorization.' };
    });
    await criterion(3, 5, () => {
      // Recompute in memory: never overwrite results.md (which contains human decisions).
      const generated = runScript(b('summarize-reeval.cjs'));
      const recomputed = JSON.parse(generated[b('reeval-v2/summary.json')]);
      delete recomputed.generatedAt;
      const recorded = { ...summary }; delete recorded.generatedAt;
      assert.deepEqual(recomputed, recorded);
      return 'Entire machine summary reproduces exactly except generatedAt; raw dependencies, totals, recall, cost classes, structural quality and negative outcomes reconcile. Original JSON/Markdown and human decisions not rewritten.';
    });
  }
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), verifier: { version: verifier.version, file: verifier.file, sha256: verifier.sha256 },
    scope: 'Offline evidence and current implementation checks; no external evaluation, billing proof, semantic-equivalence claim or publication.', results }, null, 2));
  if (results.some(r => r.status !== 'pass')) process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { installedVerifier, card, cardIds };
