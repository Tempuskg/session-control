import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixtureRoot = path.join(path.resolve(__dirname, '..', '..', '..'), 'test', 'fixtures', 'typesafe');
const sessionsDir = path.join(fixtureRoot, 'sessions');

const INTENTS = ['implement', 'debug', 'plan', 'question', 'release', 'analyze', 'automation', 'chitchat'] as const;
const ROUTE_INTENTS = ['resume', 'list', 'analyze', 'implement', 'none'] as const;

interface EvalLabel {
	id: string;
	intent: string;
	routeIntent: string;
	worthAnalyzing: boolean;
	friction: number;
	toolFailureLoops: number;
	trivial: boolean;
	rationale: string;
}

interface EvalLabelsFile {
	schemaVersion: number;
	sessions: EvalLabel[];
}

/** Patterns that must never appear in committed fixtures. */
const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
	['user profile path', /[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+(?!<user>)[^\\/\s"'<>]+/i],
	['home path', /\/(?:home|Users)\/(?!<user>)[A-Za-z0-9._-]+\//],
	['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/],
	['owner name', /darren|mcleod|tempuskg/i],
	['OpenAI/Anthropic key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/],
	['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
	['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
	['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
	['Stripe key', /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/],
	['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
	['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['bearer credential', /\bBearer\s+(?!<secret>)[A-Za-z0-9._~+/=-]{12,}/],
	['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
];

function readLabels(): EvalLabelsFile {
	return JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'labels.json'), 'utf8')) as EvalLabelsFile;
}

function sessionFiles(): string[] {
	return fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.json')).sort();
}

suite('typesafe/evaluation set', () => {
	test('contains 30 to 50 redacted sessions', () => {
		const files = sessionFiles();
		assert.ok(files.length >= 30 && files.length <= 50, `expected 30–50 sessions, found ${files.length}`);
		for (const file of files) {
			const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')) as { id: string; userPrompts: unknown[] };
			assert.strictEqual(`${session.id}.json`, file, `${file} id mismatch`);
			assert.ok(Array.isArray(session.userPrompts), `${file} has no userPrompts`);
		}
	});

	test('labels every session exactly once with valid dimensions', () => {
		const labels = readLabels();
		assert.strictEqual(labels.schemaVersion, 1);
		const fileIds = sessionFiles().map((file) => file.replace(/\.json$/, ''));
		const labelIds = labels.sessions.map((label) => label.id);
		assert.deepStrictEqual([...labelIds].sort(), fileIds);
		assert.strictEqual(new Set(labelIds).size, labelIds.length, 'duplicate label ids');

		for (const label of labels.sessions) {
			assert.ok((INTENTS as readonly string[]).includes(label.intent), `${label.id} intent ${label.intent}`);
			assert.ok((ROUTE_INTENTS as readonly string[]).includes(label.routeIntent), `${label.id} routeIntent ${label.routeIntent}`);
			assert.strictEqual(typeof label.worthAnalyzing, 'boolean', `${label.id} worthAnalyzing`);
			assert.strictEqual(typeof label.trivial, 'boolean', `${label.id} trivial`);
			for (const score of [label.friction, label.toolFailureLoops]) {
				assert.ok(Number.isInteger(score) && score >= 0 && score <= 3, `${label.id} score ${score}`);
			}
			assert.ok(label.rationale.trim().length > 0, `${label.id} rationale`);
			assert.ok(!(label.trivial && label.worthAnalyzing), `${label.id} cannot be both trivial and worth analyzing`);
		}
	});

	test('labels cover both classes for threshold tuning', () => {
		const { sessions } = readLabels();
		const worth = sessions.filter((label) => label.worthAnalyzing).length;
		assert.ok(worth >= 5 && sessions.length - worth >= 5, `unbalanced worthAnalyzing split: ${worth}/${sessions.length}`);
		assert.ok(sessions.some((label) => label.trivial), 'no trivial examples');
		assert.ok(sessions.some((label) => label.toolFailureLoops >= 2), 'no tool-failure loop examples');
		assert.ok(sessions.some((label) => label.friction >= 2), 'no high-friction examples');
	});

	test('fixtures contain no secrets or personal data', () => {
		const files = [path.join(fixtureRoot, 'labels.json'), ...sessionFiles().map((file) => path.join(sessionsDir, file))];
		for (const file of files) {
			const text = fs.readFileSync(file, 'utf8');
			for (const [name, pattern] of FORBIDDEN_PATTERNS) {
				const match = pattern.exec(text);
				assert.strictEqual(match, null, `${path.basename(file)} contains ${name}: ${match?.[0]}`);
			}
		}
	});
});
