import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
