import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	deriveCursorAgentTranscriptsPath,
	deriveCursorProjectSlug,
	getDefaultCursorProjectsPath,
	normalizeCursorAgentTranscriptJsonl,
	readCursorAgentTranscriptSessions,
} from '../../src/cursorAgentTranscriptReader';

async function copyFixture(fixtureName: string, destinationPath: string): Promise<void> {
	const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
	const fixturePath = path.join(repositoryRoot, 'test', 'fixtures', 'cursor-agent-transcript', fixtureName);
	await fs.copyFile(fixturePath, destinationPath);
}

suite('cursorAgentTranscriptReader', () => {
	test('deriveCursorProjectSlug maps Windows workspace paths to Cursor project slugs', () => {
		assert.equal(deriveCursorProjectSlug('E:\\chat-commit'), 'e-chat-commit');
		assert.equal(deriveCursorProjectSlug('e:/chat-commit'), 'e-chat-commit');
		assert.equal(
			deriveCursorProjectSlug('E:\\Source\\Workspaces\\DogsDen\\Online\\DogsDen.Online'),
			'e-Source-Workspaces-DogsDen-Online-DogsDen-Online',
		);
	});

	test('getDefaultCursorProjectsPath points at ~/.cursor/projects', () => {
		const projectsPath = getDefaultCursorProjectsPath();
		assert.equal(projectsPath.endsWith(path.join('.cursor', 'projects')), true);
	});

	test('normalizeCursorAgentTranscriptJsonl maps user and assistant turns', () => {
		const fixturePath = path.resolve(
			__dirname,
			'..',
			'..',
			'..',
			'test',
			'fixtures',
			'cursor-agent-transcript',
			'sample-agent-session.jsonl',
		);

		return fs.readFile(fixturePath, 'utf8').then((content) => {
			const session = normalizeCursorAgentTranscriptJsonl(content, 'sample-agent-session', Date.parse('2026-06-07T12:00:00.000Z'));
			assert.ok(session);
			assert.equal(session?.provider, 'cursor');
			assert.equal(session?.title, 'Add Cursor session import support');
			assert.equal(session?.turns.length, 4);
			assert.equal(session?.turns[0]?.type, 'request');
			assert.equal((session?.turns[0] as { prompt: string }).prompt, 'Add Cursor session import support');
			assert.equal(session?.turns[1]?.type, 'response');
			const responseTurn = session?.turns[1];
			if (responseTurn?.type === 'response') {
				assert.equal(responseTurn.participant, 'cursor');
				assert.equal(responseTurn.toolCalls.length, 1);
				assert.equal(responseTurn.toolCalls[0]?.name, 'ReadFile');
			}
		});
	});

	test('reads agent transcript sessions for the matching Cursor project slug', async () => {
		const warnings: string[] = [];
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-agent-'));
		const repoPath = path.join(root, 'workspace', 'chat-commit');
		const sessionId = 'agent-session-1';
		const projectsRoot = path.join(root, '.cursor', 'projects');
		const projectSlug = deriveCursorProjectSlug(repoPath);
		const transcriptDirectory = path.join(
			deriveCursorAgentTranscriptsPath(projectsRoot, projectSlug),
			sessionId,
		);

		await fs.mkdir(transcriptDirectory, { recursive: true });
		await copyFixture('sample-agent-session.jsonl', path.join(transcriptDirectory, `${sessionId}.jsonl`));

		try {
			const sessions = await readCursorAgentTranscriptSessions(
				repoPath,
				projectsRoot,
				async (filePath: string) => fs.readFile(filePath, 'utf8'),
				(message: string) => {
					warnings.push(message);
				},
			);

			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.id, sessionId);
			assert.equal(sessions[0]?.provider, 'cursor');
			assert.equal(sessions[0]?.title, 'Add Cursor session import support');
			assert.equal(warnings.length, 0);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
