import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	SKILL_SUGGESTION_MIN_CONFIDENCE,
	createCodexSkillImporter,
	suggestMatchingSkill,
	type SkillCatalogEntry,
} from '../../src/codexSkillImporter';
import { createFakeJudgmentService } from '../../src/typesafe/judgmentService';

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

	test('skips creating a new Claude Code skill when the same source was already imported under a different skill folder', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-claude-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, '.github'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.claude', 'skills', 'custom-copilot-guidance'), { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
				'# Copilot\nUse the local test workflow.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.claude', 'skills', 'custom-copilot-guidance', 'SKILL.md'),
				[
					'---',
					'name: custom-copilot-guidance',
					'description: "Imported repository guidance from .github/copilot-instructions.md. Use when working in this repository and the original guidance is relevant."',
					'---',
					'',
					'Follow this imported repository guidance from `.github/copilot-instructions.md` when the task overlaps with its original scope.',
					'',
					'## Instructions',
					'- Preserve the original guidance.',
					'',
					'## Imported guidance',
					'',
					'# Copilot',
					'Use the local test workflow.',
					'',
				].join('\n'),
				'utf8',
			);

			const result = await importer.importSkills(workspaceRoot, {
				skillDirectorySegments: ['.claude', 'skills'],
			});
			assert.deepEqual(result.created, []);
			assert.deepEqual(result.skipped, [
				'.claude/skills/custom-copilot-guidance/SKILL.md',
			]);
			await assert.rejects(
				fs.access(path.join(workspaceRoot, '.claude', 'skills', 'github-copilot-instructions', 'SKILL.md')),
			);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('skips creating a new Claude Code skill when imported guidance content already exists in another imported skill', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-claude-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, 'guides'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.claude', 'skills', 'existing-review-guidance'), { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, 'guides', 'onboarding.agent.md'),
				'Pair patiently and explain local conventions clearly.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.claude', 'skills', 'existing-review-guidance', 'SKILL.md'),
				[
					'---',
					'name: existing-review-guidance',
					'description: "Imported repository guidance from .github/prompts/review.prompt.md. Use when working in this repository and the original guidance is relevant."',
					'---',
					'',
					'Follow this imported repository guidance from `.github/prompts/review.prompt.md` when the task overlaps with its original scope.',
					'',
					'## Instructions',
					'- Preserve the original guidance.',
					'',
					'## Imported guidance',
					'',
					'Pair patiently and explain local conventions clearly.',
					'',
				].join('\n'),
				'utf8',
			);

			const result = await importer.importSkills(workspaceRoot, {
				skillDirectorySegments: ['.claude', 'skills'],
			});
			assert.deepEqual(result.created, []);
			assert.deepEqual(result.skipped, [
				'.claude/skills/existing-review-guidance/SKILL.md',
			]);
			await assert.rejects(
				fs.access(path.join(workspaceRoot, '.claude', 'skills', 'guides-onboarding-agent', 'SKILL.md')),
			);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('skips creating a new skill when the same source was already imported under a different skill folder', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-codex-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, '.github'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.agents', 'skills', 'custom-copilot-guidance'), { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
				'# Copilot\nUse the local test workflow.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.agents', 'skills', 'custom-copilot-guidance', 'SKILL.md'),
				[
					'---',
					'name: custom-copilot-guidance',
					'description: "Imported repository guidance from .github/copilot-instructions.md. Use when working in this repository and the original guidance is relevant."',
					'---',
					'',
					'Follow this imported repository guidance from `.github/copilot-instructions.md` when the task overlaps with its original scope.',
					'',
					'## Instructions',
					'- Preserve the original guidance.',
					'',
					'## Imported guidance',
					'',
					'# Copilot',
					'Use the local test workflow.',
					'',
				].join('\n'),
				'utf8',
			);

			const result = await importer.importSkills(workspaceRoot);
			assert.deepEqual(result.created, []);
			assert.deepEqual(result.skipped, [
				'.agents/skills/custom-copilot-guidance/SKILL.md',
			]);
			await assert.rejects(
				fs.access(path.join(workspaceRoot, '.agents', 'skills', 'github-copilot-instructions', 'SKILL.md')),
			);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('skips creating a new skill when imported guidance content already exists in another imported skill', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-codex-skill-importer-'));
		const importer = createCodexSkillImporter();

		try {
			await fs.mkdir(path.join(workspaceRoot, 'guides'), { recursive: true });
			await fs.mkdir(path.join(workspaceRoot, '.agents', 'skills', 'existing-review-guidance'), { recursive: true });
			await fs.writeFile(
				path.join(workspaceRoot, 'guides', 'onboarding.agent.md'),
				'Pair patiently and explain local conventions clearly.\n',
				'utf8',
			);
			await fs.writeFile(
				path.join(workspaceRoot, '.agents', 'skills', 'existing-review-guidance', 'SKILL.md'),
				[
					'---',
					'name: existing-review-guidance',
					'description: "Imported repository guidance from .github/prompts/review.prompt.md. Use when working in this repository and the original guidance is relevant."',
					'---',
					'',
					'Follow this imported repository guidance from `.github/prompts/review.prompt.md` when the task overlaps with its original scope.',
					'',
					'## Instructions',
					'- Preserve the original guidance.',
					'',
					'## Imported guidance',
					'',
					'Pair patiently and explain local conventions clearly.',
					'',
				].join('\n'),
				'utf8',
			);

			const result = await importer.importSkills(workspaceRoot);
			assert.deepEqual(result.created, []);
			assert.deepEqual(result.skipped, [
				'.agents/skills/existing-review-guidance/SKILL.md',
			]);
			await assert.rejects(
				fs.access(path.join(workspaceRoot, '.agents', 'skills', 'guides-onboarding-agent', 'SKILL.md')),
			);
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

	suite('skill suggestion', () => {
		const skills: SkillCatalogEntry[] = [
			{ name: 'repo-validation', description: 'Validate touched files before broad test runs.', relativeSkillFilePath: '.agents/skills/repo-validation/SKILL.md' },
			{ name: 'release', description: 'Cut a VS Code extension release.', relativeSkillFilePath: '.agents/skills/release/SKILL.md' },
		];

		test('asks one Choice over the skill catalog plus none and suggests a confident match', async () => {
			const judgment = createFakeJudgmentService({ answers: { skill: { choice: 'skill-2', confidence: 0.9 } } });
			const suggestion = await suggestMatchingSkill({ task: 'publish version 2.0', skills, judgment });

			assert.deepEqual(suggestion, { skill: skills[1], confidence: 0.9 });
			assert.equal(judgment.calls.length, 1);
			assert.equal(judgment.calls[0]?.options, 'routing');
			const question = (judgment.calls[0]?.questions as Record<string, { type?: string; criteria?: Record<string, string> }>).skill;
			assert.equal(question?.type, 'choice');
			assert.deepEqual(Object.keys(question?.criteria ?? {}), ['skill-1', 'skill-2', 'none']);
		});

		test('returns no suggestion for low confidence, none, or invalid answers', async () => {
			const lowConfidence = createFakeJudgmentService({
				answers: { skill: { choice: 'skill-1', confidence: SKILL_SUGGESTION_MIN_CONFIDENCE - 0.01 } },
			});
			assert.equal(await suggestMatchingSkill({ task: 'run tests', skills, judgment: lowConfidence }), undefined);

			const none = createFakeJudgmentService({ answers: { skill: { choice: 'none', confidence: 0.99 } } });
			assert.equal(await suggestMatchingSkill({ task: 'draw a logo', skills, judgment: none }), undefined);

			const outOfRange = createFakeJudgmentService({ answers: { skill: { choice: 'skill-9', confidence: 0.99 } } });
			assert.equal(await suggestMatchingSkill({ task: 'run tests', skills, judgment: outOfRange }), undefined);
		});

		test('skips the request when routing is off or there is nothing to choose', async () => {
			const featureOff = createFakeJudgmentService({ features: { routing: false }, answers: { skill: { choice: 'skill-1', confidence: 0.9 } } });
			assert.equal(await suggestMatchingSkill({ task: 'run tests', skills, judgment: featureOff }), undefined);
			assert.equal(featureOff.calls.length, 0);

			assert.equal(await suggestMatchingSkill({ task: 'run tests', skills, judgment: undefined }), undefined);

			const judgment = createFakeJudgmentService({ answers: { skill: { choice: 'skill-1', confidence: 0.9 } } });
			assert.equal(await suggestMatchingSkill({ task: 'run tests', skills: [], judgment }), undefined);
			assert.equal(await suggestMatchingSkill({ task: '  ', skills, judgment }), undefined);
			assert.equal(judgment.calls.length, 0);
		});

		test('lists the skill catalog from SKILL.md frontmatter', async () => {
			const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-skill-catalog-'));
			try {
				await fs.mkdir(path.join(workspaceRoot, '.agents', 'skills', 'release'), { recursive: true });
				await fs.mkdir(path.join(workspaceRoot, '.agents', 'skills', 'no-description'), { recursive: true });
				await fs.writeFile(
					path.join(workspaceRoot, '.agents', 'skills', 'release', 'SKILL.md'),
					'---\nname: release\ndescription: "Cut a \\"release\\" build."\n---\nBody\n',
					'utf8',
				);
				await fs.writeFile(
					path.join(workspaceRoot, '.agents', 'skills', 'no-description', 'SKILL.md'),
					'---\nname: no-description\n---\n',
					'utf8',
				);

				const catalog = await createCodexSkillImporter().listSkillCatalog(workspaceRoot);
				assert.deepEqual(catalog, [
					{ name: 'release', description: 'Cut a "release" build.', relativeSkillFilePath: '.agents/skills/release/SKILL.md' },
				]);
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});
});
