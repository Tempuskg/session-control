import { ScoredSession, SessionMeta } from './types';

const DEFAULT_SLUG = 'session';
const MAX_SLUG_LENGTH = 80;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function toAscii(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '');
}

function clampSlugLength(value: string): string {
	if (value.length <= MAX_SLUG_LENGTH) {
		return value;
	}

	return value.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}

function orderedCharacterMatch(query: string, target: string): boolean {
	if (!query || !target) {
		return false;
	}

	let queryIndex = 0;
	for (const char of target) {
		if (char === query[queryIndex]) {
			queryIndex += 1;
		}

		if (queryIndex >= query.length) {
			return true;
		}
	}

	return false;
}

function wordBoundaryMatch(query: string, target: string): boolean {
	const words = query.split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return false;
	}

	return words.every((word) => {
		const pattern = new RegExp(`\\b${escapeRegExp(word)}`);
		return pattern.test(target);
	});
}

function scoreSession(query: string, session: SessionMeta): number {
	const title = normalize(session.title);
	const fileSlug = normalize(session.fileName.replace(/\.json$/i, ''));

	if (query === title || query === fileSlug) {
		return 100;
	}

	if (title.startsWith(query) || fileSlug.startsWith(query)) {
		return 80;
	}

	if (title.includes(query) || fileSlug.includes(query)) {
		return 60;
	}

	if (wordBoundaryMatch(query, title)) {
		return 40;
	}

	if (orderedCharacterMatch(query, title) || orderedCharacterMatch(query, fileSlug)) {
		return 20;
	}

	return 0;
}

export function slugify(title: string): string {
	const ascii = toAscii(title);
	const hyphenated = ascii
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (!hyphenated) {
		return DEFAULT_SLUG;
	}

	return clampSlugLength(hyphenated);
}

export function formatTimestamp(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	const hours = String(date.getUTCHours()).padStart(2, '0');
	const minutes = String(date.getUTCMinutes()).padStart(2, '0');

	return `${year}-${month}-${day}T${hours}-${minutes}`;
}

export function parseFileSize(size: string): number {
	const match = /^\s*(\d+)\s*(kb|mb)\s*$/i.exec(size);
	if (!match) {
		throw new Error(`Invalid file size format: ${size}`);
	}

	const [, valueText, unitText] = match;
	if (!valueText || !unitText) {
		throw new Error(`Invalid file size format: ${size}`);
	}

	const value = Number.parseInt(valueText, 10);
	const unit = unitText.toLowerCase();

	if (value <= 0) {
		throw new Error(`File size must be greater than zero: ${size}`);
	}

	return unit === 'mb' ? value * 1024 * 1024 : value * 1024;
}

export function fuzzyMatchSessions(query: string, sessions: SessionMeta[]): ScoredSession[] {
	const normalizedQuery = normalize(query);
	if (!normalizedQuery) {
		return [];
	}

	return sessions
		.map((session) => ({
			...session,
			score: scoreSession(normalizedQuery, session),
		}))
		.filter((session) => session.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}

			return Date.parse(b.savedAt) - Date.parse(a.savedAt);
		});
}
