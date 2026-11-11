import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ChatSession, SessionMeta, isChatSession } from './types';
import { formatTimestamp, slugify } from './utils';

interface SessionStoreDeps {
	mkdir(directoryPath: string): Promise<void>;
	readdir(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;
	/** Exclusive create (`flag: 'wx'`). Used only for auto-save identity locks. */
	writeFileExclusive(filePath: string, content: string): Promise<void>;
	exists(filePath: string): Promise<boolean>;
	rename(fromPath: string, toPath: string): Promise<void>;
	unlink(filePath: string): Promise<void>;
	wait(ms: number): Promise<void>;
	logWarning(message: string): void;
	autoSaveLockRetryMs: number;
	autoSaveLockMaxAttempts: number;
	autoSaveLockHeartbeatMs: number;
	autoSaveLockRecoveryGraceMs: number;
}

export type SessionPruneAction = 'archive' | 'delete';

export interface OrphanedPartFile {
	fileName: string;
	sessionId: string;
	title: string;
	savedAt: string;
	danglingLink: string;
	superseded: boolean;
}

export interface SessionFileNameOptions {
	includeTimestampInFileName: boolean;
}

export interface SessionPruneResult {
	archived: number;
	deleted: number;
}

export interface AutoSaveSessionFile {
	fileName: string;
	savedAt: string;
	sourceRevision: string;
}

export interface AutoSaveSessionIdentity {
	sourceId: string;
	sourceSessionId: string;
}

interface SessionWritePlanEntry {
	fileName: string;
	session: ChatSession;
}

function createDefaultDeps(): SessionStoreDeps {
	return {
		mkdir: async (directoryPath: string) => {
			await fs.mkdir(directoryPath, { recursive: true });
		},
		readdir: async (directoryPath: string) => {
			const entries = await fs.readdir(directoryPath, { withFileTypes: true });
			return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
		},
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		writeFile: async (filePath: string, content: string) => fs.writeFile(filePath, content, 'utf8'),
		writeFileExclusive: async (filePath: string, content: string) =>
			fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' }),
		exists: async (filePath: string) => {
			try {
				await fs.access(filePath);
				return true;
			} catch {
				return false;
			}
		},
		rename: async (fromPath: string, toPath: string) => fs.rename(fromPath, toPath),
		unlink: async (filePath: string) => fs.unlink(filePath),
		wait: async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
		logWarning: (message: string) => {
			console.warn(message);
		},
		autoSaveLockRetryMs: 25,
		autoSaveLockMaxAttempts: 80,
		autoSaveLockHeartbeatMs: 1_000,
		autoSaveLockRecoveryGraceMs: 5_000,
	};
}

function createTempName(fileName: string): string {
	const randomPart = Math.random().toString(16).slice(2);
	return `${fileName}.${randomPart}.tmp`;
}

function toSessionMeta(fileName: string, session: ChatSession): SessionMeta {
	return {
		id: session.id,
		title: session.title,
		savedAt: session.savedAt,
		fileName,
		...(session.provider ? { provider: session.provider } : {}),
		turnCount: session.totalTurns,
		git: session.git,
	};
}

export function createSessionFileName(session: Pick<ChatSession, 'savedAt' | 'title'>): string {
	return createSessionFileNameWithOptions(session, {
		includeTimestampInFileName: true,
	});
}

function createSessionFileNameWithOptions(
	session: Pick<ChatSession, 'savedAt' | 'title'>,
	options: SessionFileNameOptions,
): string {
	const timestamp = formatTimestamp(new Date(session.savedAt));
	const slug = slugify(session.title);

	if (options.includeTimestampInFileName) {
		return `${timestamp}-${slug}.json`;
	}

	return `${slug}.json`;
}

function createConflictResolvedFileName(
	session: Pick<ChatSession, 'savedAt' | 'title' | 'id'>,
	options: SessionFileNameOptions,
): string {
	const timestamp = formatTimestamp(new Date(session.savedAt));
	const slug = slugify(session.title);
	const suffix = slugify(session.id).slice(0, 12);

	if (options.includeTimestampInFileName) {
		return `${timestamp}-${slug}-${suffix}.json`;
	}

	return `${slug}-${suffix}.json`;
}

function stripJsonExtension(fileName: string): string {
	return fileName.replace(/\.json$/i, '');
}

function resolveUniqueSessionFileName(
	session: Pick<ChatSession, 'savedAt' | 'title' | 'id'>,
	options: SessionFileNameOptions,
	reservedFileNames: Set<string>,
): string {
	const preferredFileName = createSessionFileNameWithOptions(session, options);
	if (!reservedFileNames.has(preferredFileName.toLowerCase())) {
		return preferredFileName;
	}

	const conflictResolvedFileName = createConflictResolvedFileName(session, options);
	if (!reservedFileNames.has(conflictResolvedFileName.toLowerCase())) {
		return conflictResolvedFileName;
	}

	const baseName = stripJsonExtension(conflictResolvedFileName);
	let duplicateIndex = 2;
	while (true) {
		const candidate = `${baseName}-${duplicateIndex}.json`;
		if (!reservedFileNames.has(candidate.toLowerCase())) {
			return candidate;
		}

		duplicateIndex += 1;
	}
}

function createSessionWritePlan(
	sessions: readonly ChatSession[],
	options: SessionFileNameOptions,
	existingFiles: readonly string[],
): SessionWritePlanEntry[] {
	const reservedFileNames = new Set(existingFiles.map((fileName) => fileName.toLowerCase()));
	const fileNames = sessions.map((session) => {
		const fileName = resolveUniqueSessionFileName(session, options, reservedFileNames);
		reservedFileNames.add(fileName.toLowerCase());
		return fileName;
	});

	return sessions.map((session, index) => ({
		fileName: fileNames[index] as string,
		session:
			sessions.length > 1
				? {
						...session,
						previousPartFile: index > 0 ? (fileNames[index - 1] ?? null) : null,
						nextPartFile: index + 1 < fileNames.length ? (fileNames[index + 1] ?? null) : null,
					}
				: session,
	}));
}

export function createSessionStore(overrides: Partial<SessionStoreDeps> = {}) {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	interface AutoSaveLockHandle {
		lockPath: string;
		ownerToken: string;
		/** Exact bytes last written by this owner; used for compare-and-rename release. */
		lastContent: string;
	}

	interface RevisionAutoSaveCandidate {
		fileName: string;
		session: ChatSession;
	}

	function createAutoSaveLockFileName(identity: AutoSaveSessionIdentity): string {
		const raw = `${identity.sourceId}\0${identity.sourceSessionId}`;
		let hash = 0;
		for (let index = 0; index < raw.length; index += 1) {
			hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
		}
		return `.session-control-autosave-${hash.toString(16)}.lock`;
	}

	function createAutoSaveLockOwnerToken(): string {
		const randomPart = Math.random().toString(16).slice(2);
		const timePart = Date.now().toString(16);
		return `${timePart}-${randomPart}`;
	}

	function serializeAutoSaveLockContent(ownerToken: string, heartbeatAt: number): string {
		return `${ownerToken}\n${heartbeatAt}\n`;
	}

	function isExclusiveCreateError(error: unknown): boolean {
		const code =
			typeof error === 'object' && error !== null && 'code' in error
				? String((error as { code?: unknown }).code)
				: '';
		if (code === 'EEXIST') {
			return true;
		}
		const message = error instanceof Error ? error.message : String(error);
		return /eexist|file already exists|cannot create a file when that file already exists/i.test(message);
	}

	function lockContentFingerprint(content: string): string {
		let hash = 2166136261;
		for (let index = 0; index < content.length; index += 1) {
			hash ^= content.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(16);
	}

	/**
	 * Safe crash-recovery step: never deletes by lock age alone.
	 * Observe opaque lock bytes, wait a full grace window, and only then
	 * rename-aside that exact byte snapshot.
	 */
	async function tryReclaimAutoSaveLockIfUnchanged(lockPath: string): Promise<void> {
		let first: string;
		try {
			first = await deps.readFile(lockPath);
		} catch {
			return;
		}

		await deps.wait(deps.autoSaveLockRecoveryGraceMs);

		let second: string;
		try {
			second = await deps.readFile(lockPath);
		} catch {
			return;
		}
		if (second !== first) {
			return;
		}

		const trashPath = `${lockPath}.dead.${lockContentFingerprint(first)}`;
		try {
			await deps.rename(lockPath, trashPath);
		} catch {
			return;
		}

		await deps.unlink(trashPath).catch(() => undefined);
	}

	async function acquireAutoSaveIdentityLock(
		storageDirectory: string,
		identity: AutoSaveSessionIdentity,
	): Promise<AutoSaveLockHandle> {
		await ensureStorageDirectory(storageDirectory);
		const lockPath = path.join(storageDirectory, createAutoSaveLockFileName(identity));
		const ownerToken = createAutoSaveLockOwnerToken();

		for (let attempt = 0; attempt < deps.autoSaveLockMaxAttempts; attempt += 1) {
			const content = serializeAutoSaveLockContent(ownerToken, Date.now());
			try {
				await deps.writeFileExclusive(lockPath, content);
				return { lockPath, ownerToken, lastContent: content };
			} catch (error) {
				if (!isExclusiveCreateError(error)) {
					throw error;
				}

				// Contention / stale crash recovery only — never wraps the protected upsert.
				if (attempt > 0 && attempt % 8 === 0) {
					await tryReclaimAutoSaveLockIfUnchanged(lockPath);
				} else {
					await deps.wait(deps.autoSaveLockRetryMs);
				}
			}
		}

		throw new Error(
			`Could not acquire auto-save lock for ${identity.sourceId}:${identity.sourceSessionId}.`,
		);
	}

	async function refreshAutoSaveLockHeartbeat(handle: AutoSaveLockHandle): Promise<void> {
		try {
			const current = await deps.readFile(handle.lockPath);
			if (current !== handle.lastContent) {
				return;
			}
			const next = serializeAutoSaveLockContent(handle.ownerToken, Date.now());
			await deps.writeFile(handle.lockPath, next);
			handle.lastContent = next;
		} catch {
			// Lock disappeared or raced; release path handles ownership mismatch.
		}
	}

	async function releaseAutoSaveIdentityLock(handle: AutoSaveLockHandle): Promise<void> {
		let current: string;
		try {
			current = await deps.readFile(handle.lockPath);
		} catch {
			return;
		}

		if (!current.startsWith(`${handle.ownerToken}\n`)) {
			return;
		}

		const trashPath = `${handle.lockPath}.released.${handle.ownerToken}`;
		try {
			const confirmed = await deps.readFile(handle.lockPath);
			if (!confirmed.startsWith(`${handle.ownerToken}\n`)) {
				return;
			}
			await deps.rename(handle.lockPath, trashPath);
		} catch {
			return;
		}

		await deps.unlink(trashPath).catch(() => undefined);
	}

	async function withAutoSaveIdentityLock<T>(
		storageDirectory: string,
		identity: AutoSaveSessionIdentity,
		run: () => Promise<T>,
	): Promise<T> {
		const handle = await acquireAutoSaveIdentityLock(storageDirectory, identity);
		// Heartbeats are serialized and fully drained before release. A detached
		// read-compare-write heartbeat could otherwise recreate the lock file after
		// release renamed it away, leaving a stale lock that peers must wait out.
		let stopped = false;
		let pendingHeartbeat: Promise<void> = Promise.resolve();
		const heartbeat = setInterval(() => {
			pendingHeartbeat = pendingHeartbeat.then(async () => {
				if (!stopped) {
					await refreshAutoSaveLockHeartbeat(handle);
				}
			});
		}, deps.autoSaveLockHeartbeatMs);

		try {
			return await run();
		} finally {
			stopped = true;
			clearInterval(heartbeat);
			await pendingHeartbeat;
			await releaseAutoSaveIdentityLock(handle);
		}
	}

	function isNonEmptySourceRevision(value: unknown): value is string {
		return typeof value === 'string' && value.length > 0;
	}

	function isPreferredAutoSaveFileName(fileName: string, sourceSessionId: string): boolean {
		const lower = fileName.toLowerCase();
		const idPrefix = sourceSessionId
			.replace(/[^a-zA-Z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 12)
			.toLowerCase();
		if (!idPrefix) {
			return true;
		}
		return !new RegExp(`-${idPrefix}(?:-\\d+)?\\.json$`, 'i').test(lower);
	}

	function compareCanonicalAutoSaveFileNames(left: string, right: string, sourceSessionId: string): number {
		const leftPreferred = isPreferredAutoSaveFileName(left, sourceSessionId);
		const rightPreferred = isPreferredAutoSaveFileName(right, sourceSessionId);
		if (leftPreferred !== rightPreferred) {
			return leftPreferred ? -1 : 1;
		}
		// Collision copies always extend the preferred stem, so the shorter name is
		// the canonical one. Ordinal comparison keeps the order locale-independent.
		if (left.length !== right.length) {
			return left.length - right.length;
		}
		return left < right ? -1 : left > right ? 1 : 0;
	}

	function sameLink(expected: string | null | undefined, actual: string | null | undefined): boolean {
		if ((expected === null || expected === undefined) && (actual === null || actual === undefined)) {
			return true;
		}
		if (typeof expected !== 'string' || typeof actual !== 'string') {
			return false;
		}
		return expected.toLowerCase() === actual.toLowerCase();
	}

	function tryWalkCompleteLinkedSet(
		root: RevisionAutoSaveCandidate,
		byFileName: Map<string, RevisionAutoSaveCandidate>,
		identity: AutoSaveSessionIdentity,
		sourceRevision: string,
		expectedPartCount: number,
	): string[] | undefined {
		const ordered: RevisionAutoSaveCandidate[] = [];
		const seen = new Set<string>();
		let current: RevisionAutoSaveCandidate | undefined = root;

		for (let expectedPart = 1; expectedPart <= expectedPartCount; expectedPart += 1) {
			if (!current) {
				return undefined;
			}
			const key = current.fileName.toLowerCase();
			if (seen.has(key)) {
				return undefined;
			}
			seen.add(key);

			const { session } = current;
			const origin = session.origin;
			if (
				origin?.saveKind !== 'auto' ||
				origin.sourceId !== identity.sourceId ||
				origin.sourceSessionId !== identity.sourceSessionId ||
				!isNonEmptySourceRevision(origin.sourceRevision) ||
				origin.sourceRevision !== sourceRevision
			) {
				return undefined;
			}
			if (session.part !== expectedPart || session.totalParts !== expectedPartCount) {
				return undefined;
			}

			const expectedPrevious = expectedPart === 1 ? null : (ordered[expectedPart - 2]?.fileName ?? null);
			if (!sameLink(expectedPrevious, session.previousPartFile)) {
				return undefined;
			}

			ordered.push(current);

			if (expectedPart === expectedPartCount) {
				if (session.nextPartFile !== null) {
					return undefined;
				}
				break;
			}

			const nextName = session.nextPartFile;
			if (typeof nextName !== 'string' || nextName.length === 0) {
				return undefined;
			}
			current = byFileName.get(nextName.toLowerCase());
		}

		if (ordered.length !== expectedPartCount) {
			return undefined;
		}
		return ordered.map((entry) => entry.fileName);
	}

	/**
	 * Adopt only a complete consistent automatic export for one identity+revision.
	 * Never heals by sorting matches and slicing to expectedPartCount, and never
	 * unlinks ambiguous, incomplete, or surplus files during adoption.
	 */
	async function listRevisionAutoSaveFileNames(
		storageDirectory: string,
		identity: AutoSaveSessionIdentity,
		sourceRevision: string,
		expectedPartCount: number,
	): Promise<string[] | undefined> {
		if (expectedPartCount <= 0 || !isNonEmptySourceRevision(sourceRevision)) {
			return undefined;
		}

		const inventory = await findAutoSaveSessionFiles(
			storageDirectory,
			identity.sourceId,
			identity.sourceSessionId,
		);
		const candidates: RevisionAutoSaveCandidate[] = [];
		for (const entry of inventory) {
			let session: ChatSession;
			try {
				session = await readSession(storageDirectory, entry.fileName);
			} catch {
				continue;
			}

			const origin = session.origin;
			if (
				origin?.saveKind !== 'auto' ||
				origin.sourceId !== identity.sourceId ||
				origin.sourceSessionId !== identity.sourceSessionId
			) {
				continue;
			}
			if (!isNonEmptySourceRevision(origin.sourceRevision)) {
				continue;
			}
			if (origin.sourceRevision !== sourceRevision) {
				continue;
			}

			candidates.push({ fileName: entry.fileName, session });
		}

		if (candidates.length === 0) {
			return undefined;
		}

		const byFileName = new Map(
			candidates.map((candidate) => [candidate.fileName.toLowerCase(), candidate] as const),
		);

		if (expectedPartCount === 1) {
			const singles = candidates.filter((candidate) => {
				const { session } = candidate;
				const partOk = session.part === null || session.part === 1;
				const totalOk = session.totalParts === null || session.totalParts === 1;
				return partOk && totalOk && session.previousPartFile === null && session.nextPartFile === null;
			});
			if (singles.length === 0) {
				return undefined;
			}

			singles.sort((left, right) =>
				compareCanonicalAutoSaveFileNames(left.fileName, right.fileName, identity.sourceSessionId),
			);
			const canonical = singles[0];
			return canonical ? [canonical.fileName] : undefined;
		}

		const roots = candidates.filter(
			(candidate) => candidate.session.part === 1 && candidate.session.totalParts === expectedPartCount,
		);
		const completeChains: string[][] = [];
		const seenChainKeys = new Set<string>();
		for (const root of roots) {
			const chain = tryWalkCompleteLinkedSet(
				root,
				byFileName,
				identity,
				sourceRevision,
				expectedPartCount,
			);
			if (!chain) {
				continue;
			}
			const chainKey = chain.map((fileName) => fileName.toLowerCase()).join('\0');
			if (seenChainKeys.has(chainKey)) {
				continue;
			}
			seenChainKeys.add(chainKey);
			completeChains.push(chain);
		}

		if (completeChains.length === 0) {
			return undefined;
		}

		completeChains.sort((left, right) => {
			const leftRoot = left[0] ?? '';
			const rightRoot = right[0] ?? '';
			return compareCanonicalAutoSaveFileNames(leftRoot, rightRoot, identity.sourceSessionId);
		});
		return completeChains[0];
	}

	async function ensureStorageDirectory(storageDirectory: string): Promise<void> {
		await deps.mkdir(storageDirectory);
	}

	async function writeSession(
		storageDirectory: string,
		session: ChatSession,
		options: SessionFileNameOptions = { includeTimestampInFileName: true },
	): Promise<string> {
		const [fileName] = await writeSessions(storageDirectory, [session], options);
		if (!fileName) {
			throw new Error('Session write produced no file name.');
		}

		return fileName;
	}

	async function writeSessionToFile(storageDirectory: string, fileName: string, session: ChatSession): Promise<void> {
		await ensureStorageDirectory(storageDirectory);
		const filePath = path.join(storageDirectory, fileName);
		const tempPath = path.join(storageDirectory, createTempName(fileName));
		const content = JSON.stringify(session, null, 2);

		try {
			await deps.writeFile(tempPath, content);
			await deps.rename(tempPath, filePath);
		} catch (error) {
			await deps.unlink(tempPath).catch(() => undefined);
			throw error;
		}
	}

	async function writeSessions(
		storageDirectory: string,
		sessions: readonly ChatSession[],
		options: SessionFileNameOptions = { includeTimestampInFileName: true },
	): Promise<string[]> {
		await ensureStorageDirectory(storageDirectory);

		const existingFiles = await deps.readdir(storageDirectory).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return [];
			}

			throw error;
		});
		const writePlan = createSessionWritePlan(sessions, options, existingFiles);
		for (const entry of writePlan) {
			await writeSessionToFile(storageDirectory, entry.fileName, entry.session);
		}

		return writePlan.map((entry) => entry.fileName);
	}

	async function upsertAutoSaveSessions(
		storageDirectory: string,
		sessions: readonly ChatSession[],
		identity: AutoSaveSessionIdentity,
		options: SessionFileNameOptions = { includeTimestampInFileName: true },
	): Promise<string[]> {
		if (sessions.length === 0) {
			return [];
		}

		const ownsSession = (session: ChatSession): boolean =>
			session.origin?.saveKind === 'auto' &&
			session.origin.sourceId === identity.sourceId &&
			session.origin.sourceSessionId === identity.sourceSessionId;
		if (sessions.some((session) => !ownsSession(session))) {
			throw new Error('Auto-save upsert requires every new part to have the matching automatic-save origin.');
		}

		// Validate every incoming part explicitly. Do not filter missing revisions
		// before measuring the distinct set — one blank + one valid must reject.
		const incomingRevisions = new Set<string>();
		for (const session of sessions) {
			const revision = session.origin?.sourceRevision;
			if (!isNonEmptySourceRevision(revision)) {
				throw new Error('Auto-save upsert requires every new part to have a valid sourceRevision.');
			}
			incomingRevisions.add(revision);
		}
		if (incomingRevisions.size !== 1) {
			throw new Error('Auto-save upsert requires every new part to share one sourceRevision.');
		}
		const [sourceRevision] = [...incomingRevisions];
		if (!isNonEmptySourceRevision(sourceRevision)) {
			throw new Error('Auto-save upsert requires a sourceRevision.');
		}

		// Lock covers the entire automatic upsert: adopt/short-circuit, stage,
		// publication, rollback, and retirement of prior automatic files.
		return withAutoSaveIdentityLock(storageDirectory, identity, async () => {
			const existingForRevision = await listRevisionAutoSaveFileNames(
				storageDirectory,
				identity,
				sourceRevision,
				sessions.length,
			);
			if (existingForRevision) {
				return existingForRevision;
			}

			const previousFiles = await findAutoSaveSessionFiles(
				storageDirectory,
				identity.sourceId,
				identity.sourceSessionId,
			);
			await ensureStorageDirectory(storageDirectory);
			const existingFiles = await deps.readdir(storageDirectory);
			const writePlan = createSessionWritePlan(sessions, options, existingFiles);
			const stagedWrites = writePlan.map((entry) => ({
				...entry,
				filePath: path.join(storageDirectory, entry.fileName),
				tempPath: path.join(storageDirectory, createTempName(entry.fileName)),
			}));
			const publishedPaths: string[] = [];

			try {
				for (const entry of stagedWrites) {
					await deps.writeFile(entry.tempPath, JSON.stringify(entry.session, null, 2));
				}

				const raced = await listRevisionAutoSaveFileNames(
					storageDirectory,
					identity,
					sourceRevision,
					sessions.length,
				);
				if (raced) {
					for (const entry of stagedWrites) {
						await deps.unlink(entry.tempPath).catch(() => undefined);
					}
					return raced;
				}

				for (const entry of stagedWrites) {
					await deps.rename(entry.tempPath, entry.filePath);
					publishedPaths.push(entry.filePath);
				}
			} catch (error) {
				for (const entry of stagedWrites) {
					await deps.unlink(entry.tempPath).catch(() => undefined);
				}
				for (const publishedPath of publishedPaths) {
					await deps.unlink(publishedPath).catch((cleanupError: unknown) => {
						const reason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
						deps.logWarning(`Could not roll back staged auto-save file ${publishedPath}: ${reason}`);
					});
				}
				throw error;
			}

			const newFileNames = new Set(writePlan.map((entry) => entry.fileName.toLowerCase()));
			for (const previousFile of previousFiles) {
				if (newFileNames.has(previousFile.fileName.toLowerCase())) {
					continue;
				}

				let previousSession: ChatSession;
				try {
					previousSession = await readSession(storageDirectory, previousFile.fileName);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (/no such file|cannot find|enoent/i.test(message)) {
						continue;
					}

					throw error;
				}

				if (!ownsSession(previousSession)) {
					continue;
				}

				await deleteSession(storageDirectory, previousFile.fileName);
			}

			return writePlan.map((entry) => entry.fileName);
		});
	}

	async function readSession(storageDirectory: string, fileName: string): Promise<ChatSession> {
		const filePath = path.join(storageDirectory, fileName);
		const content = await deps.readFile(filePath);
		const parsed = JSON.parse(content) as unknown;

		if (!isChatSession(parsed)) {
			throw new Error(`Invalid session schema: ${fileName}`);
		}

		return parsed;
	}

	async function listSessions(storageDirectory: string): Promise<SessionMeta[]> {
		let files: string[];
		try {
			files = await deps.readdir(storageDirectory);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return [];
			}

			throw error;
		}

		const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));
		const sessions = await Promise.all(
			jsonFiles.map(async (fileName) => {
				try {
					const session = await readSession(storageDirectory, fileName);
					return toSessionMeta(fileName, session);
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					deps.logWarning(`Skipped session file ${fileName}: ${reason}`);
					return null;
				}
			}),
		);

		return sessions
			.filter((session): session is SessionMeta => session !== null)
			.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
	}

	async function findAutoSaveSessionFiles(
		storageDirectory: string,
		sourceId: string,
		sourceSessionId: string,
	): Promise<AutoSaveSessionFile[]> {
		let files: string[];
		try {
			files = await deps.readdir(storageDirectory);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return [];
			}

			throw error;
		}

		const matches: AutoSaveSessionFile[] = [];
		for (const fileName of files.filter((file) => file.toLowerCase().endsWith('.json'))) {
			try {
				const session = await readSession(storageDirectory, fileName);
				const origin = session.origin;
				if (origin?.saveKind !== 'auto' || origin.sourceId !== sourceId || origin.sourceSessionId !== sourceSessionId) {
					continue;
				}

				matches.push({
					fileName,
					savedAt: session.savedAt,
					sourceRevision: origin.sourceRevision,
				});
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				deps.logWarning(`Skipped session file ${fileName}: ${reason}`);
			}
		}

		return matches.sort((left, right) => {
			const savedAtDifference = Date.parse(right.savedAt) - Date.parse(left.savedAt);
			return savedAtDifference || left.fileName.localeCompare(right.fileName);
		});
	}

	async function findOrphanedPartFiles(storageDirectory: string): Promise<OrphanedPartFile[]> {
		let files: string[];
		try {
			files = await deps.readdir(storageDirectory);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return [];
			}

			throw error;
		}

		const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));
		const onDisk = new Set(jsonFiles.map((file) => file.toLowerCase()));
		const parsed: Array<{ fileName: string; session: ChatSession }> = [];
		for (const fileName of jsonFiles) {
			try {
				parsed.push({
					fileName,
					session: await readSession(storageDirectory, fileName),
				});
			} catch {
				// Unreadable files are reported by listSessions; they cannot be
				// classified as orphaned parts without valid link metadata.
			}
		}

		const broken = parsed.filter(({ session }) => {
			const links = [session.previousPartFile, session.nextPartFile];
			return links.some((link) => link && !onDisk.has(link.toLowerCase()));
		});
		if (broken.length === 0) {
			return [];
		}

		const brokenFileNames = new Set(broken.map(({ fileName }) => fileName));
		return broken.map(({ fileName, session }) => {
			const danglingLink =
				[session.previousPartFile, session.nextPartFile].find((link) => link && !onDisk.has(link.toLowerCase())) ?? '';

			// Stale auto-save iterations are superseded by a newer, intact copy
			// of the same session; a broken file without one may hold the only
			// remaining turns and must not be removed automatically.
			const superseded = parsed.some(
				(candidate) =>
					candidate.fileName !== fileName &&
					candidate.session.id === session.id &&
					!brokenFileNames.has(candidate.fileName) &&
					Date.parse(candidate.session.savedAt) >= Date.parse(session.savedAt),
			);

			return {
				fileName,
				sessionId: session.id,
				title: session.title,
				savedAt: session.savedAt,
				danglingLink,
				superseded,
			};
		});
	}

	async function deleteSession(storageDirectory: string, fileName: string): Promise<boolean> {
		const filePath = path.join(storageDirectory, fileName);
		try {
			await deps.unlink(filePath);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/no such file|cannot find|enoent/i.test(message)) {
				return false;
			}

			throw error;
		}
	}

	async function pruneSessions(
		storageDirectory: string,
		maxSavedSessions: number,
		action: SessionPruneAction,
	): Promise<SessionPruneResult> {
		if (maxSavedSessions <= 0) {
			return { archived: 0, deleted: 0 };
		}

		const sessions = await listSessions(storageDirectory);

		// Part files of a split session share one session id and reference each
		// other by file name, so pruning must keep or remove them as a unit —
		// a per-file cutoff can land mid-chain and orphan the surviving parts.
		const groupsById = new Map<string, SessionMeta[]>();
		for (const session of sessions) {
			const group = groupsById.get(session.id) ?? [];
			group.push(session);
			groupsById.set(session.id, group);
		}

		const groups = [...groupsById.values()].sort((a, b) => {
			const newestA = Math.max(...a.map((session) => Date.parse(session.savedAt)));
			const newestB = Math.max(...b.map((session) => Date.parse(session.savedAt)));
			return newestB - newestA;
		});

		const toPrune = groups.slice(maxSavedSessions).flat();
		if (!toPrune.length) {
			return { archived: 0, deleted: 0 };
		}

		if (action === 'archive') {
			const archiveDirectory = path.join(storageDirectory, '.archive');
			await deps.mkdir(archiveDirectory);

			for (const session of toPrune) {
				await deps.rename(path.join(storageDirectory, session.fileName), path.join(archiveDirectory, session.fileName));
			}

			return { archived: toPrune.length, deleted: 0 };
		}

		for (const session of toPrune) {
			await deps.unlink(path.join(storageDirectory, session.fileName));
		}

		return { archived: 0, deleted: toPrune.length };
	}

	return {
		ensureStorageDirectory,
		writeSession,
		writeSessions,
		upsertAutoSaveSessions,
		readSession,
		listSessions,
		findAutoSaveSessionFiles,
		findOrphanedPartFiles,
		deleteSession,
		pruneSessions,
	};
}
