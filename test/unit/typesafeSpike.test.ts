import * as assert from 'node:assert';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import { APIConnectionError, APIError, APITimeoutError, APIUserAbortError, TypeSafeClient } from '@typesafe-ai/sdk';
import { isTypeSafeSpikeEnabled, mapTypeSafeSpikeError, runTypeSafeSpike } from '../../src/typesafe/spike';

async function withServer(
	handler: http.RequestListener,
	run: (baseURL: string) => Promise<void>,
): Promise<void> {
	const server = http.createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address() as AddressInfo;
		await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

const noRetry = { retry: { maxRetries: 0 } };

suite('typesafe/spike', () => {
	test('runs inside a Node 20+ extension host', () => {
		const [major] = process.versions.node.split('.').map(Number);
		console.log(`[typesafe-spike] extension host Node version: ${process.versions.node}`);
		assert.ok(major !== undefined && major >= 20, `expected Node 20+, got ${process.versions.node}`);
	});

	test('isTypeSafeSpikeEnabled reads the dev-flag env var', () => {
		assert.strictEqual(isTypeSafeSpikeEnabled({}), false);
		assert.strictEqual(isTypeSafeSpikeEnabled({ SESSION_CONTROL_TYPESAFE_SPIKE: '0' }), false);
		assert.strictEqual(isTypeSafeSpikeEnabled({ SESSION_CONTROL_TYPESAFE_SPIKE: '1' }), true);
	});

	test('maps 401 responses to unauthorized', () => {
		const error = APIError.fromResponse(401, { error: 'bad key' }, new Headers());
		assert.strictEqual(mapTypeSafeSpikeError(error), 'unauthorized');
	});

	test('maps 429 responses to rate-limited', () => {
		const error = APIError.fromResponse(429, { error: 'slow down' }, new Headers());
		assert.strictEqual(mapTypeSafeSpikeError(error), 'rate-limited');
	});

	test('maps 529 responses to overloaded', () => {
		const error = APIError.fromResponse(529, { error: 'overloaded' }, new Headers());
		assert.strictEqual(mapTypeSafeSpikeError(error), 'overloaded');
	});

	test('maps other 5xx responses to overloaded', () => {
		const error = APIError.fromResponse(503, { error: 'unavailable' }, new Headers());
		assert.strictEqual(mapTypeSafeSpikeError(error), 'overloaded');
	});

	test('maps timeouts to timeout, distinct from generic connection errors', () => {
		assert.strictEqual(mapTypeSafeSpikeError(new APITimeoutError(1000)), 'timeout');
		assert.strictEqual(mapTypeSafeSpikeError(new APIConnectionError('socket hang up')), 'connection');
	});

	test('maps caller cancellation to aborted', () => {
		assert.strictEqual(mapTypeSafeSpikeError(new APIUserAbortError()), 'aborted');
	});

	test('maps unrecognized errors to other', () => {
		assert.strictEqual(mapTypeSafeSpikeError(new Error('boom')), 'other');
	});

	test('succeeds end-to-end against a local systemOne-shaped response', async () => {
		await withServer(
			(req, res) => {
				let body = '';
				req.on('data', (chunk: Buffer) => (body += chunk.toString()));
				req.on('end', () => {
					const parsed = JSON.parse(body) as { questions: Record<string, unknown> };
					assert.ok(Object.prototype.hasOwnProperty.call(parsed.questions, 'ready'));
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: {
								ready: { type: 'choice', choice: 'yes', confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 } },
							},
							usage: { input_tokens: 42, output_tokens: 7 },
						}),
					);
				});
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				try {
					const result = await runTypeSafeSpike(cancellation.token, { apiKey: 'test-key', baseURL, ...noRetry });
					assert.deepStrictEqual(result, {
						outcome: 'success',
						model: 'jev-latest',
						usage: { inputTokens: 42, outputTokens: 7 },
					});
				} finally {
					cancellation.dispose();
				}
			},
		);
	});

	test('maps a live 401 from the wire through the client', async () => {
		await withServer(
			(_req, res) => {
				res.writeHead(401, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: 'invalid api key' }));
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				try {
					const result = await runTypeSafeSpike(cancellation.token, { apiKey: 'test-key', baseURL, ...noRetry });
					assert.strictEqual(result.outcome, 'error');
					assert.strictEqual(result.outcome === 'error' && result.kind, 'unauthorized');
				} finally {
					cancellation.dispose();
				}
			},
		);
	});

	test('maps a live 529 from the wire through the client', async () => {
		await withServer(
			(_req, res) => {
				res.writeHead(529, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: 'overloaded' }));
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				try {
					const result = await runTypeSafeSpike(cancellation.token, { apiKey: 'test-key', baseURL, ...noRetry });
					assert.strictEqual(result.outcome, 'error');
					assert.strictEqual(result.outcome === 'error' && result.kind, 'overloaded');
				} finally {
					cancellation.dispose();
				}
			},
		);
	});

	test('maps a live 429 from the wire through the client', async () => {
		await withServer(
			(_req, res) => {
				res.writeHead(429, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: 'rate limited' }));
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				try {
					const result = await runTypeSafeSpike(cancellation.token, { apiKey: 'test-key', baseURL, ...noRetry });
					assert.strictEqual(result.outcome, 'error');
					assert.strictEqual(result.outcome === 'error' && result.kind, 'rate-limited');
				} finally {
					cancellation.dispose();
				}
			},
		);
	});

	test('maps a connection failure (nothing listening) to connection', async () => {
		const cancellation = new vscode.CancellationTokenSource();
		try {
			// Port 1 is a reserved, unlisted TCP port: the connection is refused immediately.
			const result = await runTypeSafeSpike(cancellation.token, {
				apiKey: 'test-key',
				baseURL: 'http://127.0.0.1:1',
				...noRetry,
			});
			assert.strictEqual(result.outcome, 'error');
			assert.strictEqual(result.outcome === 'error' && result.kind, 'connection');
		} finally {
			cancellation.dispose();
		}
	});

	test('maps a slow server past the per-attempt timeout to timeout', async () => {
		await withServer(
			(_req, res) => {
				setTimeout(() => {
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(
						JSON.stringify({
							model: 'jev-latest',
							answers: { ready: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1, no: 0 } } },
							usage: { input_tokens: 1, output_tokens: 1 },
						}),
					);
				}, 500);
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				try {
					const result = await runTypeSafeSpike(cancellation.token, {
						apiKey: 'test-key',
						baseURL,
						timeout: 50,
						...noRetry,
					});
					assert.strictEqual(result.outcome, 'error');
					assert.strictEqual(result.outcome === 'error' && result.kind, 'timeout');
				} finally {
					cancellation.dispose();
				}
			},
		);
	});

	test('a vscode.CancellationToken aborts the request via AbortSignal', async () => {
		let serverSawAbort = false;
		await withServer(
			(req, res) => {
				req.on('aborted', () => {
					serverSawAbort = true;
				});
				// Never respond, so the only way this request resolves is cancellation.
				void res;
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				const pending = runTypeSafeSpike(cancellation.token, { apiKey: 'test-key', baseURL, ...noRetry });
				setTimeout(() => cancellation.cancel(), 25);
				try {
					const result = await pending;
					assert.strictEqual(result.outcome, 'error');
					assert.strictEqual(result.outcome === 'error' && result.kind, 'aborted');
				} finally {
					cancellation.dispose();
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
				assert.strictEqual(serverSawAbort, true, 'expected the server socket to see the abort');
			},
		);
	});

	test('an already-cancelled token aborts before the request is sent', async () => {
		let requestReceived = false;
		await withServer(
			(_req, res) => {
				requestReceived = true;
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(
					JSON.stringify({
						model: 'jev-latest',
						answers: { ready: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1, no: 0 } } },
						usage: { input_tokens: 1, output_tokens: 1 },
					}),
				);
			},
			async (baseURL) => {
				const cancellation = new vscode.CancellationTokenSource();
				cancellation.cancel();
				try {
					const result = await runTypeSafeSpike(cancellation.token, { apiKey: 'test-key', baseURL, ...noRetry });
					assert.strictEqual(result.outcome, 'error');
					assert.strictEqual(result.outcome === 'error' && result.kind, 'aborted');
				} finally {
					cancellation.dispose();
				}
				assert.strictEqual(requestReceived, false, 'expected no request when the token was already cancelled');
			},
		);
	});

	test('constructing the client from the extension host does not throw', () => {
		assert.doesNotThrow(() => new TypeSafeClient({ apiKey: 'test-key' }));
	});
});
