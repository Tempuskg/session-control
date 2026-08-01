import * as path from 'node:path';
import {
	type AutoSaveSourceValidationDiagnostic,
	type AutoSaveWorkspaceProfileKind,
} from './autoSaveDiagnostics';
import { deriveChatSessionsPath } from './sessionReader';

export const COPILOT_WORKSPACE_SESSION_FORMATS = ['json', 'jsonl'] as const;

export interface CopilotWorkspaceStorageUriLike {
	fsPath: string;
	scheme?: string;
}

export interface CopilotWorkspaceFolderLike {
	uri: {
		fsPath: string;
		scheme: string;
	};
}

interface CopilotWorkspaceStoreResolutionDeps {
	isDirectory: (candidatePath: string) => boolean;
	pathExists: (candidatePath: string) => boolean;
}

export interface CopilotWorkspaceStoreResolutionInput {
	storageUri: CopilotWorkspaceStorageUriLike | undefined;
	workspaceFolder: CopilotWorkspaceFolderLike;
	workspaceFolderCount: number;
	remoteName: string | undefined;
}

interface CopilotWorkspaceStoreResolutionBase {
	resolvedPath: string;
	pathExists: boolean;
	validation: AutoSaveSourceValidationDiagnostic;
}

export interface ResolvedCopilotWorkspaceStore extends CopilotWorkspaceStoreResolutionBase {
	kind: 'resolved';
	workspaceStorePath: string;
	sessionsDirectory: string;
}

export interface RejectedCopilotWorkspaceStore extends CopilotWorkspaceStoreResolutionBase {
	kind: 'rejected';
}

export type CopilotWorkspaceStoreResolution =
	| ResolvedCopilotWorkspaceStore
	| RejectedCopilotWorkspaceStore;

interface CopilotWorkspaceStoreCandidate {
	workspaceStorePath: string;
	sessionsDirectory: string;
	profileKind: AutoSaveWorkspaceProfileKind;
}

function getWorkspaceMode(
	workspaceFolderCount: number,
): AutoSaveSourceValidationDiagnostic['workspaceMode'] {
	if (workspaceFolderCount === 1) {
		return 'single-root';
	}

	return workspaceFolderCount > 1 ? 'multi-root' : 'no-workspace';
}

function getProfileKind(storagePath: string): AutoSaveWorkspaceProfileKind {
	const segments = path.normalize(storagePath).split(/[\\/]+/).filter(Boolean);
	let workspaceStorageIndex = -1;
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		if (segments[index]?.toLowerCase() === 'workspacestorage') {
			workspaceStorageIndex = index;
			break;
		}
	}
	if (
		workspaceStorageIndex >= 2
		&& segments[workspaceStorageIndex - 2]?.toLowerCase() === 'profiles'
	) {
		return 'profile';
	}

	return workspaceStorageIndex >= 0 ? 'default' : 'unknown';
}

function getWorkspaceStoreCandidate(
	storageUri: CopilotWorkspaceStorageUriLike | undefined,
): CopilotWorkspaceStoreCandidate | undefined {
	if (!storageUri?.fsPath || !path.isAbsolute(storageUri.fsPath)) {
		return undefined;
	}

	const workspaceStorePath = path.dirname(storageUri.fsPath);
	const workspaceStorageRoot = path.dirname(workspaceStorePath);
	if (path.basename(workspaceStorageRoot).toLowerCase() !== 'workspacestorage') {
		return undefined;
	}

	return {
		workspaceStorePath,
		sessionsDirectory: deriveChatSessionsPath(storageUri.fsPath),
		profileKind: getProfileKind(storageUri.fsPath),
	};
}

function createValidation(
	input: CopilotWorkspaceStoreResolutionInput,
	status: AutoSaveSourceValidationDiagnostic['status'],
	reason: string,
	candidate: CopilotWorkspaceStoreCandidate | undefined,
): AutoSaveSourceValidationDiagnostic {
	const storageScheme = input.storageUri?.scheme ?? 'file';
	const hostKind = input.remoteName || storageScheme !== 'file'
		|| input.workspaceFolder.uri.scheme !== 'file'
		? 'remote'
		: 'local';

	return {
		status,
		reason,
		workspaceMode: getWorkspaceMode(input.workspaceFolderCount),
		hostKind,
		profileKind: candidate?.profileKind ?? 'unknown',
		supportedFormats: [...COPILOT_WORKSPACE_SESSION_FORMATS],
		...(candidate ? { workspaceStorePath: candidate.workspaceStorePath } : {}),
	};
}

export function resolveCopilotWorkspaceStore(
	input: CopilotWorkspaceStoreResolutionInput,
	deps: CopilotWorkspaceStoreResolutionDeps,
): CopilotWorkspaceStoreResolution {
	const candidate = getWorkspaceStoreCandidate(input.storageUri);
	const resolvedPath = candidate?.sessionsDirectory
		?? input.storageUri?.fsPath
		?? '<unresolved>';
	const pathExists = candidate ? deps.pathExists(candidate.sessionsDirectory) : false;

	if (!input.storageUri) {
		return {
			kind: 'rejected',
			resolvedPath,
			pathExists,
			validation: createValidation(
				input,
				'rejected',
				'ExtensionContext.storageUri is unavailable for this workspace.',
				candidate,
			),
		};
	}

	const storageScheme = input.storageUri.scheme ?? 'file';
	if (
		input.remoteName
		|| storageScheme !== 'file'
		|| input.workspaceFolder.uri.scheme !== 'file'
	) {
		return {
			kind: 'rejected',
			resolvedPath,
			pathExists,
			validation: createValidation(
				input,
				'unsupported',
				'Remote VS Code hosts are unsupported because the current Copilot reader and watcher require local file paths.',
				candidate,
			),
		};
	}

	if (input.workspaceFolderCount !== 1) {
		const reason = input.workspaceFolderCount > 1
			? 'The VS Code workspace store belongs to the whole multi-root workspace, so its owning folder is ambiguous; the active editor is not used to guess.'
			: 'No workspace folder is available to own the VS Code workspace store.';
		return {
			kind: 'rejected',
			resolvedPath,
			pathExists,
			validation: createValidation(input, 'rejected', reason, candidate),
		};
	}

	if (!candidate) {
		return {
			kind: 'rejected',
			resolvedPath,
			pathExists,
			validation: createValidation(
				input,
				'rejected',
				'ExtensionContext.storageUri is not an absolute workspaceStorage/<workspace-id>/<extension-id> path.',
				candidate,
			),
		};
	}

	if (!deps.isDirectory(candidate.workspaceStorePath)) {
		return {
			kind: 'rejected',
			resolvedPath,
			pathExists,
			validation: createValidation(
				input,
				'rejected',
				'The resolved VS Code workspace store directory does not exist or is not a directory.',
				candidate,
			),
		};
	}

	return {
		kind: 'resolved',
		workspaceStorePath: candidate.workspaceStorePath,
		sessionsDirectory: candidate.sessionsDirectory,
		resolvedPath,
		pathExists,
		validation: createValidation(
			input,
			'validated',
			'Resolved from ExtensionContext.storageUri for the sole open workspace folder.',
			candidate,
		),
	};
}
