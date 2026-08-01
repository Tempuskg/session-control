import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAutoSaveDiagnosticState } from '../../src/autoSaveDiagnostics';
import { registerAutoSaveOnChatResponseListener } from '../../src/extension';
import { type SessionOrigin, type SessionProviderId, type SourceChatSession } from '../../src/types';

/** Yield to the event loop so that void async IIFEs inside schedule callbacks complete. */
function drainAsyncWork(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeWatcher {
	onDidChange: (listener: () => void) => vscode.Disposable;
	onDidCreate: (listener: () => void) => vscode.Disposable;
	dispose: () => void;
	emitChange: () => void;
	emitCreate: () => void;
}

function createFakeWatcher(): FakeWatcher {
	let changeListener: (() => void) | undefined;
	let createListener: (() => void) | undefined;

	return {
		onDidChange: (listener: () => void) => {
			changeListener = listener;
			return {
				dispose: () => {
					changeListener = undefined;
				},
			};
		},
		onDidCreate: (listener: () => void) => {
			createListener = listener;
			return {
				dispose: () => {
					createListener = undefined;
				},
			};
		},
		dispose: () => {
			changeListener = undefined;
			createListener = undefined;
		},
		emitChange: () => changeListener?.(),
		emitCreate: () => createListener?.(),
	};
}

function createCopilotWatcherFactory(
	vscodeCopilotWatcher: FakeWatcher,
	copilotCliWatcher = createFakeWatcher(),
): (directory: string, glob: string) => FakeWatcher {
	return (_directory, glob) => (glob === '*/events.jsonl' ? copilotCliWatcher : vscodeCopilotWatcher);
}

function createValidatedCopilotWorkspaceStoreOverrides(workspaceId = 'workspace-id') {
	const storageUriPath = path.join(
		path.parse(process.cwd()).root,
		'vscode-user-data',
		'workspaceStorage',
		workspaceId,
		'darrenjmcleod.session-control',
	);
	return {
		getStorageUri: () => ({
			fsPath: storageUriPath,
			scheme: 'file',
		}),
		getWorkspaceFolderCount: () => 1,
		isDirectory: (candidatePath: string) => candidatePath === path.dirname(storageUriPath),
		findExistingAutoSaves: async () => [],
		settleReadDelayMs: 0,
	};
}

suite('extension auto-save on chat response', () => {
	test('watches Copilot CLI when no VS Code storage URI is available', () => {
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];

		const result = registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				getStorageUri: () => undefined,
				createWatcher: (directory, glob) => {
					watchedTargets.push({ directory, glob });
					return createFakeWatcher();
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
			},
		);

		assert.notEqual(result, undefined);
		assert.deepEqual(watchedTargets, [
			{
				directory: path.join('C:/Users/test/.copilot', 'session-state'),
				glob: '*/events.jsonl',
			},
		]);
		assert.equal(subscriptions.length, 1);
		assert.equal(
			outputLines.some((line) => line.includes('GitHub Copilot CLI event logs')),
			true,
		);
	});

	test('validates the resolved VS Code Copilot store before watching and reports it in diagnostics', () => {
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const diagnosticState = createAutoSaveDiagnosticState();
		const storeOverrides = createValidatedCopilotWorkspaceStoreOverrides();
		const storageUriPath = storeOverrides.getStorageUri().fsPath;
		const sessionsDirectory = path.join(path.dirname(storageUriPath), 'chatSessions');

		const result = registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...storeOverrides,
				pathExists: (candidatePath) => candidatePath === sessionsDirectory,
				diagnosticState,
				createWatcher: (directory, glob) => {
					watchedTargets.push({ directory, glob });
					return createFakeWatcher();
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getWorkspaceFolderCount: () => 1,
				getRemoteName: () => undefined,
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
			},
		);

		assert.notEqual(result, undefined);
		assert.equal(
			watchedTargets.some(({ directory, glob }) => directory === sessionsDirectory && glob === '*.{json,jsonl}'),
			true,
		);
		assert.deepEqual(diagnosticState.getSource('copilot-vscode'), {
			sourceId: 'copilot-vscode',
			resolvedPath: sessionsDirectory,
			pathExists: true,
			health: 'healthy',
			disabled: false,
			warningShown: false,
			validation: {
				status: 'validated',
				reason: 'Resolved from ExtensionContext.storageUri for the sole open workspace folder.',
				workspaceMode: 'single-root',
				hostKind: 'local',
				profileKind: 'default',
				supportedFormats: ['json', 'jsonl'],
				workspaceStorePath: path.dirname(storageUriPath),
			},
		});
		assert.equal(
			outputLines.some(
				(line) =>
					line.includes('Validated VS Code Copilot workspace store') &&
					line.includes(path.dirname(storageUriPath)) &&
					line.includes('formats=json,jsonl'),
			),
			true,
		);
	});

	test('skips ambiguous VS Code Copilot sessions in a multi-root workspace', () => {
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];
		const diagnosticState = createAutoSaveDiagnosticState();
		let watcherCreations = 0;

		const result = registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides('multi-root-workspace-id'),
				diagnosticState,
				getStorageDirectory: () => 'e:/first-workspace/.chat',
				createWatcher: () => {
					watcherCreations += 1;
					return createFakeWatcher();
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/first-workspace'),
					name: 'first-workspace',
					index: 0,
				}),
				getWorkspaceFolderCount: () => 2,
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
			},
		);

		assert.notEqual(result, undefined);
		assert.equal(watcherCreations, 1);
		assert.equal(subscriptions.length, 1);
		assert.equal(
			outputLines.some(
				(line) => line.includes('owning folder is ambiguous') && line.includes('active editor is not used to guess'),
			),
			true,
		);
		assert.equal(diagnosticState.getSource('copilot-vscode')?.validation?.status, 'rejected');
		assert.equal(diagnosticState.getSource('copilot-vscode')?.validation?.workspaceMode, 'multi-root');
		assert.match(
			diagnosticState.getSource('copilot-vscode')?.skipReason?.reason ?? '',
			/active editor is not used to guess/i,
		);
	});

	test('triggers save when chatSessions file changes and turn count increases', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{
			workspaceFolder: vscode.WorkspaceFolder;
			storageDirectory: string;
			origin: SessionOrigin;
		}> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];
		const diagnosticState = createAutoSaveDiagnosticState();
		let refreshCount = 0;

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				diagnosticState,
				createWatcher: createCopilotWatcherFactory(watcher),
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [
					{
						provider: 'copilot',
						id: 'session-1',
						title: 'My Session',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'hello',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'copilot',
								content: 'hi',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'session-1.jsonl',
					},
				],
				readCopilotCliSessions: async () => [],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory, _provider, _sessions, origin) => {
					saveCalls.push({ workspaceFolder, storageDirectory, origin });
					return ['saved-session.json'];
				},
				refreshSessionExplorer: () => {
					refreshCount += 1;
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'session-control');
		assert.equal(saveCalls[0]?.origin.saveKind, 'auto');
		assert.equal(saveCalls[0]?.origin.sourceId, 'copilot-vscode');
		assert.equal(saveCalls[0]?.origin.sourceSessionId, 'session-1');
		assert.equal(saveCalls[0]?.origin.sourceRevision.length, 64);
		assert.equal(refreshCount, 1);
		assert.deepEqual(
			diagnosticState.getSource('copilot-vscode')?.lastSuccess?.fileNames,
			['saved-session.json'],
		);
		assert.equal(
			outputLines.some((line) => line.includes('My Session')),
			true,
		);
	});

	test('does not refresh or report success when an auto-save is skipped or fails', async () => {
		const scenarios: readonly {
			label: string;
			save: () => Promise<string[] | undefined>;
			expectedFailure: boolean;
		}[] = [
			{
				label: 'undefined save result',
				save: async () => undefined,
				expectedFailure: false,
			},
			{
				label: 'empty save result',
				save: async () => [],
				expectedFailure: false,
			},
			{
				label: 'failed save',
				save: async () => {
					throw new Error('upsert failed');
				},
				expectedFailure: true,
			},
		];

		for (const scenario of scenarios) {
			const watcher = createFakeWatcher();
			const scheduledCallbacks: Array<() => void> = [];
			const subscriptions: vscode.Disposable[] = [];
			const diagnosticState = createAutoSaveDiagnosticState();
			let refreshCount = 0;

			const controller = registerAutoSaveOnChatResponseListener(
				{ subscriptions } as unknown as vscode.ExtensionContext,
				{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
				{
					...createValidatedCopilotWorkspaceStoreOverrides(`refresh-${scenario.label}`),
					diagnosticState,
					createWatcher: createCopilotWatcherFactory(watcher),
					getImplicitWorkspaceFolder: () => ({
						uri: vscode.Uri.file('e:/session-control'),
						name: 'session-control',
						index: 0,
					}),
					getAutoSaveProviders: () => ['copilot'],
					getCopilotHomePath: () => 'C:/Users/test/.copilot',
					readCopilotSessions: async () => [
						{
							provider: 'copilot',
							id: 'session-1',
							title: 'My Session',
							lastMessageDate: '2026-07-30T12:00:00.000Z',
							turns: [
								{
									type: 'response',
									participant: 'copilot',
									content: 'settled response',
									toolCalls: [],
									timestamp: '2026-07-30T12:00:00.000Z',
								},
							],
							sourceFile: 'session-1.jsonl',
						},
					],
					readCopilotCliSessions: async () => [],
					saveSessionSilently: scenario.save,
					refreshSessionExplorer: () => {
						refreshCount += 1;
					},
					showWarningMessage: async () => undefined,
					schedule: (callback: () => void) => {
						scheduledCallbacks.push(callback);
						return callback as unknown as ReturnType<typeof setTimeout>;
					},
					clearSchedule: () => undefined,
				},
			);

			watcher.emitChange();
			scheduledCallbacks[0]?.();
			await drainAsyncWork();

			const diagnostic = diagnosticState.getSource('copilot-vscode');
			assert.equal(refreshCount, 0, scenario.label);
			assert.equal(diagnostic?.lastSuccess, undefined, scenario.label);
			if (scenario.expectedFailure) {
				assert.notEqual(diagnostic?.lastError, undefined, scenario.label);
			} else {
				assert.notEqual(diagnostic?.skipReason, undefined, scenario.label);
			}
			controller?.dispose();
		}
	});

	test('auto-saves the observed project-owned Copilot CLI session when its settled event log changes', async () => {
		const observedSource = {
			homeDirectory: 'C:/Users/darre/.copilot',
			sessionStateDirectory: 'C:/Users/darre/.copilot/session-state',
			sessionId: '84a4c0f6-321d-401d-907a-72d94089b85e',
			eventsPath: 'C:/Users/darre/.copilot/session-state/84a4c0f6-321d-401d-907a-72d94089b85e/events.jsonl',
			workspacePath: 'E:\\chat-commit',
			repository: 'Tempuskg/session-control',
		};
		const observedEventsJsonl = [
			JSON.stringify({
				id: '00000000-0000-4000-8000-000000000001',
				timestamp: '2026-07-29T13:59:25.414Z',
				parentId: null,
				type: 'session.start',
				data: {
					version: 1,
					sessionId: observedSource.sessionId,
					context: {
						cwd: observedSource.workspacePath,
						repository: observedSource.repository,
						branch: 'main',
					},
				},
			}),
			JSON.stringify({
				id: '00000000-0000-4000-8000-000000000002',
				timestamp: '2026-07-29T13:59:37.800Z',
				parentId: '00000000-0000-4000-8000-000000000001',
				type: 'assistant.message',
				data: {
					messageId: 'sanitized-message',
					content: 'Sanitized completed response.',
				},
			}),
			JSON.stringify({
				id: '00000000-0000-4000-8000-000000000003',
				timestamp: '2026-07-29T13:59:37.917Z',
				parentId: '00000000-0000-4000-8000-000000000002',
				type: 'assistant.turn_end',
				data: { turnId: '1' },
			}),
		].join('\n');
		const observedEvents = observedEventsJsonl.split('\n').map(
			(line) =>
				JSON.parse(line) as {
					type: string;
					data: {
						version?: number;
						sessionId?: string;
						context?: {
							cwd: string;
							repository: string;
						};
					};
				},
		);
		const sessionStart = observedEvents[0];
		const settledTurn = observedEvents.at(-1);

		assert.equal(sessionStart?.type, 'session.start');
		assert.equal(sessionStart?.data.version, 1);
		assert.equal(sessionStart?.data.sessionId, observedSource.sessionId);
		assert.equal(sessionStart?.data.context?.cwd, observedSource.workspacePath);
		assert.equal(sessionStart?.data.context?.repository, observedSource.repository);
		assert.equal(settledTurn?.type, 'assistant.turn_end');

		const vscodeCopilotWatcher = createFakeWatcher();
		const copilotCliWatcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: string[] = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const subscriptions: vscode.Disposable[] = [];
		const depsOverrides = {
			...createValidatedCopilotWorkspaceStoreOverrides(),
			createWatcher: (directory: string, glob: string) => {
				watchedTargets.push({ directory, glob });
				const normalizedDirectory = directory.replace(/\\/g, '/');
				return normalizedDirectory === observedSource.sessionStateDirectory ? copilotCliWatcher : vscodeCopilotWatcher;
			},
			getImplicitWorkspaceFolder: () => ({
				uri: vscode.Uri.file(observedSource.workspacePath),
				name: 'chat-commit',
				index: 0,
			}),
			getAutoSaveProviders: () => ['copilot'],
			getCopilotHomePath: () => observedSource.homeDirectory,
			getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
			readCopilotSessions: async () => [],
			readCopilotCliSessions: async () => [
				{
					provider: 'copilot',
					id: observedSource.sessionId,
					title: 'Sanitized Copilot CLI session',
					lastMessageDate: '2026-07-29T13:59:37.917Z',
					turns: [
						{
							type: 'request',
							participant: 'user',
							prompt: 'Sanitized request.',
							references: [],
							timestamp: '2026-07-29T13:59:25.414Z',
						},
						{
							type: 'response',
							participant: 'copilot',
							content: 'Sanitized completed response.',
							toolCalls: [],
							timestamp: '2026-07-29T13:59:37.800Z',
						},
					],
					sourceFile: observedSource.eventsPath,
					cwd: observedSource.workspacePath,
				},
			],
			readCursorSessions: async () => [],
			saveSessionSilently: async () => {
				saveCalls.push(observedSource.sessionId);
				return ['copilot-cli-auto-save.json'];
			},
			showWarningMessage: async () => undefined,
			schedule: (callback: () => void) => {
				scheduledCallbacks.push(callback);
				return callback as unknown as ReturnType<typeof setTimeout>;
			},
			clearSchedule: () => undefined,
		} satisfies Parameters<typeof registerAutoSaveOnChatResponseListener>[2] & Record<string, unknown>;

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			depsOverrides,
		);

		const copilotCliTarget = watchedTargets.find(
			({ directory, glob }) =>
				directory.replace(/\\/g, '/') === observedSource.sessionStateDirectory && glob === '*/events.jsonl',
		);
		assert.ok(
			copilotCliTarget,
			'Expected a Copilot CLI session-state/*/events.jsonl watcher; only VS Code Copilot chatSessions is watched',
		);

		copilotCliWatcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.deepEqual(saveCalls, [observedSource.sessionId]);
	});

	test('ignores timestamp-only touches and saves same-turn semantic changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{
			workspaceFolder: vscode.WorkspaceFolder;
			storageDirectory: string;
		}> = [];
		const subscriptions: vscode.Disposable[] = [];
		let generatedTimestamp = '2026-07-30T12:00:00.000Z';
		let responseContent = 'hi';

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: createCopilotWatcherFactory(watcher),
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [
					{
						provider: 'copilot',
						id: 'session-1',
						title: 'My Session',
						lastMessageDate: generatedTimestamp,
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'hello',
								references: [],
								timestamp: generatedTimestamp,
							},
							{
								type: 'response',
								participant: 'copilot',
								content: responseContent,
								toolCalls: [],
								timestamp: generatedTimestamp,
							},
						],
						sourceFile: 'session-1.jsonl',
					},
				],
				readCopilotCliSessions: async () => [],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return ['saved-session.json'];
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		// First change saves the new session.
		watcher.emitChange();
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);

		// A source touch that only regenerates timestamps has the same semantic revision.
		generatedTimestamp = '2026-07-30T12:05:00.000Z';
		watcher.emitChange();
		scheduledCallbacks[1]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);

		// Corrected response text updates the snapshot without adding a turn.
		responseContent = 'hi, corrected';
		watcher.emitChange();
		scheduledCallbacks[2]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 2);
	});

	test('routes successive versions through the same automatic-save identity', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveOrigins: SessionOrigin[] = [];
		let saveCounter = 0;
		let turnCount = 2;
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: createCopilotWatcherFactory(watcher),
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [
					{
						provider: 'copilot',
						id: 'session-1',
						title: 'My Session',
						lastMessageDate: new Date().toISOString(),
						turns: Array.from({ length: turnCount }, (_, i) => ({
							type: (i % 2 === 0 ? 'request' : 'response') as 'request' | 'response',
							participant: i % 2 === 0 ? 'user' : 'copilot',
							prompt: i % 2 === 0 ? 'hello' : undefined,
							content: i % 2 === 1 ? 'hi' : undefined,
							references: [] as string[],
							toolCalls: [] as Array<{ name: string }>,
							timestamp: new Date().toISOString(),
						})) as never[],
						sourceFile: 'session-1.jsonl',
					},
				],
				readCopilotCliSessions: async () => [],
				readCursorSessions: async () => [],
				saveSessionSilently: async (_workspaceFolder, _storageDirectory, _provider, _sessions, origin) => {
					saveCounter++;
					saveOrigins.push(origin);
					return [`saved-v${saveCounter}-part1.json`, `saved-v${saveCounter}-part2.json`];
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		// First save
		watcher.emitChange();
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCounter, 1);

		// A later version is routed through the same store-owned upsert identity.
		turnCount = 4;
		watcher.emitChange();
		scheduledCallbacks[1]?.();
		await drainAsyncWork();
		assert.equal(saveCounter, 2);
		assert.deepEqual(
			saveOrigins.map(({ saveKind, sourceId, sourceSessionId }) => ({
				saveKind,
				sourceId,
				sourceSessionId,
			})),
			[
				{
					saveKind: 'auto',
					sourceId: 'copilot-vscode',
					sourceSessionId: 'session-1',
				},
				{
					saveKind: 'auto',
					sourceId: 'copilot-vscode',
					sourceSessionId: 'session-1',
				},
			],
		);
	});

	test('pauses and periodically retries only the source that fails', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const warnings: string[] = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: createCopilotWatcherFactory(watcher),
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/session-control'),
					name: 'session-control',
					index: 0,
				}),
				getAutoSaveProviders: () => ['copilot'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => {
					throw new Error('read failed');
				},
				readCopilotCliSessions: async () => [],
				readCursorSessions: async () => [],
				saveSessionSilently: async () => ['saved.json'],
				showWarningMessage: async (message: string) => {
					warnings.push(message);
					return undefined;
				},
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		// First change pauses this source, warns once, and schedules its retry.
		watcher.emitChange();
		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(
			warnings.some(
				(msg) => msg.includes('Other auto-save sources will continue') && msg.includes('retry automatically'),
			),
			true,
		);
		assert.equal(
			outputLines.some((line) => line.includes('read failed')),
			true,
		);
		assert.equal(scheduledCallbacks.length, 2, 'One periodic source retry is scheduled');

		// Further events do not duplicate the warning or retry timer while paused.
		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 2);
		assert.equal(warnings.length, 1);

		// A persistent failure schedules the next periodic retry without warning again.
		scheduledCallbacks[1]?.();
		await drainAsyncWork();
		assert.equal(scheduledCallbacks.length, 3);
		assert.equal(warnings.length, 1);
	});

	test('triggers save when Cursor agent transcript changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{
			workspaceFolder: vscode.WorkspaceFolder;
			storageDirectory: string;
		}> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					return watcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getAutoSaveProviders: () => ['cursor'],
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [],
				readCursorSessions: async () => [
					{
						provider: 'cursor',
						id: 'cursor-session-1',
						title: 'Implement Cursor auto-save',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'implement autosave',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'cursor',
								content: 'working on it',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'cursor-session-1',
					},
				],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return ['cursor-auto-save.json'];
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 1);
		assert.equal(watchedTargets[0]?.directory.replace(/\\/g, '/'), 'C:/Users/test/.cursor/projects/e-chat-commit');
		assert.equal(watchedTargets[0]?.glob, 'agent-transcripts/**/*.jsonl');

		watcher.emitCreate();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'chat-commit');
		assert.equal(
			outputLines.some((line) => line.includes('Implement Cursor auto-save')),
			true,
		);
	});

	test('triggers save when Codex session transcript changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{
			workspaceFolder: vscode.WorkspaceFolder;
			storageDirectory: string;
		}> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					return watcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getAutoSaveProviders: () => ['codex'],
				getCodexHomePath: () => 'C:/Users/test/.codex',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [],
				readCodexSessions: async () => [
					{
						provider: 'codex',
						id: 'codex-session-1',
						title: 'Implement Codex auto-save',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'implement codex autosave',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'codex',
								content: 'working on it',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'codex-session-1',
						cwd: 'E:/chat-commit',
					},
				],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return ['codex-auto-save.json'];
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 1);
		assert.equal(watchedTargets[0]?.directory.replace(/\\/g, '/'), 'C:/Users/test/.codex');
		assert.equal(watchedTargets[0]?.glob, 'sessions/**/*.{json,jsonl}');

		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'chat-commit');
		assert.equal(
			outputLines.some((line) => line.includes('Implement Codex auto-save')),
			true,
		);
	});

	test('triggers save when Claude Code session transcript changes', async () => {
		const watcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{
			workspaceFolder: vscode.WorkspaceFolder;
			storageDirectory: string;
		}> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const outputLines: string[] = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{
				appendLine: (value: string) => outputLines.push(value),
			} as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					return watcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getAutoSaveProviders: () => ['claude-code'],
				getCodexHomePath: () => 'C:/Users/test/.codex',
				getClaudeCodeHomePath: () => 'C:/Users/test/.claude',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [],
				readCodexSessions: async () => [],
				readClaudeCodeSessions: async () => [
					{
						provider: 'claude-code',
						id: 'claude-session-1',
						title: 'Implement Claude Code auto-save',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'implement claude autosave',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'claude-code',
								content: 'working on it',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'claude-session-1',
						cwd: 'E:/chat-commit',
					},
				],
				readCursorSessions: async () => [],
				saveSessionSilently: async (workspaceFolder, storageDirectory) => {
					saveCalls.push({ workspaceFolder, storageDirectory });
					return ['claude-auto-save.json'];
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 1);
		assert.equal(watchedTargets[0]?.directory.replace(/\\/g, '/'), 'C:/Users/test/.claude/projects/e--chat-commit');
		assert.equal(watchedTargets[0]?.glob, '*.jsonl');

		watcher.emitChange();
		assert.equal(scheduledCallbacks.length, 1);

		scheduledCallbacks[0]?.();
		await drainAsyncWork();
		assert.equal(saveCalls.length, 1);
		assert.equal(saveCalls[0]?.workspaceFolder.name, 'chat-commit');
		assert.equal(
			outputLines.some((line) => line.includes('Implement Claude Code auto-save')),
			true,
		);
	});

	test('skips ambiguous and mismatched Codex and Claude Code sessions during immediate reconciliation', async () => {
		const workspacePath = 'E:/chat-commit';
		const timestamp = '2026-07-30T12:00:00.000Z';
		const scenarios: readonly {
			label: string;
			provider: Extract<SessionProviderId, 'codex' | 'claude-code'>;
			session: SourceChatSession;
		}[] = [
			{
				label: 'ambiguous Codex session',
				provider: 'codex',
				session: {
					provider: 'codex',
					id: 'codex-ambiguous',
					title: 'Codex without cwd',
					lastMessageDate: timestamp,
					turns: [
						{
							type: 'request',
							participant: 'user',
							prompt: 'Do not guess my project',
							references: [],
							timestamp,
						},
					],
					sourceFile: 'codex-ambiguous',
				},
			},
			{
				label: 'mismatched Codex session',
				provider: 'codex',
				session: {
					provider: 'codex',
					id: 'codex-mismatch',
					title: 'Codex for another project',
					lastMessageDate: timestamp,
					turns: [
						{
							type: 'request',
							participant: 'user',
							prompt: 'Belongs elsewhere',
							references: [],
							timestamp,
						},
					],
					sourceFile: 'codex-mismatch',
					cwd: 'E:/another-project',
				},
			},
			{
				label: 'ambiguous Claude Code session',
				provider: 'claude-code',
				session: {
					provider: 'claude-code',
					id: 'claude-ambiguous',
					title: 'Claude Code without cwd',
					lastMessageDate: timestamp,
					turns: [
						{
							type: 'request',
							participant: 'user',
							prompt: 'Do not guess my project',
							references: [],
							timestamp,
						},
					],
					sourceFile: 'claude-ambiguous',
				},
			},
			{
				label: 'mismatched Claude Code session',
				provider: 'claude-code',
				session: {
					provider: 'claude-code',
					id: 'claude-mismatch',
					title: 'Claude Code for another project',
					lastMessageDate: timestamp,
					turns: [
						{
							type: 'request',
							participant: 'user',
							prompt: 'Belongs elsewhere',
							references: [],
							timestamp,
						},
					],
					sourceFile: 'claude-mismatch',
					cwd: 'E:/another-project',
				},
			},
		];

		for (const scenario of scenarios) {
			const subscriptions: vscode.Disposable[] = [];
			let saveCount = 0;

			const controller = registerAutoSaveOnChatResponseListener(
				{ subscriptions } as unknown as vscode.ExtensionContext,
				{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
				{
					...createValidatedCopilotWorkspaceStoreOverrides(),
					createWatcher: () => createFakeWatcher(),
					getImplicitWorkspaceFolder: () => ({
						uri: vscode.Uri.file(workspacePath),
						name: 'chat-commit',
						index: 0,
					}),
					getAutoSaveProviders: () => [scenario.provider],
					getCodexHomePath: () => 'C:/Users/test/.codex',
					getClaudeCodeHomePath: () => 'C:/Users/test/.claude',
					getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
					readCodexSessions: async () => (scenario.provider === 'codex' ? [scenario.session] : []),
					readClaudeCodeSessions: async () => (scenario.provider === 'claude-code' ? [scenario.session] : []),
					saveSessionSilently: async () => {
						saveCount += 1;
						return ['unexpected-auto-save.json'];
					},
					showWarningMessage: async () => undefined,
				},
			);

			assert.notEqual(controller, undefined, scenario.label);
			controller?.reconcile();
			await drainAsyncWork();
			assert.equal(saveCount, 0, scenario.label);
			controller?.dispose();
		}
	});

	test('watches all four configured providers without host-based exclusion', async () => {
		const copilotWatcher = createFakeWatcher();
		const copilotCliWatcher = createFakeWatcher();
		const codexWatcher = createFakeWatcher();
		const claudeWatcher = createFakeWatcher();
		const cursorWatcher = createFakeWatcher();
		const scheduledCallbacks: Array<() => void> = [];
		const saveCalls: Array<{ provider: string; title: string }> = [];
		const watchedTargets: Array<{ directory: string; glob: string }> = [];
		const subscriptions: vscode.Disposable[] = [];

		registerAutoSaveOnChatResponseListener(
			{ subscriptions } as unknown as vscode.ExtensionContext,
			{ appendLine: () => undefined } as unknown as vscode.OutputChannel,
			{
				...createValidatedCopilotWorkspaceStoreOverrides(),
				createWatcher: (directory: string, glob: string) => {
					watchedTargets.push({ directory, glob });
					if (glob === '*.{json,jsonl}') {
						return copilotWatcher;
					}
					if (glob === '*/events.jsonl') {
						return copilotCliWatcher;
					}
					if (glob === 'sessions/**/*.{json,jsonl}') {
						return codexWatcher;
					}
					return glob === '*.jsonl' ? claudeWatcher : cursorWatcher;
				},
				getImplicitWorkspaceFolder: () => ({
					uri: vscode.Uri.file('e:/chat-commit'),
					name: 'chat-commit',
					index: 0,
				}),
				getAutoSaveProviders: () => ['copilot', 'codex', 'claude-code', 'cursor'],
				getCopilotHomePath: () => 'C:/Users/test/.copilot',
				getCodexHomePath: () => 'C:/Users/test/.codex',
				getClaudeCodeHomePath: () => 'C:/Users/test/.claude',
				getCursorProjectsPath: () => 'C:/Users/test/.cursor/projects',
				readCopilotSessions: async () => [
					{
						provider: 'copilot',
						id: 'copilot-session-1',
						title: 'Copilot session',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'copilot prompt',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'copilot',
								content: 'copilot response',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'copilot-session-1.jsonl',
					},
				],
				readCopilotCliSessions: async () => [],
				readCodexSessions: async () => [
					{
						provider: 'codex',
						id: 'codex-session-1',
						title: 'Codex session',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'codex prompt',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'codex',
								content: 'codex response',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'codex-session-1',
						cwd: 'E:/chat-commit',
					},
				],
				readClaudeCodeSessions: async () => [
					{
						provider: 'claude-code',
						id: 'claude-session-1',
						title: 'Claude Code session',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'claude prompt',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'claude-code',
								content: 'claude response',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'claude-session-1',
						cwd: 'E:/chat-commit',
					},
				],
				readCursorSessions: async () => [
					{
						provider: 'cursor',
						id: 'cursor-session-1',
						title: 'Cursor session',
						lastMessageDate: new Date().toISOString(),
						turns: [
							{
								type: 'request',
								participant: 'user',
								prompt: 'cursor prompt',
								references: [],
								timestamp: new Date().toISOString(),
							},
							{
								type: 'response',
								participant: 'cursor',
								content: 'cursor response',
								toolCalls: [],
								timestamp: new Date().toISOString(),
							},
						],
						sourceFile: 'cursor-session-1',
						cwd: 'E:/chat-commit',
					},
				],
				saveSessionSilently: async (_workspaceFolder, _storageDirectory, provider, sessions) => {
					saveCalls.push({ provider, title: sessions[0]?.title ?? '' });
					return [`${provider}-auto-save.json`];
				},
				showWarningMessage: async () => undefined,
				schedule: (callback: () => void) => {
					scheduledCallbacks.push(callback);
					return callback as unknown as ReturnType<typeof setTimeout>;
				},
				clearSchedule: () => undefined,
			},
		);

		assert.equal(watchedTargets.length, 5);
		assert.equal(watchedTargets[0]?.glob, '*.{json,jsonl}');
		assert.equal(watchedTargets[1]?.glob, '*/events.jsonl');
		assert.equal(watchedTargets[2]?.glob, 'sessions/**/*.{json,jsonl}');
		assert.equal(watchedTargets[3]?.glob, '*.jsonl');
		assert.equal(watchedTargets[4]?.glob, 'agent-transcripts/**/*.jsonl');

		copilotWatcher.emitChange();
		codexWatcher.emitChange();
		claudeWatcher.emitChange();
		cursorWatcher.emitChange();
		assert.equal(scheduledCallbacks.length, 4);

		scheduledCallbacks[0]?.();
		scheduledCallbacks[1]?.();
		scheduledCallbacks[2]?.();
		scheduledCallbacks[3]?.();
		await drainAsyncWork();

		assert.deepEqual(saveCalls, [
			{ provider: 'copilot', title: 'Copilot session' },
			{ provider: 'codex', title: 'Codex session' },
			{ provider: 'claude-code', title: 'Claude Code session' },
			{ provider: 'cursor', title: 'Cursor session' },
		]);
	});
});
