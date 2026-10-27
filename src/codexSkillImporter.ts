import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { choice, type ChoiceQuestion, type JudgmentService, type Questions } from './typesafe/judgmentService';
import { slugify } from './utils';

interface DirectoryEntry {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
}

interface CodexSkillImporterDeps {
	readDir(directoryPath: string): Promise<DirectoryEntry[]>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;
	mkdir(directoryPath: string): Promise<void>;
	exists(filePath: string): Promise<boolean>;
}

interface ExistingSkillSignature {
	relativeSkillFilePath: string;
	importedGuidance?: string;
	importedSourcePath?: string;
}

export interface CodexSkillImportResult {
	created: string[];
	skipped: string[];
	sourceFiles: string[];
}

export interface CodexSkillImportOptions {
	skillDirectorySegments?: readonly string[];
}

export interface SkillCatalogEntry {
	readonly name: string;
	readonly description: string;
	readonly relativeSkillFilePath: string;
}

export interface SkillSuggestionInput {
	readonly task: string;
	readonly skills: readonly SkillCatalogEntry[];
	readonly judgment: JudgmentService | undefined;
	readonly token?: vscode.CancellationToken;
	readonly log?: (message: string) => void;
}

export interface SkillSuggestion {
	readonly skill: SkillCatalogEntry;
	readonly confidence: number;
}

export const SKILL_SUGGESTION_MIN_CONFIDENCE = 0.7;
export const SKILL_SUGGESTION_MAX_CANDIDATES = 40;

const SKILL_LABEL_PREFIX = 'skill-';
const NO_SKILL_LABEL = 'none';

const EXCLUDED_DIRECTORIES = new Set([
	'.agents',
	'.chat',
	'.claude',
	'.codex',
	'.cursor',
	'.git',
	'.vscode',
	'.vscode-test',
	'dist',
	'dist-test',
	'node_modules',
]);

const SKIPPABLE_READ_DIRECTORY_ERROR_CODES = new Set([
	'EACCES',
	'ENOENT',
	'ENOTDIR',
	'EPERM',
]);

function createDefaultDeps(): CodexSkillImporterDeps {
	return {
		readDir: async (directoryPath: string) => {
			const entries = await fs.readdir(directoryPath, { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile(),
			}));
		},
		readFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
		writeFile: async (filePath: string, content: string) => fs.writeFile(filePath, content, 'utf8'),
		mkdir: async (directoryPath: string) => {
			await fs.mkdir(directoryPath, { recursive: true });
		},
		exists: async (filePath: string) => {
			try {
				await fs.access(filePath);
				return true;
			} catch {
				return false;
			}
		},
	};
}

function normalizeRelativePath(workspaceRoot: string, filePath: string): string {
	return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function escapeYamlDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripLeadingFrontmatter(content: string): string {
	if (!content.startsWith('---')) {
		return content.trim();
	}

	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	if (!match) {
		return content.trim();
	}

	return content.slice(match[0].length).trim();
}

function normalizeComparableText(content: string): string {
	return content.replace(/\r\n/g, '\n').trim();
}

function isGuidanceFileName(fileName: string): boolean {
	return /(?:\.instructions|\.prompt|\.agent)\.md$/i.test(fileName) || /^SKILL\.md$/i.test(fileName);
}

function isSkippableReadDirectoryError(error: unknown): boolean {
	return typeof error === 'object'
		&& error !== null
		&& 'code' in error
		&& typeof error.code === 'string'
		&& SKIPPABLE_READ_DIRECTORY_ERROR_CODES.has(error.code);
}

async function readDirectoryEntries(
	directoryPath: string,
	deps: CodexSkillImporterDeps,
): Promise<DirectoryEntry[]> {
	try {
		return await deps.readDir(directoryPath);
	} catch (error: unknown) {
		if (isSkippableReadDirectoryError(error)) {
			return [];
		}

		throw error;
	}
}

function isInstructionsFileName(fileName: string): boolean {
	return /\.instructions\.md$/i.test(fileName);
}

function isPromptFileName(fileName: string): boolean {
	return /\.prompt\.md$/i.test(fileName);
}

function toSkillSlug(relativePath: string): string {
	const withoutExtension = relativePath.replace(/\.md$/i, '');
	return slugify(withoutExtension) || 'imported-guidance';
}

function resolveSkillDirectorySegments(options: CodexSkillImportOptions): string[] {
	const segments = options.skillDirectorySegments
		?.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);

	return segments && segments.length > 0 ? segments : ['.agents', 'skills'];
}

function renderSkillContent(skillName: string, relativeSourcePath: string, sourceContent: string): string {
	const description = `Imported repository guidance from ${relativeSourcePath}. Use when working in this repository and the original guidance is relevant.`;
	const importedGuidance = stripLeadingFrontmatter(sourceContent);

	return [
		'---',
		`name: ${skillName}`,
		`description: "${escapeYamlDoubleQuoted(description)}"`,
		'---',
		'',
		`Follow this imported repository guidance from \`${relativeSourcePath}\` when the task overlaps with its original scope.`,
		'',
		'## Instructions',
		'- Treat the guidance below as repository-specific instructions for this project.',
		'- Apply it together with higher-priority system, developer, and repo instructions already in effect.',
		'- Preserve the intent of the source guidance while adapting it to the current task.',
		'',
		'## Imported guidance',
		'',
		importedGuidance || '_No guidance content found in the source file._',
		'',
	].join('\n');
}

function extractImportedSourcePath(skillContent: string): string | undefined {
	const match = skillContent.match(/Follow this imported repository guidance from `([^`]+)` when the task overlaps with its original scope\./);
	return match?.[1]?.trim();
}

function extractImportedGuidance(skillContent: string): string | undefined {
	const match = skillContent.match(/^## Imported guidance\r?\n\r?\n([\s\S]*)$/m);
	const importedGuidance = match?.[1]?.trim();
	return importedGuidance ? normalizeComparableText(importedGuidance) : undefined;
}

function readFrontmatterField(skillContent: string, field: string): string | undefined {
	const frontmatter = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
	const line = frontmatter?.split(/\r?\n/).find((candidate) => candidate.startsWith(`${field}:`));
	const raw = line?.slice(field.length + 1).trim();
	if (!raw) {
		return undefined;
	}
	if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
		return raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
	}
	return raw;
}

export function buildSkillSuggestionQuestions(skills: readonly SkillCatalogEntry[]): Questions {
	const criteria: Record<string, string> = {};
	skills.forEach((skill, index) => {
		criteria[`${SKILL_LABEL_PREFIX}${index + 1}`] = `${skill.name}: ${skill.description}`;
	});
	criteria[NO_SKILL_LABEL] = 'None of the listed skills fits the task.';
	const questions: Record<string, ChoiceQuestion> = {
		skill: choice('Which existing skill best matches the task the user is working on?', criteria),
	};
	return questions;
}

/**
 * Suggest the existing skill that best matches the current task, following the
 * skill-suggestion cookbook: one Choice over the skill catalog plus `none`.
 * Returns undefined when TypeSafe or `routing` is off, the request fails, the
 * answer is `none`, or confidence is below `SKILL_SUGGESTION_MIN_CONFIDENCE`.
 */
export async function suggestMatchingSkill(input: SkillSuggestionInput): Promise<SkillSuggestion | undefined> {
	const task = input.task.trim();
	const judgment = input.judgment;
	const skills = input.skills.slice(0, SKILL_SUGGESTION_MAX_CANDIDATES);
	if (!task || !skills.length || !judgment) {
		return undefined;
	}

	try {
		if (!judgment.isFeatureEnabled('routing')) {
			return undefined;
		}

		const answers = await judgment.ask({ task }, buildSkillSuggestionQuestions(skills), input.token, 'routing');
		if (!answers || input.token?.isCancellationRequested) {
			return undefined;
		}

		const answer = (answers as Record<string, { choice?: unknown; confidence?: unknown } | undefined>).skill;
		const label = typeof answer?.choice === 'string' ? answer.choice : undefined;
		const confidence = typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : undefined;
		const index = label?.startsWith(SKILL_LABEL_PREFIX) ? Number(label.slice(SKILL_LABEL_PREFIX.length)) - 1 : -1;
		const skill = Number.isInteger(index) ? skills[index] : undefined;
		if (!skill || confidence === undefined || confidence < SKILL_SUGGESTION_MIN_CONFIDENCE) {
			input.log?.(`[skill-suggestion] choice=${label ?? 'invalid'} confidence=${confidence ?? 'n/a'} decision=none`);
			return undefined;
		}

		input.log?.(`[skill-suggestion] choice=${skill.name} confidence=${confidence} decision=suggest`);
		return { skill, confidence };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.log?.(`[skill-suggestion] ${message}`);
		return undefined;
	}
}

async function collectMatchingFiles(
	directoryPath: string,
	deps: CodexSkillImporterDeps,
	matcher: (fileName: string) => boolean,
	results: Set<string>,
): Promise<void> {
	const exists = await deps.exists(directoryPath);
	if (!exists) {
		return;
	}

	const entries = await readDirectoryEntries(directoryPath, deps);
	for (const entry of entries) {
		const absolutePath = path.join(directoryPath, entry.name);
		if (entry.isDirectory) {
			await collectMatchingFiles(absolutePath, deps, matcher, results);
			continue;
		}

		if (entry.isFile && matcher(entry.name)) {
			results.add(absolutePath);
		}
	}
}

async function collectWorkspaceGuidanceFiles(
	directoryPath: string,
	deps: CodexSkillImporterDeps,
	results: Set<string>,
): Promise<void> {
	const entries = await readDirectoryEntries(directoryPath, deps);
	for (const entry of entries) {
		if (EXCLUDED_DIRECTORIES.has(entry.name)) {
			continue;
		}

		const absolutePath = path.join(directoryPath, entry.name);
		if (entry.isDirectory) {
			await collectWorkspaceGuidanceFiles(absolutePath, deps, results);
			continue;
		}

		if (entry.isFile && isGuidanceFileName(entry.name)) {
			results.add(absolutePath);
		}
	}
}

async function collectExistingSkillSignatures(
	workspaceRoot: string,
	skillRoot: string,
	deps: CodexSkillImporterDeps,
): Promise<ExistingSkillSignature[]> {
	const skillFiles = new Set<string>();
	await collectMatchingFiles(skillRoot, deps, isGuidanceFileName, skillFiles);
	const signatures: ExistingSkillSignature[] = [];

	for (const skillFilePath of [...skillFiles].sort((left, right) => left.localeCompare(right))) {
		const skillContent = await deps.readFile(skillFilePath);
		const importedSourcePath = extractImportedSourcePath(skillContent);
		const importedGuidance = extractImportedGuidance(skillContent);
		const signature: ExistingSkillSignature = {
			relativeSkillFilePath: normalizeRelativePath(workspaceRoot, skillFilePath),
		};
		if (importedSourcePath) {
			signature.importedSourcePath = importedSourcePath;
		}
		if (importedGuidance) {
			signature.importedGuidance = importedGuidance;
		}
		signatures.push(signature);
	}

	return signatures;
}

export function createCodexSkillImporter(overrides: Partial<CodexSkillImporterDeps> = {}): {
	discoverSourceFiles(workspaceRoot: string): Promise<string[]>;
	importSkills(workspaceRoot: string, options?: CodexSkillImportOptions): Promise<CodexSkillImportResult>;
	listSkillCatalog(workspaceRoot: string, options?: CodexSkillImportOptions): Promise<SkillCatalogEntry[]>;
} {
	const deps = {
		...createDefaultDeps(),
		...overrides,
	};

	const discoverSourceFiles = async (workspaceRoot: string): Promise<string[]> => {
		const discovered = new Set<string>();
		const copilotInstructionsPath = path.join(workspaceRoot, '.github', 'copilot-instructions.md');
		if (await deps.exists(copilotInstructionsPath)) {
			discovered.add(copilotInstructionsPath);
		}

		await collectMatchingFiles(path.join(workspaceRoot, '.github', 'instructions'), deps, isInstructionsFileName, discovered);
		await collectMatchingFiles(path.join(workspaceRoot, '.github', 'prompts'), deps, isPromptFileName, discovered);

		if (await deps.exists(workspaceRoot)) {
			await collectWorkspaceGuidanceFiles(workspaceRoot, deps, discovered);
		}

		return [...discovered].sort((left, right) => left.localeCompare(right));
	};

	return {
		discoverSourceFiles,

		async listSkillCatalog(workspaceRoot: string, options: CodexSkillImportOptions = {}): Promise<SkillCatalogEntry[]> {
			const skillRoot = path.join(workspaceRoot, ...resolveSkillDirectorySegments(options));
			const skillFiles = new Set<string>();
			await collectMatchingFiles(skillRoot, deps, (fileName) => /^SKILL\.md$/i.test(fileName), skillFiles);
			const catalog: SkillCatalogEntry[] = [];

			for (const skillFilePath of [...skillFiles].sort((left, right) => left.localeCompare(right))) {
				const skillContent = await deps.readFile(skillFilePath);
				const name = readFrontmatterField(skillContent, 'name') ?? path.basename(path.dirname(skillFilePath));
				const description = readFrontmatterField(skillContent, 'description');
				if (!description) {
					continue;
				}
				catalog.push({ name, description, relativeSkillFilePath: normalizeRelativePath(workspaceRoot, skillFilePath) });
			}

			return catalog;
		},

		async importSkills(workspaceRoot: string, options: CodexSkillImportOptions = {}): Promise<CodexSkillImportResult> {
			const sourceFiles = await discoverSourceFiles(workspaceRoot);
			const created: string[] = [];
			const skipped: string[] = [];
			const reservedTargets = new Set<string>();
			const skillDirectorySegments = resolveSkillDirectorySegments(options);
			const skillRoot = path.join(workspaceRoot, ...skillDirectorySegments);
			const existingSkillSignatures = await collectExistingSkillSignatures(workspaceRoot, skillRoot, deps);
			const existingSkillBySourcePath = new Map<string, string>();
			const existingSkillByGuidance = new Map<string, string>();

			for (const signature of existingSkillSignatures) {
				if (signature.importedSourcePath) {
					existingSkillBySourcePath.set(signature.importedSourcePath.toLowerCase(), signature.relativeSkillFilePath);
				}

				if (signature.importedGuidance) {
					existingSkillByGuidance.set(signature.importedGuidance, signature.relativeSkillFilePath);
				}
			}

			for (const sourcePath of sourceFiles) {
				const relativeSourcePath = normalizeRelativePath(workspaceRoot, sourcePath);
				const skillName = toSkillSlug(relativeSourcePath);
				const skillDirectory = path.join(workspaceRoot, ...skillDirectorySegments, skillName);
				const skillFilePath = path.join(skillDirectory, 'SKILL.md');
				const relativeSkillFilePath = normalizeRelativePath(workspaceRoot, skillFilePath);
				const normalizedTarget = relativeSkillFilePath.toLowerCase();

				if (reservedTargets.has(normalizedTarget) || await deps.exists(skillFilePath)) {
					skipped.push(relativeSkillFilePath);
					reservedTargets.add(normalizedTarget);
					continue;
				}

				const sourceContent = await deps.readFile(sourcePath);
				const normalizedImportedGuidance = normalizeComparableText(stripLeadingFrontmatter(sourceContent));
				const existingSkillForSource = existingSkillBySourcePath.get(relativeSourcePath.toLowerCase());
				if (existingSkillForSource) {
					skipped.push(existingSkillForSource);
					reservedTargets.add(normalizedTarget);
					continue;
				}

				const existingSkillForGuidance = existingSkillByGuidance.get(normalizedImportedGuidance);
				if (existingSkillForGuidance) {
					skipped.push(existingSkillForGuidance);
					reservedTargets.add(normalizedTarget);
					continue;
				}

				const skillContent = renderSkillContent(skillName, relativeSourcePath, sourceContent);
				await deps.mkdir(skillDirectory);
				await deps.writeFile(skillFilePath, skillContent);

				reservedTargets.add(normalizedTarget);
				created.push(relativeSkillFilePath);
				existingSkillBySourcePath.set(relativeSourcePath.toLowerCase(), relativeSkillFilePath);
				existingSkillByGuidance.set(normalizedImportedGuidance, relativeSkillFilePath);
			}

			return {
				created,
				skipped,
				sourceFiles: sourceFiles.map((filePath) => normalizeRelativePath(workspaceRoot, filePath)),
			};
		},
	};
}
