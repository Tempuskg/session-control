'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const lib = require('../library.bundle.cjs');
const { prepare } = require('../run.cjs');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const normalize = value => value.replace(/^OpenAI:\s*/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
let running = false;

async function benchmark() {
  if (running) throw new Error('Benchmark is already running.');
  running = true;
  try {
    const data = prepare();
    const baseline = read(path.join(__dirname, '../prepared-baseline.json'));
    const comparison = read(path.join(__dirname, '../prepared-comparison.json'));
    if (JSON.stringify(baseline.config) !== JSON.stringify(data.config) || JSON.stringify(comparison.config) !== JSON.stringify(data.config)) {
      throw new Error('Prepared inputs differ from current source/baseline. Prepare the benchmark again.');
    }
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
    const model = matches[0];
    const resultPath = path.join(__dirname, `../analysis-${Date.now()}.json`);
    const result = { schemaVersion: 1, state: 'running', startedAt: new Date().toISOString(), config: data.config,
      model: { name: model.name, id: model.id, vendor: model.vendor, version: model.version, maxInputTokens: model.maxInputTokens },
      tokenMeasurement: 'VS Code model.countTokens on the explicit user message and returned text. Provider billed usage, hidden reasoning, system overhead and provider caching are not exposed; these remain unknown.',
      providerBilledUsage: null, triageResultPath: comparison.triageResultPath, arms: [] };
    write(resultPath, result);
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Approved MWNN triage benchmark', cancellable: true }, async (progress, token) => {
      try {
        async function promptCall(prompt, arm, kind) {
          if (token.isCancellationRequested) throw new Error('Benchmark cancelled.');
          const message = vscode.LanguageModelChatMessage.User(prompt);
          const inputTokens = await model.countTokens(message, token);
          if (inputTokens > model.maxInputTokens) throw new Error('Prepared prompt exceeds the selected model input limit. No automatic evidence changes allowed.');
          const start = performance.now();
          const response = await model.sendRequest([message], {}, token);
          let text = '';
          for await (const chunk of response.text) text += chunk;
          const wallTimeMs = performance.now() - start;
          if (!text.trim()) throw new Error('Model returned empty text; cannot use this run.');
          const outputTokens = await model.countTokens(text, token);
          arm.calls.push({ kind, inputTokens, outputTokens, wallTimeMs, text });
          write(resultPath, result);
          return text;
        }
        for (const [name, input] of [['baseline', baseline], ['triageEnabled', comparison]]) {
          const arm = { name, state: 'running', calls: [] }; result.arms.push(arm);
          const armStart = performance.now();
          const summaries = [];
          for (const [index, batch] of input.batches.entries()) {
            progress.report({ message: `${name}: batch ${index + 1}/${input.batches.length}` });
            summaries.push(await promptCall(batch.prompt, arm, `batch-${index + 1}`));
          }
          if (summaries.length > 1) await promptCall(lib.buildAnalysisSynthesisPrompt(data.selection, summaries, data.baseline), arm, 'synthesis');
          arm.wallTimeMs = performance.now() - armStart;
          arm.inputTokens = arm.calls.reduce((sum, call) => sum + call.inputTokens, 0);
          arm.outputTokens = arm.calls.reduce((sum, call) => sum + call.outputTokens, 0);
          arm.endToEndWallTimeMs = arm.wallTimeMs + (name === 'triageEnabled' ? comparison.triageWallTimeMs : 0);
          arm.state = 'complete'; write(resultPath, result);
        }
        result.state = 'complete';
      } catch (error) {
        result.state = token.isCancellationRequested ? 'cancelled' : 'incomplete';
        result.errorName = error?.name || 'Error';
        // No raw provider error details or request headers are persisted.
        throw error;
      } finally {
        result.finishedAt = new Date().toISOString(); write(resultPath, result);
      }
      void vscode.window.showInformationMessage(`Benchmark complete: ${path.basename(resultPath)}`);
      return resultPath;
    });
  } finally { running = false; }
}

exports.activate = context => {
  context.subscriptions.push(vscode.commands.registerCommand('mwnn.runApprovedTriageBenchmark', benchmark));
  // A one-time claim avoids duplicate paid runs if the Development Host reloads.
  const claimPath = path.join(__dirname, '../editor-auto-launch-v2.claim');
  try { fs.writeFileSync(claimPath, new Date().toISOString(), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  void require('./launch.cjs').run().catch(() => {});
};
exports.deactivate = () => {};
