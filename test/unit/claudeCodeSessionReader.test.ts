import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	createClaudeCodeSessionReader,
	deriveClaudeCodeProjectSlug,
	deriveClaudeCodeProjectsPath,
} from '../../src/claudeCodeSessionReader';

async function setupClaudeCodeHome(workspacePath = 'E:\\chat-commit'): Promise<{
	root: string;
	claudeCodeHomePath: string;
	projectDirectory: string;
	workspacePath: string;
}> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-claude-reader-'));
	const claudeCodeHomePath = path.join(root, '.claude');
	const projectDirectory = path.join(deriveClaudeCodeProjectsPath(claudeCodeHomePath), deriveClaudeCodeProjectSlug(workspacePath));
	await fs.mkdir(projectDirectory, { recursive: true });
	return { root, claudeCodeHomePath, projectDirectory, workspacePath };
}

function createClaudeCodeSessionJsonl(
	sessionId: string,
	timestampPrefix: string,
	cwd = 'E:\\chat-commit',
): string {
	return [
		JSON.stringify({
			type: 'user',
			sessionId,
			cwd,
			timestamp: `${timestampPrefix}:00.000Z`,
			message: {
				role: 'user',
				content: 'Implement the Claude provider',
			},
		}),
		JSON.stringify({
			type: 'assistant',
			sessionId,
			cwd,
			timestamp: `${timestampPrefix}:01.000Z`,
			message: {
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 'private reasoning' },
					{
						type: 'tool_use',
						id: `${sessionId}-tool-1`,
						name: 'Read',
						input: { file_path: 'src/extension.ts' },
					},
				],
			},
		}),
		JSON.stringify({
			type: 'user',
			sessionId,
			cwd,
			timestamp: `${timestampPrefix}:02.000Z`,
			message: {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: `${sessionId}-tool-1`,
						content: 'extension wiring found',
					},
				],
			},
		}),
		JSON.stringify({
			type: 'assistant',
			sessionId,
			cwd,
			timestamp: `${timestampPrefix}:03.000Z`,
			message: {
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Claude Code sessions now normalize cleanly.' },
				],
			},
		}),
		JSON.stringify({
			type: 'ai-title',
			sessionId,
			cwd,
			timestamp: `${timestampPrefix}:04.000Z`,
			aiTitle: 'Claude provider work',
		}),
		JSON.stringify({
			type: 'summary',
			sessionId,
			cwd,
			timestamp: `${timestampPrefix}:05.000Z`,
			summary: 'skip me',
		}),
	].join('\n');
}

suite('claudeCodeSessionReader', () => {
	test('derives Claude Code project paths from workspace paths', () => {
		assert.equal(deriveClaudeCodeProjectsPath(path.join('tmp', '.claude')).endsWith(path.join('.claude', 'projects')), true);
		assert.equal(deriveClaudeCodeProjectSlug('e:\\chat-commit'), 'e--chat-commit');
		assert.equal(deriveClaudeCodeProjectSlug('e:/chat-commit'), 'e--chat-commit');
		assert.equal(deriveClaudeCodeProjectSlug('/home/user/chat-commit'), '-home-user-chat-commit');
	});

	test('reads Claude Code JSONL sessions, pairs tool results, applies ai-title, and sorts by recency', async () => {
		const warnings: string[] = [];
		const setup = await setupClaudeCodeHome();

		try {
			await fs.writeFile(
				path.join(setup.projectDirectory, 'newer.jsonl'),
				createClaudeCodeSessionJsonl('newer-session', '2026-06-20T10:00'),
				'utf8',
			);
			await fs.writeFile(
				path.join(setup.projectDirectory, 'older.jsonl'),
				createClaudeCodeSessionJsonl('older-session', '2026-06-19T09:00'),
				'utf8',
			);
			await fs.writeFile(path.join(setup.projectDirectory, 'corrupt.jsonl'), '{not-json', 'utf8');

			const sessions = await createClaudeCodeSessionReader({
				showInformationMessage: async () => undefined,
				logWarning: (message) => {
					warnings.push(message);
				},
			}).readClaudeCodeSessions(setup.claudeCodeHomePath, setup.workspacePath);

			assert.equal(sessions.length, 2);
			assert.equal(sessions[0]?.provider, 'claude-code');
			assert.equal(sessions[0]?.id, 'newer-session');
			assert.equal(sessions[0]?.title, 'Claude provider work');
			assert.equal(sessions[0]?.cwd, 'E:\\chat-commit');
			assert.equal(sessions[0]?.turns.length, 2);
			assert.equal(sessions[0]?.turns[0]?.type, 'request');
			const responseTurn = sessions[0]?.turns[1];
			assert.equal(responseTurn?.type, 'response');
			if (responseTurn?.type === 'response') {
				assert.equal(responseTurn.participant, 'claude-code');
				assert.equal(responseTurn.content, 'Claude Code sessions now normalize cleanly.');
				assert.equal(responseTurn.toolCalls.length, 1);
				assert.equal(responseTurn.toolCalls[0]?.name, 'Read');
				assert.equal(responseTurn.toolCalls[0]?.arguments, '{"file_path":"src/extension.ts"}');
				assert.equal(responseTurn.toolCalls[0]?.output, 'extension wiring found');
			}
			assert.equal(warnings.some((message) => message.includes('corrupt.jsonl')), true);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});

	test('skips sidechain records and subagent transcript files', async () => {
		const setup = await setupClaudeCodeHome();
		const sidechainPath = path.join(setup.projectDirectory, 'sidechain.jsonl');
		const subagentPath = path.join(setup.projectDirectory, 'main-session', 'subagents', 'agent-1.jsonl');

		try {
			await fs.mkdir(path.dirname(subagentPath), { recursive: true });
			await fs.writeFile(
				sidechainPath,
				JSON.stringify({
					type: 'user',
					isSidechain: true,
					sessionId: 'sidechain',
					cwd: setup.workspacePath,
					timestamp: '2026-06-20T10:00:00.000Z',
					message: { role: 'user', content: 'Skip this sidechain' },
				}),
				'utf8',
			);
			await fs.writeFile(
				subagentPath,
				createClaudeCodeSessionJsonl('subagent-session', '2026-06-20T10:00'),
				'utf8',
			);

			const sessions = await createClaudeCodeSessionReader({
				listFiles: async () => [sidechainPath, subagentPath],
				showInformationMessage: async () => undefined,
				logWarning: () => undefined,
			}).readClaudeCodeSessions(setup.claudeCodeHomePath, setup.workspacePath);

			assert.deepEqual(sessions, []);
		} finally {
			await fs.rm(setup.root, { recursive: true, force: true });
		}
	});
});
