import * as assert from 'node:assert';
import { runAutoSaveMenu } from '../../src/autoSaveMenu';
import { buildAutoSaveStatusTooltip } from '../../src/autoSaveDiagnostics';

suite('auto-save status bar menu', () => {
	const expected = [
		['Toggle Auto-Save', 'session-control.toggleAutoSave'],
		['Diagnose Auto-Save', 'session-control.diagnoseAutoSave'],
		['Open Saved Sessions', 'session-control.sessionExplorer.focus'],
		['Analyze Saved Chats', 'session-control.analyzeSavedChats'],
	];
	for (const [label, command] of expected) {
		test(`dispatches only the selected action: ${label}`, async () => {
			const executed: string[] = [];
			await runAutoSaveMenu({
				pick: async (items) => {
					assert.deepStrictEqual(items.map((item) => [item.label, item.command]), expected);
					assert.deepStrictEqual(executed, []);
					return items.find((item) => item.label === label);
				},
				executeCommand: async (id) => { executed.push(id); },
			});
			assert.deepStrictEqual(executed, [command]);
		});
	}
	test('cancelling does not execute an action or toggle auto-save', async () => {
		await runAutoSaveMenu({
			pick: async () => undefined,
			executeCommand: async () => assert.fail('Cancel must not dispatch a command'),
		});
	});
	test('tooltip describes opening a menu whether auto-save is on or off', () => {
		for (const enabled of [true, false]) {
			const tooltip = buildAutoSaveStatusTooltip('Workspace', enabled, []);
			assert.match(tooltip, /Click to open the auto-save and saved sessions menu/);
			assert.doesNotMatch(tooltip, /Click to (enable|disable)/);
		}
	});
});
