import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	CURSOR_CLI_SOURCE_ID,
	createCursorCliSessionReader,
	resolveCursorCliSessionLocation,
} from '../../src/cursorCliSessionReader';
import { CURSOR_IDE_LEGACY_SOURCE_ID } from '../../src/cursorSessionReader';

interface CursorCliFixtureContract {
	provider: string;
	observedRealSessionCliVersion: string;
	contractReverifiedCliVersion: string;
	location: string;
	sessionIdentity: string;
	workingDirectory: string;
	projectSlug: string;
	turns: {
		initialFixture: string;
		initialNormalizedRecords: number;
		continuedFixture: string;
		continuedNormalizedRecords: number;
	};
	continuation: {
		command: string;
		behavior: string;
		syntheticFollowUp: boolean;
	};
	separateCompatibilitySource: {
		sourceId: string;
		description: string;
	};
}

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureDirectory = path.join(
	repositoryRoot,
	'test',
	'fixtures',
	'cursor-cli',
	'verified-session',
);

async function readFixtureContract(): Promise<CursorCliFixtureContract> {
	const content = await fs.readFile(path.join(fixtureDirectory, 'contract.json'), 'utf8');
	return JSON.parse(content) as CursorCliFixtureContract;
}

async function writeFixtureTranscript(
	fixtureName: string,
	transcriptPath: string,
): Promise<void> {
	await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
	await fs.copyFile(path.join(fixtureDirectory, fixtureName), transcriptPath);
}

suite('cursorCliSessionReader', () => {
	test('records the verified Cursor CLI session contract and separate IDE source', async () => {
		const contract = await readFixtureContract();

		assert.equal(contract.provider, CURSOR_CLI_SOURCE_ID);
		assert.match(contract.observedRealSessionCliVersion, /^2026\.06\.19-/);
		assert.equal(contract.contractReverifiedCliVersion, '2026.07.23-e383d2b');
		assert.equal(contract.location.includes('/.cursor/projects/'), true);
		assert.equal(contract.location.includes(contract.sessionIdentity), true);
		assert.equal(contract.workingDirectory.length > 0, true);
		assert.equal(contract.projectSlug.length > 0, true);
		assert.equal(contract.turns.initialNormalizedRecords, 3);
		assert.equal(contract.turns.continuedNormalizedRecords, 5);
		assert.equal(contract.continuation.command.includes(contract.sessionIdentity), true);
		assert.equal(contract.continuation.behavior.includes('same UUID-named JSONL'), true);
		assert.equal(contract.continuation.syntheticFollowUp, true);
		assert.equal(
			contract.separateCompatibilitySource.sourceId,
			CURSOR_IDE_LEGACY_SOURCE_ID,
		);
		assert.notEqual(CURSOR_CLI_SOURCE_ID, CURSOR_IDE_LEGACY_SOURCE_ID);
	});

	test('positively locates the workspace project and rejects a second project session', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-cli-match-'));
		const projectsPath = path.join(root, '.cursor', 'projects');
		const workspacePath = path.join(root, 'workspaces', 'current-project');
		const otherWorkspacePath = path.join(root, 'workspaces', 'other-project');
		const contract = await readFixtureContract();
		const currentLocation = resolveCursorCliSessionLocation(workspacePath, projectsPath);
		const otherLocation = resolveCursorCliSessionLocation(otherWorkspacePath, projectsPath);
		const otherSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
		const currentTranscriptPath = path.join(
			currentLocation.agentTranscriptsDirectory,
			contract.sessionIdentity,
			`${contract.sessionIdentity}.jsonl`,
		);
		const otherTranscriptPath = path.join(
			otherLocation.agentTranscriptsDirectory,
			otherSessionId,
			`${otherSessionId}.jsonl`,
		);

		try {
			await fs.mkdir(workspacePath, { recursive: true });
			await fs.mkdir(otherWorkspacePath, { recursive: true });
			await writeFixtureTranscript(contract.turns.continuedFixture, currentTranscriptPath);
			await writeFixtureTranscript(contract.turns.initialFixture, otherTranscriptPath);

			const reader = createCursorCliSessionReader();
			const currentSessions = await reader.readCursorCliSessions(
				workspacePath,
				projectsPath,
			);
			const otherSessions = await reader.readCursorCliSessions(
				otherWorkspacePath,
				projectsPath,
			);

			assert.equal(currentLocation.sourceId, CURSOR_CLI_SOURCE_ID);
			assert.equal(currentSessions.length, 1);
			assert.equal(currentSessions[0]?.id, contract.sessionIdentity);
			assert.equal(currentSessions[0]?.cwd, path.resolve(workspacePath));
			assert.equal(currentSessions.some((session) => session.id === otherSessionId), false);
			assert.equal(otherSessions.length, 1);
			assert.equal(otherSessions[0]?.id, otherSessionId);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('continuation updates the same logical session and adds turns', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-cli-resume-'));
		const projectsPath = path.join(root, '.cursor', 'projects');
		const workspacePath = path.join(root, 'workspaces', 'continued-project');
		const contract = await readFixtureContract();
		const location = resolveCursorCliSessionLocation(workspacePath, projectsPath);
		const transcriptPath = path.join(
			location.agentTranscriptsDirectory,
			contract.sessionIdentity,
			`${contract.sessionIdentity}.jsonl`,
		);
		const reader = createCursorCliSessionReader();

		try {
			await fs.mkdir(workspacePath, { recursive: true });
			await writeFixtureTranscript(contract.turns.initialFixture, transcriptPath);
			const initialSessions = await reader.readCursorCliSessions(
				workspacePath,
				projectsPath,
			);

			await writeFixtureTranscript(contract.turns.continuedFixture, transcriptPath);
			const continuedSessions = await reader.readCursorCliSessions(
				workspacePath,
				projectsPath,
			);

			assert.equal(initialSessions.length, 1);
			assert.equal(initialSessions[0]?.id, contract.sessionIdentity);
			assert.equal(
				initialSessions[0]?.turns.length,
				contract.turns.initialNormalizedRecords,
			);
			assert.equal(continuedSessions.length, 1);
			assert.equal(continuedSessions[0]?.id, initialSessions[0]?.id);
			assert.equal(
				continuedSessions[0]?.turns.length,
				contract.turns.continuedNormalizedRecords,
			);
			assert.equal(continuedSessions[0]?.sourceFile, contract.sessionIdentity);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
