import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('Extension manifest is discoverable', async () => {
		const extension = vscode.extensions.getExtension('darrenjmcleod.session-control');
		assert.ok(extension);
	});

	test('Continue This Session In... is contributed and registered', async () => {
		const extension = vscode.extensions.getExtension('darrenjmcleod.session-control');
		assert.ok(extension);

		const contributedCommands = (extension.packageJSON.contributes?.commands ?? []) as { command: string }[];
		assert.ok(
			contributedCommands.some((command) => command.command === 'session-control.continueSessionWithProvider'),
			'continueSessionWithProvider is missing from the extension manifest',
		);

		await extension.activate();
		const registeredCommands = await vscode.commands.getCommands(true);
		assert.ok(
			registeredCommands.includes('session-control.continueSessionWithProvider'),
			'continueSessionWithProvider was not registered on activation',
		);
	});
});
