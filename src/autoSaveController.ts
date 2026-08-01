import * as path from 'node:path';
import {
	type AutoSaveDiagnosticState,
	type AutoSaveSourceEventKind,
	type AutoSaveSourceId,
} from './autoSaveDiagnostics';
import { type SourceChatSession, type ToolCall } from './types';

export interface AutoSaveControllerDisposable {
	dispose: () => void;
}

export interface AutoSaveController extends AutoSaveControllerDisposable {
	reconcile: () => void;
}

export interface AutoSaveControllerWatcher {
	onDidChange: (listener: (sourcePath?: string) => void) => AutoSaveControllerDisposable;
	onDidCreate: (listener: (sourcePath?: string) => void) => AutoSaveControllerDisposable;
	dispose: () => void;
}

export interface AutoSaveCandidate<TSession> {
	identity: string;
	sourceSessionId: string;
	sourcePath: string;
	sourceRevision: string;
	title: string;
	turnCount: number;
	session: TSession;
}

export interface ExistingAutoSaveFile {
	fileName: string;
	sourceRevision: string;
}

export const AUTO_SAVE_CHECKPOINT_STATE_VERSION = 1;

export interface AutoSaveCheckpointEntry {
	sourceId: string;
	sourceSessionId: string;
	fileNames: readonly string[];
	revisionHash?: string;
}

export interface AutoSaveCheckpointState {
	version: typeof AUTO_SAVE_CHECKPOINT_STATE_VERSION;
	checkpoints: readonly AutoSaveCheckpointEntry[];
}

export interface AutoSaveCheckpointStorage {
	read: () => unknown;
	write: (state: AutoSaveCheckpointState) => PromiseLike<void>;
}

export interface AutoSaveSource<TSession> {
	sourceId: AutoSaveSourceId;
	directory: string;
	glob: string;
	label: string;
	sessionLabel: string;
	storageDirectory: string;
	readCandidates: () => Promise<AutoSaveCandidate<TSession>[]>;
	findExistingAutoSaves: (sourceSessionId: string) => Promise<readonly ExistingAutoSaveFile[]>;
	saveCandidates: (candidates: readonly AutoSaveCandidate<TSession>[]) => Promise<readonly string[] | undefined>;
}

export interface AutoSaveControllerDeps {
	createWatcher: (directory: string, glob: string) => AutoSaveControllerWatcher;
	pathExists: (sourcePath: string) => boolean;
	diagnosticState: AutoSaveDiagnosticState;
	appendLine: (value: string) => void;
	showWarningMessage: (message: string) => PromiseLike<unknown>;
	hash: (value: string) => string;
	schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearSchedule: (handle: ReturnType<typeof setTimeout>) => void;
	scheduleMaintenance?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearMaintenanceSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
	debounceDelayMs: number;
	settleReadDelayMs: number;
	maxSettleReadAttempts: number;
	incompleteRetryDelaysMs: readonly number[];
	failureRetryDelayMs: number;
	directoryRecoveryDelayMs: number;
	fallbackScanIntervalMs: number;
	checkpointStorage?: AutoSaveCheckpointStorage;
}

interface ComparableSourcePath {
	absolute: boolean;
	caseInsensitive: boolean;
	fileStem: string;
	normalized: string;
}

interface PendingReconciliation<TSession> {
	source: AutoSaveSource<TSession>;
	changedPath?: string;
}

function toComparableSourcePath(sourcePath: string): ComparableSourcePath | undefined {
	const trimmed = sourcePath.trim();
	if (!trimmed) {
		return undefined;
	}

	const isWindowsAbsolute = path.win32.isAbsolute(trimmed);
	const isPosixAbsolute = path.posix.isAbsolute(trimmed);
	const caseInsensitive = isWindowsAbsolute || trimmed.includes('\\');
	const normalized = isWindowsAbsolute
		? path.win32.normalize(trimmed).replace(/\\/g, '/').toLowerCase()
		: isPosixAbsolute
			? path.posix.normalize(trimmed)
			: trimmed.replace(/\\/g, '/');
	const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);

	return {
		absolute: isWindowsAbsolute || isPosixAbsolute,
		caseInsensitive,
		fileStem: fileName.replace(/\.jsonl?$/i, ''),
		normalized,
	};
}

function sourcePathsMatch(candidatePath: string, changedPath: string): boolean {
	const candidate = toComparableSourcePath(candidatePath);
	const changed = toComparableSourcePath(changedPath);
	if (!candidate || !changed) {
		return false;
	}

	if (candidate.absolute && changed.absolute) {
		return candidate.normalized === changed.normalized;
	}

	if (!candidate.fileStem || !changed.fileStem) {
		return false;
	}

	return candidate.caseInsensitive || changed.caseInsensitive
		? candidate.fileStem.toLowerCase() === changed.fileStem.toLowerCase()
		: candidate.fileStem === changed.fileStem;
}

function selectCandidatesForChangedPath<TSession>(
	candidates: readonly AutoSaveCandidate<TSession>[],
	changedPath: string | undefined,
): readonly AutoSaveCandidate<TSession>[] {
	if (changedPath === undefined) {
		return candidates;
	}

	const matches = candidates.filter((candidate) => sourcePathsMatch(candidate.sourcePath, changedPath));
	return matches.length === 1 ? matches : candidates;
}

function createToolCallRevisionInput(toolCall: ToolCall): Record<string, string> {
	return {
		name: toolCall.name,
		...(toolCall.summary === undefined ? {} : { summary: toolCall.summary }),
		...(toolCall.arguments === undefined ? {} : { arguments: toolCall.arguments }),
		...(toolCall.output === undefined ? {} : { output: toolCall.output }),
	};
}

export function createAutoSaveSourceRevisionInput(sourceId: AutoSaveSourceId, session: SourceChatSession): string {
	return JSON.stringify({
		sourceId,
		provider: session.provider,
		sessionId: session.id,
		title: session.title,
		turns: session.turns.map((turn) =>
			turn.type === 'request'
				? {
						type: turn.type,
						participant: turn.participant,
						text: turn.prompt,
						references: turn.references,
					}
				: {
						type: turn.type,
						participant: turn.participant,
						text: turn.content,
						toolCalls: turn.toolCalls.map(createToolCallRevisionInput),
					},
		),
	});
}

function createCandidateRevisionInput<TSession>(
	source: AutoSaveSource<TSession>,
	candidate: AutoSaveCandidate<TSession>,
): string {
	return createStoredRevisionInput(source.sourceId, candidate.sourceSessionId, candidate.sourceRevision);
}

function createStoredRevisionInput(
	sourceId: AutoSaveSourceId,
	sourceSessionId: string,
	sourceRevision: string,
): string {
	return JSON.stringify({
		sourceId,
		sourceSessionId,
		sourceRevision,
	});
}

function createCheckpointKey(sourceId: string, sourceSessionId: string): string {
	return JSON.stringify([sourceId, sourceSessionId]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isCheckpointFileName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!path.win32.isAbsolute(value) &&
		!path.posix.isAbsolute(value) &&
		path.win32.basename(value) === value &&
		path.posix.basename(value) === value
	);
}

function parseCheckpointState(value: unknown): AutoSaveCheckpointEntry[] {
	if (
		!isRecord(value) ||
		value.version !== AUTO_SAVE_CHECKPOINT_STATE_VERSION ||
		!Array.isArray(value.checkpoints)
	) {
		return [];
	}

	const checkpoints: AutoSaveCheckpointEntry[] = [];
	for (const candidate of value.checkpoints) {
		if (
			!isRecord(candidate) ||
			typeof candidate.sourceId !== 'string' ||
			candidate.sourceId.length === 0 ||
			typeof candidate.sourceSessionId !== 'string' ||
			candidate.sourceSessionId.length === 0 ||
			!Array.isArray(candidate.fileNames) ||
			candidate.fileNames.length === 0 ||
			!candidate.fileNames.every(isCheckpointFileName) ||
			(candidate.revisionHash !== undefined &&
				(typeof candidate.revisionHash !== 'string' || candidate.revisionHash.length === 0))
		) {
			continue;
		}

		const checkpoint: AutoSaveCheckpointEntry = {
			sourceId: candidate.sourceId,
			sourceSessionId: candidate.sourceSessionId,
			fileNames: [...candidate.fileNames],
		};
		if (typeof candidate.revisionHash === 'string') {
			checkpoint.revisionHash = candidate.revisionHash;
		}
		checkpoints.push(checkpoint);
	}

	return checkpoints;
}

function createCandidateSetRevisionInput<TSession>(candidates: readonly AutoSaveCandidate<TSession>[]): string {
	return JSON.stringify(
		candidates.map((candidate) => ({
			identity: candidate.identity,
			sourceRevision: candidate.sourceRevision,
		})),
	);
}

function isRecognizedIncompleteSourceError(error: unknown): boolean {
	if (!(error instanceof SyntaxError)) {
		return false;
	}

	const message = error.message.toLowerCase();
	return (
		message.includes('unexpected end of json') ||
		message.includes('unexpected end of input') ||
		message.includes('unexpected eof') ||
		message.includes('end of data') ||
		message.includes('unterminated') ||
		message.includes('incomplete json') ||
		message.includes('truncated json') ||
		/\binvalid\b.*\bjsonl?\b/.test(message)
	);
}

export function createAutoSaveController<TSession>(
	sources: readonly AutoSaveSource<TSession>[],
	deps: AutoSaveControllerDeps,
): AutoSaveController {
	const checkpoints = new Map<string, AutoSaveCheckpointEntry>();
	const restoredCheckpointKeys = new Set<string>();
	const debounceTimers = new Map<AutoSaveSourceId, ReturnType<typeof setTimeout>>();
	const retryTimers = new Map<AutoSaveSourceId, ReturnType<typeof setTimeout>>();
	const directoryRecoveryTimers = new Map<AutoSaveSourceId, ReturnType<typeof setTimeout>>();
	const retryAttempts = new Map<AutoSaveSourceId, number>();
	const delayWaiters = new Map<ReturnType<typeof setTimeout>, (shouldContinue: boolean) => void>();
	const activeReconciliations = new Set<AutoSaveSourceId>();
	const trailingReconciliations = new Map<AutoSaveSourceId, PendingReconciliation<TSession>>();
	const sourceWatchers = new Map<AutoSaveSourceId, AutoSaveControllerWatcher>();
	const sourceWatcherDisposables = new Map<AutoSaveSourceId, AutoSaveControllerDisposable[]>();
	const disabledSources = new Set<AutoSaveSourceId>();
	const warnedSources = new Set<AutoSaveSourceId>();
	const scheduleMaintenance = deps.scheduleMaintenance ?? deps.schedule;
	const clearMaintenanceSchedule = deps.clearMaintenanceSchedule ?? deps.clearSchedule;
	const checkpointStorage = deps.checkpointStorage;
	let checkpointWriteChain = Promise.resolve();
	let fallbackScanTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	if (checkpointStorage) {
		try {
			for (const checkpoint of parseCheckpointState(checkpointStorage.read())) {
				const checkpointKey = createCheckpointKey(checkpoint.sourceId, checkpoint.sourceSessionId);
				checkpoints.set(checkpointKey, checkpoint);
				restoredCheckpointKeys.add(checkpointKey);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.appendLine(`[auto-save] Ignored unreadable workspace checkpoint state: ${message}`);
		}
	}

	const persistCheckpoints = (): void => {
		if (!checkpointStorage) {
			return;
		}

		const state: AutoSaveCheckpointState = {
			version: AUTO_SAVE_CHECKPOINT_STATE_VERSION,
			checkpoints: [...checkpoints.values()]
				.map((checkpoint) => ({
					sourceId: checkpoint.sourceId,
					sourceSessionId: checkpoint.sourceSessionId,
					fileNames: [...checkpoint.fileNames],
					...(checkpoint.revisionHash === undefined ? {} : { revisionHash: checkpoint.revisionHash }),
				}))
				.sort((left, right) => {
					const sourceDifference = left.sourceId.localeCompare(right.sourceId);
					return sourceDifference || left.sourceSessionId.localeCompare(right.sourceSessionId);
				}),
		};
		checkpointWriteChain = checkpointWriteChain
			.then(() => checkpointStorage.write(state))
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				deps.appendLine(`[auto-save] Could not persist workspace checkpoints: ${message}`);
			});
	};

	const setCheckpoint = (checkpoint: AutoSaveCheckpointEntry): void => {
		const checkpointKey = createCheckpointKey(checkpoint.sourceId, checkpoint.sourceSessionId);
		checkpoints.set(checkpointKey, checkpoint);
		restoredCheckpointKeys.delete(checkpointKey);
		persistCheckpoints();
	};

	const clearDirectoryRecoveryTimer = (sourceId: AutoSaveSourceId): void => {
		const recoveryTimer = directoryRecoveryTimers.get(sourceId);
		if (recoveryTimer === undefined) {
			return;
		}

		clearMaintenanceSchedule(recoveryTimer);
		directoryRecoveryTimers.delete(sourceId);
	};

	const waitForDelay = (delayMs: number): Promise<boolean> => {
		if (delayMs <= 0) {
			return Promise.resolve(!disposed);
		}

		return new Promise((resolve) => {
			const handle = deps.schedule(() => {
				delayWaiters.delete(handle);
				resolve(!disposed);
			}, delayMs);
			delayWaiters.set(handle, resolve);
		});
	};

	const readSettledCandidates = async (
		source: AutoSaveSource<TSession>,
		changedPath?: string,
	): Promise<AutoSaveCandidate<TSession>[] | undefined> => {
		const maxSettleReadAttempts = Math.max(2, Math.floor(deps.maxSettleReadAttempts));
		let previousRevisionInput: string | undefined;
		let successfulReadCount = 0;
		let incompleteRetryCount = 0;

		while (successfulReadCount < maxSettleReadAttempts && !disposed) {
			let candidates: AutoSaveCandidate<TSession>[];
			try {
				candidates = await source.readCandidates();
			} catch (error) {
				const retryDelayMs = deps.incompleteRetryDelaysMs[incompleteRetryCount];
				if (!isRecognizedIncompleteSourceError(error) || retryDelayMs === undefined) {
					throw error;
				}

				incompleteRetryCount += 1;
				deps.appendLine(
					`[auto-save] Source JSON/JSONL appears incomplete; retrying read ${incompleteRetryCount}/${deps.incompleteRetryDelaysMs.length} in ${retryDelayMs} ms…`,
				);
				if (!(await waitForDelay(retryDelayMs))) {
					return undefined;
				}
				continue;
			}

			if (disposed) {
				return undefined;
			}

			successfulReadCount += 1;
			const selectedCandidates = selectCandidatesForChangedPath(candidates, changedPath);
			const revisionInput = createCandidateSetRevisionInput(selectedCandidates);
			if (revisionInput === previousRevisionInput) {
				deps.appendLine(`[auto-save] Source content settled after ${successfulReadCount} bounded reads.`);
				return candidates;
			}

			previousRevisionInput = revisionInput;
			if (successfulReadCount >= maxSettleReadAttempts) {
				const reason = `Source content did not settle after ${maxSettleReadAttempts} reads.`;
				deps.diagnosticState.recordSkip(source.sourceId, reason);
				deps.appendLine(`[auto-save] Skipped — ${reason}`);
				return undefined;
			}

			if (!(await waitForDelay(deps.settleReadDelayMs))) {
				return undefined;
			}
		}

		return undefined;
	};

	const reconcileSource = async (source: AutoSaveSource<TSession>, changedPath?: string): Promise<boolean> => {
		deps.diagnosticState.recordScan(source.sourceId);
		const candidates = await readSettledCandidates(source, changedPath);
		if (!candidates) {
			return false;
		}
		deps.diagnosticState.recordScan(source.sourceId, candidates.length);
		deps.appendLine(`[auto-save] Read ${candidates.length} ${source.sessionLabel} session(s).`);
		if (candidates.length === 0) {
			deps.diagnosticState.recordSkip(source.sourceId, 'No sessions found.');
			deps.appendLine('[auto-save] No sessions found — nothing to save.');
			return true;
		}

		const selectedCandidates = selectCandidatesForChangedPath(candidates, changedPath);
		const selected = selectedCandidates[0];
		if (!selected) {
			deps.diagnosticState.recordSkip(source.sourceId, 'Selected session was unavailable.');
			return true;
		}

		if (selectedCandidates !== candidates) {
			deps.appendLine(`[auto-save] Matched changed source path to session id=${selected.sourceSessionId}.`);
		} else if (changedPath !== undefined) {
			deps.appendLine('[auto-save] Changed source path did not map uniquely; using full source scan order.');
		}
		deps.appendLine(
			`[auto-save] Selected: "${selected.title}" id=${selected.sourceSessionId} turns=${selected.turnCount}`,
		);
		const revisionHash = deps.hash(createCandidateRevisionInput(source, selected));
		const checkpointKey = createCheckpointKey(source.sourceId, selected.sourceSessionId);
		let previous = checkpoints.get(checkpointKey);
		if (
			restoredCheckpointKeys.delete(checkpointKey) &&
			previous !== undefined &&
			previous.fileNames.some((fileName) => !deps.pathExists(path.join(source.storageDirectory, fileName)))
		) {
			checkpoints.delete(checkpointKey);
			persistCheckpoints();
			previous = undefined;
			deps.appendLine(
				`[auto-save] Discarded a stale workspace checkpoint for ${source.sourceId}:${selected.sourceSessionId}; rebuilding from saved files.`,
			);
		}
		if (previous === undefined) {
			const existingAutoSaves = await source.findExistingAutoSaves(selected.sourceSessionId);
			if (existingAutoSaves.length > 0) {
				const fileNames = [...new Set(existingAutoSaves.map((existing) => existing.fileName))];
				const recoveredRevisionHashes = new Set(
					existingAutoSaves.map((existing) =>
						deps.hash(createStoredRevisionInput(source.sourceId, selected.sourceSessionId, existing.sourceRevision)),
					),
				);
				const [recoveredRevisionHash] = [...recoveredRevisionHashes];
				previous =
					recoveredRevisionHashes.size === 1 && recoveredRevisionHash !== undefined
						? {
								sourceId: source.sourceId,
								sourceSessionId: selected.sourceSessionId,
								fileNames,
								revisionHash: recoveredRevisionHash,
							}
						: {
								sourceId: source.sourceId,
								sourceSessionId: selected.sourceSessionId,
								fileNames,
							};
				setCheckpoint(previous);
				deps.appendLine(
					`[auto-save] Recovered ${fileNames.length} existing auto-save file(s) for ${source.sourceId}:${selected.sourceSessionId}.`,
				);
			}
		}

		if (previous?.revisionHash === revisionHash) {
			const reason = `Semantic revision unchanged for session ${selected.sourceSessionId}.`;
			deps.diagnosticState.recordSkip(source.sourceId, reason);
			deps.appendLine(`[auto-save] Skipped — ${reason}`);
			return true;
		}

		deps.appendLine(`[auto-save] Saving to ${source.storageDirectory}…`);
		const newFileNames = await source.saveCandidates(selectedCandidates);
		if (!newFileNames || newFileNames.length === 0) {
			deps.diagnosticState.recordSkip(source.sourceId, 'Save returned no filenames.');
			deps.appendLine('[auto-save] Save returned no filename — session may already be up to date.');
			return true;
		}

		const savedFileNames = [...newFileNames];
		setCheckpoint({
			sourceId: source.sourceId,
			sourceSessionId: selected.sourceSessionId,
			fileNames: savedFileNames,
			revisionHash,
		});
		deps.diagnosticState.recordSuccess(source.sourceId, selected.sourceSessionId, savedFileNames);
		deps.appendLine(`[auto-save] Saved "${selected.title}" (${selected.turnCount} turns) after chat response.`);
		return true;
	};

	const recoverSource = (source: AutoSaveSource<TSession>): void => {
		if (!disabledSources.delete(source.sourceId)) {
			return;
		}

		retryAttempts.delete(source.sourceId);
		warnedSources.delete(source.sourceId);
		deps.diagnosticState.recordRecovery(source.sourceId);
		deps.appendLine(`[auto-save] ${source.label} recovered; only its source diagnostic state was cleared.`);
	};

	const scheduleSourceRetry = (source: AutoSaveSource<TSession>): void => {
		if (disposed || retryTimers.has(source.sourceId)) {
			return;
		}

		const attempt = (retryAttempts.get(source.sourceId) ?? 0) + 1;
		const delayMs = Math.max(1, Math.floor(deps.failureRetryDelayMs));
		retryAttempts.set(source.sourceId, attempt);
		deps.diagnosticState.recordRetry(source.sourceId, attempt, delayMs);
		deps.appendLine(`[auto-save] ${source.label} retry ${attempt} scheduled in ${delayMs} ms.`);
		const retryTimer = deps.schedule(() => {
			retryTimers.delete(source.sourceId);
			if (disposed) {
				return;
			}

			if (!sourceWatchers.has(source.sourceId) && !registerSourceWatcher(source)) {
				return;
			}
			runReconciliation(source, undefined, true);
		}, delayMs);
		retryTimers.set(source.sourceId, retryTimer);
	};

	const failSource = (source: AutoSaveSource<TSession>, error: unknown): void => {
		disabledSources.add(source.sourceId);
		trailingReconciliations.delete(source.sourceId);
		const shouldWarn = !warnedSources.has(source.sourceId);
		if (shouldWarn) {
			warnedSources.add(source.sourceId);
		}
		deps.diagnosticState.recordFailure(source.sourceId, error, warnedSources.has(source.sourceId));
		const message = error instanceof Error ? error.message : String(error);
		deps.appendLine(
			`[auto-save] ${source.label} paused after a persistent source error: ${message}. Other sources remain active.`,
		);
		if (shouldWarn) {
			void deps.showWarningMessage(
				`Session Control could not read ${source.label} (${source.directory}): ${message}. Other auto-save sources will continue; this source will retry automatically.`,
			);
		}
		scheduleSourceRetry(source);
	};

	const queueTrailingReconciliation = (source: AutoSaveSource<TSession>, changedPath?: string): void => {
		const existing = trailingReconciliations.get(source.sourceId);
		if (!existing && changedPath !== undefined) {
			trailingReconciliations.set(source.sourceId, { source, changedPath });
			return;
		}

		if (!existing) {
			trailingReconciliations.set(source.sourceId, { source });
			return;
		}

		if (existing.changedPath === undefined || changedPath === undefined || existing.changedPath !== changedPath) {
			trailingReconciliations.set(source.sourceId, { source });
		}
	};

	const runReconciliation = (source: AutoSaveSource<TSession>, changedPath?: string, allowDisabled = false): void => {
		if (disposed || (disabledSources.has(source.sourceId) && !allowDisabled)) {
			return;
		}

		if (activeReconciliations.has(source.sourceId)) {
			queueTrailingReconciliation(source, changedPath);
			deps.appendLine('[auto-save] Save already active; queued one trailing reconciliation.');
			return;
		}

		activeReconciliations.add(source.sourceId);
		void (async () => {
			try {
				const sourceResponded = await reconcileSource(source, changedPath);
				if (sourceResponded) {
					recoverSource(source);
				} else if (allowDisabled && disabledSources.has(source.sourceId)) {
					scheduleSourceRetry(source);
				}
			} catch (error) {
				failSource(source, error);
			} finally {
				activeReconciliations.delete(source.sourceId);
				const trailing = trailingReconciliations.get(source.sourceId);
				if (trailing && !disposed && !disabledSources.has(source.sourceId)) {
					trailingReconciliations.delete(source.sourceId);
					runReconciliation(trailing.source, trailing.changedPath);
				}
			}
		})();
	};

	const onStorageChanged = (
		source: AutoSaveSource<TSession>,
		kind: AutoSaveSourceEventKind,
		sourcePath?: string,
	): void => {
		const sourcePathExists = deps.pathExists(source.directory);
		deps.diagnosticState.registerSource(source.sourceId, source.directory, sourcePathExists);
		if (sourcePathExists) {
			clearDirectoryRecoveryTimer(source.sourceId);
		}
		if (sourcePath === undefined) {
			deps.diagnosticState.recordEvent(source.sourceId, kind);
		} else {
			deps.diagnosticState.recordEvent(source.sourceId, kind, sourcePath);
		}

		if (disabledSources.has(source.sourceId)) {
			deps.diagnosticState.recordSkip(
				source.sourceId,
				'Source paused due to a previous error; periodic retry remains scheduled.',
			);
			deps.appendLine(
				`[auto-save] Skipped ${source.label} event while that source is paused; periodic retry remains scheduled.`,
			);
			return;
		}

		deps.appendLine(`[auto-save] File change detected, debouncing ${deps.debounceDelayMs / 1000} s…`);
		const debounceTimer = debounceTimers.get(source.sourceId);
		if (debounceTimer) {
			deps.clearSchedule(debounceTimer);
		}

		const nextDebounceTimer = deps.schedule(() => {
			debounceTimers.delete(source.sourceId);
			runReconciliation(source, sourcePath);
		}, deps.debounceDelayMs);
		debounceTimers.set(source.sourceId, nextDebounceTimer);
	};

	const registerSourceWatcher = (source: AutoSaveSource<TSession>): boolean => {
		if (sourceWatchers.has(source.sourceId)) {
			return true;
		}

		let watcher: AutoSaveControllerWatcher | undefined;
		const watcherDisposables: AutoSaveControllerDisposable[] = [];
		try {
			watcher = deps.createWatcher(source.directory, source.glob);
			watcherDisposables.push(
				watcher.onDidChange((sourcePath) => onStorageChanged(source, 'change', sourcePath)),
				watcher.onDidCreate((sourcePath) => onStorageChanged(source, 'create', sourcePath)),
			);
			sourceWatchers.set(source.sourceId, watcher);
			sourceWatcherDisposables.set(source.sourceId, watcherDisposables);
			clearDirectoryRecoveryTimer(source.sourceId);
			return true;
		} catch (error) {
			for (const watcherDisposable of watcherDisposables) {
				watcherDisposable.dispose();
			}
			watcher?.dispose();
			failSource(source, error);
			return false;
		}
	};

	const scheduleDirectoryRecovery = (source: AutoSaveSource<TSession>): void => {
		const delayMs = Math.max(0, Math.floor(deps.directoryRecoveryDelayMs));
		if (disposed || delayMs === 0 || directoryRecoveryTimers.has(source.sourceId)) {
			return;
		}

		const recoveryTimer = scheduleMaintenance(() => {
			directoryRecoveryTimers.delete(source.sourceId);
			if (disposed) {
				return;
			}

			const sourcePathExists = deps.pathExists(source.directory);
			deps.diagnosticState.registerSource(source.sourceId, source.directory, sourcePathExists);
			if (!sourcePathExists) {
				deps.diagnosticState.recordSkip(
					source.sourceId,
					'Source path does not exist yet; directory recovery remains scheduled.',
				);
				scheduleDirectoryRecovery(source);
				return;
			}

			deps.appendLine(`[auto-save] ${source.label} directory appeared; reconciling now.`);
			if (sourceWatchers.has(source.sourceId) || registerSourceWatcher(source)) {
				runReconciliation(source, undefined, true);
			}
		}, delayMs);
		directoryRecoveryTimers.set(source.sourceId, recoveryTimer);
	};

	const scheduleFallbackScan = (): void => {
		const delayMs = Math.max(0, Math.floor(deps.fallbackScanIntervalMs));
		if (disposed || sources.length === 0 || delayMs === 0 || fallbackScanTimer !== undefined) {
			return;
		}

		fallbackScanTimer = scheduleMaintenance(() => {
			fallbackScanTimer = undefined;
			if (disposed) {
				return;
			}

			deps.appendLine('[auto-save] Running low-frequency fallback reconciliation scan.');
			for (const source of sources) {
				const sourcePathExists = deps.pathExists(source.directory);
				deps.diagnosticState.registerSource(source.sourceId, source.directory, sourcePathExists);
				if (!sourcePathExists) {
					deps.diagnosticState.recordSkip(
						source.sourceId,
						'Source path does not exist yet; directory recovery remains scheduled.',
					);
					scheduleDirectoryRecovery(source);
					continue;
				}

				clearDirectoryRecoveryTimer(source.sourceId);
				if (!sourceWatchers.has(source.sourceId) && !registerSourceWatcher(source)) {
					continue;
				}
				runReconciliation(source);
			}
			scheduleFallbackScan();
		}, delayMs);
	};

	for (const source of sources) {
		const sourcePathExists = deps.pathExists(source.directory);
		deps.diagnosticState.registerSource(source.sourceId, source.directory, sourcePathExists);
		if (!sourcePathExists) {
			deps.diagnosticState.recordSkip(source.sourceId, 'Source path does not exist yet.');
			deps.appendLine(`[auto-save] Waiting for ${source.label} directory: ${source.directory}`);
			registerSourceWatcher(source);
			scheduleDirectoryRecovery(source);
			continue;
		}

		deps.appendLine(`[auto-save] Watching ${source.label}: ${source.directory} (${source.glob})`);
		registerSourceWatcher(source);
	}
	scheduleFallbackScan();

	return {
		reconcile: () => {
			for (const source of sources) {
				const sourcePathExists = deps.pathExists(source.directory);
				deps.diagnosticState.registerSource(source.sourceId, source.directory, sourcePathExists);
				if (!sourcePathExists) {
					scheduleDirectoryRecovery(source);
					continue;
				}
				if (!sourceWatchers.has(source.sourceId) && !registerSourceWatcher(source)) {
					continue;
				}
				runReconciliation(source);
			}
		},
		dispose: () => {
			disposed = true;
			for (const debounceTimer of debounceTimers.values()) {
				deps.clearSchedule(debounceTimer);
			}
			debounceTimers.clear();
			for (const retryTimer of retryTimers.values()) {
				deps.clearSchedule(retryTimer);
			}
			retryTimers.clear();
			for (const recoveryTimer of directoryRecoveryTimers.values()) {
				clearMaintenanceSchedule(recoveryTimer);
			}
			directoryRecoveryTimers.clear();
			if (fallbackScanTimer !== undefined) {
				clearMaintenanceSchedule(fallbackScanTimer);
				fallbackScanTimer = undefined;
			}
			for (const [delayHandle, resolve] of delayWaiters) {
				deps.clearSchedule(delayHandle);
				resolve(false);
			}
			delayWaiters.clear();
			trailingReconciliations.clear();
			for (const watcher of sourceWatchers.values()) {
				watcher.dispose();
			}
			sourceWatchers.clear();
			for (const watcherDisposables of sourceWatcherDisposables.values()) {
				for (const watcherDisposable of watcherDisposables) {
					watcherDisposable.dispose();
				}
			}
			sourceWatcherDisposables.clear();
		},
	};
}
