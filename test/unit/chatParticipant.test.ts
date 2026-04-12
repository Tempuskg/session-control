import * as assert from 'node:assert';
import { renderSessionListMarkdown, selectSessionForResume, trimTurnsForResume } from '../../src/chatParticipant';
import { SavedTurn, SessionMeta } from '../../src/types';

function createMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		id: overrides.id ?? '1',
		title: overrides.title ?? 'Fix auth bug',
		savedAt: overrides.savedAt ?? '2026-04-12T12:00:00.000Z',
		fileName: overrides.fileName ?? '2026-04-12T12-00-fix-auth-bug.json',
		turnCount: overrides.turnCount ?? 10,
		git: overrides.git ?? null,
	};
}

suite('chatParticipant selection', () => {
	test('auto-selects a single strong match', () => {
		const sessions = [
			createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json' }),
			createMeta({ id: '2', title: 'Update docs', fileName: 'update-docs.json' }),
		];

		const selection = selectSessionForResume('fix auth', sessions);
		assert.equal(selection.session?.id, '1');
		assert.equal(selection.candidates, undefined);
	});

	test('returns candidates when only weak fuzzy matches exist', () => {
		const sessions = [
			createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json' }),
			createMeta({ id: '2', title: 'Feature branch cleanup', fileName: 'feature-branch-cleanup.json' }),
		];

		const selection = selectSessionForResume('fab', sessions);
		assert.equal(selection.session, undefined);
		assert.equal((selection.candidates ?? []).length >= 1, true);
		assert.equal(selection.candidates?.[0]?.id, '1');
	});

	test('returns empty selection when no query or no matches', () => {
		const sessions = [createMeta({ id: '1', title: 'Fix auth bug', fileName: 'fix-auth-bug.json' })];

		const noQuery = selectSessionForResume('', sessions);
		const noMatches = selectSessionForResume('deploy', sessions);

		assert.equal(noQuery.session, undefined);
		assert.equal(noQuery.candidates, undefined);
		assert.equal(noMatches.session, undefined);
		assert.equal(noMatches.candidates, undefined);
	});

	test('trimTurnsForResume honors max turn and char budgets', () => {
		const turns: SavedTurn[] = [
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'one',
				references: [],
				timestamp: '2026-04-12T12:00:00.000Z',
			},
			{
				type: 'response',
				participant: 'copilot',
				content: 'two two',
				toolCalls: [],
				timestamp: '2026-04-12T12:01:00.000Z',
			},
			{
				type: 'request',
				participant: 'copilot',
				prompt: 'three',
				references: [],
				timestamp: '2026-04-12T12:02:00.000Z',
			},
		];

		const trimmed = trimTurnsForResume(turns, 2, 9);
		assert.equal(trimmed.length, 1);
		assert.equal(trimmed[0]?.type, 'request');
	});

	test('renderSessionListMarkdown returns a friendly empty message', () => {
		const markdown = renderSessionListMarkdown([]);
		assert.equal(markdown.includes('No saved sessions found.'), true);
	});
});
