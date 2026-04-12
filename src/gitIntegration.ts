import * as vscode from 'vscode';
import { GitContext } from './types';

interface WorkspaceUriLike {
	toString(): string;
}

interface HeadLike {
	name?: string;
	commit?: string;
}

interface RepositoryStateLike {
	HEAD?: HeadLike;
	workingTreeChanges?: unknown[];
	indexChanges?: unknown[];
	mergeChanges?: unknown[];
}

interface RepositoryLike {
	rootUri: WorkspaceUriLike;
	state: RepositoryStateLike;
}

interface GitApiLike {
	repositories: RepositoryLike[];
}

interface GitExportsLike {
	getAPI(version: number): GitApiLike;
}

interface GitExtensionLike {
	isActive: boolean;
	exports: GitExportsLike | undefined;
	activate(): Promise<GitExportsLike>;
}

interface GitIntegrationDeps {
	getGitExtension(): GitExtensionLike | undefined;
	showInformationMessage(message: string): Thenable<unknown>;
}

const MISSING_GIT_MESSAGE = 'Git extension not available. Sessions will be saved without git metadata.';

function normalizeUri(value: string): string {
	return value.replace(/\/+$/g, '').toLowerCase();
}

function computeDirtyState(state: RepositoryStateLike): boolean {
	return (
		(state.workingTreeChanges?.length ?? 0) > 0
		|| (state.indexChanges?.length ?? 0) > 0
		|| (state.mergeChanges?.length ?? 0) > 0
	);
}

function pickRepository(workspaceFolder: WorkspaceUriLike, repositories: RepositoryLike[]): RepositoryLike | undefined {
	const target = normalizeUri(workspaceFolder.toString());

	const sorted = [...repositories].sort(
		(a, b) => normalizeUri(b.rootUri.toString()).length - normalizeUri(a.rootUri.toString()).length,
	);

	return sorted.find((repository) => {
		const root = normalizeUri(repository.rootUri.toString());
		return target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`);
	});
}

function createDefaultDeps(): GitIntegrationDeps {
	return {
		getGitExtension: () => vscode.extensions.getExtension<GitExportsLike>('vscode.git') as GitExtensionLike | undefined,
		showInformationMessage: (message: string) => vscode.window.showInformationMessage(message),
	};
}

export function createGitIntegration(overrides: Partial<GitIntegrationDeps> = {}): {
	getGitContext(workspaceFolder: WorkspaceUriLike): Promise<GitContext | null>;
} {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	let didWarnMissingGit = false;

	async function notifyMissingGitOnce(): Promise<void> {
		if (didWarnMissingGit) {
			return;
		}

		didWarnMissingGit = true;
		await deps.showInformationMessage(MISSING_GIT_MESSAGE);
	}

	return {
		async getGitContext(workspaceFolder: WorkspaceUriLike): Promise<GitContext | null> {
			const extension = deps.getGitExtension();
			if (!extension) {
				await notifyMissingGitOnce();
				return null;
			}

			const gitExports = extension.isActive ? extension.exports : await extension.activate();
			if (!gitExports || typeof gitExports.getAPI !== 'function') {
				await notifyMissingGitOnce();
				return null;
			}

			const gitApi = gitExports.getAPI(1);
			if (!gitApi.repositories.length) {
				return null;
			}

			const repository = pickRepository(workspaceFolder, gitApi.repositories);
			if (!repository) {
				return null;
			}

			const branch = repository.state.HEAD?.name ?? 'detached';
			const commit = repository.state.HEAD?.commit ?? '';
			const dirty = computeDirtyState(repository.state);

			if (!commit) {
				return null;
			}

			return { branch, commit, dirty };
		},
	};
}

const defaultGitIntegration = createGitIntegration();

export async function getGitContext(workspaceFolder: vscode.Uri): Promise<GitContext | null> {
	return defaultGitIntegration.getGitContext(workspaceFolder);
}
