'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { TypeSafeClient } = require('@typesafe-ai/sdk');
const lib = require('./library.bundle.cjs');
const root = path.resolve(__dirname, '../..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');

function prepare() {
  const request = read(path.join(root, '.mwnn/triage-evaluation-request.json'));
  if (request.state !== 'external-calls-approved') throw new Error('Evaluation approval is absent.');
  const checked = item => {
    const absolute = path.resolve(root, item.path);
    if (!absolute.startsWith(path.join(root, 'test', 'fixtures', 'typesafe') + path.sep)) throw new Error('Unexpected input path.');
    if (hash(absolute) !== item.sha256) throw new Error(`Approved input changed: ${item.path}`);
    return read(absolute);
  };
  const labels = checked(request.labels);
  const fixtures = request.fixtures.map(checked);
  if (fixtures.length !== 44 || new Set(fixtures.map(f => f.id)).size !== 44) throw new Error('Expected 44 unique fixtures.');
  if (labels.sessions.length !== 44 || labels.sessions.some(l => !fixtures.some(f => f.id === l.id))) throw new Error('Label/fixture mismatch.');
  const candidates = fixtures.map((f, index) => {
    // This is compact fixture evidence, not a reconstruction of omitted transcript turns/tools.
    const turns = [];
    for (const [i, prompt] of f.userPrompts.entries()) {
      turns.push({ type: 'request', prompt: prompt.text, participant: '', references: [], timestamp: '' });
      if (i === 0 && f.firstResponse) turns.push({ type: 'response', content: f.firstResponse, participant: '', toolCalls: [], timestamp: '' });
    }
    if (f.lastResponse) turns.push({ type: 'response', content: f.lastResponse, participant: '', toolCalls: [], timestamp: '' });
    return {
      workspaceName: 'redacted-evaluation', storageDirectory: '', fileName: `${f.id}.json`, rootFileName: `${f.id}.json`,
      fingerprint: request.fixtures[index].sha256,
      session: { version: 1, id: f.id, title: f.title, savedAt: f.savedDate, provider: f.provider, git: null,
        vscodeVersion: '', totalTurns: f.counts.turns, part: null, totalParts: null, previousPartFile: null, nextPartFile: null,
        turns, markdownSummary: 'Redacted compact fixture; omitted turns and individual tool events are unavailable.\n' + JSON.stringify(f) },
    };
  });
  const baseline = ['AGENTS.md', '.github/copilot-instructions.md'].map(p => `## ${p}\n${fs.readFileSync(path.join(root, p), 'utf8')}`).join('\n\n');
  const selection = { mode: 'needsAnalysis', label: 'fixed redacted evaluation set (44 sessions)', range: null };
  const config = { analysisModelDisplayName: request.analysisModel.displayName, batchCharBudget: lib.DEFAULT_ANALYSIS_BATCH_CHAR_BUDGET,
    promptVersion: lib.ANALYSIS_PROMPT_VERSION, questionSetVersion: lib.ANALYSIS_TRIAGE_QUESTION_SET_VERSION,
    threshold: lib.ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD, baselineSha256: crypto.createHash('sha256').update(baseline).digest('hex'),
    adapter: 'Compact fixture prompts in recorded order, first/last response only; no fabricated tools or timestamps; fixture JSON as summary. Results apply to these redacted fixtures.' };
  if (config.threshold !== request.protocol.trivialSkipThreshold) throw new Error('Policy changed since request approval.');
  return { request, labels, candidates, baseline, selection, config };
}

function analysisArm(data, candidates, detailLevels) {
  return lib.splitCandidatesIntoAnalysisBatches(candidates, data.config.batchCharBudget, detailLevels).map(batch => ({
    ids: batch.map(c => c.session.id), prompt: lib.buildAnalysisPrompt(data.selection, batch, data.baseline, 'full', detailLevels),
  }));
}

async function run() {
  const data = prepare();
  const baseline = analysisArm(data, data.candidates);
  if (!process.argv.includes('--live')) {
    write(path.join(__dirname, 'prepared-baseline.json'), { config: data.config, batches: baseline });
    console.log(JSON.stringify({ prepared: data.candidates.length, baselineBatches: baseline.length, networkCalls: 0 }));
    return;
  }
  if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('TYPESAFE_API_KEY is not available to this process.');
  const resultPath = path.join(__dirname, `triage-${Date.now()}.json`);
  const result = { schemaVersion: 1, startedAt: new Date().toISOString(), state: 'running', config: data.config,
    requestedModel: data.request.triageModel.configuredName, cache: 'cold; no persisted judgment reads', records: [] };
  write(resultPath, result);
  const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, timeout: 60000, retry: { maxRetries: 0 } });
  const started = performance.now();
  const queue = [...data.candidates];
  const predictions = new Map();
  let stop = false;
  async function worker() {
    for (let candidate = queue.shift(); candidate && !stop; candidate = queue.shift()) {
      const start = performance.now();
      const record = { id: candidate.session.id, fingerprint: candidate.fingerprint };
      try {
        const response = await client.systemOne({ model: result.requestedModel, state: lib.buildAnalysisTriageState(candidate), questions: lib.ANALYSIS_TRIAGE_QUESTIONS });
        record.answers = response.answers;
        record.model = response.model;
        record.usage = response.usage;
        record.state = 'success';
        predictions.set(candidate.fingerprint, response.answers);
      } catch (error) {
        // Never persist raw API error messages, request headers, or credentials.
        record.state = 'error'; record.error = { name: error?.name || 'Error', status: error?.status ?? null };
        stop = true;
      }
      record.wallTimeMs = performance.now() - start;
      result.records.push(record);
      write(resultPath, result);
      console.log(`${record.id}: ${record.state}`);
    }
  }
  // Match production's maximum concurrency; first request probes authentication/network.
  const probe = data.candidates[0];
  queue.splice(0, 1);
  queue.unshift(probe);
  // Run one worker first only until its first request fails or completes via a one-item queue.
  const remaining = queue.splice(1);
  await worker();
  if (!stop) { queue.push(...remaining); await Promise.all(Array.from({ length: 4 }, worker)); }
  result.wallTimeMs = performance.now() - started;
  result.state = predictions.size === data.candidates.length ? 'complete' : 'incomplete';
  const plan = lib.planAnalysisFromTriage(data.candidates, predictions, data.config.batchCharBudget);
  const retained = new Set(plan.analyzable.map(c => c.session.id));
  const positives = data.labels.sessions.filter(l => l.worthAnalyzing).map(l => l.id);
  result.retainedIds = [...retained]; result.skippedIds = plan.skipped.map(c => c.session.id);
  result.missedPositiveIds = positives.filter(id => !retained.has(id));
  result.fallbackIds = data.candidates.filter(c => !predictions.has(c.fingerprint)).map(c => c.session.id);
  result.recall = result.state === 'complete' ? (positives.length - result.missedPositiveIds.length) / positives.length : null;
  result.positiveLabelCount = positives.length;
  result.usage = result.records.filter(r => r.state === 'success').reduce((sum, r) => ({
    input_tokens: sum.input_tokens + r.usage.input_tokens, output_tokens: sum.output_tokens + r.usage.output_tokens,
  }), { input_tokens: 0, output_tokens: 0 });
  result.finishedAt = new Date().toISOString();
  write(resultPath, result);
  if (result.state === 'complete') write(path.join(__dirname, 'prepared-comparison.json'), {
    triageResultPath: path.basename(resultPath), config: data.config,
    triageWallTimeMs: result.wallTimeMs, triageUsage: result.usage, batches: analysisArm(data, plan.analyzable, plan.detailLevels),
  });
  console.log(JSON.stringify({ result: path.relative(root, resultPath), state: result.state, judged: predictions.size, recall: result.recall, usage: result.usage, wallTimeMs: result.wallTimeMs }));
  if (result.state !== 'complete') process.exitCode = 1;
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, analysisArm };
