import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCodexSessionReader, deriveCodexSessionsPath } from '../../src/codexSessionReader';

async function setupCodexHome(): Promise<{
	root: string;
	codexHomePath: string;
	sessionsDirectory: string;
}> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-codex-reader-'));
	const codexHomePath = path.join(root, '.codex');
	const sessionsDirectory = deriveCodexSessionsPath(codexHomePath);
	await fs.mkdir(sessionsDirectory, { recursive: true });
	return { root, codexHomePath, sessionsDirectory };
}

function createCodexSessionJsonl(id: string, prompt: string, response: string, timestampPrefix: string): string {
	return [
		JSON.stringify({
			timestamp: `${timestampPrefix}:00.000Z`,
			type: 'session_meta',
			payload: {
				id,
				timestamp: `${timestampPrefix}:00.000Z`,
			},
		}),
		JSON.stringify({
			timestamp: `${timestampPrefix}:01.000Z`,
			type: 'event_msg',
			payload: {
				type: 'user_message',
				message: prompt,
			},
		}),
		JSON.stringify({
			timestamp: `${timestampPrefix}:02.000Z`,
			type: 'response_item',
			payload: {
				type: 'function_call',
				call_id: `${id}-call-1`,
				name: 'shell_command',
				arguments: {
					command: 'rg -n "auth" src',
				},
			},
		}),
		JSON.stringify({
			timestamp: `${timestampPrefix}:03.000Z`,
			type: 'response_item',
			payload: {
				type: 'function_call_output',
				call_id: `${id}-call-1`,
				output: 'src/auth.ts:12: missing refresh guard',
			},
		}),
		JSON.stringify({
			timestamp: `${timestampPrefix}:04.000Z`,
			type: 'response_item',
			payload: {
				type: 'message',
				role: 'assistant',
				content: [
					{
						type: 'output_text',
						text: response,
					},
				],
			},
		}),
		JSON.stringify({
			timestamp: `${timestampPrefix}:05.000Z`,
			type: 'event_msg',
			payload: {
				type: 'agent_message',
				message: response,
			},
		}),
	].join('\n');
}

suite('codexSessionReader', () => {
	test('deriveCodexSessionsPath appends sessions to the Codex home directory', () => {
		const result = deriveCodexSessionsPath(path.join('tmp', '.codex'));
		assert.equal(result.endsWith(path.join('.codex', 'sessions')), true);
	});

	test('reads Codex JSONL sessions, sorts by recency, and skips corrupt files', async () => {
		const warnings: string[] = [];
		const infoMessages: string[] = [];
		const setup = await setupCodexHome();

		try {
			const newerDirectory = path.join(setup.sessionsDirectory, '2026', '06', '03');
			const olderDirectory = path.join(setup.sessionsDirectory, '2026', '06', '02');
			await fs.mkdir(newerDirectory, { recursive: true });
			await fs.mkdir(olderDirectory, { recursive: true });

			await fs.writeFile(
				path.join(newerDirectory, 'newer-session.jsonl'),
				createCodexSessionJsonl(
					'codex-session-newer',
					'Help me refactor auth middleware',
					'I found the middleware and can simplify the null checks.',
					'2026-06-03T10:00',
				),
				'utf8',
			);
			await fs.writeFile(
				path.join(olderDirectory, 'older-session.jsonl'),
				createCodexSessionJsonl(
					'codex-session-older',
					'Review the migration plan',
					'The migration is safe if we keep the current defaults.',
					'2026-06-02T09:15',
				),
				'utf8',
			);
			await fs.writeFile(path.join(newerDirectory, 'corrupt-session.jsonl'), '{not-json', 'utf8');

			const reader = createCodexSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				logWarning: (message: string) => {
					warnings.push(message);
				},
			});

			const sessions = await reader.readCodexSessions(setup.codexHomePath);
			assert.equal(sessions.length, 2);
			assert.equal(sessions[0]?.provider, 'codex');
			assert.equal(sessions[0]?.id, 'codex-session-newer');
			assert.equal(sessions[0]?.title, 'Help me refactor auth middleware');
			assert.equal(sessions[0]?.turns.length, 2);
			assert.equal(sessions[0]?.turns[0]?.type, 'request');
			const responseTurn = sessions[0]?.turns[1];
			assert.equal(responseTurn?.type, 'response');
			if (responseTurn?.type === 'response') {
				assert.equal(responseTurn.participant, 'codex');
				assert.equal(responseTurn.toolCalls.length, 1);
				assert.equal(responseTurn.toolCalls[0]?.name, 'shell_command');
				assert.equal(responseTurn.toolCalls[0]?.output, 'src/auth.ts:12: missing refresh guard');
			}
			assert.equal(warnings.some((message) => message.includes('corrupt-session.jsonl')), true);
			assert.equal(infoMessages.length, 0);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});

	test('returns empty and shows an info message when the Codex sessions directory is missing', async () => {
		const infoMessages: string[] = [];
		const setup = await setupCodexHome();

		try {
			await fs.rm(setup.sessionsDirectory, { recursive: true, force: true });

			const reader = createCodexSessionReader({
				showInformationMessage: async (message: string) => {
					infoMessages.push(message);
				},
				logWarning: () => undefined,
			});

			const sessions = await reader.readCodexSessions(setup.codexHomePath);
			assert.equal(sessions.length, 0);
			assert.equal(infoMessages[0], `No Codex sessions found in ${setup.sessionsDirectory}.`);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});
});
