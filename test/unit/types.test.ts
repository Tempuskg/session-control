import * as assert from 'node:assert';
import {
	isChatSession,
	isGitContext,
	isRequestTurn,
	isResponseTurn,
	isToolCall,
} from '../../src/types';

suite('types guards', () => {
	test('isGitContext accepts valid git data', () => {
		assert.equal(
			isGitContext({ branch: 'main', commit: 'abc123', dirty: false }),
			true,
		);
	});

	test('isToolCall validates optional fields', () => {
		assert.equal(
			isToolCall({ name: 'read_file', summary: 'Read src/index.ts' }),
			true,
		);
		assert.equal(
			isToolCall({ name: 'run_in_terminal', output: 12 }),
			false,
		);
	});

	test('request/response turn guards reject invalid shapes', () => {
		assert.equal(
			isRequestTurn({
				type: 'request',
				participant: 'copilot',
				prompt: 'hello',
				references: ['src/file.ts'],
				timestamp: '2026-04-12T12:00:00.000Z',
			}),
			true,
		);

		assert.equal(
			isResponseTurn({
				type: 'response',
				participant: 'copilot',
				content: 'done',
				toolCalls: [{ name: 'read_file' }],
				timestamp: '2026-04-12T12:00:00.000Z',
			}),
			true,
		);

		assert.equal(
			isResponseTurn({
				type: 'response',
				participant: 'copilot',
				content: 'done',
				toolCalls: [{ wrong: 'shape' }],
				timestamp: '2026-04-12T12:00:00.000Z',
			}),
			false,
		);
	});

	test('isChatSession validates required schema', () => {
		const valid = {
			version: 1,
			id: 'session-1',
			title: 'Fix auth bug',
			savedAt: '2026-04-12T12:00:00.000Z',
			git: { branch: 'main', commit: 'abc123', dirty: false },
			vscodeVersion: '1.93.0',
			totalTurns: 2,
			part: null,
			totalParts: null,
			previousPartFile: null,
			nextPartFile: null,
			turns: [
				{
					type: 'request',
					participant: 'copilot',
					prompt: 'help',
					references: [],
					timestamp: '2026-04-12T12:00:00.000Z',
				},
				{
					type: 'response',
					participant: 'copilot',
					content: 'sure',
					toolCalls: [],
					timestamp: '2026-04-12T12:01:00.000Z',
				},
			],
			markdownSummary: '# Chat: Fix auth bug',
		};

		assert.equal(isChatSession(valid), true);
		assert.equal(isChatSession({ ...valid, savedAt: 'not-a-date' }), false);
		assert.equal(isChatSession({ ...valid, turns: [{ type: 'bad' }] }), false);
	});
});
