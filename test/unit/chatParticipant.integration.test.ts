import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	buildResumePrompt,
	createAnalysisCandidates,
	loadReassembledSession,
	renderSessionListMarkdown,
	selectSessionForResume,
} from '../../src/chatParticipant';
import { createSessionStore } from '../../src/sessionStore';
import { applySaveBloatControls, createChatSession } from '../../src/sessionWriter';
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
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-chat-participant-'));
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

	test('buildResumePrompt applies summarize and recent-only overflow strategies', () => {
		const saved = createChatSession(createCopilotSession(), {
			title: 'Overflow Session',
			savedAt: '2026-04-12T13:00:00.000Z',
			vscodeVersion: '1.115.0',
		});

		const summarizePrompt = buildResumePrompt(saved, 'Continue please', 2, 200, 'summarize');
		const recentOnlyPrompt = buildResumePrompt(saved, 'Continue please', 2, 200, 'recent-only');

		assert.equal(summarizePrompt.includes('Summary of omitted context:'), true);
		assert.equal(recentOnlyPrompt.includes('Earlier turns omitted ('), true);
	});

	test('loadReassembledSession rebuilds full turns from split part chain', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-chat-participant-reassembly-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			const source = createCopilotSession();
			for (const turn of source.turns) {
				if (turn.type === 'request') {
					turn.prompt = `${turn.prompt} ${'x'.repeat(240)}`;
				} else {
					turn.content = `${turn.content} ${'y'.repeat(240)}`;
				}
			}

			const saved = createChatSession(source, {
				title: 'Split Resume Session',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			});

			const split = applySaveBloatControls(saved, {
				maxFileSizeBytes: 1400,
				overflowStrategy: 'split',
				stripToolOutput: false,
			});

			assert.equal(split.sessions.length > 1, true);

			const fileNames: string[] = [];
			for (const part of split.sessions) {
				fileNames.push(await store.writeSession(storageDirectory, part));
			}

			const secondPart = fileNames[1];
			assert.ok(secondPart);

			const reassembled = await loadReassembledSession(storageDirectory, secondPart as string);
			assert.equal(reassembled.rootFileName, fileNames[0]);
			assert.equal(reassembled.partFiles.length, fileNames.length);
			assert.equal(reassembled.session.turns.length, saved.turns.length);

			const prompt = buildResumePrompt(reassembled.session, 'Continue from merged context', 50, 30000, 'truncate');
			assert.equal(prompt.includes('Continue from merged context'), true);
			assert.equal(prompt.includes('First user question about auth bug.'), true);
			assert.equal(prompt.includes('Second assistant answer proposing token refresh fix.'), true);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('createAnalysisCandidates skips unreadable multipart sessions and keeps usable sessions', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-chat-participant-analysis-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();
		const workspaceFolder = {
			uri: vscode.Uri.file(tempRoot),
			name: 'workspace',
			index: 0,
		} as vscode.WorkspaceFolder;

		try {
			const broken = {
				...createChatSession(createCopilotSession(), {
				title: 'Broken multipart session',
				savedAt: '2026-04-12T12:30:00.000Z',
				vscodeVersion: '1.115.0',
				}),
				id: 'broken-session',
				previousPartFile: 'missing-part.json',
			};
			const valid = {
				...createChatSession(createCopilotSession(), {
				title: 'Valid session',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
				}),
				id: 'valid-session',
			};

			const brokenFileName = await store.writeSession(storageDirectory, broken);
			const validFileName = await store.writeSession(storageDirectory, valid);
			const listed = await store.listSessions(storageDirectory);
			const brokenMeta = listed.find((session) => session.fileName === brokenFileName);
			const validMeta = listed.find((session) => session.fileName === validFileName);

			assert.ok(brokenMeta);
			assert.ok(validMeta);

			const candidates = await createAnalysisCandidates([
				{
					...brokenMeta,
					workspaceFolder,
					storageDirectory,
					displayTitle: `[workspace] ${brokenMeta.title}`,
				},
				{
					...validMeta,
					workspaceFolder,
					storageDirectory,
					displayTitle: `[workspace] ${validMeta.title}`,
				},
			]);

			assert.equal(candidates.length, 1);
			assert.equal(candidates[0]?.session.id, 'valid-session');
			assert.equal(candidates[0]?.rootFileName, validFileName);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('loadReassembledSession follows collision-resolved title-only part filenames', async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-chat-participant-title-only-'));
		const storageDirectory = path.join(tempRoot, '.chat');
		const store = createSessionStore();

		try {
			await store.writeSession(storageDirectory, createChatSession(createCopilotSession(), {
				title: 'Status Plan (Part 1/2)',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}), {
				includeTimestampInFileName: false,
			});
			await store.writeSession(storageDirectory, createChatSession(createCopilotSession(), {
				title: 'Status Plan (Part 2/2)',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}), {
				includeTimestampInFileName: false,
			});

			const source = createCopilotSession();
			for (const turn of source.turns) {
				if (turn.type === 'request') {
					turn.prompt = `${turn.prompt} ${'x'.repeat(240)}`;
				} else {
					turn.content = `${turn.content} ${'y'.repeat(240)}`;
				}
			}

			const saved = createChatSession(source, {
				title: 'Status Plan',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			});
			const split = applySaveBloatControls(saved, {
				maxFileSizeBytes: 1400,
				overflowStrategy: 'split',
				stripToolOutput: false,
			});

			const writtenFiles = await store.writeSessions(storageDirectory, split.sessions, {
				includeTimestampInFileName: false,
			});
			const secondPart = writtenFiles[1];

			assert.ok(secondPart);

			const reassembled = await loadReassembledSession(storageDirectory, secondPart as string);
			assert.equal(reassembled.rootFileName, writtenFiles[0]);
			assert.equal(reassembled.partFiles.length, writtenFiles.length);
			assert.equal(reassembled.session.turns.length, saved.turns.length);
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test('selectSessionForResume can disambiguate multi-root sessions using workspace-prefixed titles', () => {
		const sessions = [
			{
				id: '1',
				title: 'Fix auth bug',
				displayTitle: '[frontend] Fix auth bug',
				savedAt: '2026-04-12T10:00:00.000Z',
				fileName: 'fix-auth-bug-frontend.json',
				turnCount: 4,
				git: null,
			},
			{
				id: '2',
				title: 'Fix auth bug',
				displayTitle: '[backend] Fix auth bug',
				savedAt: '2026-04-12T11:00:00.000Z',
				fileName: 'fix-auth-bug-backend.json',
				turnCount: 4,
				git: null,
			},
		];

		const selection = selectSessionForResume('backend fix auth', sessions);
		assert.equal(selection.session?.fileName, 'fix-auth-bug-backend.json');
	});
});
