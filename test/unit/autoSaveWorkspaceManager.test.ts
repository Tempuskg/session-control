import * as assert from 'node:assert';
import {
	AUTO_SAVE_CONFIGURATION_SECTIONS,
	createAutoSaveWorkspaceLifecycle,
	createAutoSaveWorkspaceManager,
	type AutoSaveWorkspaceControllerContext,
} from '../../src/autoSaveWorkspaceManager';

interface TestWorkspaceFolder {
	key: string;
	enabled: boolean;
	storageDirectory: string;
	configurationRevision: string;
}

interface ControllerRecord {
	context: AutoSaveWorkspaceControllerContext<TestWorkspaceFolder>;
	disposed: boolean;
	reconciliationCount: number;
}

suite('auto-save workspace manager', () => {
	test('reloads for auto-save provider settings independently of the manual provider preference', () => {
		const configurationSections: readonly string[] = AUTO_SAVE_CONFIGURATION_SECTIONS;

		assert.equal(
			configurationSections.includes('session-control.autoSave.providers'),
			true,
		);
		assert.equal(
			configurationSections.includes('session-control.copilot.homePath'),
			true,
		);
		assert.equal(
			configurationSections.includes('session-control.save.provider'),
			false,
		);
	});

	test('creates one controller per enabled folder and reconciles folder and configuration changes', () => {
		const firstWorkspace: TestWorkspaceFolder = {
			key: 'file:///workspace-one',
			enabled: true,
			storageDirectory: 'E:/workspace-one/.chat-one',
			configurationRevision: 'initial',
		};
		const secondWorkspace: TestWorkspaceFolder = {
			key: 'file:///workspace-two',
			enabled: false,
			storageDirectory: 'E:/workspace-two/.chat-two',
			configurationRevision: 'initial',
		};
		let workspaceFolders = [firstWorkspace, secondWorkspace];
		const controllers: ControllerRecord[] = [];
		const manager = createAutoSaveWorkspaceManager<TestWorkspaceFolder>({
			getWorkspaceFolders: () => workspaceFolders,
			getWorkspaceKey: (workspaceFolder) => workspaceFolder.key,
			isEnabled: (workspaceFolder) => workspaceFolder.enabled,
			getStorageDirectory: (workspaceFolder) => workspaceFolder.storageDirectory,
			getConfigurationFingerprint: (workspaceFolder) => workspaceFolder.configurationRevision,
			createController: (context) => {
				const record = { context, disposed: false, reconciliationCount: 0 };
				controllers.push(record);
				return {
					reconcile: () => {
						record.reconciliationCount += 1;
					},
					dispose: () => {
						record.disposed = true;
					},
				};
			},
		});

		manager.sync();
		assert.equal(controllers.length, 1);
		assert.equal(controllers[0]?.context.workspaceFolder, firstWorkspace);
		assert.equal(controllers[0]?.context.workspaceFolderCount, 2);
		assert.equal(
			controllers[0]?.context.storageDirectory,
			'E:/workspace-one/.chat-one',
		);
		assert.equal(
			controllers[0]?.reconciliationCount,
			1,
			'activation immediately reconciles the enabled workspace',
		);

		secondWorkspace.enabled = true;
		manager.sync();
		assert.equal(controllers.length, 2);
		assert.equal(controllers[0]?.disposed, false);
		assert.equal(controllers[1]?.context.workspaceFolder, secondWorkspace);
		assert.equal(
			controllers[1]?.context.storageDirectory,
			'E:/workspace-two/.chat-two',
		);
		assert.equal(
			controllers[1]?.reconciliationCount,
			1,
			'newly enabling a resource-scoped workspace immediately reconciles it',
		);

		firstWorkspace.storageDirectory = 'E:/workspace-one/.sessions';
		firstWorkspace.configurationRevision = 'storage-path-changed';
		manager.sync();
		assert.equal(controllers.length, 3);
		assert.equal(controllers[0]?.disposed, true);
		assert.equal(controllers[1]?.disposed, false);
		assert.equal(
			controllers[2]?.context.storageDirectory,
			'E:/workspace-one/.sessions',
		);

		workspaceFolders = [firstWorkspace];
		manager.sync();
		assert.equal(controllers.length, 4);
		assert.equal(controllers[1]?.disposed, true);
		assert.equal(controllers[2]?.disposed, true);
		assert.equal(controllers[3]?.context.workspaceFolderCount, 1);

		manager.dispose();
		assert.equal(controllers[3]?.disposed, true);
	});

	test('owns activation and configuration listeners as one disposable lifecycle', () => {
		const firstWorkspace: TestWorkspaceFolder = {
			key: 'file:///workspace-one',
			enabled: true,
			storageDirectory: 'E:/workspace-one/.chat',
			configurationRevision: 'initial',
		};
		const secondWorkspace: TestWorkspaceFolder = {
			key: 'file:///workspace-two',
			enabled: true,
			storageDirectory: 'E:/workspace-two/.chat',
			configurationRevision: 'initial',
		};
		let workspaceFolders = [firstWorkspace];
		let workspaceFoldersListener: (() => void) | undefined;
		let configurationListener:
			| ((event: { affectsConfiguration: (section: string) => boolean }) => void)
			| undefined;
		let workspaceFoldersListenerDisposed = false;
		let configurationListenerDisposed = false;
		let workspaceFoldersChangedCount = 0;
		let configurationChangedCount = 0;
		const controllers: ControllerRecord[] = [];

		const lifecycle = createAutoSaveWorkspaceLifecycle({
			getWorkspaceFolders: () => workspaceFolders,
			getWorkspaceKey: (workspaceFolder) => workspaceFolder.key,
			isEnabled: (workspaceFolder) => workspaceFolder.enabled,
			getStorageDirectory: (workspaceFolder) => workspaceFolder.storageDirectory,
			getConfigurationFingerprint: (workspaceFolder) =>
				workspaceFolder.configurationRevision,
			createController: (context) => {
				const record = { context, disposed: false, reconciliationCount: 0 };
				controllers.push(record);
				return {
					reconcile: () => {
						record.reconciliationCount += 1;
					},
					dispose: () => {
						record.disposed = true;
					},
				};
			},
			onDidChangeWorkspaceFolders: (listener) => {
				workspaceFoldersListener = listener;
				return {
					dispose: () => {
						workspaceFoldersListenerDisposed = true;
						workspaceFoldersListener = undefined;
					},
				};
			},
			onDidChangeConfiguration: (listener) => {
				configurationListener = listener;
				return {
					dispose: () => {
						configurationListenerDisposed = true;
						configurationListener = undefined;
					},
				};
			},
			afterWorkspaceFoldersChanged: () => {
				workspaceFoldersChangedCount += 1;
			},
			afterAutoSaveConfigurationChanged: () => {
				configurationChangedCount += 1;
			},
		});

		assert.equal(controllers.length, 1, 'activation performs the initial sync');
		assert.equal(controllers[0]?.reconciliationCount, 1);

		configurationListener?.({
			affectsConfiguration: (section) => section === 'editor.fontSize',
		});
		assert.equal(controllers.length, 1, 'unrelated configuration is ignored');
		assert.equal(configurationChangedCount, 0);

		firstWorkspace.configurationRevision = 'codex-home-changed';
		configurationListener?.({
			affectsConfiguration: (section) =>
				section === 'session-control.codex.homePath',
		});
		assert.equal(controllers.length, 2);
		assert.equal(controllers[0]?.disposed, true);
		assert.equal(configurationChangedCount, 1);

		workspaceFolders = [firstWorkspace, secondWorkspace];
		workspaceFoldersListener?.();
		assert.equal(controllers.length, 4);
		assert.equal(controllers[1]?.disposed, true);
		assert.equal(workspaceFoldersChangedCount, 1);

		lifecycle.dispose();
		assert.equal(workspaceFoldersListenerDisposed, true);
		assert.equal(configurationListenerDisposed, true);
		assert.equal(controllers.every((controller) => controller.disposed), true);

		lifecycle.dispose();
		assert.equal(controllers.length, 4, 'disposal is idempotent');
	});
});
