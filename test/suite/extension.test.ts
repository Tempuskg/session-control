import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('Extension manifest is discoverable', async () => {
		const extension = vscode.extensions.getExtension('your-publisher-id.chat-commit');
		assert.ok(extension);
	});
});
