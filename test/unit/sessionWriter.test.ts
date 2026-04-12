import * as assert from 'node:assert';
import { CopilotSession } from '../../src/sessionReader';
import { createChatSession } from '../../src/sessionWriter';

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
		assert.equal(result.title, 'Fix login null pointer issue now please');
		assert.equal(result.totalTurns, source.turns.length);
		assert.equal(result.part, null);
		assert.equal(result.totalParts, null);
		assert.equal(result.markdownSummary.includes('# Chat: Fix login null pointer issue now please'), true);
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
});
