import * as assert from 'node:assert';
import { CopilotSession } from '../../src/sessionReader';
import { applySaveBloatControls, createChatSession } from '../../src/sessionWriter';
import { SourceChatSession } from '../../src/types';

function createSourceSession(turnCount = 2): CopilotSession {
	const turns = [] as CopilotSession['turns'];
	for (let index = 0; index < turnCount; index += 1) {
		turns.push({
			type: 'request',
			participant: 'copilot',
			prompt: `Prompt ${index + 1}`,
			references: index % 2 === 0 ? ['src/auth.ts'] : [],
			timestamp: `2026-04-12T10:${String(index).padStart(2, '0')}:00.000Z`,
		});
		turns.push({
			type: 'response',
			participant: 'copilot',
			content: `Response ${index + 1}`,
			toolCalls: [{ name: 'read_file', summary: 'src/auth.ts' }],
			timestamp: `2026-04-12T10:${String(index).padStart(2, '0')}:30.000Z`,
		});
	}

	return {
		provider: 'copilot',
		id: 'session-source',
		title: 'Source title',
		lastMessageDate: '2026-04-12T12:00:00.000Z',
		turns,
		sourceFile: 'source-file',
	};
}

suite('sessionWriter', () => {
	test('creates chat session with schema fields and generated title', () => {
		const source = createSourceSession(1);
		source.turns[0] = {
			type: 'request',
			participant: 'copilot',
			prompt: 'Fix login null pointer issue now please',
			references: [],
			timestamp: '2026-04-12T10:00:00.000Z',
		};

		const result = createChatSession(source, {
			git: { branch: 'main', commit: 'abcdef1234567890', dirty: true },
			savedAt: '2026-04-12T12:00:00.000Z',
			vscodeVersion: '1.115.0',
		});

		assert.equal(result.version, 1);
		assert.equal(result.id, 'session-source');
		assert.equal(result.provider, 'copilot');
		assert.equal(result.title, 'Fix login null pointer issue now please');
		assert.equal(result.totalTurns, source.turns.length);
		assert.equal(result.part, null);
		assert.equal(result.totalParts, null);
		assert.equal(result.markdownSummary.includes('# Chat: Fix login null pointer issue now please'), true);
	});

	test('records origin metadata only when it is supplied', () => {
		const source = createSourceSession(1);
		const legacyResult = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
		});
		const autoSaveResult = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
			origin: {
				saveKind: 'auto',
				sourceId: 'copilot-vscode',
				sourceSessionId: source.id,
				sourceRevision: 'sha256:abc123',
			},
		});

		assert.equal('origin' in legacyResult, false);
		assert.deepEqual(autoSaveResult.origin, {
			saveKind: 'auto',
			sourceId: 'copilot-vscode',
			sourceSessionId: 'session-source',
			sourceRevision: 'sha256:abc123',
		});
	});

	test('uses explicit title override when provided', () => {
		const source = createSourceSession(1);
		const result = createChatSession(source, {
			title: 'Custom Session Name',
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		assert.equal(result.title, 'Custom Session Name');
	});

	test('markdown summary includes metadata and tool call rendering', () => {
		const source = createSourceSession(1);
		const result = createChatSession(source, {
			git: { branch: 'feature/auth', commit: 'abcdef1234567890', dirty: false },
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		assert.equal(result.markdownSummary.includes('**Branch:** feature/auth | **Commit:** abcdef1'), true);
		assert.equal(result.markdownSummary.includes('### Turn 1 - User'), true);
		assert.equal(result.markdownSummary.includes('### Turn 2 - Copilot'), true);
		assert.equal(result.markdownSummary.includes('> **Tool calls:** read_file (src/auth.ts)'), true);
	});

	test('markdown summary labels Codex responses from the session provider', () => {
		const source: SourceChatSession = {
			...createSourceSession(1),
			provider: 'codex',
			turns: [
				{
					type: 'request',
					participant: 'user',
					prompt: 'Review the migration plan',
					references: [],
					timestamp: '2026-04-12T10:00:00.000Z',
				},
				{
					type: 'response',
					participant: 'codex',
					content: 'The migration looks safe if we preserve the current defaults.',
					toolCalls: [],
					timestamp: '2026-04-12T10:00:30.000Z',
				},
			],
		};

		const result = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		assert.equal(result.provider, 'codex');
		assert.equal(result.markdownSummary.includes('### Turn 2 - Codex'), true);
	});

	test('markdown summary labels Cursor responses from the session provider', () => {
		const source: SourceChatSession = {
			...createSourceSession(1),
			provider: 'cursor',
			turns: [
				{
					type: 'request',
					participant: 'user',
					prompt: 'Add Cursor session import',
					references: [],
					timestamp: '2026-04-12T10:00:00.000Z',
				},
				{
					type: 'response',
					participant: 'cursor',
					content: 'I can add a cursor provider that reads workspace chatSessions JSONL files.',
					toolCalls: [],
					timestamp: '2026-04-12T10:00:30.000Z',
				},
			],
		};

		const result = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		assert.equal(result.provider, 'cursor');
		assert.equal(result.markdownSummary.includes('### Turn 2 - Cursor'), true);
	});

	test('markdown summary limits turns and emits omission note', () => {
		const source = createSourceSession(30);
		const result = createChatSession(source, {
			summaryMaxTurns: 50,
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		assert.equal(result.totalTurns, 60);
		assert.equal(result.markdownSummary.includes('... 10 additional turns not shown in summary'), true);
	});

	test('markdown summary enforces max chars with truncation marker', () => {
		const source = createSourceSession(25);
		for (const turn of source.turns) {
			if (turn.type === 'request') {
				turn.prompt = `${turn.prompt} ${'x'.repeat(250)}`;
			} else {
				turn.content = `${turn.content} ${'y'.repeat(250)}`;
			}
		}

		const result = createChatSession(source, {
			summaryMaxChars: 1200,
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		assert.equal(result.markdownSummary.length <= 1250, true);
		assert.equal(result.markdownSummary.includes('... summary truncated ...') || result.markdownSummary.includes('... turns omitted ...'), true);
	});

	test('save bloat controls can strip tool output', () => {
		const source = createSourceSession(1);
		const responseTurn = source.turns.find((turn) => turn.type === 'response');
		if (responseTurn && responseTurn.type === 'response') {
			responseTurn.toolCalls = [{ name: 'run_in_terminal', output: 'x'.repeat(100), summary: 'npm test' }];
		}

		const session = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
		});

		const result = applySaveBloatControls(session, {
			maxFileSizeBytes: 10 * 1024,
			overflowStrategy: 'warn',
			stripToolOutput: true,
		});

		const stripped = result.sessions[0]?.turns.find((turn) => turn.type === 'response');
		assert.equal(stripped?.type, 'response');
		if (stripped?.type === 'response') {
			assert.equal(stripped.toolCalls[0]?.output, '[output stripped - 100 chars]');
		}
	});

	test('save bloat controls warn strategy keeps oversized session', () => {
		const source = createSourceSession(8);
		for (const turn of source.turns) {
			if (turn.type === 'request') {
				turn.prompt = `${turn.prompt} ${'p'.repeat(200)}`;
			} else {
				turn.content = `${turn.content} ${'r'.repeat(200)}`;
			}
		}

		const session = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
		});
		const result = applySaveBloatControls(session, {
			maxFileSizeBytes: 900,
			overflowStrategy: 'warn',
			stripToolOutput: false,
		});

		assert.equal(result.sessions.length, 1);
		assert.equal(result.warning?.includes('save.overflowStrategy=warn'), true);
		assert.equal(result.sessions[0]?.turns.length, session.turns.length);
	});

	test('save bloat controls truncateOldest removes early turns', () => {
		const source = createSourceSession(10);
		for (const turn of source.turns) {
			if (turn.type === 'request') {
				turn.prompt = `${turn.prompt} ${'a'.repeat(140)}`;
			} else {
				turn.content = `${turn.content} ${'b'.repeat(140)}`;
			}
		}

		const session = createChatSession(source, {
			savedAt: '2026-04-12T12:00:00.000Z',
		});
		const result = applySaveBloatControls(session, {
			maxFileSizeBytes: 700,
			overflowStrategy: 'truncateOldest',
			stripToolOutput: false,
		});

		assert.equal(result.sessions.length, 1);
		assert.equal((result.sessions[0]?.turns.length ?? 0) < session.turns.length, true);
		assert.equal(Boolean(result.warning), true);
	});

	test('save bloat controls split strategy creates linked auto-owned parts', () => {
		const source = createSourceSession(12);
		for (const turn of source.turns) {
			if (turn.type === 'request') {
				turn.prompt = `${turn.prompt} ${'m'.repeat(180)}`;
			} else {
				turn.content = `${turn.content} ${'n'.repeat(180)}`;
			}
		}

		const origin = {
			saveKind: 'auto' as const,
			sourceId: 'copilot-vscode',
			sourceSessionId: source.id,
			sourceRevision: 'sha256:split-revision',
		};
		const session = createChatSession(source, {
			title: 'Large Session',
			savedAt: '2026-04-12T12:00:00.000Z',
			origin,
		});
		const result = applySaveBloatControls(session, {
			maxFileSizeBytes: 1500,
			overflowStrategy: 'split',
			stripToolOutput: false,
		});

		assert.equal(result.sessions.length > 1, true);
		assert.equal(result.sessions.every((part) => part.totalParts === result.sessions.length), true);
		assert.equal(result.sessions[0]?.nextPartFile !== null, true);
		assert.equal(result.sessions[result.sessions.length - 1]?.previousPartFile !== null, true);
		for (const part of result.sessions) {
			assert.deepEqual(part.origin, origin);
		}
		assert.equal(result.warning?.includes('split into'), true);
	});
});
