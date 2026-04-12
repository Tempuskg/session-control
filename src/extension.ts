import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
	// Phase 1 stub — commands and chat participant will be wired in later phases.
	// The onStartupFinished activation event fires here; check autoSaveOnCommit
	// and register the git listener only if enabled (implemented in Phase 9).
	const autoSave = vscode.workspace
		.getConfiguration('chat-commit')
		.get<boolean>('autoSaveOnCommit', false);

	if (autoSave) {
		// Git commit listener registered in Phase 9 (src/gitIntegration.ts).
	}

	// Commands registered in Phase 6 (save) and Phase 7 (list/delete).
	context.subscriptions.push(
		vscode.commands.registerCommand('chat-commit.saveSession', () => {
			void vscode.window.showInformationMessage('Chat Commit: Save Session — coming in Phase 6');
		}),
		vscode.commands.registerCommand('chat-commit.listSessions', () => {
			void vscode.window.showInformationMessage('Chat Commit: List Sessions — coming in Phase 6');
		}),
		vscode.commands.registerCommand('chat-commit.deleteSession', () => {
			void vscode.window.showInformationMessage('Chat Commit: Delete Session — coming in Phase 6');
		}),
	);

	// Chat participant registered in Phase 7 (src/chatParticipant.ts).
}

export function deactivate(): void {
	// Cleanup handled via context.subscriptions disposal above.
}
