import * as assert from 'node:assert';
import { ChatSession, RequestTurn, ResponseTurn } from '../../src/types';
import { buildPageHtml, escapeHtml, groupTurnsByPrompt, renderTurnHtml } from '../../src/sessionViewer';

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
		assert.ok(html.includes('<details class="search-panel" open>'), 'missing collapsible search panel');
		assert.ok(html.includes('search-panel-header">Search</summary>'), 'missing search panel header');
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

function makeRequest(prompt: string): RequestTurn {
	return { type: 'request', participant: 'copilot', prompt, references: [], timestamp: '2026-04-13T10:01:00.000Z' };
}

function makeResponse(content: string): ResponseTurn {
	return { type: 'response', participant: 'copilot', content, toolCalls: [], timestamp: '2026-04-13T10:01:05.000Z' };
}

suite('groupTurnsByPrompt', () => {
	test('groups replies under the prompt they follow: [request, response, response, request, response]', () => {
		const groups = groupTurnsByPrompt([
			makeRequest('a'), makeResponse('r1'), makeResponse('r2'), makeRequest('b'), makeResponse('r3'),
		]);
		assert.deepEqual(groups, [
			{ requestIndex: 0, responseIndices: [1, 2] },
			{ requestIndex: 3, responseIndices: [4] },
		]);
	});

	test('gives replies before the first prompt their own group: [response, request]', () => {
		const groups = groupTurnsByPrompt([makeResponse('r1'), makeRequest('a')]);
		assert.deepEqual(groups, [
			{ requestIndex: null, responseIndices: [0] },
			{ requestIndex: 1, responseIndices: [] },
		]);
	});

	test('keeps prompts without replies as empty groups: [request, request]', () => {
		const groups = groupTurnsByPrompt([makeRequest('a'), makeRequest('b')]);
		assert.deepEqual(groups, [
			{ requestIndex: 0, responseIndices: [] },
			{ requestIndex: 1, responseIndices: [] },
		]);
	});

	test('returns no groups for no turns', () => {
		assert.deepEqual(groupTurnsByPrompt([]), []);
	});
});

suite('buildPageHtml — prompts view', () => {
	const turns = [
		makeRequest('first prompt'), makeResponse('reply one'), makeResponse('reply two'), makeResponse('reply three'),
		makeRequest('second prompt'), makeResponse('reply four'),
		makeRequest('third prompt'),
	];

	test('renders the toggle as an unpressed type=button with aria-pressed', () => {
		const html = makePage(makeSession({ turns }));
		const match = /<button[^>]*id="promptsViewToggle"[^>]*>/.exec(html);
		assert.ok(match, 'prompts view toggle missing');
		assert.ok(match[0].includes('type="button"'), 'toggle must be type=button');
		assert.ok(match[0].includes('aria-pressed="false"'), 'toggle must start unpressed');
		assert.ok(!match[0].includes('disabled'), 'toggle should be enabled when turns exist');
		assert.ok(html.indexOf('id="promptsViewToggle"') < html.indexOf('<details class="section"'), 'toggle must precede the sections');
	});

	test('binds the toggle and expanders with addEventListener', () => {
		const html = makePage(makeSession({ turns }));
		assert.ok(html.includes("promptsViewToggle.addEventListener('click'"), 'toggle listener missing');
		assert.ok(html.includes("replyToggle.addEventListener('click'"), 'expander listener missing');
	});

	test('uses no inline on* handler attributes in its own markup', () => {
		const html = makePage(makeSession({ turns }));
		const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
		assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(markup), 'inline on* attribute found');
	});

	test('renders one expander per prompt that has replies, with counts', () => {
		const html = makePage(makeSession({ turns }));
		const toggles = html.match(/<button type="button" class="reply-toggle"[^>]*>[^<]*<\/button>/g) ?? [];
		assert.equal(toggles.length, 2);
		assert.ok(toggles[0]?.includes('>Show 3 responses<'), 'first expander should count 3 responses');
		assert.ok(toggles[1]?.includes('>Show 1 response<'), 'second expander should use the singular');
		assert.equal((html.match(/class="reply-group"/g) ?? []).length, 2);
	});

	test('wraps only the replies of each prompt in its reply group, keeping order', () => {
		const html = makePage(makeSession({ turns }));
		const firstGroup = /<div class="reply-group" id="replyGroup0">([\s\S]*?)<\/div>\n<div class="turn turn-request"/.exec(html);
		assert.ok(firstGroup?.[1], 'first reply group not found');
		assert.ok(firstGroup[1].includes('reply one') && firstGroup[1].includes('reply three'), 'replies missing from group');
		assert.ok(!firstGroup[1].includes('second prompt'), 'next prompt must not be inside the group');
		assert.ok(html.indexOf('first prompt') < html.indexOf('reply one'));
		assert.ok(html.indexOf('reply three') < html.indexOf('second prompt'));
		assert.ok(html.indexOf('second prompt') < html.indexOf('third prompt'));
	});

	test('adds an expander for replies that precede the first prompt', () => {
		const html = makePage(makeSession({ turns: [makeResponse('orphan reply'), makeRequest('later prompt')] }));
		assert.ok(html.includes('>Show 1 response<'), 'leading replies need an expander');
		assert.ok(html.indexOf('reply-toggle') < html.indexOf('later prompt'), 'leading expander must come first');
	});

	test('renders no expander for prompts without replies', () => {
		const html = makePage(makeSession({ turns: [makeRequest('a'), makeRequest('b')] }));
		assert.ok(!html.includes('class="reply-toggle"'), 'no expander expected');
		assert.ok(!html.includes('class="reply-group"'), 'no reply group expected');
	});

	test('disables the toggle and keeps the script safe when there are no turns', () => {
		const html = makePage(makeSession({ turns: [] }));
		const match = /<button[^>]*id="promptsViewToggle"[^>]*>/.exec(html);
		assert.ok(match?.[0].includes('disabled'), 'toggle should be disabled with no turns');
		assert.ok(html.includes('if (!promptsViewToggle.disabled)'), 'listener must be guarded');
		assert.ok(html.includes('id="conversation"'), 'conversation container must exist for the script');
	});

	test('lets search reveal matches inside collapsed reply groups', () => {
		const html = makePage(makeSession({ turns }));
		assert.ok(html.includes("current.classList.contains('reply-group')"), 'openAncestorDetails must expand reply groups');
		assert.ok(html.includes('setReplyGroupExpanded(current, true)'), 'reply group expansion missing');
	});

	test('keeps the default page state with the mode off', () => {
		const html = makePage(makeSession({ turns }));
		assert.ok(html.includes('<details class="section" open>'), 'summary should be open');
		assert.ok(html.includes('<details class="section">'), 'conversation should be closed');
		assert.ok(!html.includes('prompts-view"'), 'mode class must not be server-rendered');
	});
});
