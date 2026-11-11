'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildCostAccounting } = require('./costAccounting.cjs');

const root = __dirname;
const dir = path.join(root, 'reeval-v2');
const rates = JSON.parse(fs.readFileSync(path.join(root, 'cost-rates.json'), 'utf8'));

function features(text) {
  const sessionIds = [...new Set(text.match(/eval-\d+/g) || [])];
  const control = [...new Set(text.match(/AGENTS\.md|\.github\/copilot-instructions\.md|CLAUDE\.md|SKILL\.md/g) || [])];
  const tableRows = (text.match(/^\|/gm) || []).length;
  const limitation = /limitation|unavailable|cannot be verified|does not independently|not a fresh|synthesizes the .* batch|compact|redacted|tool traces?/i.test(text);
  const themeHits = {
    installedBuildVerification: /installed (build|extension)|Developer: Reload|vsix/i.test(text),
    multiRepoPreload: /multi-repo|preload packet/i.test(text),
    gapOnlyAiControl: /AI control file|AGENTS\.md|gap-only/i.test(text),
    wrapperSkillSync: /SKILL\.md|wrapper/i.test(text),
    tokenBudgetBatching: /token limit|batch|budget/i.test(text),
    typesafeOrTriage: /TypeSafe|triage/i.test(text),
  };
  return { chars: text.length, sessionIds, control, tableRows, limitation, themeHits };
}

const out = [];
out.push('# Report quality and evidence-support comparison — card-mvq03qy7-3');
out.push('');
out.push('Structured comparison for human review. Retention of sessions does **not** imply equivalent recommendations. No publication authorized.');
out.push('');
out.push('## Rubric');
out.push('');
out.push('| Dimension | What was inspected |');
out.push('| --- | --- |');
out.push('| Coverage honesty | Whether synthesis states batch/fixture limits rather than claiming full-transcript certainty |');
out.push('| Evidence support | Whether findings cite eval session ids or acknowledge missing tool traces |');
out.push('| Control-file targeting | Mentions of AGENTS.md / SKILL.md / similar AI control files |');
out.push('| Specificity / density | Approximate table-row and recommendation density in synthesis text |');
out.push('| Cross-arm risk | Whether triageEnabled loses themes present in baseline without proving skipped sessions were irrelevant |');
out.push('');

const files = fs.readdirSync(dir).filter((f) => /^analysis-pair-\d+-\d+\.json$/.test(f)).sort();
for (const file of files) {
  const analysis = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const triage = JSON.parse(fs.readFileSync(path.join(root, analysis.triageResultPath), 'utf8'));
  const cost = buildCostAccounting({ analysis, triage, ratesDoc: rates });
  const baseline = analysis.arms.find((a) => a.name === 'baseline');
  const after = analysis.arms.find((a) => a.name === 'triageEnabled');
  const bText = (baseline.calls.find((c) => c.kind === 'synthesis') || baseline.calls.at(-1)).text;
  const aText = (after.calls.find((c) => c.kind === 'synthesis') || after.calls.at(-1)).text;
  const b = features(bText);
  const a = features(aText);

  out.push(`## ${analysis.pairId} — order ${analysis.armOrder.join(' → ')}, cache=${analysis.cacheCondition}`);
  out.push('');
  out.push('| Metric | Baseline | TriageEnabled |');
  out.push('| --- | ---: | ---: |');
  out.push(`| Synthesis chars | ${b.chars} | ${a.chars} |`);
  out.push(`| Table-like rows | ${b.tableRows} | ${a.tableRows} |`);
  out.push(`| Distinct eval ids mentioned | ${b.sessionIds.length} | ${a.sessionIds.length} |`);
  out.push(`| States limitations | ${b.limitation} | ${a.limitation} |`);
  out.push(`| Control-file mentions | ${b.control.join(', ') || 'none'} | ${a.control.join(', ') || 'none'} |`);
  out.push('');
  out.push('### Theme presence (heuristic keyword hits)');
  out.push('');
  out.push('| Theme | Baseline | TriageEnabled |');
  out.push('| --- | --- | --- |');
  for (const key of Object.keys(b.themeHits)) {
    out.push(`| ${key} | ${b.themeHits[key]} | ${a.themeHits[key]} |`);
  }
  out.push('');
  out.push('### Cost components (list-rate / unavailable — not verified savings)');
  out.push('');
  out.push(`- verifiedSavingsClaim.established: ${cost.verifiedSavingsClaim.established}`);
  out.push(`- financialSavingsEstablished: ${cost.financialSavingsEstablished}`);
  out.push(`- reason: ${cost.verifiedSavingsClaim.reason}`);
  out.push(`- partialEstimateSum before: ~$${cost.totals.before.partialEstimateSum.value} USD (${cost.totals.before.partialEstimateSum.status})`);
  out.push(`- partialEstimateSum after: ~$${cost.totals.after.partialEstimateSum.value} USD (${cost.totals.after.partialEstimateSum.status})`);
  out.push(`- verified attributable total before/after: unavailable / unavailable`);
  out.push('- analysis actual billed: unavailable');
  out.push('- TypeSafe actual billed: unavailable');
  out.push('');
  out.push(`Artifacts: [${file}](${file}), triage \`${analysis.triageResultPath}\``);
  out.push('');
}

out.push('## Cross-pair observations for human review');
out.push('');
out.push('- All three pairs kept limitation language in both arms.');
out.push('- TriageEnabled syntheses are consistently shorter and cite fewer distinct eval ids than baseline in the same pair.');
out.push('- Theme keyword hits often remain true on both arms for core AI-control-file topics, but density and table support vary; do not treat keyword equality as report equivalence.');
out.push('- Skipped negatives (`eval-13`, `eval-15`, `eval-24`, `eval-31`, `eval-37`) never appear as retained analysis evidence in triageEnabled arms by design.');
out.push('');
out.push('## Unresolved representativeness limits');
out.push('');
out.push('- Compact redacted fixtures omit middle turns and individual tool events.');
out.push('- v2 adapter summary is counts/tools only; production session summaries differ.');
out.push('- Warm analysis repeats may benefit from provider-side caching that production cold starts lack.');
out.push('- Keyword theme hits are review aids only; they are not a substitute for reading synthesis text.');
out.push('- Human sign-off remains on card-mvq03qy7-4.');
out.push('');

fs.writeFileSync(path.join(dir, 'report-quality.md'), `${out.join('\n')}\n`);
console.log(JSON.stringify({ wrote: 'reeval-v2/report-quality.md', pairs: files.length }));
