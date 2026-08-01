import * as assert from 'node:assert';
import {
	buildAutoSaveDiagnosticReport,
	buildAutoSaveStatusTooltip,
	createAutoSaveDiagnosticState,
} from '../../src/autoSaveDiagnostics';

suite('auto-save diagnostic state', () => {
	test('records path, event, scan, skip, success, and error diagnostics', () => {
		const instants = [
			'2026-07-29T20:00:00.000Z',
			'2026-07-29T20:00:01.000Z',
			'2026-07-29T20:00:02.000Z',
			'2026-07-29T20:00:03.000Z',
			'2026-07-29T20:00:04.000Z',
		];
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => {
				const instant = instants.shift();
				assert.ok(instant);
				return instant;
			},
		});

		diagnosticState.registerSource(
			'copilot-vscode',
			'C:/storage/chatSessions',
			true,
			{
				status: 'validated',
				reason: 'Resolved from ExtensionContext.storageUri.',
				workspaceMode: 'single-root',
				hostKind: 'local',
				profileKind: 'profile',
				supportedFormats: ['json', 'jsonl'],
				workspaceStorePath: 'C:/storage',
			},
		);
		diagnosticState.recordEvent(
			'copilot-vscode',
			'change',
			'C:/storage/chatSessions/session.jsonl',
		);
		diagnosticState.recordScan('copilot-vscode', 2);
		diagnosticState.recordSkip('copilot-vscode', 'Turn count unchanged (4).');
		diagnosticState.recordSuccess(
			'copilot-vscode',
			'session-1',
			['session-1.json'],
		);
		diagnosticState.recordError('copilot-vscode', new Error('transcript became unreadable'));

		assert.deepEqual(diagnosticState.getSource('copilot-vscode'), {
			sourceId: 'copilot-vscode',
			resolvedPath: 'C:/storage/chatSessions',
			pathExists: true,
			health: 'degraded',
			disabled: false,
			warningShown: false,
			validation: {
				status: 'validated',
				reason: 'Resolved from ExtensionContext.storageUri.',
				workspaceMode: 'single-root',
				hostKind: 'local',
				profileKind: 'profile',
				supportedFormats: ['json', 'jsonl'],
				workspaceStorePath: 'C:/storage',
			},
			lastEvent: {
				at: '2026-07-29T20:00:00.000Z',
				kind: 'change',
				sourcePath: 'C:/storage/chatSessions/session.jsonl',
			},
			lastScan: {
				at: '2026-07-29T20:00:01.000Z',
				candidateCount: 2,
			},
			skipReason: {
				at: '2026-07-29T20:00:02.000Z',
				reason: 'Turn count unchanged (4).',
			},
			lastSuccess: {
				at: '2026-07-29T20:00:03.000Z',
				sourceSessionId: 'session-1',
				fileNames: ['session-1.json'],
			},
			lastError: {
				at: '2026-07-29T20:00:04.000Z',
				message: 'transcript became unreadable',
			},
		});
	});

	test('keeps each source diagnostic independent', () => {
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-29T21:00:00.000Z',
		});
		diagnosticState.registerSource('codex-cli', 'C:/Users/test/.codex', true);
		diagnosticState.registerSource('claude-code-cli', 'C:/Users/test/.claude', true);
		diagnosticState.recordScan('codex-cli', 1);
		diagnosticState.recordSuccess('codex-cli', 'codex-session', ['codex.json']);
		const codexBeforeClaudeFailure = diagnosticState.getSource('codex-cli');

		diagnosticState.recordScan('claude-code-cli');
		diagnosticState.recordError('claude-code-cli', new Error('invalid JSONL'));

		assert.deepEqual(diagnosticState.getSource('codex-cli'), codexBeforeClaudeFailure);
		assert.equal(
			diagnosticState.getSource('claude-code-cli')?.lastError?.message,
			'invalid JSONL',
		);
		assert.equal(diagnosticState.getAll().length, 2);
	});

	test('recovers only the affected source failure and retry state', () => {
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-30T18:00:00.000Z',
		});
		diagnosticState.registerSource('codex-cli', 'C:/Users/test/.codex', true);
		diagnosticState.registerSource('claude-code-cli', 'C:/Users/test/.claude', true);
		diagnosticState.recordFailure(
			'codex-cli',
			new SyntaxError('Invalid Codex JSON'),
			true,
		);
		diagnosticState.recordRetry('codex-cli', 2, 60_000);
		diagnosticState.recordFailure(
			'claude-code-cli',
			new Error('Claude path is unavailable'),
			true,
		);
		diagnosticState.recordRetry('claude-code-cli', 1, 60_000);
		const claudeFailure = diagnosticState.getSource('claude-code-cli');

		diagnosticState.recordRecovery('codex-cli');

		const codexRecovery = diagnosticState.getSource('codex-cli');
		assert.equal(codexRecovery?.health, 'healthy');
		assert.equal(codexRecovery?.disabled, false);
		assert.equal(codexRecovery?.warningShown, false);
		assert.equal(codexRecovery?.lastError, undefined);
		assert.equal(codexRecovery?.lastRetry, undefined);
		assert.deepEqual(
			diagnosticState.getSource('claude-code-cli'),
			claudeFailure,
		);
	});

	test('builds a complete metadata-only copyable report', () => {
		const promptContentMarker = 'PROMPT-CONTENT-MUST-NOT-APPEAR';
		const responseContentMarker = 'RESPONSE-CONTENT-MUST-NOT-APPEAR';
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => '2026-07-30T20:00:00.000Z',
		});
		diagnosticState.registerSource(
			'copilot-vscode',
			'C:/profiles/profile-1/workspaceStorage/workspace-1/chatSessions',
			true,
			{
				status: 'validated',
				reason: 'Resolved from active profile storage.',
				workspaceMode: 'single-root',
				hostKind: 'local',
				profileKind: 'profile',
				supportedFormats: ['json', 'jsonl'],
				workspaceStorePath: 'C:/profiles/profile-1/workspaceStorage/workspace-1',
			},
		);
		diagnosticState.recordEvent(
			'copilot-vscode',
			'change',
			'C:/profiles/profile-1/workspaceStorage/workspace-1/chatSessions/session.jsonl',
		);
		diagnosticState.recordScan('copilot-vscode', 3);
		diagnosticState.recordSkip('copilot-vscode', promptContentMarker);
		diagnosticState.recordSuccess(
			'copilot-vscode',
			'session-1',
			[`${promptContentMarker}.json`, `${responseContentMarker}.json`],
		);
		diagnosticState.recordError(
			'copilot-vscode',
			new Error(responseContentMarker),
		);

		const report = buildAutoSaveDiagnosticReport({
			generatedAt: '2026-07-30T20:01:00.000Z',
			workspaceName: 'chat-commit',
			workspacePath: 'E:/chat-commit',
			storagePath: 'E:/chat-commit/.chat',
			enabled: true,
			selectedProviders: ['copilot', 'codex'],
			sources: diagnosticState.getAll(),
		});

		assert.match(report, /Workspace path: E:\/chat-commit/);
		assert.match(report, /Storage path: E:\/chat-commit\/\.chat/);
		assert.match(report, /Enablement: enabled/);
		assert.match(report, /Selected providers: copilot, codex/);
		assert.match(report, /Source path: C:\/profiles\/profile-1/);
		assert.match(report, /Match strategy:/);
		assert.match(report, /Watcher state: watching/);
		assert.match(report, /Events: change at 2026-07-30T20:00:00.000Z/);
		assert.match(report, /Scans: last at 2026-07-30T20:00:00.000Z/);
		assert.match(report, /Candidates: 3/);
		assert.match(report, /Skips: last at 2026-07-30T20:00:00.000Z/);
		assert.match(report, /Successes: last at 2026-07-30T20:00:00.000Z; provider=Copilot; output files=2/);
		assert.match(report, /Errors: last at 2026-07-30T20:00:00.000Z/);
		assert.match(report, /Remote host: local/);
		assert.match(report, /Remote limit:/);
		assert.match(report, /Profile detection: profile/);
		assert.match(report, /Profile limit:/);
		assert.doesNotMatch(report, new RegExp(promptContentMarker));
		assert.doesNotMatch(report, new RegExp(responseContentMarker));
	});

	test('summarizes source health and the most recent successful provider in the tooltip', () => {
		const instants = [
			'2026-07-30T20:00:00.000Z',
			'2026-07-30T20:02:00.000Z',
			'2026-07-30T20:03:00.000Z',
		];
		let changeCount = 0;
		const diagnosticState = createAutoSaveDiagnosticState({
			now: () => {
				const instant = instants.shift();
				assert.ok(instant);
				return instant;
			},
			onDidChange: () => {
				changeCount += 1;
			},
		});
		diagnosticState.registerSource('copilot-cli', 'C:/Users/test/.copilot/session-state', true);
		diagnosticState.registerSource('codex-cli', 'C:/Users/test/.codex', true);
		diagnosticState.registerSource('cursor-cli', 'C:/Users/test/.cursor/projects/chat-commit', true);
		diagnosticState.recordSuccess('copilot-cli', 'copilot-session', ['copilot.json']);
		diagnosticState.recordSuccess('codex-cli', 'codex-session', ['codex.json']);
		diagnosticState.recordError('cursor-cli', new Error('unreadable source'));

		const tooltip = buildAutoSaveStatusTooltip(
			'chat-commit',
			true,
			diagnosticState.getAll(),
		);

		assert.match(tooltip, /Healthy sources: 2/);
		assert.match(tooltip, /Attention sources: 1/);
		assert.match(
			tooltip,
			/Last successful provider\/time: Codex at 2026-07-30T20:02:00.000Z/,
		);
		assert.equal(changeCount, 6);
	});
});
