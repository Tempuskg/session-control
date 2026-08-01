import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	resolveCopilotWorkspaceStore,
	type CopilotWorkspaceStoreResolutionInput,
} from '../../src/copilotWorkspaceStore';

function createStoragePath(profileId?: string): string {
	const root = path.parse(process.cwd()).root;
	const userDataPath = profileId
		? path.join(root, 'User', 'profiles', profileId)
		: path.join(root, 'User');
	return path.join(
		userDataPath,
		'workspaceStorage',
		'workspace-id',
		'darrenjmcleod.session-control',
	);
}

function createInput(
	overrides: Partial<CopilotWorkspaceStoreResolutionInput> = {},
): CopilotWorkspaceStoreResolutionInput {
	return {
		storageUri: {
			fsPath: createStoragePath(),
			scheme: 'file',
		},
		workspaceFolder: {
			uri: {
				fsPath: path.join(path.parse(process.cwd()).root, 'workspace'),
				scheme: 'file',
			},
		},
		workspaceFolderCount: 1,
		remoteName: undefined,
		...overrides,
	};
}

function resolve(input: CopilotWorkspaceStoreResolutionInput) {
	const workspaceStorePath = input.storageUri
		? path.dirname(input.storageUri.fsPath)
		: '';
	return resolveCopilotWorkspaceStore(input, {
		isDirectory: (candidatePath) => candidatePath === workspaceStorePath,
		pathExists: () => true,
	});
}

suite('Copilot workspace store resolution', () => {
	test('validates a local single-root workspace store and reports supported formats', () => {
		const input = createInput();
		const result = resolve(input);

		assert.equal(result.kind, 'resolved');
		assert.equal(result.validation.status, 'validated');
		assert.equal(result.validation.workspaceMode, 'single-root');
		assert.equal(result.validation.hostKind, 'local');
		assert.equal(result.validation.profileKind, 'default');
		assert.deepEqual(result.validation.supportedFormats, ['json', 'jsonl']);
		assert.equal(
			result.resolvedPath,
			path.join(path.dirname(input.storageUri?.fsPath ?? ''), 'chatSessions'),
		);
	});

	test('fails closed for multi-root ownership instead of choosing an active folder', () => {
		const result = resolve(createInput({ workspaceFolderCount: 2 }));

		assert.equal(result.kind, 'rejected');
		assert.equal(result.validation.status, 'rejected');
		assert.equal(result.validation.workspaceMode, 'multi-root');
		assert.match(result.validation.reason, /owning folder is ambiguous/i);
		assert.match(result.validation.reason, /active editor is not used/i);
	});

	test('uses the profile-specific workspace store supplied by VS Code', () => {
		const storagePath = createStoragePath('profile-1');
		const result = resolve(createInput({
			storageUri: {
				fsPath: storagePath,
				scheme: 'file',
			},
		}));

		assert.equal(result.kind, 'resolved');
		assert.equal(result.validation.status, 'validated');
		assert.equal(result.validation.profileKind, 'profile');
		assert.equal(result.validation.workspaceStorePath, path.dirname(storagePath));
	});

	test('reports remote hosts as unsupported and does not resolve a watch target', () => {
		const result = resolve(createInput({
			storageUri: {
				fsPath: createStoragePath(),
				scheme: 'vscode-remote',
			},
			workspaceFolder: {
				uri: {
					fsPath: '/workspaces/session-control',
					scheme: 'vscode-remote',
				},
			},
			remoteName: 'ssh-remote',
		}));

		assert.equal(result.kind, 'rejected');
		assert.equal(result.validation.status, 'unsupported');
		assert.equal(result.validation.hostKind, 'remote');
		assert.match(result.validation.reason, /unsupported/i);
	});

	test('rejects a storage URI outside the expected workspaceStorage layout', () => {
		const result = resolve(createInput({
			storageUri: {
				fsPath: path.join(path.parse(process.cwd()).root, 'tmp', 'session-control'),
				scheme: 'file',
			},
		}));

		assert.equal(result.kind, 'rejected');
		assert.equal(result.validation.status, 'rejected');
		assert.match(result.validation.reason, /workspaceStorage/i);
	});

	test('rejects the derived store when its parent is not a directory', () => {
		const result = resolveCopilotWorkspaceStore(createInput(), {
			isDirectory: () => false,
			pathExists: () => false,
		});

		assert.equal(result.kind, 'rejected');
		assert.equal(result.validation.status, 'rejected');
		assert.match(result.validation.reason, /does not exist or is not a directory/i);
	});
});
