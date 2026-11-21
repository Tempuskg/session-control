'use strict';
// Exercise the installed verifier factory with fresh inputs, real commands and
// its real repository snapshot implementation. No VS Code activation is needed.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { installedVerifier, card, cardIds } = require('./verify-adjusted.cjs');
const root = path.resolve(__dirname, '../..');
async function main() {
  const { api, version, sha256 } = installedVerifier();
  const profileText = await fs.readFile(path.join(root, '.mwnn/verification.json'), 'utf8');
  const profile = api.parseVerificationProfile(profileText);
  const mappings = [...cardIds, 'card-mwhqmgjl-1'].flatMap(id => api.criterionTexts(card(id)).map(text => {
    const mapping = profile.criteria.find(c => c.text === text);
    if (!mapping?.checks.length || mapping.human) throw Error(`Unmapped criterion: ${id}: ${text}`);
    return { cardId: id, text, checks: mapping.checks };
  }));
  const logs = [];
  let receipt;
  const factory = api.createOutcomeEvidenceFactory({
    snapshot: api.snapshotRevision,
    readText: p => fs.readFile(p, 'utf8'), now: () => new Date(), id: crypto.randomUUID,
    npmCommand: await api.resolveNpmCommand(),
    run: async (command, signal) => {
      process.stderr.write(`Checking ${command.id}\n`);
      const result = await new Promise(resolve => {
        // Invoke npm's JS entry directly on Windows to preserve argv without a
        // shell/.cmd quoting layer. This executes the installed npm, not a mock.
        const isNpm = /npm\.cmd$/i.test(command.command);
        const child = isNpm
          ? spawn(process.execPath, [path.join(path.dirname(command.command), 'node_modules/npm/bin/npm-cli.js'), ...command.args], { cwd: command.cwd, windowsHide: true, signal })
          : spawn(command.command, command.args, { cwd: command.cwd, windowsHide: true, signal });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
        child.on('error', e => resolve({ started: false, cancelled: signal.aborted, exitCode: null, error: e.message, stdout, stderr }));
        child.on('close', exitCode => resolve({ started: true, cancelled: signal.aborted, exitCode, stdout, stderr }));
      });
      logs.push({ ...command, ...result });
      process.stderr.write(`${command.id}: exit ${result.exitCode}\n`);
      return result;
    },
    persist: async r => { receipt = r; return 'memory:pending-workspace-evidence'; },
  });
  const id = 'card-mwhqmgjl-1';
  const session = await factory({ cwd: root, boardFolder: '.mwnn', card: card(id),
    stage: 'implementation', prompt: 'Fresh offline independent verification of adjusted triage follow-up and exact original criterion mappings.',
    reloadCard: async () => card(id), signal: new AbortController().signal });
  const verdict = await session.verify();
  const revalidated = verdict.valid ? await session.revalidate() : false;
  // Write only after the factory finishes its unchanged-input checks. These are
  // exported offline receipts, not receipts from the AI loop's frozen dispatch.
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const report = { checkedAt: new Date().toISOString(), installedVersion: version, bundleSha256: sha256,
    valid: verdict.valid, revalidatedBeforeExport: revalidated, reason: verdict.reason ?? null, mappings,
    receipt: receipt ?? null,
    receiptScope: 'Installed verifier factory run with fresh inputs; receipt held in memory during checks then exported locally. Not a live-loop dispatch receipt. Export changes the repository digest; redispatch captures the final profile and evidence.', logs };
  const file = path.join(__dirname, `verification-profile-${suffix}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ file: path.relative(root, file), valid: verdict.valid, revalidated, reason: report.reason }));
  if (!verdict.valid || !revalidated) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
