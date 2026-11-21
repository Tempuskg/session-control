// Read-only smoke of the actual installed production module, without activation or API calls.
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const root = 'C:/Users/darre/.vscode/extensions/darrenjmcleod.session-control-1.13.1';
const bundle = fs.readFileSync(`${root}/dist/extension.js`, 'utf8');
const ast = acorn.parse(bundle, { ecmaVersion: 'latest' });
let moduleSource;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Property' && node.value?.type === 'ArrowFunctionExpression') {
    const text = bundle.slice(node.value.start, node.value.end);
    if (text.includes('"analysis-triage-v2"') && text.includes('ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD=.7')) moduleSource = text;
  }
  if (node.type === 'Property' && node.value?.type === 'FunctionExpression') {
    const text = bundle.slice(node.value.start, node.value.end);
    if (text.includes('"analysis-triage-v2"') && text.includes('ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD=.7')) moduleSource = text;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(ast);
assert.ok(moduleSource, 'Locate actual production triage webpack module');
const exportsObject = {};
// Webpack uses concise object methods; their function node begins with the parameter list.
const standaloneSource = /^\([^)]*\)\{/.test(moduleSource) ? `function${moduleSource}` : moduleSource;
vm.runInNewContext(`(${standaloneSource})`)({}, exportsObject, () => ({
  score: (question, levels) => ({ question, levels }), noul: question => ({ question }),
}));
assert.equal(exportsObject.ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD, 0.7);
assert.equal(exportsObject.ANALYSIS_TRIAGE_QUESTION_SET_VERSION, 'analysis-triage-v2');
assert.equal(exportsObject.ANALYSIS_TRIAGE_PAYLOAD_VERSION, 'triage-payload-v2');
assert.equal(exportsObject.isTrivialAnalysisCandidate({ trivial: { noul: 0.7 } }), true);
assert.equal(exportsObject.isTrivialAnalysisCandidate({ trivial: { noul: 0.699 } }), false);
const payload = exportsObject.buildAnalysisTriageState({ session: {
  title: 'Installed artifact probe', provider: 'codex', markdownSummary: 's'.repeat(3000),
  turns: [
    { type: 'request', prompt: 'first' },
    { type: 'response', content: 'response', toolCalls: [{ name: 'run', output: 'SECRET_TOOL_OUTPUT' }] },
    { type: 'request', prompt: 'p'.repeat(500) },
  ],
} });
assert.equal(payload.summary.length, 2501);
assert.equal(payload.userPrompts[0].length, 321);
assert.equal(payload.tools.total, 1);
assert.equal(payload.tools.topTools[0].name, 'run');
assert.equal('evidence' in payload, false);
assert.equal(JSON.stringify(payload).includes('SECRET_TOOL_OUTPUT'), false);
const proRoot = `${root}/node_modules/@tempuskg/session-control-pro`;
const pro = JSON.parse(fs.readFileSync(`${proRoot}/package.json`));
assert.equal(pro.version, '0.10.3');
assert.ok(require.resolve('@tempuskg/session-control-pro', { paths: [root] }).endsWith('index.js'));
assert.deepEqual(fs.readdirSync(`${proRoot}/dist`), ['index.js']);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const report = {
  inspectedAt: new Date().toISOString(), root, version: JSON.parse(fs.readFileSync(`${root}/package.json`)).version,
  bundleSha256: hash(bundle), triageModuleSha256: hash(moduleSource), proVersion: pro.version,
  proBundleSha256: hash(fs.readFileSync(`${proRoot}/dist/index.js`)),
  checks: ['production module loads in isolation', 'threshold 0.7 boundary', 'question/payload v2',
    'clipped summary/user prompts', 'tool-name counts without outputs', 'no duplicated evidence',
    'bundled Pro 0.10.3 resolves; no source map'],
  limits: 'Read-only isolated module smoke; not an interactive Extension Host or licensed Pro smoke. No external model call.',
};
fs.writeFileSync(`${__dirname}/installed-inspection.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
