import * as assert from 'node:assert';
import { ChatSession, RequestTurn, ResponseTurn } from '../../src/types';
import { buildPageHtml, escapeHtml, renderTurnHtml } from '../../src/sessionViewer';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		version: 1,
		id: 'test-id-123',
		title: 'My Test Session',
		savedAt: '2026-04-13T10:00:00.000Z',
		git: { branch: 'main', commit: 'abcdef1234567890', dirty: false },
		vscodeVersion: '1.115.0',
		totalTurns: 2,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns: [],
		markdownSummary: '# Summary\n\nThis is the **summary**.',
		...overrides,
	};
}

function makePage(session: ChatSession): string {
	return buildPageHtml(session, 'https://file.example/style.css', 'vscode-webview-resource:', 'testnonce', '/path/to/session.json');
}

suite('escapeHtml', () => {
	test('escapes ampersand', () => {
		assert.equal(escapeHtml('a & b'), 'a &amp; b');
	});

	test('escapes less-than and greater-than', () => {
		assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
	});

	test('escapes double quote', () => {
		assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
	});

	test('escapes single quote', () => {
		assert.equal(escapeHtml("it's"), 'it&#039;s');
	});

	test('leaves safe characters unchanged', () => {
		assert.equal(escapeHtml('hello world 123'), 'hello world 123');
	});

	test('escapes all special chars together', () => {
		assert.equal(escapeHtml('& < > " \''), '&amp; &lt; &gt; &quot; &#039;');
	});
});

suite('buildPageHtml — structure', () => {
	test('contains session title in header', () => {
		const html = makePage(makeSession({ title: 'Fix Auth Bug' }));
		assert.ok(html.includes('Fix Auth Bug'), 'title missing from page');
	});

	test('contains summary section open by default', () => {
		const html = makePage(makeSession());
		assert.ok(html.includes('<details class="section" open>'), 'summary section should be open by default');
	});

	test('renders markdownSummary content as HTML', () => {
		const html = makePage(makeSession({ markdownSummary: '**bold text**' }));
		assert.ok(html.includes('<strong>bold text</strong>'), 'bold markdown not rendered');
	});

	test('shows empty-state when markdownSummary is empty', () => {
		const html = makePage(makeSession({ markdownSummary: '' }));
		assert.ok(html.includes('No summary available'), 'missing empty-state for summary');
	});

	test('contains full conversation section', () => {
		const html = makePage(makeSession());
		assert.ok(html.includes('Full Conversation'), 'conversation section missing');
	});

	test('shows empty-state when turns array is empty', () => {
		const html = makePage(makeSession({ turns: [] }));
		assert.ok(html.includes('No turns recorded'), 'missing empty-state for turns');
	});

	test('contains Open Raw JSON button', () => {
		const html = makePage(makeSession());
		assert.ok(html.includes('openRawJson'), 'missing Open Raw JSON button');
		assert.ok(html.includes('Open Raw JSON'), 'missing button label');
	});

	test('contains search toolbar controls', () => {
		const html = makePage(makeSession());
		assert.ok(html.includes('id="searchInput"'), 'missing search input');
		assert.ok(html.includes('id="searchPrev"'), 'missing previous search button');
		assert.ok(html.includes('id="searchNext"'), 'missing next search button');
		assert.ok(html.includes('id="searchClear"'), 'missing clear search button');
		assert.ok(html.includes('id="searchStatus"'), 'missing search status indicator');
	});

	test('contains the file path in footer', () => {
		const html = buildPageHtml(makeSession(), 'css', 'csp', 'nonce', '/work/.chat/session.json');
		assert.ok(html.includes('/work/.chat/session.json'), 'file path missing from footer');
	});

	test('contains session ID in footer', () => {
		const html = makePage(makeSession({ id: 'unique-session-xyz' }));
		assert.ok(html.includes('unique-session-xyz'), 'session ID missing from footer');
	});

	test('contains postMessage script with nonce', () => {
		const html = buildPageHtml(makeSession(), 'css', 'csp', 'mynonce', '/session.json');
		assert.ok(html.includes('nonce="mynonce"'), 'script nonce missing');
		assert.ok(html.includes("vscode.postMessage"), 'postMessage call missing');
	});

	test('contains search script bindings', () => {
		const html = makePage(makeSession());
		assert.ok(html.includes("searchInput.addEventListener('input'"), 'search input listener missing');
		assert.ok(html.includes("setActiveMatch(activeMatchIndex + 1)"), 'next-match navigation missing');
		assert.ok(html.includes("document.querySelectorAll('mark.' + highlightedClass)"), 'search highlight selector missing');
	});

	test('CSP meta tag includes provided cspSource', () => {
		const html = buildPageHtml(makeSession(), 'css', 'vscode-special-source:', 'nonce', '/s.json');
		assert.ok(html.includes('vscode-special-source:'), 'cspSource not included in CSP');
	});
});

suite('buildPageHtml — git metadata', () => {
	test('renders git branch and short commit', () => {
		const html = makePage(makeSession({ git: { branch: 'feature/auth', commit: 'abc1234ffffff', dirty: false } }));
		assert.ok(html.includes('feature/auth'), 'branch not rendered');
		assert.ok(html.includes('abc1234'), 'short commit hash not rendered');
	});

	test('renders dirty badge when dirty is true', () => {
		const html = makePage(makeSession({ git: { branch: 'main', commit: 'aabbcc', dirty: true } }));
		assert.ok(html.includes('dirty-badge'), 'dirty badge missing');
	});

	test('omits dirty badge when dirty is false', () => {
		const html = makePage(makeSession({ git: { branch: 'main', commit: 'aabbcc', dirty: false } }));
		assert.ok(!html.includes('dirty-badge'), 'dirty badge should not appear when clean');
	});

	test('handles null git gracefully', () => {
		const html = makePage(makeSession({ git: null }));
		assert.ok(!html.includes('meta-git'), 'git section should be absent when null');
	});
});

suite('buildPageHtml — multi-part sessions', () => {
	test('shows part indicator for multi-part sessions', () => {
		const html = makePage(makeSession({ part: 2, totalParts: 3 }));
		assert.ok(html.includes('Part 2 of 3'), 'part indicator missing');
		assert.ok(html.includes('part-indicator'), 'part-indicator class missing');
	});

	test('omits part indicator for single-part sessions', () => {
		const html = makePage(makeSession({ totalParts: null }));
		assert.ok(!html.includes('part-indicator'), 'part indicator should not appear for non-multi-part session');
	});

	test('omits part indicator when totalParts is 1', () => {
		const html = makePage(makeSession({ part: 1, totalParts: 1 }));
		assert.ok(!html.includes('part-indicator'), 'part indicator should not appear for totalParts=1');
	});
});

suite('renderTurnHtml — request turn', () => {
	const requestTurn: RequestTurn = {
		type: 'request',
		participant: 'copilot',
		prompt: 'How does this work?',
		references: ['src/utils.ts', 'src/types.ts'],
		timestamp: '2026-04-13T10:01:00.000Z',
	};

	test('has turn-request class', () => {
		const html = renderTurnHtml(requestTurn, 0);
		assert.ok(html.includes('turn-request'), 'missing turn-request class');
	});

	test('renders participant name', () => {
		const html = renderTurnHtml(requestTurn, 0);
		assert.ok(html.includes('copilot'), 'participant name missing');
	});

	test('renders prompt content', () => {
		const html = renderTurnHtml(requestTurn, 0);
		assert.ok(html.includes('How does this work?'), 'prompt content missing');
	});

	test('renders reference chips', () => {
		const html = renderTurnHtml(requestTurn, 0);
		assert.ok(html.includes('ref-chip'), 'reference chips missing');
		assert.ok(html.includes('src/utils.ts'), 'first reference missing');
		assert.ok(html.includes('src/types.ts'), 'second reference missing');
	});

	test('omits references section when references is empty', () => {
		const html = renderTurnHtml({ ...requestTurn, references: [] }, 0);
		assert.ok(!html.includes('ref-chip'), 'ref-chip should not appear when no references');
	});
});

suite('renderTurnHtml — response turn', () => {
	const responseTurn: ResponseTurn = {
		type: 'response',
		participant: 'copilot',
		content: 'Here is the result: **done**.',
		toolCalls: [],
		timestamp: '2026-04-13T10:01:05.000Z',
	};

	test('has turn-response class', () => {
		const html = renderTurnHtml(responseTurn, 1);
		assert.ok(html.includes('turn-response'), 'missing turn-response class');
	});

	test('renders markdown content', () => {
		const html = renderTurnHtml(responseTurn, 1);
		assert.ok(html.includes('<strong>done</strong>'), 'markdown not rendered in response');
	});

	test('omits tool-calls section when toolCalls is empty', () => {
		const html = renderTurnHtml(responseTurn, 1);
		assert.ok(!html.includes('tool-call'), 'tool-calls should not appear when empty');
	});

	test('renders tool call name', () => {
		const withTools: ResponseTurn = {
			...responseTurn,
			toolCalls: [{ name: 'read_file', summary: 'Reading src/utils.ts', arguments: '{"path":"src/utils.ts"}', output: 'file content' }],
		};
		const html = renderTurnHtml(withTools, 1);
		assert.ok(html.includes('read_file'), 'tool call name missing');
	});

	test('renders tool call summary', () => {
		const withTools: ResponseTurn = {
			...responseTurn,
			toolCalls: [{ name: 'read_file', summary: 'Reading utilities' }],
		};
		const html = renderTurnHtml(withTools, 1);
		assert.ok(html.includes('Reading utilities'), 'tool call summary missing');
	});

	test('renders tool call as collapsible details element', () => {
		const withTools: ResponseTurn = {
			...responseTurn,
			toolCalls: [{ name: 'grep_search', summary: 'Searching for patterns' }],
		};
		const html = renderTurnHtml(withTools, 1);
		assert.ok(html.includes('<details class="tool-call">'), 'tool call not wrapped in <details>');
	});

	test('renders tool call arguments when present', () => {
		const withTools: ResponseTurn = {
			...responseTurn,
			toolCalls: [{ name: 'run_command', arguments: '{"cmd":"ls -la"}' }],
		};
		const html = renderTurnHtml(withTools, 1);
		assert.ok(html.includes('ls -la'), 'tool call arguments missing');
		assert.ok(html.includes('tool-section'), 'tool-section wrapper missing for arguments');
	});

	test('renders tool call output when present', () => {
		const withTools: ResponseTurn = {
			...responseTurn,
			toolCalls: [{ name: 'run_command', output: 'file1.ts\nfile2.ts' }],
		};
		const html = renderTurnHtml(withTools, 1);
		assert.ok(html.includes('file1.ts'), 'tool call output missing');
	});

	test('escapes HTML in tool call arguments', () => {
		const withTools: ResponseTurn = {
			...responseTurn,
			toolCalls: [{ name: 'inject', arguments: '<script>alert(1)</script>' }],
		};
		const html = renderTurnHtml(withTools, 1);
		assert.ok(!html.includes('<script>alert'), 'raw <script> tag must not appear in tool arguments');
		assert.ok(html.includes('&lt;script&gt;'), 'tool arguments must be HTML-escaped');
	});
});

suite('buildPageHtml — XSS safety', () => {
	test('escapes title containing HTML', () => {
		const html = makePage(makeSession({ title: '<img src=x onerror=alert(1)>' }));
		assert.ok(!html.includes('<img src=x'), 'unescaped title tag found — XSS risk');
		assert.ok(html.includes('&lt;img'), 'title not escaped');
	});

	test('escapes session ID containing HTML', () => {
		const html = makePage(makeSession({ id: '<b>injected</b>' }));
		assert.ok(!html.includes('<b>injected</b>'), 'raw HTML in id — XSS risk');
	});
});
