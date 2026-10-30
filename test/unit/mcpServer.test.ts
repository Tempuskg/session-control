import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import {
	MCP_LIST_SESSIONS_TOOL_NAME,
	MCP_RESUME_SESSION_TOOL_NAME,
	createMcpServer,
	parseMcpServerConfig,
	serveStdio,
	type JsonRpcResponse,
	type McpServerConfig,
} from '../../src/mcpServer';
import { DEFAULT_RESUME_SETTINGS } from '../../src/sessionLibrary';
import { createSessionStore } from '../../src/sessionStore';
import type { ChatSession, SavedTurn } from '../../src/types';

function createTurns(count: number): SavedTurn[] {
	return Array.from({ length: count }, (_, index): SavedTurn => (index % 2 === 0
		? { type: 'request', participant: 'copilot', prompt: `Question ${index}`, references: [], timestamp: '2026-04-12T12:00:00.000Z' }
		: { type: 'response', participant: 'copilot', content: `Answer ${index}`, toolCalls: [], timestamp: '2026-04-12T12:00:00.000Z' }));
}

function createSession(id: string, title: string, savedAt: string, turns: SavedTurn[]): ChatSession {
	return {
		version: 1,
		id,
		title,
		savedAt,
		git: { branch: 'main', commit: 'abcdef123456', dirty: false },
		vscodeVersion: '1.115.0',
		totalTurns: turns.length,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns,
		markdownSummary: '',
	};
}

type ToolCallResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

suite('mcpServer', () => {
	let root: string;
	let config: McpServerConfig;

	suiteSetup(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-mcp-'));
		const store = createSessionStore();
		const storageDirectory = path.join(root, '.chat');
		await store.writeSession(storageDirectory, createSession('session-auth', 'Fix auth bug', '2026-04-12T12:00:00.000Z', createTurns(10)));
		await store.writeSession(storageDirectory, createSession('session-login', 'Add login form', '2026-04-13T12:00:00.000Z', createTurns(2)));
		config = parseMcpServerConfig(['--root', root, '--max-turns', '4'], {});
	});

	suiteTeardown(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
		const response = await createMcpServer(config).handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
		assert.strictEqual(response?.id, 7);
		return response?.result as ToolCallResult;
	}

	test('config reads roots and resume limits from arguments, then env, then defaults', () => {
		const cwd = path.resolve('/work/app');
		const defaults = parseMcpServerConfig([], {}, cwd);
		assert.deepStrictEqual(defaults.roots, [{ path: cwd, name: 'app' }]);
		assert.strictEqual(defaults.storagePath, '.chat');
		assert.deepStrictEqual(defaults.resume, DEFAULT_RESUME_SETTINGS);

		const fromEnv = parseMcpServerConfig([], {
			SESSION_CONTROL_ROOTS: [path.resolve('/a'), path.resolve('/b')].join(path.delimiter),
			SESSION_CONTROL_STORAGE_PATH: 'history',
			SESSION_CONTROL_RESUME_MAX_TURNS: '10',
			SESSION_CONTROL_RESUME_MAX_CONTEXT_CHARS: '500',
			SESSION_CONTROL_RESUME_OVERFLOW_STRATEGY: 'recent-only',
		}, cwd);
		assert.deepStrictEqual(fromEnv.roots.map((entry) => entry.name), ['a', 'b']);
		assert.strictEqual(fromEnv.storagePath, 'history');
		assert.deepStrictEqual(fromEnv.resume, { maxTurns: 10, maxContextChars: 500, overflowStrategy: 'recent-only' });

		const fromArgs = parseMcpServerConfig(['--root', 'one', '--root=two', '--max-turns', '3'], { SESSION_CONTROL_ROOTS: path.resolve('/a'), SESSION_CONTROL_RESUME_MAX_TURNS: '10' }, cwd);
		assert.deepStrictEqual(fromArgs.roots.map((entry) => entry.path), [path.join(cwd, 'one'), path.join(cwd, 'two')]);
		assert.strictEqual(fromArgs.resume.maxTurns, 3);

		assert.throws(() => parseMcpServerConfig(['--max-turns', '0'], {}, cwd), /positive integer/);
		assert.throws(() => parseMcpServerConfig(['--overflow-strategy', 'all'], {}, cwd), /must be one of/);
		assert.throws(() => parseMcpServerConfig(['--bogus'], {}, cwd), /Unknown option/);
	});

	test('initialize negotiates the protocol and advertises tools', async () => {
		const server = createMcpServer(config);
		const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
		const result = response?.result as { protocolVersion: string; capabilities: { tools?: unknown }; serverInfo: { name: string } };
		assert.strictEqual(result.protocolVersion, '2025-03-26');
		assert.ok(result.capabilities.tools);
		assert.strictEqual(result.serverInfo.name, 'session-control');
		assert.strictEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
		assert.strictEqual((await server.handle({ jsonrpc: '2.0', id: 2, method: 'resources/list' }))?.error?.code, -32601);
	});

	test('tools/list exposes list and resume with the VS Code tool input schemas', async () => {
		const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
			bin?: Record<string, string>;
			contributes: { languageModelTools: Array<{ name: string; inputSchema: { properties: Record<string, { type: string }>; required?: string[] } }> };
		};
		const vscodeSchema = (name: string) => manifest.contributes.languageModelTools.find((tool) => tool.name === name)?.inputSchema;
		const response = await createMcpServer(config).handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
		const tools = (response?.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, { type: string }>; required?: string[] } }> }).tools;
		assert.deepStrictEqual(tools.map((tool) => tool.name), [MCP_LIST_SESSIONS_TOOL_NAME, MCP_RESUME_SESSION_TOOL_NAME]);

		const typesOf = (schema: { properties: Record<string, { type: string }> } | undefined) =>
			Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([key, value]) => [key, value.type]));
		assert.deepStrictEqual(typesOf(tools[0]?.inputSchema), typesOf(vscodeSchema('session-control_listSessions')));
		assert.deepStrictEqual(typesOf(tools[1]?.inputSchema), typesOf(vscodeSchema('session-control_resumeSession')));
		assert.deepStrictEqual(tools[1]?.inputSchema.required, vscodeSchema('session-control_resumeSession')?.required);
		assert.strictEqual(manifest.bin?.['session-control-mcp'], './dist/mcpServer.js');
	});

	test('list_sessions returns saved sessions newest first and honors query and limit', async () => {
		const all = JSON.parse((await callTool(MCP_LIST_SESSIONS_TOOL_NAME, {})).content[0]?.text ?? '') as { total: number; sessions: Array<{ id: string; workspaceFolder: string }>; hint: string };
		assert.strictEqual(all.total, 2);
		assert.deepStrictEqual(all.sessions.map((session) => session.id), ['session-login', 'session-auth']);
		assert.strictEqual(all.sessions[0]?.workspaceFolder, path.basename(root));
		assert.match(all.hint, new RegExp(MCP_RESUME_SESSION_TOOL_NAME));

		const filtered = JSON.parse((await callTool(MCP_LIST_SESSIONS_TOOL_NAME, { query: 'auth', limit: 1 })).content[0]?.text ?? '') as { returned: number; sessions: Array<{ id: string }> };
		assert.strictEqual(filtered.returned, 1);
		assert.strictEqual(filtered.sessions[0]?.id, 'session-auth');
	});

	test('resume_session loads a session by id or title within the resume limits', async () => {
		const byId = await callTool(MCP_RESUME_SESSION_TOOL_NAME, { session: 'session-auth' });
		assert.strictEqual(byId.isError, undefined);
		const text = byId.content[0]?.text ?? '';
		assert.match(text, /Saved session "Fix auth bug" \(id session-auth/);
		assert.match(text, /Included 4 of 10 turns/);
		assert.match(text, /Summary of omitted context: 6 earlier turns/);
		assert.match(text, /Answer 9/);
		assert.doesNotMatch(text, /User: Question 4\b/);

		const byTitle = await callTool(MCP_RESUME_SESSION_TOOL_NAME, { session: 'Add login form' });
		assert.match(byTitle.content[0]?.text ?? '', /id session-login/);

		const missing = await callTool(MCP_RESUME_SESSION_TOOL_NAME, {});
		assert.match(missing.content[0]?.text ?? '', new RegExp(`Call ${MCP_LIST_SESSIONS_TOOL_NAME}`));
	});

	test('unknown tools return an error result', async () => {
		const result = await callTool('analyze_sessions', {});
		assert.strictEqual(result.isError, true);
	});

	test('serves newline-delimited JSON-RPC over stdio streams', async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const chunks: string[] = [];
		output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
		const served = serveStdio(createMcpServer(config), input, output);
		input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
		input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
		input.write('not json\n');
		input.end('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
		await served;
		const responses = chunks.join('').trim().split('\n').map((line) => JSON.parse(line) as JsonRpcResponse);
		assert.strictEqual(responses.length, 3);
		assert.ok(responses.some((response) => response.id === 1 && response.result));
		assert.ok(responses.some((response) => response.id === null && response.error?.code === -32700));
		assert.ok(responses.some((response) => response.id === 2 && response.result));
	});
});
