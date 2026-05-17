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
	createdAt?: string;
	sessionCount?: number;
	ownerWorkspaceName?: string;
	repositories?: AnalysisReportRepositorySummary[];
	sourceSessions?: AnalysisReportSourceSession[];
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

const ANALYSIS_INDEX_VERSION = 1;

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
	lines.push('');
	lines.push('## Findings');
	lines.push('');
	lines.push(content.trim());
	lines.push('');

	return lines.join('\n');
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
			...(input.ownerWorkspaceName === undefined ? {} : { ownerWorkspaceName: input.ownerWorkspaceName }),
			...(input.repositories === undefined ? {} : { repositories: [...input.repositories] }),
			...(input.sourceSessions === undefined ? {} : { sourceSessions: [...input.sourceSessions] }),
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