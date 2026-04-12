import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('Extension manifest is discoverable', async () => {
		const extension = vscode.extensions.getExtension('your-publisher-id.session-control');
		assert.ok(extension);
	});
});
