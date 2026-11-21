import * as vscode from 'vscode';

export const AUTO_SAVE_MENU_COMMAND = 'session-control.showAutoSaveMenu';

interface AutoSaveMenuItem extends vscode.QuickPickItem {
	command: string;
}

interface AutoSaveMenuDeps {
	pick: (items: AutoSaveMenuItem[]) => Thenable<AutoSaveMenuItem | undefined>;
	executeCommand: (command: string) => Thenable<unknown>;
}

export async function runAutoSaveMenu(overrides: Partial<AutoSaveMenuDeps> = {}): Promise<void> {
	const deps: AutoSaveMenuDeps = {
		pick: (items) => vscode.window.showQuickPick(items, {
			title: 'Session Control',
			placeHolder: 'Choose an auto-save or saved-session action',
		}),
		executeCommand: (command) => vscode.commands.executeCommand(command),
		...overrides,
	};
	const selected = await deps.pick([
		{ label: 'Toggle Auto-Save', command: 'session-control.toggleAutoSave' },
		{ label: 'Diagnose Auto-Save', command: 'session-control.diagnoseAutoSave' },
		{ label: 'Open Saved Sessions', command: 'session-control.sessionExplorer.focus' },
		{ label: 'Analyze Saved Chats', command: 'session-control.analyzeSavedChats' },
	]);
	if (selected) {
		await deps.executeCommand(selected.command);
	}
}
