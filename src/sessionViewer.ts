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
