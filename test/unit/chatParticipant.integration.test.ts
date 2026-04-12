import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildResumePrompt, renderSessionListMarkdown, selectSessionForResume } from '../../src/chatParticipant';
import { createSessionStore } from '../../src/sessionStore';
import { createChatSession } from '../../src/sessionWriter';
import { CopilotSession } from '../../src/sessionReader';

function createCopilotSession(): CopilotSession {
	return {
		id: 'resume-roundtrip',
		title: 'Resume Round Trip',
		lastMessageDate: '2026-04-12T13:00:00.000Z',
		sourceFile: 'resume-roundtrip',
		turns: [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'First user question about auth bug.',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'First assistant answer with initial diagnosis.',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'Second user question with reproduction steps.',
				references: ['src/auth.ts'],
				timestamp: '2026-04-12T12:02:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'Second assistant answer proposing token refresh fix.',
				toolCalls: [],
				timestamp: '2026-04-12T12:03:00.000Z',
			},
		],
	};
}

suite('chatParticipant integration', () => {
	test('resume round-trip persists, matches, reloads, and builds constrained prompt', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-commit-chat-participant-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const saved = createChatSession(createCopilotSession(), {
				title: 'Fix auth bug',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
				git: {
					branch: 'main',
					commit: 'abcdef1234567890',
					dirty: false,
				},
			});

			const fileName = await store.writeSession(storageDirectory, saved);
			const listed = await store.listSessions(storageDirectory);

			assert.equal(listed.length, 1);
			assert.equal(listed[0]?.fileName, fileName);

			const selection = selectSessionForResume('fix auth', listed);
			assert.equal(selection.session?.fileName, fileName);

			const restored = await store.readSession(storageDirectory, fileName);
			const prompt = buildResumePrompt(restored, 'What should I patch first?', 3, 150);

			assert.equal(prompt.includes('User follow-up: What should I patch first?'), true);
			assert.equal(prompt.includes('Second user question with reproduction steps.'), true);
			assert.equal(prompt.includes('Second assistant answer proposing token refresh fix.'), true);
			assert.equal(prompt.includes('First user question about auth bug.'), false);

			const listMarkdown = renderSessionListMarkdown(listed);
			assert.equal(listMarkdown.includes('## Saved Sessions'), true);
			assert.equal(listMarkdown.includes('Fix auth bug'), true);
			assert.equal(listMarkdown.includes('main@abcdef1'), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});
