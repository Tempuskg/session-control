import * as path from 'node:path';
import * as vscode from 'vscode';
import { marked } from 'marked';
import { ChatSession, RequestTurn, ResponseTurn, SavedTurn, ToolCall } from './types';

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function formatDate(isoDate: string): string {
	const ts = Date.parse(isoDate);
	if (!Number.isFinite(ts)) {
		return isoDate;
	}
	return new Date(ts).toLocaleString();
}

function renderToolCallHtml(toolCall: ToolCall): string {
	const name = escapeHtml(toolCall.name);
	const summaryText = toolCall.summary ? ` — <span class="tool-summary-text">${escapeHtml(toolCall.summary)}</span>` : '';
	const argsSection = toolCall.arguments
		? `<div class="tool-section"><span class="tool-label">Arguments</span><pre><code>${escapeHtml(toolCall.arguments)}</code></pre></div>`
		: '';
	const outputSection = toolCall.output
		? `<div class="tool-section"><span class="tool-label">Output</span><pre><code>${escapeHtml(toolCall.output)}</code></pre></div>`
		: '';

	return `<details class="tool-call">
			<summary class="tool-call-summary"><span class="tool-name">${name}</span>${summaryText}</summary>
			${argsSection}${outputSection}
		</details>`;
}

function renderRequestTurnHtml(turn: RequestTurn, index: number): string {
	const timestamp = escapeHtml(formatDate(turn.timestamp));
	const contentHtml = marked.parse(turn.prompt) as string;
	const refsHtml = turn.references.length > 0
		? `<div class="references">${turn.references.map((r) => `<span class="ref-chip">${escapeHtml(r)}</span>`).join('')}</div>`
		: '';

	return `<div class="turn turn-request" data-index="${index}">
		<div class="turn-header">
			<span class="turn-icon">👤</span>
			<span class="turn-participant">${escapeHtml(turn.participant)}</span>
			<span class="turn-timestamp">${timestamp}</span>
		</div>
		<div class="turn-content">${contentHtml}</div>
		${refsHtml}
	</div>`;
}

function renderResponseTurnHtml(turn: ResponseTurn, index: number): string {
	const timestamp = escapeHtml(formatDate(turn.timestamp));
	const contentHtml = marked.parse(turn.content) as string;
	const toolCallsHtml = turn.toolCalls.length > 0
		? `<div class="tool-calls">${turn.toolCalls.map((tc) => renderToolCallHtml(tc)).join('')}</div>`
		: '';

	return `<div class="turn turn-response" data-index="${index}">
		<div class="turn-header">
			<span class="turn-icon">🤖</span>
			<span class="turn-participant">${escapeHtml(turn.participant)}</span>
			<span class="turn-timestamp">${timestamp}</span>
		</div>
		<div class="turn-content">${contentHtml}</div>
		${toolCallsHtml}
	</div>`;
}

export function renderTurnHtml(turn: SavedTurn, index: number): string {
	if (turn.type === 'request') {
		return renderRequestTurnHtml(turn, index);
	}
	return renderResponseTurnHtml(turn, index);
}

export function buildPageHtml(
	session: ChatSession,
	cssUri: string,
	cspSource: string,
	nonce: string,
	filePath: string,
): string {
	const summaryHtml = session.markdownSummary
		? (marked.parse(session.markdownSummary) as string)
		: '<p class="empty-state"><em>No summary available.</em></p>';

	const turnsHtml = session.turns.length > 0
		? session.turns.map((turn, i) => renderTurnHtml(turn, i)).join('\n')
		: '<p class="empty-state"><em>No turns recorded.</em></p>';

	const gitHtml = session.git
		? `<span class="meta-item meta-git">${escapeHtml(session.git.branch)} @ <code>${escapeHtml(session.git.commit.slice(0, 7))}</code>${session.git.dirty ? ' <span class="dirty-badge">dirty</span>' : ''}</span>`
		: '';

	const multiPartHtml = session.totalParts !== null && session.totalParts > 1
		? `<div class="part-indicator">Part ${session.part ?? '?'} of ${session.totalParts}</div>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${cssUri}" rel="stylesheet">
	<title>${escapeHtml(session.title)}</title>
</head>
<body>
	<div class="session-header">
		<div class="header-title-row">
			<h1 class="session-title">${escapeHtml(session.title)}</h1>
			<button class="open-json-btn" id="openRawJson">Open Raw JSON</button>
		</div>
		<div class="header-meta">
			<span class="meta-item">${escapeHtml(formatDate(session.savedAt))}</span>
			<span class="meta-item">${session.totalTurns} turns</span>
			${gitHtml}
			<span class="meta-item meta-vscode">VS Code ${escapeHtml(session.vscodeVersion)}</span>
		</div>
	</div>
	<details class="search-panel" open>
		<summary class="search-panel-header">Search</summary>
		<div class="search-toolbar" role="search" aria-label="Search session content">
			<input id="searchInput" class="search-input" type="search" placeholder="Search summary and conversation..." aria-label="Search summary and conversation" />
			<div class="search-actions">
				<button id="searchPrev" class="search-btn" type="button" aria-label="Previous match">Prev</button>
				<button id="searchNext" class="search-btn" type="button" aria-label="Next match">Next</button>
				<button id="searchClear" class="search-btn search-btn-clear" type="button" aria-label="Clear search">Clear</button>
			</div>
			<span id="searchStatus" class="search-status" aria-live="polite">No search term</span>
		</div>
	</details>
	${multiPartHtml}
	<details class="section" open>
		<summary class="section-header">Summary</summary>
		<div class="section-body">${summaryHtml}</div>
	</details>
	<details class="section">
		<summary class="section-header">Full Conversation (${session.totalTurns} turns)</summary>
		<div class="section-body conversation">${turnsHtml}</div>
	</details>
	<div class="session-footer">
		<span class="footer-path">${escapeHtml(filePath)}</span>
		<span class="footer-id">ID: ${escapeHtml(session.id)}</span>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('openRawJson').addEventListener('click', function () {
			vscode.postMessage({ command: 'openRawJson' });
		});

		const searchInput = document.getElementById('searchInput');
		const searchPrev = document.getElementById('searchPrev');
		const searchNext = document.getElementById('searchNext');
		const searchClear = document.getElementById('searchClear');
		const searchStatus = document.getElementById('searchStatus');
		const searchRoots = Array.from(document.querySelectorAll('.section-body'));
		const highlightedClass = 'search-highlight';
		const activeClass = 'search-highlight-active';
		let matches = [];
		let activeMatchIndex = -1;

		function pluralize(count, singular, plural) {
			return count === 1 ? singular : plural;
		}

		function updateSearchStatus() {
			if (!searchInput.value.trim()) {
				searchStatus.textContent = 'No search term';
				return;
			}
			if (matches.length === 0) {
				searchStatus.textContent = 'No matches';
				return;
			}
			searchStatus.textContent = matches.length + ' ' + pluralize(matches.length, 'match', 'matches') + ' (' + (activeMatchIndex + 1) + '/' + matches.length + ')';
		}

		function updateSearchButtons() {
			const noMatches = matches.length === 0;
			searchPrev.disabled = noMatches;
			searchNext.disabled = noMatches;
		}

		function clearHighlights() {
			const highlightedNodes = document.querySelectorAll('mark.' + highlightedClass);
			for (const node of highlightedNodes) {
				const parent = node.parentNode;
				if (!parent) {
					continue;
				}
				parent.replaceChild(document.createTextNode(node.textContent || ''), node);
				parent.normalize();
			}
			matches = [];
			activeMatchIndex = -1;
		}

		function openAncestorDetails(node) {
			let current = node.parentElement;
			while (current) {
				if (current.tagName === 'DETAILS') {
					current.open = true;
				}
				current = current.parentElement;
			}
		}

		function setActiveMatch(index) {
			if (matches.length === 0) {
				activeMatchIndex = -1;
				updateSearchStatus();
				return;
			}

			for (const match of matches) {
				match.classList.remove(activeClass);
			}

			activeMatchIndex = ((index % matches.length) + matches.length) % matches.length;
			const activeMatch = matches[activeMatchIndex];
			activeMatch.classList.add(activeClass);
			openAncestorDetails(activeMatch);
			activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
			updateSearchStatus();
		}

		function highlightMatches(term) {
			if (!term) {
				return;
			}
			const normalizedTerm = term.toLowerCase();
			for (const root of searchRoots) {
				const textNodes = [];
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
					acceptNode: function (node) {
						if (!node.nodeValue || !node.nodeValue.trim()) {
							return NodeFilter.FILTER_REJECT;
						}
						const parentElement = node.parentElement;
						if (!parentElement) {
							return NodeFilter.FILTER_REJECT;
						}
						const tagName = parentElement.tagName;
						if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'MARK') {
							return NodeFilter.FILTER_REJECT;
						}
						if (node.nodeValue.toLowerCase().indexOf(normalizedTerm) === -1) {
							return NodeFilter.FILTER_REJECT;
						}
						return NodeFilter.FILTER_ACCEPT;
					},
				});

				let currentNode = walker.nextNode();
				while (currentNode) {
					textNodes.push(currentNode);
					currentNode = walker.nextNode();
				}

				for (const textNode of textNodes) {
					const text = textNode.nodeValue || '';
					const lowerText = text.toLowerCase();
					let fromIndex = 0;
					let matchIndex = lowerText.indexOf(normalizedTerm, fromIndex);
					if (matchIndex === -1) {
						continue;
					}

					const fragment = document.createDocumentFragment();
					while (matchIndex !== -1) {
						if (matchIndex > fromIndex) {
							fragment.appendChild(document.createTextNode(text.slice(fromIndex, matchIndex)));
						}
						const matchedText = text.slice(matchIndex, matchIndex + term.length);
						const mark = document.createElement('mark');
						mark.className = highlightedClass;
						mark.textContent = matchedText;
						fragment.appendChild(mark);
						matches.push(mark);
						fromIndex = matchIndex + term.length;
						matchIndex = lowerText.indexOf(normalizedTerm, fromIndex);
					}
					if (fromIndex < text.length) {
						fragment.appendChild(document.createTextNode(text.slice(fromIndex)));
					}
					textNode.parentNode.replaceChild(fragment, textNode);
				}
			}
		}

		function runSearch() {
			const term = searchInput.value.trim();
			clearHighlights();
			highlightMatches(term);
			updateSearchButtons();
			if (matches.length > 0) {
				setActiveMatch(0);
				return;
			}
			updateSearchStatus();
		}

		searchInput.addEventListener('input', runSearch);
		searchInput.addEventListener('keydown', function (event) {
			if (event.key === 'Enter') {
				event.preventDefault();
				setActiveMatch(activeMatchIndex + (event.shiftKey ? -1 : 1));
			}
		});

		searchPrev.addEventListener('click', function () {
			setActiveMatch(activeMatchIndex - 1);
		});

		searchNext.addEventListener('click', function () {
			setActiveMatch(activeMatchIndex + 1);
		});

		searchClear.addEventListener('click', function () {
			searchInput.value = '';
			runSearch();
			searchInput.focus();
		});

		updateSearchButtons();
	</script>
</body>
</html>`;
}

export class SessionViewerPanel {
	static currentPanel: SessionViewerPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private filePath: string;
	private sessionTitle: string = '';
	private fileName: string = '';
	private readonly disposables: vscode.Disposable[] = [];

	static createOrShow(
		session: ChatSession,
		extensionUri: vscode.Uri,
		storageDirectory: string,
		fileName: string,
	): void {
		const filePath = path.join(storageDirectory, fileName);
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

		if (SessionViewerPanel.currentPanel) {
			SessionViewerPanel.currentPanel.update(session, filePath);
			SessionViewerPanel.currentPanel.panel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'session-control.sessionViewer',
			`Session: ${session.title}`,
			column,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
			},
		);

		SessionViewerPanel.currentPanel = new SessionViewerPanel(panel, extensionUri, filePath);
		SessionViewerPanel.currentPanel.update(session, filePath);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, filePath: string) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.filePath = filePath;

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		this.panel.webview.onDidReceiveMessage(
			(message: { command: string }) => {
				if (message.command === 'openRawJson') {
					void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(this.filePath));
				}
			},
			null,
			this.disposables,
		);
	}

	update(session: ChatSession, filePath: string): void {
		this.filePath = filePath;
		this.sessionTitle = session.title;
		this.fileName = path.basename(filePath);
		this.panel.title = `Session: ${session.title}`;
		this.panel.webview.html = this.renderHtml(session, filePath);
	}

	getSessionTitle(): string {
		return this.sessionTitle;
	}

	getFileName(): string {
		return this.fileName;
	}

	private renderHtml(session: ChatSession, filePath: string): string {
		const nonce = getNonce();
		const cssUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'session-viewer.css'),
		);
		return buildPageHtml(session, cssUri.toString(), this.panel.webview.cspSource, nonce, filePath);
	}

	dispose(): void {
		SessionViewerPanel.currentPanel = undefined;
		this.panel.dispose();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
		this.sessionTitle = '';
		this.fileName = '';
	}
}
