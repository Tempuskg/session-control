import { runMcpServer } from './mcpServer';

// Entry point for the `session-control-mcp` bin (bundled to dist/mcpServer.js).
void runMcpServer().catch((error: unknown) => {
	process.stderr.write(`session-control-mcp: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	process.exitCode = 1;
});
