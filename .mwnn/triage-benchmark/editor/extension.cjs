'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const lib = require('../library.bundle.cjs');
const { prepare } = require('../run.cjs');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
};
const normalize = value => value.replace(/^OpenAI:\s*/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
let running = false;

function resolvePrepared(version) {
  const baselinePath = path.join(__dirname, `../prepared-baseline-${version}.json`);
  const comparisonPath = path.join(__dirname, `../prepared-comparison-${version}.json`);
  const baseline = fs.existsSync(baselinePath)
    ? read(baselinePath)
    : read(path.join(__dirname, '../prepared-baseline.json'));
  const comparison = fs.existsSync(comparisonPath)
    ? read(comparisonPath)
    : read(path.join(__dirname, '../prepared-comparison.json'));
  return { baseline, comparison };
}

async function selectAnalysisModel(data) {
  const models = await vscode.lm.selectChatModels();
  const matches = models.filter(m => normalize(m.name) === normalize(data.request.analysisModel.displayName)
    && !`${m.vendor} ${m.id}`.toLowerCase().includes('copilotcli'));
  if (matches.length !== 1) {
    write(path.join(__dirname, '../editor-model-discovery.json'), {
      requestedName: data.request.analysisModel.displayName,
      models: models.map(m => ({ name: m.name, id: m.id, vendor: m.vendor, version: m.version })),
      matchingDirectModels: matches.length,
    });
    throw new Error('Expected exactly one direct-request GPT-6.1 Sol model; see editor-model-discovery.json. No analysis requests sent.');
  }
  return matches[0];
}

function usageClassFields() {
  return {
    tokenMeasurement: 'VS Code model.countTokens on the explicit user message and returned text. Provider billed usage, hidden reasoning, system overhead and provider caching are not exposed; these remain unknown.',
    providerReportedUsage: null,
    providerBilledUsage: null,
    actualBilledAmount: null,
    cacheUsage: null,
    retryOrFailedCharges: null,
    usageClassNotes: {
      tokenizerCounts: 'measured via model.countTokens',
      providerReportedUsage: 'unavailable: LanguageModelChatResponse exposes text/stream only',
      actualBilledAmount: 'unavailable without an attached provider invoice/statement',
      cacheUsage: 'unavailable: VS Code LM API does not expose cache tokens',
      retryOrFailedCharges: 'unavailable: VS Code LM API does not expose retry billing',
    },
  };
}

async function runArm({ name, input, model, data, token, progress, onWrite, triageWallTimeMs }) {
  const arm = { name, state: 'running', calls: [] };
  async function promptCall(prompt, kind) {
    if (token.isCancellationRequested) throw new Error('Benchmark cancelled.');
    const message = vscode.LanguageModelChatMessage.User(prompt);
    const inputTokens = await model.countTokens(message, token);
    if (inputTokens > model.maxInputTokens) {
      throw new Error('Prepared prompt exceeds the selected model input limit. No automatic evidence changes allowed.');
    }
    const start = performance.now();
    const response = await model.sendRequest([message], {}, token);
    let text = '';
    for await (const chunk of response.text) text += chunk;
    const wallTimeMs = performance.now() - start;
    if (!text.trim()) throw new Error('Model returned empty text; cannot use this run.');
    const outputTokens = await model.countTokens(text, token);
    arm.calls.push({ kind, inputTokens, outputTokens, wallTimeMs, text });
    onWrite();
    return text;
  }
  const armStart = performance.now();
  const summaries = [];
  for (const [index, batch] of input.batches.entries()) {
    progress.report({ message: `${name}: batch ${index + 1}/${input.batches.length}` });
    summaries.push(await promptCall(batch.prompt, `batch-${index + 1}`));
  }
  if (summaries.length > 1) {
    await promptCall(lib.buildAnalysisSynthesisPrompt(data.selection, summaries, data.baseline), 'synthesis');
  }
  arm.wallTimeMs = performance.now() - armStart;
  arm.inputTokens = arm.calls.reduce((sum, call) => sum + call.inputTokens, 0);
  arm.outputTokens = arm.calls.reduce((sum, call) => sum + call.outputTokens, 0);
  arm.endToEndWallTimeMs = arm.wallTimeMs + (name === 'triageEnabled' ? (triageWallTimeMs || 0) : 0);
  arm.state = 'complete';
  return arm;
}

/** Original single-pair benchmark (v1/v2 prepared files). Preserved for compatibility. */
async function benchmark() {
  if (running) throw new Error('Benchmark is already running.');
  running = true;
  try {
    const data = prepare();
    const version = data.config.questionSetVersion;
    const { baseline, comparison } = resolvePrepared(version);
    if (JSON.stringify(baseline.config) !== JSON.stringify(data.config)
      || JSON.stringify(comparison.config) !== JSON.stringify(data.config)) {
      throw new Error(`Prepared inputs differ from current source/baseline (${version}). Prepare the benchmark again.`);
    }
    const model = await selectAnalysisModel(data);
    const resultPath = path.join(__dirname, `../analysis-${Date.now()}.json`);
    const result = {
      schemaVersion: 1,
      state: 'running',
      startedAt: new Date().toISOString(),
      config: data.config,
      model: { name: model.name, id: model.id, vendor: model.vendor, version: model.version, maxInputTokens: model.maxInputTokens },
      ...usageClassFields(),
      triageResultPath: comparison.triageResultPath,
      armOrder: ['baseline', 'triageEnabled'],
      cacheCondition: 'unspecified-legacy-single-pair',
      arms: [],
    };
    write(resultPath, result);
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Approved MWNN triage benchmark', cancellable: true }, async (progress, token) => {
      try {
        for (const [name, input] of [['baseline', baseline], ['triageEnabled', comparison]]) {
          const arm = await runArm({
            name, input, model, data, token, progress,
            onWrite: () => write(resultPath, result),
            triageWallTimeMs: comparison.triageWallTimeMs,
          });
          result.arms.push(arm);
          write(resultPath, result);
        }
        result.state = 'complete';
      } catch (error) {
        result.state = token.isCancellationRequested ? 'cancelled' : 'incomplete';
        result.errorName = error?.name || 'Error';
        throw error;
      } finally {
        result.finishedAt = new Date().toISOString();
        write(resultPath, result);
      }
      void vscode.window.showInformationMessage(`Benchmark complete: ${path.basename(resultPath)}`);
      return resultPath;
    });
  } finally {
    running = false;
  }
}

/**
 * card-mvq03qy7-3: three paired repetitions with alternating arm order and
 * separately labeled cold/warm cache conditions. Writes under reeval-v2/.
 */
async function reevalBenchmark() {
  if (running) throw new Error('Benchmark is already running.');
  running = true;
  try {
    const data = prepare();
    const schedulePath = path.join(__dirname, '../reeval-v2/analysis-schedule.json');
    if (!fs.existsSync(schedulePath)) throw new Error('Missing reeval-v2/analysis-schedule.json');
    const schedule = read(schedulePath);
    const version = data.config.questionSetVersion;
    if (version !== schedule.questionSetVersion) {
      throw new Error(`Schedule question set ${schedule.questionSetVersion} != prepared ${version}`);
    }
    const baselinePath = path.join(__dirname, `../prepared-baseline-${version}.json`);
    if (!fs.existsSync(baselinePath)) throw new Error(`Missing ${path.basename(baselinePath)}`);
    const baseline = read(baselinePath);
    if (JSON.stringify(baseline.config) !== JSON.stringify(data.config)) {
      throw new Error('Prepared baseline config differs from current source/baseline.');
    }
    const model = await selectAnalysisModel(data);
    const hostResultPath = path.join(__dirname, `../reeval-v2/analysis-host-${Date.now()}.json`);
    const hostResult = {
      schemaVersion: 1,
      cardId: 'card-mvq03qy7-3',
      protocol: schedule.protocol,
      state: 'running',
      startedAt: new Date().toISOString(),
      config: data.config,
      model: { name: model.name, id: model.id, vendor: model.vendor, version: model.version, maxInputTokens: model.maxInputTokens },
      ...usageClassFields(),
      pairs: [],
    };
    write(hostResultPath, hostResult);

    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Adjusted triage re-evaluation (card-mvq03qy7-3)',
      cancellable: true,
    }, async (progress, token) => {
      try {
        for (const pair of schedule.pairs) {
          if (token.isCancellationRequested) throw new Error('Benchmark cancelled.');
          const preparedPath = path.join(__dirname, '../reeval-v2', pair.triagePreparedRelative);
          if (!fs.existsSync(preparedPath)) {
            throw new Error(`Missing prepared comparison for ${pair.id}: ${pair.triagePreparedRelative}`);
          }
          const comparison = read(preparedPath);
          if (JSON.stringify(comparison.config) !== JSON.stringify(data.config)) {
            throw new Error(`Prepared comparison config drift for ${pair.id}`);
          }
          const pairPath = path.join(__dirname, `../reeval-v2/analysis-${pair.id}-${Date.now()}.json`);
          const pairResult = {
            schemaVersion: 1,
            cardId: 'card-mvq03qy7-3',
            pairId: pair.id,
            armOrder: pair.armOrder,
            cacheCondition: pair.cacheCondition,
            cacheNotes: pair.notes || null,
            state: 'running',
            startedAt: new Date().toISOString(),
            config: data.config,
            model: hostResult.model,
            ...usageClassFields(),
            triageResultPath: comparison.triageResultPath,
            triageWallTimeMs: comparison.triageWallTimeMs,
            triageUsage: comparison.triageUsage || null,
            arms: [],
          };
          write(pairPath, pairResult);
          progress.report({ message: `${pair.id} (${pair.cacheCondition})` });
          const inputs = { baseline, triageEnabled: comparison };
          for (const name of pair.armOrder) {
            const arm = await runArm({
              name,
              input: inputs[name],
              model,
              data,
              token,
              progress,
              onWrite: () => write(pairPath, pairResult),
              triageWallTimeMs: comparison.triageWallTimeMs,
            });
            pairResult.arms.push(arm);
            write(pairPath, pairResult);
          }
          pairResult.state = 'complete';
          pairResult.finishedAt = new Date().toISOString();
          write(pairPath, pairResult);
          hostResult.pairs.push({
            pairId: pair.id,
            path: path.basename(pairPath),
            armOrder: pair.armOrder,
            cacheCondition: pair.cacheCondition,
            state: pairResult.state,
            triageResultPath: comparison.triageResultPath,
          });
          write(hostResultPath, hostResult);
        }
        hostResult.state = 'complete';
      } catch (error) {
        hostResult.state = token.isCancellationRequested ? 'cancelled' : 'incomplete';
        hostResult.errorName = error?.name || 'Error';
        throw error;
      } finally {
        hostResult.finishedAt = new Date().toISOString();
        write(hostResultPath, hostResult);
        write(path.join(__dirname, '../editor-launch-result.json'), {
          state: hostResult.state === 'complete' ? 'complete' : 'failed',
          mode: 'reeval-v2',
          resultPath: hostResultPath,
          errorName: hostResult.errorName || null,
        });
      }
      void vscode.window.showInformationMessage(`Re-eval complete: ${path.basename(hostResultPath)}`);
      return hostResultPath;
    });
  } finally {
    running = false;
  }
}

exports.activate = context => {
  context.subscriptions.push(vscode.commands.registerCommand('mwnn.runApprovedTriageBenchmark', benchmark));
  context.subscriptions.push(vscode.commands.registerCommand('mwnn.runAdjustedTriageReeval', reevalBenchmark));
  // Prefer the adjusted re-eval auto-launch when its claim is absent.
  const reevalClaim = path.join(__dirname, '../editor-auto-launch-reeval-v2.claim');
  try {
    fs.writeFileSync(reevalClaim, new Date().toISOString(), { flag: 'wx' });
    void require('./launch-reeval.cjs').run().catch(() => {});
    return;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  // Legacy single-pair auto-launch (v2 claim) remains one-shot.
  const claimPath = path.join(__dirname, '../editor-auto-launch-v2.claim');
  try { fs.writeFileSync(claimPath, new Date().toISOString(), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  void require('./launch.cjs').run().catch(() => {});
};
exports.deactivate = () => {};
