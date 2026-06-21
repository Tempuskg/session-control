import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCodexSkillImporter } from '../../src/codexSkillImporter';

suite('codexSkillImporter', () => {
	test('discovers guidance files and imports them into repo-scoped Codex skills by default', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-codex-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, '.github', 'instructions'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.github', 'prompts'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, 'guides'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.agents', 'skills', 'github-prompts-review-prompt'), { recursive: true });

			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
				'# Copilot\nUse the local test workflow.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'instructions', 'repo-validation.instructions.md'),
				'Validate touched files before broad test runs.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'prompts', 'review.prompt.md'),
				'Review saved sessions for regressions.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, 'guides', 'onboarding.agent.md'),
				'Pair patiently and explain local conventions clearly.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.agents', 'skills', 'github-prompts-review-prompt', 'SKILL.md'),
				'---\nname: github-prompts-review-prompt\ndescription: Existing skill.\n---\n',
				'utf8',
			);

			const discovered = await importer.discoverSourceFiles(workspaceRoot);
			assert.deepEqual(discovered.map((filePath) => path.relative(workspaceRoot, filePath).replace(/\\/g, '/')), [
				'.github/copilot-instructions.md',
				'.github/instructions/repo-validation.instructions.md',
				'.github/prompts/review.prompt.md',
				'guides/onboarding.agent.md',
			]);

			const result = await importer.importSkills(workspaceRoot);
			assert.deepEqual(result.created, [
				'.agents/skills/github-copilot-instructions/SKILL.md',
				'.agents/skills/github-instructions-repo-validation-instructions/SKILL.md',
				'.agents/skills/guides-onboarding-agent/SKILL.md',
			]);
			assert.deepEqual(result.skipped, [
				'.agents/skills/github-prompts-review-prompt/SKILL.md',
			]);

			const createdSkill = await fs.readFile(
				path.join(workspaceRoot, '.agents', 'skills', 'github-copilot-instructions', 'SKILL.md'),
				'utf8',
			);
			assert.equal(createdSkill.includes('name: github-copilot-instructions'), true);
			assert.equal(createdSkill.includes('Imported repository guidance from .github/copilot-instructions.md'), true);
			assert.equal(createdSkill.includes('Use the local test workflow.'), true);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('imports guidance into project-scoped Cursor skills when requested', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-cursor-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, '.github'), { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
				'# Copilot\nPrefer focused test runs before full validation.\n',
				'utf8',
			);

			const result = await importer.importSkills(workspaceRoot, {
				skillDirectorySegments: ['.cursor', 'skills'],
			});
			assert.deepEqual(result.created, [
				'.cursor/skills/github-copilot-instructions/SKILL.md',
			]);
			assert.deepEqual(result.skipped, []);

			const createdSkill = await fs.readFile(
				path.join(workspaceRoot, '.cursor', 'skills', 'github-copilot-instructions', 'SKILL.md'),
				'utf8',
			);
			assert.equal(createdSkill.includes('name: github-copilot-instructions'), true);
			assert.equal(createdSkill.includes('Prefer focused test runs before full validation.'), true);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('imports guidance into project-scoped Claude Code skills when requested', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-claude-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, '.github'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.claude', 'skills', 'existing'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.cursor', 'skills', 'existing'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.vscode-test', 'download-cache'), { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
				'# Copilot\nPreserve repository-specific guidance.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.claude', 'skills', 'existing', 'SKILL.md'),
				'Generated Claude skill should not be rediscovered.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.cursor', 'skills', 'existing', 'SKILL.md'),
				'Generated Cursor skill should not be rediscovered.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.vscode-test', 'download-cache', 'SKILL.md'),
				'Downloaded test cache should not be rediscovered.\n',
				'utf8',
			);

			const discovered = await importer.discoverSourceFiles(workspaceRoot);
			assert.deepEqual(discovered.map((filePath) => path.relative(workspaceRoot, filePath).replace(/\\/g, '/')), [
				'.github/copilot-instructions.md',
			]);

			const result = await importer.importSkills(workspaceRoot, {
				skillDirectorySegments: ['.claude', 'skills'],
			});
			assert.deepEqual(result.created, [
				'.claude/skills/github-copilot-instructions/SKILL.md',
			]);
			assert.deepEqual(result.skipped, []);

			const createdSkill = await fs.readFile(
				path.join(workspaceRoot, '.claude', 'skills', 'github-copilot-instructions', 'SKILL.md'),
				'utf8',
			);
			assert.equal(createdSkill.includes('name: github-copilot-instructions'), true);
			assert.equal(createdSkill.includes('Preserve repository-specific guidance.'), true);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('skips unreadable workspace directories during guidance discovery', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-codex-skill-importer-'));
		const blockedDirectory = path.join(workspaceRoot, '.tmp_pytest', 'pytest-adjacent');
		const importer = createCodexSkillImporter({
			readDir: async (directoryPath) => {
				if (directoryPath === blockedDirectory) {
					throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
				}

				const entries = await fs.readdir(directoryPath, { withFileTypes: true });
				return entries.map((entry) => ({
					name: entry.name,
					isDirectory: entry.isDirectory(),
					isFile: entry.isFile(),
				}));
			},
		});

		try {
			await fs.mkdir(path.join(workspaceRoot, '.github'), { recursive: true });
			await fs.mkdir(blockedDirectory, { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
				'# Copilot\nUse the local test workflow.\n',
				'utf8',
			);

			const discovered = await importer.discoverSourceFiles(workspaceRoot);

			assert.deepEqual(discovered.map((filePath) => path.relative(workspaceRoot, filePath).replace(/\\/g, '/')), [
				'.github/copilot-instructions.md',
			]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
