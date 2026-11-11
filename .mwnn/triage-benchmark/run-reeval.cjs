'use strict';
/**
 * Live TypeSafe triage re-evaluation runner for card-mvq03qy7-3.
 * Writes new timestamped artifacts under reeval-v2/ and never overwrites v1 results.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { TypeSafeClient } = require('@typesafe-ai/sdk');
const lib = require('./library.bundle.cjs');
const { prepare, analysisArm } = require('./run.cjs');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'reeval-v2');
const write = (p, value) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
};
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

function parseArgs(argv) {
  const args = { live: false, pair: 'pair-unspecified', cacheCondition: 'cold-no-judgment-cache' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--pair') args.pair = argv[++i];
    else if (a === '--cacheCondition') args.cacheCondition = argv[++i];
  }
  return args;
}

function packageIdentity() {
  const pkg = read(path.join(root, 'package.json'));
  return {
    name: pkg.name,
    version: pkg.version,
    typesafeSdk: pkg.dependencies?.['@typesafe-ai/sdk'] || pkg.devDependencies?.['@typesafe-ai/sdk'] || null,
  };
}

async function runLive(args) {
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    throw new Error('TYPESAFE_API_KEY is not available to this process.');
  }
  const data = prepare();
  if (data.config.questionSetVersion !== 'analysis-triage-v2') {
    throw new Error(`Expected analysis-triage-v2, got ${data.config.questionSetVersion}`);
  }
  if (data.config.payloadVersion !== 'triage-payload-v2') {
    throw new Error(`Expected triage-payload-v2, got ${data.config.payloadVersion}`);
  }

  const stamp = Date.now();
  const resultPath = path.join(outDir, `triage-${args.pair}-${stamp}.json`);
  const result = {
    schemaVersion: 1,
    cardId: 'card-mvq03qy7-3',
    protocol: 'reeval-protocol.md',
    pairId: args.pair,
    cacheCondition: args.cacheCondition,
    cacheNote: 'Local judgment cache is never read. cold-no-judgment-cache = first/isolated process; warm-immediate-repeat = consecutive live run (provider warmth only; still no persisted judgment reads).',
    startedAt: new Date().toISOString(),
    state: 'running',
    config: data.config,
    requestedModel: data.request.triageModel.configuredName,
    package: packageIdentity(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    fixtureHashes: {
      labelsSha256: data.request.labels.sha256,
      fixtureCount: data.request.fixtures.length,
      fixturesSha256Concat: crypto.createHash('sha256')
        .update(data.request.fixtures.map((f) => f.sha256).join(''))
        .digest('hex'),
    },
    records: [],
  };
  write(resultPath, result);

  const client = new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    timeout: 60000,
    retry: { maxRetries: 0 },
  });
  const started = performance.now();
  const queue = [...data.candidates];
  const predictions = new Map();
  let stop = false;

  async function worker() {
    for (let candidate = queue.shift(); candidate && !stop; candidate = queue.shift()) {
      const start = performance.now();
      const record = { id: candidate.session.id, fingerprint: candidate.fingerprint };
      try {
        const response = await client.systemOne({
          model: result.requestedModel,
          state: lib.buildAnalysisTriageState(candidate),
          questions: lib.ANALYSIS_TRIAGE_QUESTIONS,
        });
        record.answers = response.answers;
        record.model = response.model;
        record.usage = response.usage;
        record.state = 'success';
        predictions.set(candidate.fingerprint, response.answers);
      } catch (error) {
        record.state = 'error';
        record.error = { name: error?.name || 'Error', status: error?.status ?? null };
        stop = true;
      }
      record.wallTimeMs = performance.now() - start;
      result.records.push(record);
      write(resultPath, result);
      console.log(`${args.pair} ${record.id}: ${record.state}`);
    }
  }

  const probe = data.candidates[0];
  queue.splice(0, 1);
  queue.unshift(probe);
  const remaining = queue.splice(1);
  await worker();
  if (!stop) {
    queue.push(...remaining);
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  result.wallTimeMs = performance.now() - started;
  result.state = predictions.size === data.candidates.length ? 'complete' : 'incomplete';
  const plan = lib.planAnalysisFromTriage(data.candidates, predictions, data.config.batchCharBudget);
  const retained = new Set(plan.analyzable.map((c) => c.session.id));
  const positives = data.labels.sessions.filter((l) => l.worthAnalyzing).map((l) => l.id);
  result.retainedIds = [...retained];
  result.skippedIds = plan.skipped.map((c) => c.session.id);
  result.missedPositiveIds = positives.filter((id) => !retained.has(id));
  result.fallbackIds = data.candidates.filter((c) => !predictions.has(c.fingerprint)).map((c) => c.session.id);
  // Never present incomplete/fallback runs as successful model recall.
  result.recall = result.state === 'complete' && result.fallbackIds.length === 0
    ? (positives.length - result.missedPositiveIds.length) / positives.length
    : null;
  result.positiveLabelCount = positives.length;
  result.usage = result.records.filter((r) => r.state === 'success').reduce((sum, r) => ({
    input_tokens: sum.input_tokens + (r.usage?.input_tokens || 0),
    output_tokens: sum.output_tokens + (r.usage?.output_tokens || 0),
  }), { input_tokens: 0, output_tokens: 0 });
  result.finishedAt = new Date().toISOString();
  write(resultPath, result);

  const indexPath = path.join(outDir, 'triage-index.json');
  const index = fs.existsSync(indexPath) ? read(indexPath) : { schemaVersion: 1, cardId: 'card-mvq03qy7-3', runs: [] };
  index.runs.push({
    pairId: args.pair,
    cacheCondition: args.cacheCondition,
    path: path.basename(resultPath),
    state: result.state,
    recall: result.recall,
    missedPositiveIds: result.missedPositiveIds,
    skippedIds: result.skippedIds,
    fallbackIds: result.fallbackIds,
    wallTimeMs: result.wallTimeMs,
    usage: result.usage,
    finishedAt: result.finishedAt,
  });
  write(indexPath, index);

  if (result.state === 'complete') {
    const prepName = `prepared-comparison-${data.config.questionSetVersion}-${args.pair}.json`;
    const prepPath = path.join(outDir, prepName);
    write(prepPath, {
      triageResultPath: path.relative(__dirname, resultPath).replace(/\\/g, '/'),
      pairId: args.pair,
      cacheCondition: args.cacheCondition,
      config: data.config,
      triageWallTimeMs: result.wallTimeMs,
      triageUsage: result.usage,
      retainedIds: result.retainedIds,
      skippedIds: result.skippedIds,
      missedPositiveIds: result.missedPositiveIds,
      batches: analysisArm(data, plan.analyzable, plan.detailLevels),
    });
    // Also refresh the versioned comparison used by the editor helper for analysis pairs.
    write(path.join(__dirname, `prepared-comparison-${data.config.questionSetVersion}.json`), {
      triageResultPath: path.relative(__dirname, resultPath).replace(/\\/g, '/'),
      pairId: args.pair,
      cacheCondition: args.cacheCondition,
      config: data.config,
      triageWallTimeMs: result.wallTimeMs,
      triageUsage: result.usage,
      batches: analysisArm(data, plan.analyzable, plan.detailLevels),
    });
  }

  console.log(JSON.stringify({
    result: path.relative(root, resultPath).replace(/\\/g, '/'),
    state: result.state,
    pairId: args.pair,
    cacheCondition: args.cacheCondition,
    judged: predictions.size,
    recall: result.recall,
    missedPositiveIds: result.missedPositiveIds,
    skippedIds: result.skippedIds,
    fallbackIds: result.fallbackIds,
    usage: result.usage,
    wallTimeMs: result.wallTimeMs,
  }));
  if (result.state !== 'complete') process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.live) {
    const data = prepare();
    console.log(JSON.stringify({
      prepared: data.candidates.length,
      networkCalls: 0,
      questionSetVersion: data.config.questionSetVersion,
      payloadVersion: data.config.payloadVersion,
      baselineSha256: data.config.baselineSha256,
      note: 'Pass --live --pair pair-N --cacheCondition ... to execute TypeSafe calls.',
    }));
    return;
  }
  await runLive(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, packageIdentity };
