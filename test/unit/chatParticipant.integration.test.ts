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
	runResumeIntoOriginAgent,
	selectSessionForResume,
} from '../../src/chatParticipant';
import { createSessionStore } from '../../src/sessionStore';
import { applySaveBloatControls, createChatSession } from '../../src/sessionWriter';
import { CopilotSession } from '../../src/sessionReader';

function createCopilotSession(): CopilotSession {
	return {
		provider: 'copilot',
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
			assert.equal(prompt.includes('Copilot: Second assistant answer proposing token refresh fix.'), true);
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

	test('runResumeIntoOriginAgent opens query-capable targets with resumed context', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Codex resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'codex' as const,
		};
		let executedCommand: string | undefined;
		let executedArgs: unknown;

		const opened = await runResumeIntoOriginAgent(saved, 'What next?', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
			providerCommands: {
				codex: 'workbench.action.chat.open',
			},
		}, {
			getCommands: async () => ['workbench.action.chat.open'],
			executeCommand: async (commandId: string, args?: unknown) => {
				executedCommand = commandId;
				executedArgs = args;
			},
			writeClipboard: async () => undefined,
			streamMarkdown: () => undefined,
		});

		assert.equal(opened, true);
		assert.equal(executedCommand, 'workbench.action.chat.open');
		assert.equal((executedArgs as { query?: string } | undefined)?.query?.includes('User follow-up: What next?'), true);
	});

	test('runResumeIntoOriginAgent opens the Claude Code sidebar tab and pastes context', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Claude resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'claude-code' as const,
		};
		const executedCommands: string[] = [];
		let executedCommand: string | undefined;
		let clipboardText: string | undefined;

		const opened = await runResumeIntoOriginAgent(saved, 'Continue', {
			maxTurns: 2,
			maxContextChars: 30000,
			overflowStrategy: 'recent-only',
		}, {
			getCommands: async () => [
				'claude-vscode.sidebar.open',
				'claude-vscode.newConversation',
				'claude-vscode.focus',
				'claudeVSCodeSidebar.focus',
			],
			executeCommand: async (commandId: string) => {
				executedCommand = commandId;
				executedCommands.push(commandId);
			},
			writeClipboard: async (text: string) => {
				clipboardText = text;
			},
			streamMarkdown: () => undefined,
		});

		assert.equal(opened, true);
		assert.equal(executedCommand, 'editor.action.clipboardPasteAction');
		assert.deepEqual(executedCommands, [
			'claude-vscode.sidebar.open',
			'claude-vscode.newConversation',
			'claude-vscode.focus',
			'claude-vscode.focus',
			'editor.action.clipboardPasteAction',
		]);
		assert.equal(clipboardText?.includes('User follow-up: Continue'), true);
		assert.equal(clipboardText?.includes('Earlier turns omitted ('), true);
	});

	test('runResumeIntoOriginAgent waits and retries paste for a cold Claude Code sidebar', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Claude cold start',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'claude-code' as const,
		};
		const executedCommands: string[] = [];
		const waits: number[] = [];
		const messages: string[] = [];
		let pasteAttempts = 0;

		const opened = await runResumeIntoOriginAgent(saved, 'Continue', {
			maxTurns: 2,
			maxContextChars: 30000,
			overflowStrategy: 'recent-only',
		}, {
			getCommands: async () => [
				'claude-vscode.sidebar.open',
				'claude-vscode.newConversation',
				'claude-vscode.focus',
				'claudeVSCodeSidebar.focus',
			],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
				if (commandId === 'editor.action.clipboardPasteAction' && pasteAttempts < 2) {
					pasteAttempts += 1;
					throw new Error('Claude composer not ready');
				}
			},
			writeClipboard: async () => undefined,
			sleep: async (ms: number) => {
				waits.push(ms);
			},
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, [
			'claude-vscode.sidebar.open',
			'claude-vscode.newConversation',
			'claude-vscode.focus',
			'claude-vscode.focus',
			'editor.action.clipboardPasteAction',
			'editor.action.clipboardPasteAction',
			'editor.action.clipboardPasteAction',
		]);
		assert.deepEqual(waits, [250, 250, 250, 75, 150, 150]);
		assert.equal(messages[0], 'Opened the Claude Code chat tab and pasted the conversation context.');
	});

	test('runResumeIntoOriginAgent opens the Codex sidebar tab and pastes context', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Codex resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'codex' as const,
		};
		const executedCommands: string[] = [];
		let clipboardText: string | undefined;
		const messages: string[] = [];

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Codex', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['chatgpt.openSidebar', 'chatgpt.sidebarSecondaryView.focus', 'chatgpt.sidebarView.focus'],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
			},
			writeClipboard: async (text: string) => {
				clipboardText = text;
			},
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, [
			'chatgpt.openSidebar',
			'chatgpt.sidebarSecondaryView.focus',
			'editor.action.clipboardPasteAction',
		]);
		assert.equal(clipboardText?.includes('User follow-up: Continue in Codex'), true);
		assert.equal(messages[0], 'Opened the Codex chat tab and pasted the conversation context.');
	});

	test('runResumeIntoOriginAgent waits and retries paste for a cold Codex sidebar', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Codex cold start',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'codex' as const,
		};
		const executedCommands: string[] = [];
		const waits: number[] = [];
		const messages: string[] = [];
		let pasteAttempts = 0;

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Codex', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['chatgpt.openSidebar', 'chatgpt.sidebarSecondaryView.focus'],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
				if (commandId === 'editor.action.clipboardPasteAction' && pasteAttempts < 2) {
					pasteAttempts += 1;
					throw new Error('Codex composer not ready');
				}
			},
			writeClipboard: async () => undefined,
			sleep: async (ms: number) => {
				waits.push(ms);
			},
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, [
			'chatgpt.openSidebar',
			'chatgpt.sidebarSecondaryView.focus',
			'editor.action.clipboardPasteAction',
			'editor.action.clipboardPasteAction',
			'editor.action.clipboardPasteAction',
		]);
		assert.deepEqual(waits, [250, 150, 150]);
		assert.equal(messages[0], 'Opened the Codex chat tab and pasted the conversation context.');
	});

	test('runResumeIntoOriginAgent falls back to a paste instruction when no Codex focus command exists', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Codex resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'codex' as const,
		};
		const executedCommands: string[] = [];
		const messages: string[] = [];

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Codex', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['chatgpt.newCodexPanel'],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
			},
			writeClipboard: async () => undefined,
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, ['chatgpt.newCodexPanel']);
		assert.equal(messages[0], 'Opened Codex chat and copied the conversation context - paste to continue.');
	});

	test('runResumeIntoOriginAgent opens the Cursor agent chat and pastes context', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Cursor resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'cursor' as const,
		};
		const executedCommands: string[] = [];
		const waits: number[] = [];
		let clipboardText: string | undefined;
		const messages: string[] = [];

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Cursor', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['composer.newAgentChat', 'aichat.newchataction', 'composer.focusComposer'],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
			},
			writeClipboard: async (text: string) => {
				clipboardText = text;
			},
			sleep: async (ms: number) => {
				waits.push(ms);
			},
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, [
			'composer.newAgentChat',
			'composer.focusComposer',
			'editor.action.clipboardPasteAction',
		]);
		assert.deepEqual(waits, [250]);
		assert.equal(clipboardText?.includes('User follow-up: Continue in Cursor'), true);
		assert.equal(messages[0], 'Opened the Cursor chat tab and pasted the conversation context.');
	});

	test('runResumeIntoOriginAgent waits and retries paste for a cold Cursor composer', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Cursor cold start',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'cursor' as const,
		};
		const executedCommands: string[] = [];
		const waits: number[] = [];
		const messages: string[] = [];
		let pasteAttempts = 0;

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Cursor', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['composer.newAgentChat', 'composer.focusComposer'],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
				if (commandId === 'editor.action.clipboardPasteAction' && pasteAttempts < 2) {
					pasteAttempts += 1;
					throw new Error('Cursor composer not ready');
				}
			},
			writeClipboard: async () => undefined,
			sleep: async (ms: number) => {
				waits.push(ms);
			},
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, [
			'composer.newAgentChat',
			'composer.focusComposer',
			'editor.action.clipboardPasteAction',
			'editor.action.clipboardPasteAction',
			'editor.action.clipboardPasteAction',
		]);
		assert.deepEqual(waits, [250, 150, 150]);
		assert.equal(messages[0], 'Opened the Cursor chat tab and pasted the conversation context.');
	});

	test('runResumeIntoOriginAgent falls back to a paste instruction when Cursor auto-paste keeps failing', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Cursor resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'cursor' as const,
		};
		const messages: string[] = [];
		let clipboardText: string | undefined;

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Cursor', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['composer.newAgentChat', 'composer.focusComposer'],
			executeCommand: async (commandId: string) => {
				if (commandId === 'editor.action.clipboardPasteAction') {
					throw new Error('paste blocked by host');
				}
			},
			writeClipboard: async (text: string) => {
				clipboardText = text;
			},
			sleep: async () => undefined,
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.equal(clipboardText?.includes('User follow-up: Continue in Cursor'), true);
		assert.equal(
			messages[0],
			'Opened the Cursor chat tab and copied the conversation context, but automatic paste failed (paste blocked by host) - paste (Ctrl+V) to continue.',
		);
	});

	test('runResumeIntoOriginAgent falls back to a paste instruction when no Cursor focus command exists', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Cursor resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'cursor' as const,
		};
		const executedCommands: string[] = [];
		const messages: string[] = [];

		const opened = await runResumeIntoOriginAgent(saved, 'Continue in Cursor', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['aichat.newchataction'],
			executeCommand: async (commandId: string) => {
				executedCommands.push(commandId);
			},
			writeClipboard: async () => undefined,
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, true);
		assert.deepEqual(executedCommands, ['aichat.newchataction']);
		assert.equal(messages[0], 'Opened Cursor chat and copied the conversation context - paste to continue.');
	});

	test('runResumeIntoOriginAgent returns false when provider command is unavailable', async () => {
		const saved = {
			...createChatSession(createCopilotSession(), {
				title: 'Cursor resume',
				savedAt: '2026-04-12T13:00:00.000Z',
				vscodeVersion: '1.115.0',
			}),
			provider: 'cursor' as const,
		};
		const messages: string[] = [];

		const opened = await runResumeIntoOriginAgent(saved, 'Continue', {
			maxTurns: 50,
			maxContextChars: 30000,
			overflowStrategy: 'truncate',
		}, {
			getCommands: async () => ['workbench.action.chat.open'],
			executeCommand: async () => {
				throw new Error('should not execute');
			},
			writeClipboard: async () => undefined,
			streamMarkdown: (markdown: string) => {
				messages.push(markdown);
			},
		});

		assert.equal(opened, false);
		assert.equal(messages[0]?.includes('Falling back to VS Code chat resume'), true);
	});
});
