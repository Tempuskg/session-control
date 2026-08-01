import type {
	AutoSaveController,
	AutoSaveControllerDisposable,
} from './autoSaveController';

export interface AutoSaveWorkspaceControllerContext<TWorkspaceFolder> {
	workspaceFolder: TWorkspaceFolder;
	workspaceFolderCount: number;
	storageDirectory: string;
}

export interface AutoSaveWorkspaceManagerDeps<TWorkspaceFolder> {
	getWorkspaceFolders: () => readonly TWorkspaceFolder[] | undefined;
	getWorkspaceKey: (workspaceFolder: TWorkspaceFolder) => string;
	isEnabled: (workspaceFolder: TWorkspaceFolder) => boolean;
	getStorageDirectory: (workspaceFolder: TWorkspaceFolder) => string;
	getConfigurationFingerprint: (workspaceFolder: TWorkspaceFolder) => string;
	createController: (
		context: AutoSaveWorkspaceControllerContext<TWorkspaceFolder>,
	) => AutoSaveController;
}

export interface AutoSaveWorkspaceManager extends AutoSaveControllerDisposable {
	sync: () => void;
}

export interface AutoSaveConfigurationChangeEvent {
	affectsConfiguration: (section: string) => boolean;
}

export interface AutoSaveWorkspaceLifecycleDeps<
	TWorkspaceFolder,
	TConfigurationChangeEvent extends AutoSaveConfigurationChangeEvent,
> extends AutoSaveWorkspaceManagerDeps<TWorkspaceFolder> {
	onDidChangeWorkspaceFolders: (
		listener: () => void,
	) => AutoSaveControllerDisposable;
	onDidChangeConfiguration: (
		listener: (event: TConfigurationChangeEvent) => void,
	) => AutoSaveControllerDisposable;
	afterWorkspaceFoldersChanged: () => void;
	afterAutoSaveConfigurationChanged: (
		event: TConfigurationChangeEvent,
	) => void;
}

export const AUTO_SAVE_CONFIGURATION_SECTIONS = [
	'session-control.autoSaveOnChatResponse',
	'session-control.autoSave.providers',
	'session-control.copilot.homePath',
	'session-control.codex.homePath',
	'session-control.claudeCode.homePath',
	'session-control.cursor.projectsPath',
	'session-control.cursor.userDataPath',
	'session-control.storagePath',
] as const;

interface DesiredController<TWorkspaceFolder> {
	context: AutoSaveWorkspaceControllerContext<TWorkspaceFolder>;
	fingerprint: string;
}

interface ManagedController {
	controller: AutoSaveController;
	fingerprint: string;
}

export function createAutoSaveWorkspaceManager<TWorkspaceFolder>(
	deps: AutoSaveWorkspaceManagerDeps<TWorkspaceFolder>,
): AutoSaveWorkspaceManager {
	const controllers = new Map<string, ManagedController>();
	let disposed = false;

	const disposeControllers = (keys: readonly string[]): void => {
		let firstError: unknown;
		for (const key of keys) {
			const managed = controllers.get(key);
			controllers.delete(key);
			if (!managed) {
				continue;
			}

			try {
				managed.controller.dispose();
			} catch (error) {
				firstError ??= error;
			}
		}

		if (firstError !== undefined) {
			throw firstError;
		}
	};

	const sync = (): void => {
		if (disposed) {
			return;
		}

		const workspaceFolders = deps.getWorkspaceFolders() ?? [];
		const desiredControllers = new Map<string, DesiredController<TWorkspaceFolder>>();
		for (const workspaceFolder of workspaceFolders) {
			if (!deps.isEnabled(workspaceFolder)) {
				continue;
			}

			const key = deps.getWorkspaceKey(workspaceFolder);
			const storageDirectory = deps.getStorageDirectory(workspaceFolder);
			const context = {
				workspaceFolder,
				workspaceFolderCount: workspaceFolders.length,
				storageDirectory,
			};
			const fingerprint = JSON.stringify([
				workspaceFolders.length,
				storageDirectory,
				deps.getConfigurationFingerprint(workspaceFolder),
			]);
			desiredControllers.set(key, { context, fingerprint });
		}

		const staleKeys = [...controllers.entries()]
			.filter(([key, managed]) => {
				const desired = desiredControllers.get(key);
				return desired === undefined || desired.fingerprint !== managed.fingerprint;
			})
			.map(([key]) => key);
		disposeControllers(staleKeys);

		for (const [key, desired] of desiredControllers) {
			if (controllers.has(key)) {
				continue;
			}

			const controller = deps.createController(desired.context);
			controllers.set(key, {
				controller,
				fingerprint: desired.fingerprint,
			});
			controller.reconcile();
		}
	};

	return {
		sync,
		dispose: () => {
			if (disposed) {
				return;
			}

			disposed = true;
			disposeControllers([...controllers.keys()]);
		},
	};
}

export function createAutoSaveWorkspaceLifecycle<
	TWorkspaceFolder,
	TConfigurationChangeEvent extends AutoSaveConfigurationChangeEvent,
>(
	deps: AutoSaveWorkspaceLifecycleDeps<TWorkspaceFolder, TConfigurationChangeEvent>,
): AutoSaveWorkspaceManager {
	const manager = createAutoSaveWorkspaceManager(deps);
	const eventDisposables = [
		deps.onDidChangeWorkspaceFolders(() => {
			manager.sync();
			deps.afterWorkspaceFoldersChanged();
		}),
		deps.onDidChangeConfiguration((event) => {
			const affectsAutoSave = AUTO_SAVE_CONFIGURATION_SECTIONS.some(
				(section) => event.affectsConfiguration(section),
			);
			if (!affectsAutoSave) {
				return;
			}

			manager.sync();
			deps.afterAutoSaveConfigurationChanged(event);
		}),
	];
	let disposed = false;

	manager.sync();

	return {
		sync: manager.sync,
		dispose: () => {
			if (disposed) {
				return;
			}

			disposed = true;
			let firstError: unknown;
			for (const eventDisposable of eventDisposables) {
				try {
					eventDisposable.dispose();
				} catch (error) {
					firstError ??= error;
				}
			}

			try {
				manager.dispose();
			} catch (error) {
				firstError ??= error;
			}

			if (firstError !== undefined) {
				throw firstError;
			}
		},
	};
}
