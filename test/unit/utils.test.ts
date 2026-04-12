import * as assert from 'node:assert';
import { fuzzyMatchSessions, formatTimestamp, parseFileSize, slugify } from '../../src/utils';
import { SessionMeta } from '../../src/types';

function createSession(title: string, fileName: string, savedAt: string): SessionMeta {
	return {
		id: `${title}-${savedAt}`,
		title,
		savedAt,
		fileName,
		turnCount: 4,
		git: null,
	};
}

suite('utils', () => {
	test('slugify handles punctuation, accents, empty values, and max length', () => {
		assert.equal(slugify('Fix Auth Bug!'), 'fix-auth-bug');
		assert.equal(slugify('Café résumé'), 'cafe-resume');
		assert.equal(slugify('###'), 'session');
		assert.equal(slugify('a'.repeat(120)).length <= 80, true);
	});

	test('formatTimestamp uses UTC YYYY-MM-DDTHH-mm', () => {
		const value = new Date('2026-04-12T14:30:55.000Z');
		assert.equal(formatTimestamp(value), '2026-04-12T14-30');
	});

	test('parseFileSize supports kb and mb and rejects invalid values', () => {
		assert.equal(parseFileSize('500kb'), 500 * 1024);
		assert.equal(parseFileSize('1mb'), 1024 * 1024);
		assert.equal(parseFileSize('2MB'), 2 * 1024 * 1024);

		assert.throws(() => parseFileSize('42gb'));
		assert.throws(() => parseFileSize('0mb'));
	});

	test('fuzzyMatchSessions applies expected scoring tiers', () => {
		const sessions: SessionMeta[] = [
			createSession('fix-auth-bug', 'fix-auth-bug.json', '2026-04-12T10:00:00.000Z'),
			createSession('feature-xyz', 'feature-xyz.json', '2026-04-10T10:00:00.000Z'),
		];

		const exact = fuzzyMatchSessions('fix-auth-bug', sessions);
		const prefix = fuzzyMatchSessions('fix', sessions);
		const substring = fuzzyMatchSessions('auth', sessions);
		const wordBoundary = fuzzyMatchSessions('fix bug', sessions);
		const fuzzy = fuzzyMatchSessions('fab', sessions);

		assert.ok(exact[0]);
		assert.ok(prefix[0]);
		assert.ok(substring[0]);
		assert.ok(wordBoundary[0]);
		assert.ok(fuzzy[0]);

		assert.equal(exact[0]!.score, 100);
		assert.equal(prefix[0]!.score, 80);
		assert.equal(substring[0]!.score, 60);
		assert.equal(wordBoundary[0]!.score, 40);
		assert.equal(fuzzy[0]!.score, 20);
		assert.equal(fuzzyMatchSessions('deploy', sessions).length, 0);
	});

	test('fuzzyMatchSessions sorts equal scores by recency', () => {
		const sessions: SessionMeta[] = [
			createSession('fix-auth-a', 'fix-auth-a.json', '2026-04-11T10:00:00.000Z'),
			createSession('fix-auth-b', 'fix-auth-b.json', '2026-04-12T10:00:00.000Z'),
		];

		const result = fuzzyMatchSessions('fix', sessions);
		assert.ok(result[0]);
		assert.ok(result[1]);
		assert.equal(result[0]!.title, 'fix-auth-b');
		assert.equal(result[1]!.title, 'fix-auth-a');
	});
});
