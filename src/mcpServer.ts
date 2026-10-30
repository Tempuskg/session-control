import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {
	DEFAULT_RESUME_SETTINGS,
	DEFAULT_STORAGE_PATH,
	listSessionsAcrossRoots,
	loadReassembledSession,
	resolveStorageDirectory,
	type ResumeOverflowStrategy,
	type ResumeSettings,
	type RootSessionMeta,
	type SessionRoot,
} from './sessionLibrary';
import {
	buildListSessionsToolText,
	buildResumeSessionToolText,
	type ListSessionsToolInput,
	type ResumeSessionToolInput,
	type SessionToolDeps,
	type SessionToolNames,
} from './sessionToolText';

// Standalone stdio MCP server so Cursor, Claude Code, Codex, and other MCP clients
// can list and resume saved `.chat/` sessions without VS Code. It speaks
// newline-delimited JSON-RPC 2.0 and must not import `vscode`.

export const MCP_LIST_SESSIONS_TOOL_NAME = 'list_sessions';
export const MCP_RESUME_SESSION_TOOL_NAME = 'resume_session';
export const MCP_SERVER_NAME = 'session-control';

const MCP_TOOL_NAMES: SessionToolNames = { list: MCP_LIST_SESSIONS_TOOL_NAME, resume: MCP_RESUME_SESSION_TOOL_NAME };
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const OVERFLOW_STRATEGIES: readonly ResumeOverflowStrategy[] = ['summarize', 'truncate', 'recent-only', 'relevant'];

export interface McpServerRoot {
	path: string;
	name: string;
}

export interface McpServerConfig {
	roots: McpServerRoot[];
	storagePath: string;
	resume: ResumeSettings;
}

export const MCP_SERVER_USAGE = [
	'Usage: session-control-mcp [--root <path>]... [--storage-path <path>]',
	'                           [--max-turns <n>] [--max-context-chars <n>] [--overflow-strategy <strategy>]',
	'',
	'Options (environment variable in brackets; options override the environment):',
	`  --root <path>                Workspace root to read saved sessions from; repeat for several [SESSION_CONTROL_ROOTS, separated by '${path.delimiter}']. Default: the current directory.`,
	`  --storage-path <path>        Saved-session folder relative to each root [SESSION_CONTROL_STORAGE_PATH]. Default: ${DEFAULT_STORAGE_PATH}`,
	`  --max-turns <n>              Most recent turns included on resume [SESSION_CONTROL_RESUME_MAX_TURNS]. Default: ${DEFAULT_RESUME_SETTINGS.maxTurns}`,
	`  --max-context-chars <n>      Character budget for resumed context [SESSION_CONTROL_RESUME_MAX_CONTEXT_CHARS]. Default: ${DEFAULT_RESUME_SETTINGS.maxContextChars}`,
	`  --overflow-strategy <name>   ${OVERFLOW_STRATEGIES.join(' | ')} [SESSION_CONTROL_RESUME_OVERFLOW_STRATEGY]. Default: ${DEFAULT_RESUME_SETTINGS.overflowStrategy}`,
	'                               relevant needs TypeSafe in VS Code; here it falls back to summarize.',
].join('\n');

function parsePositiveInteger(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${label} must be a positive integer, got '${value}'.`);
	}
	return parsed;
}

function parseOverflowStrategy(value: string): ResumeOverflowStrategy {
	const match = OVERFLOW_STRATEGIES.find((strategy) => strategy === value);
	if (!match) {
		throw new Error(`--overflow-strategy must be one of ${OVERFLOW_STRATEGIES.join(', ')}, got '${value}'.`);
	}
	return match;
}

function toRoot(rootPath: string, cwd: string): McpServerRoot {
	const resolved = path.resolve(cwd, rootPath);
	return { path: resolved, name: path.basename(resolved) || resolved };
}

/** Reads roots, storage path, and resume limits from arguments, then the environment, then the extension defaults. */
export function parseMcpServerConfig(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>> = {},
	cwd: string = process.cwd(),
): McpServerConfig {
	const options = new Map<string, string[]>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] ?? '';
		const equals = arg.indexOf('=');
		const name = equals > 0 ? arg.slice(0, equals) : arg;
		if (!['--root', '--storage-path', '--max-turns', '--max-context-chars', '--overflow-strategy'].includes(name)) {
			throw new Error(`Unknown option '${arg}'.\n\n${MCP_SERVER_USAGE}`);
		}
		const value = equals > 0 ? arg.slice(equals + 1) : argv[++index];
		if (value === undefined || value === '') {
			throw new Error(`${name} needs a value.`);
		}
		options.set(name, [...(options.get(name) ?? []), value]);
	}

	const last = (name: string, envName: string): string | undefined => options.get(name)?.at(-1) ?? (env[envName]?.trim() || undefined);
	const rootArgs = options.get('--root')
		?? (env.SESSION_CONTROL_ROOTS ?? '').split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
	const roots = (rootArgs.length ? rootArgs : [cwd]).map((rootPath) => toRoot(rootPath, cwd));

	const maxTurns = last('--max-turns', 'SESSION_CONTROL_RESUME_MAX_TURNS');
	const maxContextChars = last('--max-context-chars', 'SESSION_CONTROL_RESUME_MAX_CONTEXT_CHARS');
	const overflowStrategy = last('--overflow-strategy', 'SESSION_CONTROL_RESUME_OVERFLOW_STRATEGY');
	return {
		roots,
		storagePath: last('--storage-path', 'SESSION_CONTROL_STORAGE_PATH') ?? DEFAULT_STORAGE_PATH,
		resume: {
			maxTurns: maxTurns ? parsePositiveInteger(maxTurns, 'max turns') : DEFAULT_RESUME_SETTINGS.maxTurns,
			maxContextChars: maxContextChars ? parsePositiveInteger(maxContextChars, 'max context chars') : DEFAULT_RESUME_SETTINGS.maxContextChars,
			overflowStrategy: overflowStrategy ? parseOverflowStrategy(overflowStrategy) : DEFAULT_RESUME_SETTINGS.overflowStrategy,
		},
	};
}

export type McpRootSessionMeta = RootSessionMeta<McpServerRoot>;

export function createMcpSessionToolDeps(config: McpServerConfig): SessionToolDeps<McpRootSessionMeta> {
	const roots: SessionRoot<McpServerRoot>[] = config.roots.map((root) => ({
		root,
		name: root.name,
		storageDirectory: resolveStorageDirectory(root.path, config.storagePath),
	}));
	return {
		listSessions: () => listSessionsAcrossRoots(roots),
		loadSession: (session) => loadReassembledSession(session.storageDirectory, session.fileName),
		getResumeLimits: () => config.resume,
	};
}

// Input schemas match the `session-control_listSessions` and
// `session-control_resumeSession` language-model tools in package.json.
export const MCP_TOOLS = [
	{
		name: MCP_LIST_SESSIONS_TOOL_NAME,
		title: 'List Saved Sessions',
		description: `Lists chat sessions that Session Control saved in the configured workspace roots, newest first. Returns JSON with each session's id, title, date (ISO saved time), git branch, short commit, turn count, origin provider, and workspace folder. Use this when the user asks which sessions are saved, or to find the id of a session before calling ${MCP_RESUME_SESSION_TOOL_NAME}. Optionally filter by a title, id, or branch substring.`,
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Optional case-insensitive substring matched against session title, id, or git branch.',
				},
				limit: {
					type: 'number',
					description: 'Maximum number of sessions to return (default 20, maximum 100).',
				},
			},
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: MCP_RESUME_SESSION_TOOL_NAME,
		title: 'Resume Saved Session',
		description: `Loads a chat session saved by Session Control and returns its transcript as text so you can continue that conversation. Pass the session id from ${MCP_LIST_SESSIONS_TOOL_NAME}, or a title; titles are fuzzy matched and ambiguous matches return candidate ids to retry with. The transcript is trimmed to the server's max turns and max context chars limits, with a note when earlier turns are omitted. Use this when the user asks to resume, continue, or reload a previous or saved session.`,
		inputSchema: {
			type: 'object',
			properties: {
				session: {
					type: 'string',
					description: 'Saved session id (preferred) or title to resume.',
				},
			},
			required: ['session'],
		},
		annotations: { readOnlyHint: true },
	},
];

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: JsonRpcId;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: JsonRpcId;
	result?: unknown;
	error?: { code: number; message: string };
}

function isRequest(value: unknown): value is JsonRpcRequest {
	return typeof value === 'object' && value !== null && typeof (value as { method?: unknown }).method === 'string';
}

function textContent(text: string, isError = false): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
	return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function readServerVersion(): string {
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { name?: string; version?: string };
		return manifest.name === 'session-control' && manifest.version ? manifest.version : '0.0.0';
	} catch {
		return '0.0.0';
	}
}

export interface McpServer {
	/** Handles one JSON-RPC message; returns undefined for notifications. */
	handle(message: unknown): Promise<JsonRpcResponse | undefined>;
}

export function createMcpServer(config: McpServerConfig, deps: SessionToolDeps<McpRootSessionMeta> = createMcpSessionToolDeps(config)): McpServer {
	const callTool = async (name: unknown, args: unknown): Promise<ReturnType<typeof textContent>> => {
		const input = typeof args === 'object' && args !== null ? args : {};
		try {
			if (name === MCP_LIST_SESSIONS_TOOL_NAME) {
				return textContent(buildListSessionsToolText(await deps.listSessions(), input as ListSessionsToolInput, MCP_TOOL_NAMES));
			}
			if (name === MCP_RESUME_SESSION_TOOL_NAME) {
				return textContent(await buildResumeSessionToolText(input as ResumeSessionToolInput, deps, MCP_TOOL_NAMES));
			}
		} catch (error) {
			return textContent(`Session Control ${String(name)} failed: ${error instanceof Error ? error.message : String(error)}`, true);
		}
		return textContent(`Unknown tool '${String(name)}'. Available tools: ${MCP_TOOLS.map((tool) => tool.name).join(', ')}.`, true);
	};

	return {
		async handle(message) {
			if (!isRequest(message)) {
				return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } };
			}
			if (message.id === undefined) {
				return undefined;
			}

			const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: message.id ?? null, result });
			switch (message.method) {
				case 'initialize': {
					const requested = message.params?.protocolVersion;
					const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
						? requested
						: SUPPORTED_PROTOCOL_VERSIONS[0];
					return reply({
						protocolVersion,
						capabilities: { tools: { listChanged: false } },
						serverInfo: { name: MCP_SERVER_NAME, title: 'Session Control', version: readServerVersion() },
						instructions: `Lists and resumes chat sessions that Session Control saved under ${config.storagePath} in: ${config.roots.map((root) => root.path).join(', ')}.`,
					});
				}
				case 'ping':
					return reply({});
				case 'tools/list':
					return reply({ tools: MCP_TOOLS });
				case 'tools/call':
					return reply(await callTool(message.params?.name, message.params?.arguments));
				default:
					return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
			}
		},
	};
}

/** Serves newline-delimited JSON-RPC over the given streams; resolves when input closes. */
export function serveStdio(server: McpServer, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
	const lines = readline.createInterface({ input, crlfDelay: Infinity });
	const pending: Promise<void>[] = [];
	lines.on('line', (line) => {
		if (!line.trim()) {
			return;
		}
		pending.push((async () => {
			let response: JsonRpcResponse | undefined;
			try {
				response = await server.handle(JSON.parse(line));
			} catch {
				response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } };
			}
			if (response) {
				output.write(`${JSON.stringify(response)}\n`);
			}
		})());
	});
	return new Promise((resolve) => {
		lines.on('close', () => {
			void Promise.all(pending).then(() => resolve());
		});
	});
}

export async function runMcpServer(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(`${MCP_SERVER_USAGE}\n`);
		return;
	}

	let config: McpServerConfig;
	let server: McpServer;
	try {
		config = parseMcpServerConfig(argv, process.env);
		server = createMcpServer(config);
	} catch (error) {
		process.stderr.write(`session-control-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 2;
		return;
	}

	// stdout carries protocol messages only; diagnostics go to stderr.
	process.stderr.write(`session-control-mcp: serving ${config.storagePath} sessions from ${config.roots.map((root) => root.path).join(', ')}\n`);
	await serveStdio(server, process.stdin, process.stdout);
}
