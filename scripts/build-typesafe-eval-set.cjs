#!/usr/bin/env node
/**
 * Builds the redacted TypeSafe evaluation fixtures in test/fixtures/typesafe/sessions/
 * from real saved sessions in the local .chat/ folder (which is gitignored).
 *
 * Usage (PowerShell):  node .\scripts\build-typesafe-eval-set.cjs [--source .chat]
 *
 * Labels live in test/fixtures/typesafe/labels.json and are hand-authored; this script
 * never writes them. Selection is a fixed list of source-session id prefixes so eval ids
 * stay stable across rebuilds. The raw source ids are not written to the fixtures.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sourceArgIndex = process.argv.indexOf('--source');
const sourceDir = path.resolve(repoRoot, sourceArgIndex > 0 ? process.argv[sourceArgIndex + 1] : '.chat');
const outDir = path.join(repoRoot, 'test', 'fixtures', 'typesafe', 'sessions');

/** Source-session id prefixes (origin.sourceSessionId or id), in eval-id order. */
const SELECTION = [
	'2ecd9103-da2', 'b4355503-719', 'f24a6bf4-762', '916a0b63-fbe', '22347285-46d',
	'e200df4e-9f1', '24e7f7d1-e52', '71a008c3-f13', '00f6d323-4f3', 'a75461a3-0a0',
	'be79ac8d-953', '17734f0e-bc7', '3eb0bb5c-784', '1843465c-d55', '84a4c0f6-321',
	'56f6866b-70f', '73011911-92b', '2d805cbf-e39', '8fa621fd-708', 'ea28c376-ca7',
	'8fed8aff-0c6', '84c55ddb-827', '035232c7-b31', '78377d24-c17', '49e5483e-e0e',
	'019e9d60-b3e', '019ee57b-c24', '019eea91-ffd', '019eebad-ab2', '019fb398-9bb',
	'019eead9-e6c', '019fe29c-646', '75f596ce-1ca', '87196b86-401', '5aa0e654-a09',
	'56879680-464', 'e42bc4f8-f40', '44c8b4fe-3be', 'd39364b2-044', '4386faea-0f8',
	'39737be0-294', 'a931ce6b-dd8', '215865db-f96', 'b2d743dd-332',
];

const LIMITS = {
	promptChars: 600,
	edgeResponseChars: 900,
	maxPrompts: 30,
	toolSummaryChars: 200,
	maxErrorSamples: 6,
	titleChars: 120,
};

const ERROR_PATTERN = /\b(error|failed|failure|exception|ENOENT|EACCES|not found|cannot find|exit code [1-9]\d*|exited with code [1-9]\d*|command not found|is not recognized)\b/i;

/** Wrapper blocks that agents inject into user turns; they carry no user intent. */
const WRAPPER_BLOCKS = [
	/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi,
	/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi,
	/<environment_context>[\s\S]*?<\/environment_context>/gi,
	/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi,
	/<system-reminder>[\s\S]*?<\/system-reminder>/gi,
	/<user_info>[\s\S]*?<\/user_info>/gi,
	/<rules>[\s\S]*?<\/rules>/gi,
	/<agent_skills>[\s\S]*?<\/agent_skills>/gi,
	/<attached_files>[\s\S]*?<\/attached_files>/gi,
	/<git_status>[\s\S]*?<\/git_status>/gi,
	/<task-notification>[\s\S]*?<\/task-notification>/gi,
	/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/gi,
	/<ide_selection>[\s\S]*?<\/ide_selection>/gi,
	/<command-(name|message|args)>[\s\S]*?<\/command-\1>/gi,
	/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi,
];

/** Read-only tools whose output often quotes the word "error" without anything failing. */
const READ_ONLY_TOOL = /read|fetch|grep|search|find|glob|list|view/i;

/**
 * Ordered redaction rules. Personal identifiers first, then credentials, then
 * high-entropy identifiers that could be tokens.
 */
const REDACTIONS = [
	[/([A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+)[^\\/\s"'`<>]+/gi, '$1<user>'],
	[/(\/(?:home|Users)\/)[^/\s"'`<>]+/g, '$1<user>'],
	[/[A-Za-z0-9._%+-]+(?:@|&)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
	[/darren\s*j?\.?\s*mcleod/gi, '<user>'],
	[/darrenjmcleod/gi, '<publisher>'],
	[/tempuskg/gi, '<owner>'],
	[/\bmcleod\b/gi, '<user>'],
	[/\bdarren?\b/gi, '<user>'],
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<private-key>'],
	[/\b(?:sk|pk|rk)-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, '<secret>'],
	[/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '<secret>'],
	[/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '<secret>'],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '<secret>'],
	[/\bAKIA[0-9A-Z]{16}\b/g, '<secret>'],
	[/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, '<secret>'],
	[/\b(?:acct|whsec|polar_[a-z]+)_[A-Za-z0-9]{10,}/g, '<secret>'],
	[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<jwt>'],
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 <secret>'],
	[/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pat)["']?\s*[:=]\s*["']?)(?!<)[^\s"',;]{8,}/gi, '$1<secret>'],
	[/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
	[/\b[0-9a-f]{32,}\b/gi, '<hash>'],
	[/\b(?![0-9a-f]+\b)[A-Za-z0-9+/_-]{48,}={0,2}/g, '<blob>'],
	[/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
];

function redact(text) {
	let out = String(text ?? '');
	for (const [pattern, replacement] of REDACTIONS) {
		out = out.replace(pattern, replacement);
	}
	return out;
}

function stripWrappers(text) {
	let out = String(text ?? '');
	for (const pattern of WRAPPER_BLOCKS) {
		out = out.replace(pattern, ' ');
	}
	const codexRequest = out.match(/## My request for Codex:\s*([\s\S]*)$/i);
	if (codexRequest) out = codexRequest[1];
	return out.replace(/# AGENTS\.md instructions for [^\n]*/gi, ' ');
}

function clip(text, max) {
	const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function prep(text, max) {
	return clip(redact(stripWrappers(text)), max);
}

function familyKey(session) {
	return (session.origin && session.origin.sourceSessionId) || session.id;
}

/** Keeps the most complete copy of each conversation; later split parts lose to part 1. */
function loadFamilies() {
	const families = new Map();
	for (const fileName of fs.readdirSync(sourceDir)) {
		if (!fileName.endsWith('.json')) continue;
		let session;
		try {
			session = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), 'utf8'));
		} catch {
			continue;
		}
		if (!session || !Array.isArray(session.turns) || typeof session.id !== 'string') continue;
		const key = familyKey(session);
		const score = session.turns.length + (session.part && session.part > 1 ? -1000 : 0);
		const current = families.get(key);
		if (!current || score > current.score) families.set(key, { score, session });
	}
	return families;
}

function toolStats(turns) {
	const byName = {};
	let total = 0;
	let errorLike = 0;
	let maxErrorStreak = 0;
	let streak = 0;
	let maxRepeatStreak = 0;
	let repeat = 0;
	let previousSignature = '';
	const errorSamples = [];
	for (const turn of turns) {
		if (turn.type !== 'response' || !Array.isArray(turn.toolCalls)) continue;
		for (const call of turn.toolCalls) {
			total += 1;
			const name = redact(call.name || 'unknown');
			byName[name] = (byName[name] || 0) + 1;
			const signature = `${call.name}|${call.arguments || call.summary || ''}`;
			repeat = signature === previousSignature ? repeat + 1 : 1;
			previousSignature = signature;
			maxRepeatStreak = Math.max(maxRepeatStreak, repeat);
			const haystack = `${call.summary || ''}\n${(call.output || '').slice(0, 300)}`;
			if (!READ_ONLY_TOOL.test(call.name || '') && ERROR_PATTERN.test(haystack)) {
				errorLike += 1;
				streak += 1;
				maxErrorStreak = Math.max(maxErrorStreak, streak);
				if (errorSamples.length < LIMITS.maxErrorSamples) {
					errorSamples.push(`${name}: ${prep(call.summary || call.output || '', LIMITS.toolSummaryChars)}`);
				}
			} else {
				streak = 0;
			}
		}
	}
	const topTools = Object.fromEntries(Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 8));
	return { total, errorLike, maxErrorStreak, maxRepeatStreak, topTools, errorSamples };
}

function samplePrompts(requests) {
	const prompts = requests
		.map((turn, index) => ({ index, text: prep(turn.prompt, LIMITS.promptChars) }))
		.filter((entry) => entry.text.length > 0);
	if (prompts.length <= LIMITS.maxPrompts) return { prompts, omitted: 0 };
	const head = prompts.slice(0, 10);
	const tail = prompts.slice(-(LIMITS.maxPrompts - 10));
	return { prompts: [...head, ...tail], omitted: prompts.length - head.length - tail.length };
}

function buildFixture(evalId, session) {
	const turns = session.turns;
	const requests = turns.filter((turn) => turn.type === 'request');
	const responses = turns.filter((turn) => turn.type === 'response');
	const { prompts, omitted } = samplePrompts(requests);
	const firstResponse = responses[0];
	const lastResponse = responses[responses.length - 1];
	const rawTitle = String(session.title || '');
	const title = /^\s*(<|# AGENTS\.md|# Context from my IDE)/i.test(rawTitle) || prep(rawTitle, LIMITS.titleChars).length === 0
		? clip(prompts[0] ? prompts[0].text : '(untitled)', 80)
		: prep(rawTitle, LIMITS.titleChars);
	return {
		schemaVersion: 1,
		id: evalId,
		sourceKey: crypto.createHash('sha256').update(familyKey(session)).digest('hex').slice(0, 12),
		provider: session.provider || 'copilot',
		title,
		savedDate: String(session.savedAt || '').slice(0, 10),
		split: session.part ? { part: session.part, totalParts: session.totalParts } : null,
		counts: {
			turns: turns.length,
			requests: requests.length,
			responses: responses.length,
		},
		tools: toolStats(turns),
		userPrompts: prompts,
		omittedUserPrompts: omitted,
		firstResponse: firstResponse ? prep(firstResponse.content, LIMITS.edgeResponseChars) : '',
		lastResponse: lastResponse && lastResponse !== firstResponse ? prep(lastResponse.content, LIMITS.edgeResponseChars) : '',
	};
}

function main() {
	if (!fs.existsSync(sourceDir)) {
		console.error(`Source folder not found: ${sourceDir}`);
		process.exit(1);
	}
	const families = loadFamilies();
	const keys = [...families.keys()];
	fs.mkdirSync(outDir, { recursive: true });
	for (const stale of fs.readdirSync(outDir)) {
		if (/^eval-\d+\.json$/.test(stale)) fs.rmSync(path.join(outDir, stale));
	}
	let written = 0;
	SELECTION.forEach((prefix, index) => {
		const matches = keys.filter((key) => key.startsWith(prefix));
		if (matches.length !== 1) {
			console.error(`Selection ${prefix}: expected 1 match, found ${matches.length}`);
			process.exitCode = 1;
			return;
		}
		const evalId = `eval-${String(index + 1).padStart(2, '0')}`;
		const fixture = buildFixture(evalId, families.get(matches[0]).session);
		fs.writeFileSync(path.join(outDir, `${evalId}.json`), `${JSON.stringify(fixture, null, '\t')}\n`);
		written += 1;
	});
	console.log(`Wrote ${written} fixtures to ${path.relative(repoRoot, outDir)}`);
}

main();
