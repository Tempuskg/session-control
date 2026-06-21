"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCodexSkillImporter = createCodexSkillImporter;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const utils_1 = require("./utils");
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
function createDefaultDeps() {
    return {
        readDir: async (directoryPath) => {
            const entries = await fs.readdir(directoryPath, { withFileTypes: true });
            return entries.map((entry) => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile(),
            }));
        },
        readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
        writeFile: async (filePath, content) => fs.writeFile(filePath, content, 'utf8'),
        mkdir: async (directoryPath) => {
            await fs.mkdir(directoryPath, { recursive: true });
        },
        exists: async (filePath) => {
            try {
                await fs.access(filePath);
                return true;
            }
            catch {
                return false;
            }
        },
    };
}
function normalizeRelativePath(workspaceRoot, filePath) {
    return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}
function escapeYamlDoubleQuoted(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function stripLeadingFrontmatter(content) {
    if (!content.startsWith('---')) {
        return content.trim();
    }
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!match) {
        return content.trim();
    }
    return content.slice(match[0].length).trim();
}
function isGuidanceFileName(fileName) {
    return /(?:\.instructions|\.prompt|\.agent)\.md$/i.test(fileName) || /^SKILL\.md$/i.test(fileName);
}
function isSkippableReadDirectoryError(error) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && typeof error.code === 'string'
        && SKIPPABLE_READ_DIRECTORY_ERROR_CODES.has(error.code);
}
async function readDirectoryEntries(directoryPath, deps) {
    try {
        return await deps.readDir(directoryPath);
    }
    catch (error) {
        if (isSkippableReadDirectoryError(error)) {
            return [];
        }
        throw error;
    }
}
function isInstructionsFileName(fileName) {
    return /\.instructions\.md$/i.test(fileName);
}
function isPromptFileName(fileName) {
    return /\.prompt\.md$/i.test(fileName);
}
function toSkillSlug(relativePath) {
    const withoutExtension = relativePath.replace(/\.md$/i, '');
    return (0, utils_1.slugify)(withoutExtension) || 'imported-guidance';
}
function resolveSkillDirectorySegments(options) {
    const segments = options.skillDirectorySegments
        ?.map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
    return segments && segments.length > 0 ? segments : ['.agents', 'skills'];
}
function renderSkillContent(skillName, relativeSourcePath, sourceContent) {
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
async function collectMatchingFiles(directoryPath, deps, matcher, results) {
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
async function collectWorkspaceGuidanceFiles(directoryPath, deps, results) {
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
function createCodexSkillImporter(overrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...overrides,
    };
    const discoverSourceFiles = async (workspaceRoot) => {
        const discovered = new Set();
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
        async importSkills(workspaceRoot, options = {}) {
            const sourceFiles = await discoverSourceFiles(workspaceRoot);
            const created = [];
            const skipped = [];
            const reservedTargets = new Set();
            const skillDirectorySegments = resolveSkillDirectorySegments(options);
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
                const skillContent = renderSkillContent(skillName, relativeSourcePath, sourceContent);
                await deps.mkdir(skillDirectory);
                await deps.writeFile(skillFilePath, skillContent);
                reservedTargets.add(normalizedTarget);
                created.push(relativeSkillFilePath);
            }
            return {
                created,
                skipped,
                sourceFiles: sourceFiles.map((filePath) => normalizeRelativePath(workspaceRoot, filePath)),
            };
        },
    };
}
//# sourceMappingURL=codexSkillImporter.js.map