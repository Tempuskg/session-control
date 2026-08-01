import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ResponseTurn, type SavedTurn, type SourceChatSession, type ToolCall } from './types';

interface CopilotCliSessionReaderDeps {
	listSessionDirectories(directoryPath: string): Promise<string[]>;
	readFile(filePath: string): Promise<string>;
	getEnvironment(): NodeJS.ProcessEnv;
	getUserHome(): string;
	hash(value: string): string;
	logWarning(message: string): void;
}

export interface CopilotCliSession extends SourceChatSession {
	provider: 'copilot';
	sourceRevision: string;
}

export interface CopilotCliSessionReadOptions {
	workspacePath: string;
	homePath?: string;
}

interface NormalizedAbsolutePath {
	style: 'posix' | 'win32';
	value: string;
}

interface TrackedToolCall {
	callId: string;
	toolCall: ToolCall;
	attached: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isMissingPathError(error: unknown): boolean {
	if (isRecord(error) && error.code === 'ENOENT') {
		return true;
	}

	const message = error instanceof Error ? error.message : String(error);
	return /no such file|cannot find|enoent/i.test(message);
}

function toIsoTimestamp(value: unknown, fallback: string): string {
	if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
		return new Date(value).toISOString();
	}

	return fallback;
}

function normalizeTitle(value: string): string {
	const collapsed = value.replace(/\s+/g, ' ').trim();
	if (!collapsed) {
		return 'Untitled Copilot CLI Session';
	}

	if (collapsed.length <= 80) {
		return collapsed;
	}

	return `${collapsed.slice(0, 77).trimEnd()}...`;
}

function stringifyUnknown(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}

	if (value === undefined) {
		return undefined;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function normalizeAbsolutePath(value: string): NormalizedAbsolutePath | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	if (path.win32.isAbsolute(trimmed)) {
		return {
			style: 'win32',
			value: path.win32.normalize(trimmed).toLowerCase(),
		};
	}

	if (path.posix.isAbsolute(trimmed)) {
		return {
			style: 'posix',
			value: path.posix.normalize(trimmed),
		};
	}

	return undefined;
}

function isSameOrDescendantPath(
	candidatePath: NormalizedAbsolutePath,
	basePath: NormalizedAbsolutePath,
): boolean {
	if (candidatePath.style !== basePath.style) {
		return false;
	}

	const pathImplementation = candidatePath.style === 'win32' ? path.win32 : path.posix;
	const relative = pathImplementation.relative(basePath.value, candidatePath.value);
	return relative === ''
		|| (
			relative !== '..'
			&& !relative.startsWith(`..${pathImplementation.sep}`)
			&& !pathImplementation.isAbsolute(relative)
		);
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
	const left = normalizeAbsolutePath(leftPath);
	const right = normalizeAbsolutePath(rightPath);
	if (!left || !right) {
		return false;
	}

	return isSameOrDescendantPath(left, right) || isSameOrDescendantPath(right, left);
}

function extractReferences(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const references: string[] = [];
	for (const attachment of value) {
		if (typeof attachment === 'string' && attachment.trim()) {
			references.push(attachment.trim());
			continue;
		}

		if (!isRecord(attachment)) {
			continue;
		}

		const reference = [attachment.path, attachment.uri, attachment.displayName, attachment.name]
			.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
		if (reference) {
			references.push(reference.trim());
		}
	}

	return references;
}

function parseEventLog(content: string, sourceFile: string): Record<string, unknown>[] {
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const records: Record<string, unknown>[] = [];
	for (const line of lines) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new SyntaxError(`Invalid Copilot CLI JSONL in ${sourceFile}`);
		}

		if (isRecord(parsed)) {
			records.push(parsed);
		}
	}

	return records;
}

function createRevisionInput(content: string): string {
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
}

function normalizeCopilotCliEvents(
	records: readonly Record<string, unknown>[],
	content: string,
	sourceFile: string,
	fallbackSessionId: string,
	hash: (value: string) => string,
): CopilotCliSession | null {
	const epoch = '1970-01-01T00:00:00.000Z';
	const sessionStart = records.find((record) => record.type === 'session.start');
	const sessionStartData = sessionStart && isRecord(sessionStart.data) ? sessionStart.data : undefined;
	const sessionContext = sessionStartData && isRecord(sessionStartData.context)
		? sessionStartData.context
		: undefined;
	const startTimestamp = toIsoTimestamp(
		sessionStart?.timestamp ?? sessionStartData?.startTime,
		epoch,
	);
	const sessionId = typeof sessionStartData?.sessionId === 'string' && sessionStartData.sessionId.trim()
		? sessionStartData.sessionId.trim()
		: fallbackSessionId;
	let workingDirectory = typeof sessionContext?.cwd === 'string' && sessionContext.cwd.trim()
		? sessionContext.cwd.trim()
		: undefined;
	let title: string | undefined;
	let lastEventTimestamp = startTimestamp;
	const turns: SavedTurn[] = [];
	const trackedToolCalls = new Map<string, TrackedToolCall>();
	let lastResponseTurn: ResponseTurn | undefined;

	const getTrackedToolCall = (
		data: Record<string, unknown>,
		fallbackCallId: string,
	): TrackedToolCall => {
		const rawCallId = data.toolCallId ?? data.callId ?? data.id;
		const callId = typeof rawCallId === 'string' && rawCallId.trim()
			? rawCallId.trim()
			: fallbackCallId;
		const existing = trackedToolCalls.get(callId);
		const rawName = data.toolName ?? data.name;
		const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'unknown';
		const argumentsText = stringifyUnknown(data.arguments ?? data.args ?? data.input);

		if (existing) {
			if (existing.toolCall.name === 'unknown' && name !== 'unknown') {
				existing.toolCall.name = name;
			}
			if (argumentsText !== undefined) {
				existing.toolCall.arguments = argumentsText;
			}
			return existing;
		}

		const toolCall: ToolCall = {
			name,
			...(argumentsText === undefined ? {} : { arguments: argumentsText }),
		};
		const tracked: TrackedToolCall = {
			callId,
			toolCall,
			attached: false,
		};
		trackedToolCalls.set(callId, tracked);
		return tracked;
	};

	for (const [index, record] of records.entries()) {
		const data = isRecord(record.data) ? record.data : {};
		const timestamp = toIsoTimestamp(record.timestamp, lastEventTimestamp);
		lastEventTimestamp = timestamp;

		if (record.type === 'session.title_changed' && typeof data.title === 'string' && data.title.trim()) {
			title = data.title.trim();
			continue;
		}

		if (
			record.type === 'session.context_changed'
			&& workingDirectory === undefined
			&& typeof data.cwd === 'string'
			&& data.cwd.trim()
		) {
			workingDirectory = data.cwd.trim();
			continue;
		}

		if (record.type === 'user.message' && typeof data.content === 'string' && data.content.trim()) {
			turns.push({
				type: 'request',
				participant: 'user',
				prompt: data.content.trim(),
				references: extractReferences(data.attachments),
				timestamp,
			});
			continue;
		}

		if (record.type === 'assistant.message') {
			const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
			for (const [requestIndex, toolRequest] of toolRequests.entries()) {
				if (isRecord(toolRequest)) {
					getTrackedToolCall(toolRequest, `assistant-${index}-tool-${requestIndex}`);
				}
			}

			const contentText = typeof data.content === 'string' ? data.content.trim() : '';
			const unattachedToolCalls = [...trackedToolCalls.values()]
				.filter((tracked) => !tracked.attached);
			if (!contentText && unattachedToolCalls.length === 0) {
				continue;
			}

			lastResponseTurn = {
				type: 'response',
				participant: 'copilot',
				content: contentText,
				toolCalls: unattachedToolCalls.map((tracked) => tracked.toolCall),
				timestamp,
			};
			for (const tracked of unattachedToolCalls) {
				tracked.attached = true;
			}
			turns.push(lastResponseTurn);
			continue;
		}

		if (record.type === 'tool.execution_start' || record.type === 'tool.user_requested') {
			getTrackedToolCall(data, `tool-${index}`);
			continue;
		}

		if (record.type === 'tool.execution_complete') {
			const tracked = getTrackedToolCall(data, `tool-${index}`);
			const result = isRecord(data.result) ? data.result : undefined;
			const error = isRecord(data.error) ? data.error : undefined;
			const output = stringifyUnknown(
				result?.content
				?? result?.detailedContent
				?? (typeof error?.message === 'string' ? `Error: ${error.message}` : undefined),
			);
			if (output !== undefined) {
				tracked.toolCall.output = output;
			}
		}
	}

	const unattachedToolCalls = [...trackedToolCalls.values()].filter((tracked) => !tracked.attached);
	if (unattachedToolCalls.length > 0) {
		if (!lastResponseTurn) {
			lastResponseTurn = {
				type: 'response',
				participant: 'copilot',
				content: '',
				toolCalls: [],
				timestamp: lastEventTimestamp,
			};
			turns.push(lastResponseTurn);
		}

		lastResponseTurn.toolCalls.push(...unattachedToolCalls.map((tracked) => tracked.toolCall));
		for (const tracked of unattachedToolCalls) {
			tracked.attached = true;
		}
	}

	if (!turns.length) {
		return null;
	}

	const firstRequest = turns.find((turn) => turn.type === 'request');
	const defaultTitle = firstRequest?.type === 'request' ? firstRequest.prompt : fallbackSessionId;

	return {
		provider: 'copilot',
		id: sessionId,
		title: normalizeTitle(title ?? defaultTitle),
		lastMessageDate: lastEventTimestamp,
		turns,
		sourceFile,
		sourceRevision: `sha256:${hash(createRevisionInput(content))}`,
		...(workingDirectory === undefined ? {} : { cwd: workingDirectory }),
	};
}

async function listSessionDirectories(directoryPath: string): Promise<string[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

function createDefaultDeps(): CopilotCliSessionReaderDeps {
	return {
		listSessionDirectories,
		readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
		getEnvironment: () => process.env,
		getUserHome: () => os.homedir(),
		hash: (value) => createHash('sha256').update(value).digest('hex'),
		logWarning: (message) => {
			console.warn(message);
		},
	};
}

export function resolveCopilotCliHomePath(
	homePath: string | undefined,
	environment: NodeJS.ProcessEnv,
	userHome: string,
): string {
	const configured = homePath?.trim();
	if (configured) {
		return configured;
	}

	const fromEnvironment = environment.COPILOT_HOME?.trim();
	if (fromEnvironment) {
		return fromEnvironment;
	}

	return path.join(userHome, '.copilot');
}

export function deriveCopilotCliSessionStatePath(copilotHomePath: string): string {
	return path.join(copilotHomePath, 'session-state');
}

export function createCopilotCliSessionReader(
	overrides: Partial<CopilotCliSessionReaderDeps> = {},
): {
	readCopilotCliSessions(options: CopilotCliSessionReadOptions): Promise<CopilotCliSession[]>;
} {
	const deps: CopilotCliSessionReaderDeps = {
		...createDefaultDeps(),
		...overrides,
	};

	return {
		async readCopilotCliSessions(options): Promise<CopilotCliSession[]> {
			const copilotHomePath = resolveCopilotCliHomePath(
				options.homePath,
				deps.getEnvironment(),
				deps.getUserHome(),
			);
			const sessionStatePath = deriveCopilotCliSessionStatePath(copilotHomePath);
			let sessionIds: string[];
			try {
				sessionIds = await deps.listSessionDirectories(sessionStatePath);
			} catch (error) {
				if (isMissingPathError(error)) {
					return [];
				}
				throw error;
			}

			const sessions: CopilotCliSession[] = [];
			for (const sessionId of sessionIds) {
				const eventsPath = path.join(sessionStatePath, sessionId, 'events.jsonl');
				try {
					const content = await deps.readFile(eventsPath);
					if (!content.trim()) {
						deps.logWarning(`Skipped empty Copilot CLI event log: ${eventsPath}`);
						continue;
					}

					const records = parseEventLog(content, eventsPath);
					const session = normalizeCopilotCliEvents(
						records,
						content,
						eventsPath,
						sessionId,
						deps.hash,
					);
					if (!session) {
						deps.logWarning(`Skipped Copilot CLI event log without usable turns: ${eventsPath}`);
						continue;
					}

					if (session.cwd && pathsOverlap(session.cwd, options.workspacePath)) {
						sessions.push(session);
					}
				} catch (error) {
					if (isMissingPathError(error)) {
						continue;
					}
					if (error instanceof SyntaxError) {
						deps.logWarning(`Skipped corrupt Copilot CLI event log: ${eventsPath}`);
						continue;
					}
					throw error;
				}
			}

			return sessions.sort(
				(left, right) => Date.parse(right.lastMessageDate) - Date.parse(left.lastMessageDate),
			);
		},
	};
}

const defaultCopilotCliSessionReader = createCopilotCliSessionReader();

export async function readCopilotCliSessions(
	options: CopilotCliSessionReadOptions,
): Promise<CopilotCliSession[]> {
	return defaultCopilotCliSessionReader.readCopilotCliSessions(options);
}
