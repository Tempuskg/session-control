import * as assert from 'node:assert';
import { createGitIntegration } from '../../src/gitIntegration';

type FakeRepository = {
	rootUri: { toString(): string };
	state: {
		HEAD?: {
			name?: string;
			commit?: string;
		};
		workingTreeChanges?: unknown[];
		indexChanges?: unknown[];
		mergeChanges?: unknown[];
	};
};

function createRepo(
	root: string,
	branch: string,
	commit: string,
	dirty: boolean,
): FakeRepository {
	return {
		rootUri: { toString: () => root },
		state: {
			HEAD: { name: branch, commit },
			workingTreeChanges: dirty ? [{}] : [],
			indexChanges: [],
			mergeChanges: [],
		},
	};
}

suite('gitIntegration', () => {
	test('returns null and warns once when git extension is missing', async () => {
		const messages: string[] = [];
		const integration = createGitIntegration({
			getGitExtension: () => undefined,
			showInformationMessage: async (message: string) => {
				messages.push(message);
			},
		});

		const workspace = { toString: () => 'file:///workspace' };
		const first = await integration.getGitContext(workspace);
		const second = await integration.getGitContext(workspace);

		assert.equal(first, null);
		assert.equal(second, null);
		assert.equal(messages.length, 1);
	});

	test('returns null when no repository matches workspace folder', async () => {
		const integration = createGitIntegration({
			getGitExtension: () => ({
				isActive: true,
				exports: {
					getAPI: () => ({
						repositories: [createRepo('file:///other', 'main', 'abc123', false)],
					}),
				},
				activate: async () => ({
					getAPI: () => ({
						repositories: [createRepo('file:///other', 'main', 'abc123', false)],
					}),
				}),
			}),
			showInformationMessage: async () => undefined,
		});

		const result = await integration.getGitContext({ toString: () => 'file:///workspace' });
		assert.equal(result, null);
	});

	test('selects the best matching repository and returns git context', async () => {
		const repositories = [
			createRepo('file:///workspace', 'main', 'aaa111', false),
			createRepo('file:///workspace/packages/app', 'feature/auth', 'bbb222', true),
		];

		const integration = createGitIntegration({
			getGitExtension: () => ({
				isActive: true,
				exports: {
					getAPI: () => ({ repositories }),
				},
				activate: async () => ({
					getAPI: () => ({ repositories }),
				}),
			}),
			showInformationMessage: async () => undefined,
		});

		const result = await integration.getGitContext({
			toString: () => 'file:///workspace/packages/app/src',
		});

		assert.ok(result);
		assert.equal(result?.branch, 'feature/auth');
		assert.equal(result?.commit, 'bbb222');
		assert.equal(result?.dirty, true);
	});

	test('returns null when repository has no commit yet', async () => {
		const repositories: FakeRepository[] = [
			{
				rootUri: { toString: () => 'file:///workspace' },
				state: {
					HEAD: { name: 'main', commit: '' },
					workingTreeChanges: [],
					indexChanges: [],
					mergeChanges: [],
				},
			},
		];

		const integration = createGitIntegration({
			getGitExtension: () => ({
				isActive: true,
				exports: {
					getAPI: () => ({ repositories }),
				},
				activate: async () => ({
					getAPI: () => ({ repositories }),
				}),
			}),
			showInformationMessage: async () => undefined,
		});

		const result = await integration.getGitContext({ toString: () => 'file:///workspace' });
		assert.equal(result, null);
	});
});
