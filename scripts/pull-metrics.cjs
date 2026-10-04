#!/usr/bin/env node
/*
 * Pull the weekly success metrics from public APIs and print (or append) a row
 * for docs/metrics-log.md, with deltas against the previous row.
 *
 *   node scripts/pull-metrics.cjs [--pro <n>] [--note "<text>"] [--append] [--date YYYY-MM-DD]
 *
 * Sources: Open VSX API, VS Marketplace extensionquery API, GitHub REST API.
 * Pro customers are read by hand from Polar.sh. No extension telemetry is involved.
 * Set GITHUB_TOKEN to avoid the unauthenticated GitHub rate limit if needed.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PUBLISHER = 'darrenjmcleod';
const EXTENSION = 'session-control';
const GITHUB_REPO = 'tempuskg/session-control';
const LOG_PATH = path.join(__dirname, '..', 'docs', 'metrics-log.md');

// Column order must match the log table header (Date first, Notes last).
const METRICS = ['openVsxDownloads', 'marketplaceInstalls', 'marketplaceDownloads', 'githubStars', 'openVsxReviews', 'proCustomers'];

function parseArgs(argv) {
  const args = { append: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--append') args.append = true;
    else if (arg === '--pro') args.pro = Number(argv[++i]);
    else if (arg === '--note') args.note = argv[++i];
    else if (arg === '--date') args.date = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.pro !== undefined && !Number.isInteger(args.pro)) throw new Error('--pro needs a whole number');
  return args;
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchOpenVsx() {
  const data = await getJson(`https://open-vsx.org/api/${PUBLISHER}/${EXTENSION}`);
  return { openVsxDownloads: data.downloadCount, openVsxReviews: data.reviewCount ?? 0 };
}

async function fetchMarketplace() {
  const data = await getJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
    // filterType 7 = extension name; flag 256 = include statistics.
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: `${PUBLISHER}.${EXTENSION}` }] }], flags: 256 }),
  });
  const ext = data.results?.[0]?.extensions?.[0];
  if (!ext) throw new Error('Marketplace returned no extension');
  const stat = (name) => Math.round(ext.statistics?.find((s) => s.statisticName === name)?.value ?? NaN);
  return { marketplaceInstalls: stat('install'), marketplaceDownloads: stat('downloadCount') };
}

async function fetchGitHub() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'session-control-metrics' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const data = await getJson(`https://api.github.com/repos/${GITHUB_REPO}`, { headers });
  return { githubStars: data.stargazers_count };
}

/** Cumulative values from the last data row of the log table. */
function readPreviousRow(log) {
  const rows = log.split(/\r?\n/).filter((line) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line));
  const last = rows.at(-1);
  if (!last) return undefined;
  const cells = last.split('|').slice(1, -1).map((c) => c.trim());
  const prev = { date: cells[0] };
  METRICS.forEach((key, i) => {
    const match = /^([\d,]+)/.exec(cells[i + 1] ?? '');
    prev[key] = match ? Number(match[1].replace(/,/g, '')) : undefined;
  });
  return prev;
}

function formatCell(value, previous) {
  if (value === undefined || Number.isNaN(value)) return '?';
  const total = value.toLocaleString('en-US');
  if (previous === undefined) return `${total} (n/a)`;
  const delta = value - previous;
  return `${total} (${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [openVsx, marketplace, github] = await Promise.all([fetchOpenVsx(), fetchMarketplace(), fetchGitHub()]);
  const current = { ...openVsx, ...marketplace, ...github, proCustomers: args.pro };

  const log = fs.readFileSync(LOG_PATH, 'utf8');
  const prev = readPreviousRow(log) ?? {};
  const date = args.date ?? new Date().toISOString().slice(0, 10);
  if (prev.date === date && args.append) throw new Error(`The log already has a row for ${date}`);

  const cells = METRICS.map((key) => formatCell(current[key], prev[key]));
  const note = (args.note ?? '').replace(/\|/g, '\\|');
  const row = `| ${date} | ${cells.join(' | ')} | ${note} |`;

  console.log(`Previous row: ${prev.date ?? 'none'}`);
  console.log(row);
  if (args.append) {
    fs.writeFileSync(LOG_PATH, log.replace(/\s*$/, '\n') + row + '\n');
    console.log(`Appended to ${path.relative(process.cwd(), LOG_PATH)}`);
  }
}

main().catch((err) => {
  console.error(`pull-metrics failed: ${err.message}`);
  process.exit(1);
});
