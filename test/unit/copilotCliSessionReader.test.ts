import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	createCopilotCliSessionReader,
	deriveCopilotCliSessionStatePath,
	resolveCopilotCliHomePath,
} from '../../src/copilotCliSessionReader';

const fixtureSessionId = '84a4c0f6-321d-401d-907a-72d94089b85e';
const fixtureWorkspacePath = 'E:\\chat-commit';

function getFixtureEventsPath(): string {
	const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
	return path.join(
		repositoryRoot,
		'test',
		'fixtures',
		'copilot-cli',
		'session-state',
		fixtureSessionId,
		'events.jsonl',
	);
}

async function copyFixtureToHome(copilotHomePath: string): Promise<string> {
	const sessionDirectory = path.join(
		deriveCopilotCliSessionStatePath(copilotHomePath),
		fixtureSessionId,
	);
	await fs.mkdir(sessionDirectory, { recursive: true });
	const eventsPath = path.join(sessionDirectory, 'events.jsonl');
	await fs.copyFile(getFixtureEventsPath(), eventsPath);
	return eventsPath;
}

async function createTemporaryRoot(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'session-control-copilot-cli-reader-'));
}

suite('copilotCliSessionReader', () => {
	test('uses an explicit home override before COPILOT_HOME', async () => {
		const root = await createTemporaryRoot();
		const overrideHome = path.join(root, 'configured-copilot-home');
		const environmentHome = path.join(root, 'environment-copilot-home');

		try {
			await copyFixtureToHome(overrideHome);
			const reader = createCopilotCliSessionReader({
				getEnvironment: () => ({ COPILOT_HOME: environmentHome }),
				getUserHome: () => path.join(root, 'user-home'),
				logWarning: () => undefined,
			});

			const sessions = await reader.readCopilotCliSessions({
				workspacePath: fixtureWorkspacePath,
				homePath: overrideHome,
			});

			assert.equal(
				resolveCopilotCliHomePath(overrideHome, { COPILOT_HOME: environmentHome }, path.join(root, 'user-home')),
				overrideHome,
			);
			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.sourceFile, path.join(overrideHome, 'session-state', fixtureSessionId, 'events.jsonl'));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('uses COPILOT_HOME when no home override is configured', async () => {
		const root = await createTemporaryRoot();
		const environmentHome = path.join(root, 'environment-copilot-home');

		try {
			await copyFixtureToHome(environmentHome);
			const reader = createCopilotCliSessionReader({
				getEnvironment: () => ({ COPILOT_HOME: environmentHome }),
				getUserHome: () => path.join(root, 'user-home'),
				logWarning: () => undefined,
			});

			const sessions = await reader.readCopilotCliSessions({
				workspacePath: fixtureWorkspacePath,
			});

			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.sourceFile, path.join(environmentHome, 'session-state', fixtureSessionId, 'events.jsonl'));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('defaults to ~/.copilot when no override or environment value exists', async () => {
		const root = await createTemporaryRoot();
		const userHome = path.join(root, 'user-home');
		const defaultCopilotHome = path.join(userHome, '.copilot');

		try {
			await copyFixtureToHome(defaultCopilotHome);
			const reader = createCopilotCliSessionReader({
				getEnvironment: () => ({}),
				getUserHome: () => userHome,
				logWarning: () => undefined,
			});

			const sessions = await reader.readCopilotCliSessions({
				workspacePath: fixtureWorkspacePath,
			});

			assert.equal(resolveCopilotCliHomePath(undefined, {}, userHome), defaultCopilotHome);
			assert.equal(sessions.length, 1);
			assert.equal(sessions[0]?.sourceFile, path.join(defaultCopilotHome, 'session-state', fixtureSessionId, 'events.jsonl'));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('returns no sessions when the resolved session-state path is missing', async () => {
		const root = await createTemporaryRoot();

		try {
			const reader = createCopilotCliSessionReader({
				getEnvironment: () => ({}),
				getUserHome: () => root,
				logWarning: () => undefined,
			});

			const sessions = await reader.readCopilotCliSessions({
				workspacePath: fixtureWorkspacePath,
			});

			assert.deepEqual(sessions, []);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('normalizes identity, working directory, turns, timestamps, tools, and a stable revision', async () => {
		const root = await createTemporaryRoot();
		const copilotHome = path.join(root, '.copilot');

		try {
			const eventsPath = await copyFixtureToHome(copilotHome);
			const reader = createCopilotCliSessionReader({
				getEnvironment: () => ({}),
				getUserHome: () => root,
				logWarning: () => undefined,
			});

			const firstRead = await reader.readCopilotCliSessions({
				workspacePath: 'e:\\CHAT-COMMIT',
				homePath: copilotHome,
			});
			const firstSession = firstRead[0];
			assert.ok(firstSession);
			assert.equal(firstSession.provider, 'copilot');
			assert.equal(firstSession.id, fixtureSessionId);
			assert.equal(firstSession.cwd, fixtureWorkspacePath);
			assert.equal(firstSession.title, 'Add Copilot CLI session adapter');
			assert.equal(firstSession.lastMessageDate, '2026-07-29T13:59:37.917Z');
			assert.equal(firstSession.turns.length, 3);

			const requestTurn = firstSession.turns[0];
			assert.equal(requestTurn?.type, 'request');
			if (requestTurn?.type === 'request') {
				assert.equal(requestTurn.prompt, 'Add a GitHub Copilot CLI session adapter.');
				assert.deepEqual(requestTurn.references, ['src/extension.ts']);
				assert.equal(requestTurn.timestamp, '2026-07-29T13:59:25.600Z');
			}

			const toolResponse = firstSession.turns[1];
			assert.equal(toolResponse?.type, 'response');
			if (toolResponse?.type === 'response') {
				assert.equal(toolResponse.content, 'I will inspect the auto-save wiring.');
				assert.equal(toolResponse.timestamp, '2026-07-29T13:59:26.000Z');
				assert.deepEqual(toolResponse.toolCalls, [{
					name: 'grep',
					arguments: '{"query":"session-state","path":"src"}',
					output: 'src/extension.ts: Copilot watcher wiring',
				}]);
			}

			assert.match(firstSession.sourceRevision, /^sha256:[a-f0-9]{64}$/);
			const fixtureContent = await fs.readFile(eventsPath, 'utf8');
			await fs.writeFile(
				eventsPath,
				`${fixtureContent.replace(/\r?\n/g, '\r\n').trimEnd()}\r\n`,
				'utf8',
			);
			const secondRead = await reader.readCopilotCliSessions({
				workspacePath: fixtureWorkspacePath,
				homePath: copilotHome,
			});
			assert.equal(secondRead[0]?.sourceRevision, firstSession.sourceRevision);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('includes only sessions whose working directory matches the project', async () => {
		const root = await createTemporaryRoot();
		const copilotHome = path.join(root, '.copilot');

		try {
			await copyFixtureToHome(copilotHome);
			const reader = createCopilotCliSessionReader({
				getEnvironment: () => ({}),
				getUserHome: () => root,
				logWarning: () => undefined,
			});

			const projectSessions = await reader.readCopilotCliSessions({
				workspacePath: 'E:\\chat-commit\\src',
				homePath: copilotHome,
			});
			const otherProjectSessions = await reader.readCopilotCliSessions({
				workspacePath: 'E:\\another-project',
				homePath: copilotHome,
			});

			assert.equal(projectSessions.length, 1);
			assert.deepEqual(otherProjectSessions, []);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('reads only session-state event logs and never reads provider database or settings state', async () => {
		const fixtureContent = await fs.readFile(getFixtureEventsPath(), 'utf8');
		const readPaths: string[] = [];
		const listedPaths: string[] = [];
		const copilotHome = path.join('C:', 'sanitized-user', '.copilot');
		const reader = createCopilotCliSessionReader({
			listSessionDirectories: async (directoryPath) => {
				listedPaths.push(directoryPath);
				return [fixtureSessionId];
			},
			readFile: async (filePath) => {
				readPaths.push(filePath);
				return fixtureContent;
			},
			getEnvironment: () => ({}),
			getUserHome: () => path.join('C:', 'sanitized-user'),
			logWarning: () => undefined,
		});

		const sessions = await reader.readCopilotCliSessions({
			workspacePath: fixtureWorkspacePath,
			homePath: copilotHome,
		});

		assert.equal(sessions.length, 1);
		assert.deepEqual(listedPaths, [path.join(copilotHome, 'session-state')]);
		assert.deepEqual(readPaths, [
			path.join(copilotHome, 'session-state', fixtureSessionId, 'events.jsonl'),
		]);
		assert.equal(
			[...listedPaths, ...readPaths].some((filePath) =>
				/session-store\.db|settings\.json|config\.json/i.test(filePath)),
			false,
		);
	});
});
