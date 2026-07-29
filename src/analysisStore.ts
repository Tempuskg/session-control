import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	AnalysisIndex,
	AnalysisIndexEntry,
	AnalysisReportRepositorySummary,
	AnalysisReportReference,
	AnalysisReportSourceSession,
	AnalysisSelection,
	ChatSession,
	GitContext,
	isAnalysisIndex,
} from './types';

interface AnalysisStoreDeps {
	mkdir(directoryPath: string): Promise<void>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	unlink(filePath: string): Promise<void>;
	exists(filePath: string): Promise<boolean>;
	now(): Date;
	createId(): string;
	hash(value: string): string;
}

export interface AnalysisWriteReportInput {
	selection: AnalysisSelection;
	promptVersion: string;
	contributingWorkspaces: string[];
	analyzedFingerprints: string[];
	content: string;
	status: 'complete' | 'partial';
	createdAt?: string;
	sessionCount?: number;
	ownerWorkspaceName?: string;
	repositories?: AnalysisReportRepositorySummary[];
	sourceSessions?: AnalysisReportSourceSession[];
	warnings?: string[];
}

export interface AnalysisRecordInput {
	fingerprint: string;
	sessionId: string;
	title: string;
	savedAt: string;
	rootFileName?: string;
	git?: GitContext | null;
}

export interface PersistedAnalysisReport {
	report: AnalysisReportReference;
	reportFilePath: string;
}

export const ANALYSIS_INDEX_VERSION = 1;

function createDefaultDeps(): AnalysisStoreDeps {
	return {
		mkdir: async (directoryPath: string) => {
			await fs.mkdir(directoryPath, { recursive: true });
		},
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		writeFile: async (filePath: string, content: string) => fs.writeFile(filePath, content, 'utf8'),
		rename: async (fromPath: string, toPath: string) => fs.rename(fromPath, toPath),
		unlink: async (filePath: string) => fs.unlink(filePath),
		exists: async (filePath: string) => {
			try {
				await fs.access(filePath);
				return true;
			} catch {
				return false;
			}
		},
		now: () => new Date(),
		createId: () => randomUUID(),
		hash: (value: string) => createHash('sha256').update(value).digest('hex'),
	};
}

function createTempName(fileName: string): string {
	const randomPart = Math.random().toString(16).slice(2);
	return `${fileName}.${randomPart}.tmp`;
}

function normalizePathForStorage(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

function slugify(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return normalized.length > 0 ? normalized : 'analysis-report';
}

function formatTimestamp(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	const hour = String(date.getUTCHours()).padStart(2, '0');
	const minute = String(date.getUTCMinutes()).padStart(2, '0');
	return `${year}-${month}-${day}T${hour}-${minute}`;

}

function getAnalysisPaths(storageDirectory: string): {
	analysisDirectory: string;
	reportsDirectory: string;
	indexPath: string;
} {
	const analysisDirectory = path.join(storageDirectory, 'analysis');
	const reportsDirectory = path.join(analysisDirectory, 'reports');
	const indexPath = path.join(analysisDirectory, 'index.json');
	return {
		analysisDirectory,
		reportsDirectory,
		indexPath,
	};
}

function createDefaultIndex(nowIso: string): AnalysisIndex {
	return {
		version: ANALYSIS_INDEX_VERSION,
		updatedAt: nowIso,
		reports: [],
		analyzedSessions: [],
	};
}

function createReportFileName(createdAt: string, selection: AnalysisSelection, reportId: string): string {
	const timestamp = formatTimestamp(new Date(createdAt));
	const label = slugify(selection.label);
	const suffix = slugify(reportId).slice(0, 8);
	return `${timestamp}-${label}-${suffix}.md`;
}

function renderReportMarkdown(report: AnalysisReportReference, content: string): string {
	const lines = [
		'# Chat Analysis Report',
		'',
		`- Report ID: ${report.id}`,
		`- Created: ${report.createdAt}`,
		`- Selection: ${report.selection.label}`,
		`- Selection Mode: ${report.selection.mode}`,
	];

	if (report.selection.range) {
		lines.push(`- Range Start: ${report.selection.range.start}`);
		lines.push(`- Range End: ${report.selection.range.end}`);
	}

	lines.push(`- Prompt Version: ${report.promptVersion}`);
	if (report.status) {
		lines.push(`- Status: ${report.status}`);
	}
	lines.push(`- Only Unanalyzed: ${report.selection.onlyUnanalyzed === true ? 'yes' : 'no'}`);
	if (report.ownerWorkspaceName) {
		lines.push(`- Owner Workspace: ${report.ownerWorkspaceName}`);
	}
	if (report.sessionCount !== undefined) {
		lines.push(`- Session Count: ${report.sessionCount}`);
	}
	lines.push(`- Workspaces: ${report.contributingWorkspaces.join(', ') || 'n/a'}`);
	lines.push(`- Sessions Analyzed: ${report.analyzedFingerprints.length}`);

	if (report.repositories && report.repositories.length > 0) {
		lines.push('');
		lines.push('## Repository Summary');
		lines.push('');
		for (const repository of report.repositories) {
			lines.push(
				`- ${repository.workspaceName}: branch ${repository.branch ?? 'n/a'}, commit ${repository.commit ?? 'n/a'}, dirty ${repository.dirty === null ? 'n/a' : repository.dirty ? 'yes' : 'no'}, sessions ${repository.sessionCount}`,
			);
		}
	}

	if (report.sourceSessions && report.sourceSessions.length > 0) {
		lines.push('');
		lines.push('## Source Sessions');
		lines.push('');
		for (const session of report.sourceSessions) {
			lines.push(`- ${session.workspaceName} | ${session.title} | ${session.rootFileName} | ${session.savedAt}`);
		}
	}

	if (report.warnings && report.warnings.length > 0) {
		lines.push('');
		lines.push('## Warnings');
		lines.push('');
		for (const warning of report.warnings) {
			lines.push(`- ${warning}`);
		}
	}
	lines.push('');
	lines.push('## Findings');
	lines.push('');
	lines.push(content.trim());
	lines.push('');

	return lines.join('\n');
}

function createExampleFingerprintSession(): ChatSession {
	return {
		version: 1,
		id: 'session-example',
		title: 'Example saved chat',
		savedAt: '2026-06-08T13:55:52.509Z',
		provider: 'cursor',
		git: {
			branch: 'main',
			commit: '3c0879b6690aec25d6a89dc821296647794f30ab',
			dirty: false,
		},
		vscodeVersion: '1.105.1',
		totalTurns: 2,
		part: null,
		totalParts: null,
		previousPartFile: null,
		nextPartFile: null,
		turns: [
			{
				type: 'request',
				participant: 'user',
				prompt: 'Analyze these saved chats for recurring AI workflow issues.',
				references: [],
				timestamp: '2026-06-08T13:55:47.415Z',
			},
			{
				type: 'response',
				participant: 'cursor',
				content: 'I will review the saved sessions and summarize the recurring issues.',
				toolCalls: [
					{
						name: 'ReadFile',
						summary: 'Read one saved session',
						arguments: '{"path":"E:/repo/.chat/example.json"}',
					},
				],
				timestamp: '2026-06-08T13:55:48.415Z',
			},
		],
		markdownSummary: '# Chat: Example saved chat',
	};
}

function createExampleAnalysisReport(promptVersion: string): AnalysisReportReference {
	const exampleSession = createExampleFingerprintSession();
	const fingerprint = createSessionAnalysisFingerprint(exampleSession);
	return {
		id: 'report-example',
		createdAt: '2026-06-08T13:55:52.509Z',
		selection: {
			mode: 'last7Days',
			label: 'Last 7 Days',
			range: {
				start: '2026-06-01T13:55:52.509Z',
				end: '2026-06-08T13:55:52.509Z',
			},
			onlyUnanalyzed: true,
		},
		promptVersion,
		reportPath: 'analysis/reports/2026-06-08T13-55-last-7-days-example.md',
		contributingWorkspaces: ['repo'],
		analyzedFingerprints: [fingerprint],
		sessionCount: 1,
		ownerWorkspaceName: 'repo',
		repositories: [{
			workspaceName: 'repo',
			branch: 'main',
			commit: '3c0879b6690aec25d6a89dc821296647794f30ab',
			dirty: false,
			sessionCount: 1,
		}],
		sourceSessions: [{
			workspaceName: 'repo',
			sessionId: exampleSession.id,
			title: exampleSession.title,
			savedAt: exampleSession.savedAt,
			rootFileName: 'example.json',
			fingerprint,
			git: exampleSession.git,
		}],
		status: 'complete',
		warnings: ['Only include this section when a warning is actually present.'],
	};
}

function renderAnalysisReportTemplate(promptVersion: string): string {
	return renderReportMarkdown(
		createExampleAnalysisReport(promptVersion),
		[
			'## Repository-Specific Findings',
			'',
			'- Example finding',
		].join('\n'),
	);
}

function renderAnalysisIndexTemplate(promptVersion: string): string {
	const report = createExampleAnalysisReport(promptVersion);
	const analyzedSession = report.sourceSessions?.[0];
	if (!analyzedSession) {
		throw new Error('Example analysis report must include a source session.');
	}

	const index: AnalysisIndex = {
		version: ANALYSIS_INDEX_VERSION,
		updatedAt: '2026-06-08T13:55:52.509Z',
		reports: [report],
		analyzedSessions: [{
			fingerprint: analyzedSession.fingerprint,
			sessionId: analyzedSession.sessionId,
			title: analyzedSession.title,
			savedAt: analyzedSession.savedAt,
			analyzedAt: report.createdAt,
			reportPath: report.reportPath,
			reportId: report.id,
			rootFileName: analyzedSession.rootFileName,
			git: analyzedSession.git,
		}],
	};

	return JSON.stringify(index, null, 2);
}

function renderNormalizedFingerprintTemplate(): string {
	return JSON.stringify(
		normalizeSessionForFingerprint(createExampleFingerprintSession()),
		null,
		2,
	);
}

export function buildAnalysisPersistenceContract(promptVersion: string): string {
	return [
		'Session Control persistence contract for this handoff:',
		'',
		`- Use report prompt version \`${promptVersion}\` and analysis index version \`${ANALYSIS_INDEX_VERSION}\`.`,
		'- Save the report markdown at the requested report path using this top-level shape:',
		'',
		'```md',
		renderAnalysisReportTemplate(promptVersion),
		'```',
		'',
		'- Keep `analysis/index.json` in this shape. Merge by `report.id` and session `fingerprint` instead of replacing unrelated entries:',
		'',
		'```json',
		renderAnalysisIndexTemplate(promptVersion),
		'```',
		'',
		'- Compute each root-session fingerprint as SHA-256 over the UTF-8 bytes of `JSON.stringify(normalizedSession)` and write the lowercase hex digest.',
		'- Use this exact normalized fingerprint payload shape:',
		'',
		'```json',
		renderNormalizedFingerprintTemplate(),
		'```',
		'',
		'- Ignore `savedAt`, `provider`, `git`, `vscodeVersion`, `markdownSummary`, `part`, `totalParts`, `previousPartFile`, and `nextPartFile` when computing the fingerprint.',
		'- A `savedAt` change by itself must not change the fingerprint.',
	].join('\n');
}

async function writeAtomic(
	deps: AnalysisStoreDeps,
	filePath: string,
	content: string,
): Promise<void> {
	const tempPath = path.join(path.dirname(filePath), createTempName(path.basename(filePath)));

	try {
		await deps.writeFile(tempPath, content);
		await deps.rename(tempPath, filePath);
	} catch (error) {
		await deps.unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

function normalizeSessionForFingerprint(session: ChatSession): object {
	return {
		id: session.id,
		title: session.title,
		totalTurns: session.totalTurns,
		turns: session.turns.map((turn) => {
			if (turn.type === 'request') {
				return {
					type: turn.type,
					participant: turn.participant,
					prompt: turn.prompt,
					references: [...turn.references],
					timestamp: turn.timestamp,
				};
			}

			return {
				type: turn.type,
				participant: turn.participant,
				content: turn.content,
				toolCalls: turn.toolCalls.map((toolCall) => ({
					name: toolCall.name,
					summary: toolCall.summary ?? null,
					arguments: toolCall.arguments ?? null,
				})),
				timestamp: turn.timestamp,
			};
		}),
	};
}

export function createSessionAnalysisFingerprint(session: ChatSession): string {
	const normalized = normalizeSessionForFingerprint(session);
	return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function createAnalysisStore(overrides: Partial<AnalysisStoreDeps> = {}) {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	async function ensureAnalysisDirectories(storageDirectory: string): Promise<{
		analysisDirectory: string;
		reportsDirectory: string;
		indexPath: string;
	}> {
		const paths = getAnalysisPaths(storageDirectory);
		await deps.mkdir(paths.analysisDirectory);
		await deps.mkdir(paths.reportsDirectory);
		return paths;
	}

	async function readIndex(storageDirectory: string): Promise<AnalysisIndex> {
		const { indexPath } = await ensureAnalysisDirectories(storageDirectory);

		if (!(await deps.exists(indexPath))) {
			return createDefaultIndex(deps.now().toISOString());
		}

		const content = await deps.readFile(indexPath);
		const parsed = JSON.parse(content) as unknown;
		if (!isAnalysisIndex(parsed)) {
			throw new Error(`Invalid analysis index schema: ${indexPath}`);
		}

		return parsed;
	}

	async function writeIndex(storageDirectory: string, index: AnalysisIndex): Promise<void> {
		const { indexPath } = await ensureAnalysisDirectories(storageDirectory);
		await writeAtomic(deps, indexPath, JSON.stringify(index, null, 2));
	}

	async function writeReport(
		storageDirectory: string,
		input: AnalysisWriteReportInput,
	): Promise<PersistedAnalysisReport> {
		const { reportsDirectory } = await ensureAnalysisDirectories(storageDirectory);
		const createdAt = input.createdAt ?? deps.now().toISOString();
		const reportId = deps.createId();
		const fileName = createReportFileName(createdAt, input.selection, reportId);
		const reportFilePath = path.join(reportsDirectory, fileName);
		const reportPath = normalizePathForStorage(path.relative(storageDirectory, reportFilePath));
		const sessionCount = input.sessionCount ?? input.sourceSessions?.length ?? input.analyzedFingerprints.length;
		const report: AnalysisReportReference = {
			id: reportId,
			createdAt,
			selection: input.selection,
			promptVersion: input.promptVersion,
			reportPath,
			contributingWorkspaces: [...input.contributingWorkspaces],
			analyzedFingerprints: [...input.analyzedFingerprints],
			sessionCount,
			status: input.status,
			...(input.ownerWorkspaceName === undefined ? {} : { ownerWorkspaceName: input.ownerWorkspaceName }),
			...(input.repositories === undefined ? {} : { repositories: [...input.repositories] }),
			...(input.sourceSessions === undefined ? {} : { sourceSessions: [...input.sourceSessions] }),
			...(input.warnings === undefined ? {} : { warnings: [...input.warnings] }),
		};

		await writeAtomic(deps, reportFilePath, renderReportMarkdown(report, input.content));

		return {
			report,
			reportFilePath,
		};
	}

	async function readReport(storageDirectory: string, reportPath: string): Promise<string> {
		const reportFilePath = path.join(storageDirectory, reportPath);
		return deps.readFile(reportFilePath);
	}

	async function recordAnalysis(
		storageDirectory: string,
		report: AnalysisReportReference,
		sessions: AnalysisRecordInput[],
	): Promise<AnalysisIndex> {
		const current = await readIndex(storageDirectory);
		const entriesByFingerprint = new Map<string, AnalysisIndexEntry>();

		for (const entry of current.analyzedSessions) {
			entriesByFingerprint.set(entry.fingerprint, entry);
		}

		for (const session of sessions) {
			entriesByFingerprint.set(session.fingerprint, {
				fingerprint: session.fingerprint,
				sessionId: session.sessionId,
				title: session.title,
				savedAt: session.savedAt,
				analyzedAt: report.createdAt,
				reportPath: report.reportPath,
				reportId: report.id,
				...(session.rootFileName === undefined ? {} : { rootFileName: session.rootFileName }),
				...(session.git === undefined ? {} : { git: session.git }),
			});
		}

		const reportsById = new Map<string, AnalysisReportReference>();
		for (const existing of current.reports) {
			reportsById.set(existing.id, existing);
		}
		reportsById.set(report.id, report);

		const next: AnalysisIndex = {
			version: ANALYSIS_INDEX_VERSION,
			updatedAt: deps.now().toISOString(),
			reports: [...reportsById.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
			analyzedSessions: [...entriesByFingerprint.values()].sort((a, b) => Date.parse(b.analyzedAt) - Date.parse(a.analyzedAt)),
		};

		await writeIndex(storageDirectory, next);
		return next;
	}

	async function hasAnalyzedFingerprint(storageDirectory: string, fingerprint: string): Promise<boolean> {
		const index = await readIndex(storageDirectory);
		return index.analyzedSessions.some((entry) => entry.fingerprint === fingerprint);
	}

	return {
		ensureAnalysisDirectories,
		readIndex,
		readReport,
		writeReport,
		recordAnalysis,
		hasAnalyzedFingerprint,
	};
}
