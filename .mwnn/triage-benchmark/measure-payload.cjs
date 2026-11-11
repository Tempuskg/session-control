'use strict';
/**
 * Reproducible triage payload size comparison for card-mvq03qy7-2.
 * Compares the original evaluation shape (v1 builder + full-fixture summary)
 * against the revised production builder and de-duplicated fixture adapter.
 *
 * Does not call TypeSafe or claim model recall / financial savings.
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./library.bundle.cjs');

const root = path.resolve(__dirname, '../..');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

const MAX_EDGE = 1200;

function clip(text, max = MAX_EDGE) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toEdgeTurn(turn) {
  return turn.type === 'request'
    ? { role: 'user', text: clip(turn.prompt) }
    : { role: 'assistant', text: clip(turn.content), tools: turn.toolCalls.map((t) => t.name) };
}

/** Original production builder used by the 2026-10-26 evaluation (analysis-triage-v1). */
function buildLegacyAnalysisTriageState(candidate) {
  const turns = candidate.session.turns;
  const firstTurn = turns[0];
  const lastTurn = turns.length > 1 ? turns[turns.length - 1] : undefined;
  return {
    title: candidate.session.title,
    ...(candidate.session.provider ? { provider: candidate.session.provider } : {}),
    turnCount: turns.length,
    evidence: lib.buildSessionEvidence(candidate, 'summaryOnly'),
    ...(firstTurn ? { firstTurn: toEdgeTurn(firstTurn) } : {}),
    ...(lastTurn ? { lastTurn: toEdgeTurn(lastTurn) } : {}),
  };
}

function adapterCandidate(fixture, fingerprint, summaryMode) {
  const turns = [];
  for (const [i, prompt] of fixture.userPrompts.entries()) {
    turns.push({ type: 'request', prompt: prompt.text, participant: '', references: [], timestamp: '' });
    if (i === 0 && fixture.firstResponse) {
      turns.push({ type: 'response', content: fixture.firstResponse, participant: '', toolCalls: [], timestamp: '' });
    }
  }
  if (fixture.lastResponse) {
    turns.push({ type: 'response', content: fixture.lastResponse, participant: '', toolCalls: [], timestamp: '' });
  }
  let markdownSummary;
  if (summaryMode === 'full-fixture-json') {
    markdownSummary = `Redacted compact fixture; omitted turns and individual tool events are unavailable.\n${JSON.stringify(fixture)}`;
  } else {
    const parts = [
      'Redacted compact fixture; omitted turns and individual tool events are unavailable.',
      `Counts: ${JSON.stringify(fixture.counts)}`,
      `Tools: ${JSON.stringify(fixture.tools)}`,
    ];
    if (fixture.omittedUserPrompts) parts.push(`Omitted user prompts: ${fixture.omittedUserPrompts}`);
    markdownSummary = parts.join('\n');
  }
  return {
    workspaceName: 'redacted-evaluation',
    storageDirectory: '',
    fileName: `${fixture.id}.json`,
    rootFileName: `${fixture.id}.json`,
    fingerprint,
    session: {
      version: 1,
      id: fixture.id,
      title: fixture.title,
      savedAt: fixture.savedDate,
      provider: fixture.provider,
      git: null,
      vscodeVersion: '',
      totalTurns: fixture.counts.turns,
      part: null,
      totalParts: null,
      previousPartFile: null,
      nextPartFile: null,
      turns,
      markdownSummary,
    },
  };
}

/** Production-shaped sessions: short saved summary, tools on turns (not fixture JSON). */
function productionShapedCandidate(fixture) {
  const turns = [];
  for (const [i, prompt] of fixture.userPrompts.entries()) {
    turns.push({ type: 'request', prompt: prompt.text, participant: 'u', references: [], timestamp: 't' });
    const content = i === 0 && fixture.firstResponse
      ? fixture.firstResponse
      : (i === fixture.userPrompts.length - 1 && fixture.lastResponse
        ? fixture.lastResponse
        : `assistant reply ${i}`);
    const toolCalls = i % 2 === 0
      ? [{ name: 'run_in_terminal', output: 'secret' }, { name: 'readFile', output: '...' }]
      : [];
    turns.push({ type: 'response', content, participant: 'a', toolCalls, timestamp: 't' });
  }
  return {
    workspaceName: 'ws',
    storageDirectory: 's',
    fileName: `${fixture.id}.json`,
    rootFileName: `${fixture.id}.json`,
    fingerprint: fixture.id,
    session: {
      version: 1,
      id: fixture.id,
      title: fixture.title,
      savedAt: fixture.savedDate,
      provider: fixture.provider,
      git: null,
      vscodeVersion: '1',
      totalTurns: turns.length,
      part: null,
      totalParts: null,
      previousPartFile: null,
      nextPartFile: null,
      turns,
      markdownSummary: `# Chat Summary\nUser asked about ${fixture.title}. Agent used tools and completed tasks.`,
    },
  };
}

function measure(label, candidates, buildState) {
  const sizes = [];
  let total = 0;
  let evidenceOrSummary = 0;
  let edges = 0;
  for (const candidate of candidates) {
    const state = buildState(candidate);
    const encoded = JSON.stringify(state);
    sizes.push(encoded.length);
    total += encoded.length;
    evidenceOrSummary += JSON.stringify(state.evidence ?? state.summary ?? '').length;
    edges += JSON.stringify(state.firstTurn ?? null).length + JSON.stringify(state.lastTurn ?? null).length;
  }
  sizes.sort((a, b) => a - b);
  return {
    label,
    sessions: candidates.length,
    totalChars: total,
    avgChars: Math.round(total / candidates.length),
    medianChars: sizes[Math.floor(sizes.length / 2)],
    minChars: sizes[0],
    maxChars: sizes[sizes.length - 1],
    summaryOrEvidenceChars: evidenceOrSummary,
    edgeTurnChars: edges,
    questionChars: JSON.stringify(lib.ANALYSIS_TRIAGE_QUESTIONS).length,
  };
}

function pctReduction(before, after) {
  return `${(((before - after) / before) * 100).toFixed(2)}%`;
}

function main() {
  const request = read(path.join(root, '.mwnn/triage-evaluation-request.json'));
  const fixtures = request.fixtures.map((item) => {
    const absolute = path.resolve(root, item.path);
    return { fixture: read(absolute), fingerprint: item.sha256 };
  });

  const legacyFixtureCandidates = fixtures.map(({ fixture, fingerprint }) =>
    adapterCandidate(fixture, fingerprint, 'full-fixture-json'));
  const revisedFixtureCandidates = fixtures.map(({ fixture, fingerprint }) =>
    adapterCandidate(fixture, fingerprint, 'meta-only'));
  const productionShaped = fixtures.map(({ fixture }) => productionShapedCandidate(fixture));

  const rows = [
    measure('eval-v1: full-fixture adapter + legacy summaryOnly+edges builder', legacyFixtureCandidates, buildLegacyAnalysisTriageState),
    measure('adapter-only fix: meta summary + legacy builder', fixtures.map(({ fixture, fingerprint }) =>
      adapterCandidate(fixture, fingerprint, 'meta-only')), buildLegacyAnalysisTriageState),
    measure('eval-v2: revised adapter + triage-payload-v2 builder', revisedFixtureCandidates, (c) => lib.buildAnalysisTriageState(c)),
    measure('production-shaped: legacy summaryOnly+edges builder', productionShaped, buildLegacyAnalysisTriageState),
    measure('production-shaped: triage-payload-v2 builder', productionShaped, (c) => lib.buildAnalysisTriageState(c)),
  ];

  const result = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    questionSetVersionBefore: 'analysis-triage-v1',
    questionSetVersionAfter: lib.ANALYSIS_TRIAGE_QUESTION_SET_VERSION,
    payloadVersionAfter: lib.ANALYSIS_TRIAGE_PAYLOAD_VERSION,
    trivialSkipThreshold: lib.ANALYSIS_TRIAGE_TRIVIAL_THRESHOLD,
    note: 'Character counts of JSON-encoded triage state only. Not TypeSafe tokens, not billed cost, not recall.',
    rows,
    reductions: {
      fixtureEvalPath: {
        beforeLabel: rows[0].label,
        afterLabel: rows[2].label,
        beforeTotalChars: rows[0].totalChars,
        afterTotalChars: rows[2].totalChars,
        charReduction: pctReduction(rows[0].totalChars, rows[2].totalChars),
      },
      productionShapedPath: {
        beforeLabel: rows[3].label,
        afterLabel: rows[4].label,
        beforeTotalChars: rows[3].totalChars,
        afterTotalChars: rows[4].totalChars,
        charReduction: pctReduction(rows[3].totalChars, rows[4].totalChars),
      },
      adapterDuplicationIsolated: {
        beforeLabel: rows[0].label,
        afterLabel: rows[1].label,
        beforeTotalChars: rows[0].totalChars,
        afterTotalChars: rows[1].totalChars,
        charReduction: pctReduction(rows[0].totalChars, rows[1].totalChars),
        note: 'Same legacy builder; only fixture summary changed. This isolates adapter duplication from production builder overhead.',
      },
    },
  };

  const outPath = path.join(__dirname, 'payload-measurements.json');
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    wrote: path.relative(root, outPath),
    questionSetVersionAfter: result.questionSetVersionAfter,
    payloadVersionAfter: result.payloadVersionAfter,
    fixtureEvalCharReduction: result.reductions.fixtureEvalPath.charReduction,
    productionShapedCharReduction: result.reductions.productionShapedPath.charReduction,
    adapterOnlyCharReduction: result.reductions.adapterDuplicationIsolated.charReduction,
  }, null, 2));
}

if (require.main === module) {
  main();
}
module.exports = { buildLegacyAnalysisTriageState, adapterCandidate, measure };
