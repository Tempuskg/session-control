import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findExecutableOnPath(executableNames: readonly string[]): Promise<string | undefined> {
	const pathEntries = (process.env.PATH ?? '').split(path.delimiter);

	for (const entry of pathEntries) {
		const trimmedEntry = entry.trim();
		if (trimmedEntry.length === 0) {
			continue;
		}

		for (const executableName of executableNames) {
			const candidatePath = path.join(trimmedEntry, executableName);
			if (await fileExists(candidatePath)) {
				return candidatePath;
			}
		}
	}

	return undefined;
}

async function resolveVscodeExecutablePath(): Promise<string> {
	const explicitExecutablePath = process.env.VSCODE_EXECUTABLE_PATH?.trim();
	if (explicitExecutablePath) {
		return explicitExecutablePath;
	}

	const localExecutablePath = await findExecutableOnPath(
		process.platform === 'win32'
			? ['code.cmd', 'code.exe', 'code-insiders.cmd', 'code-insiders.exe']
			: ['code', 'code-insiders'],
	);
	if (localExecutablePath) {
		return localExecutablePath;
	}

	const testVersion = process.env.VSCODE_TEST_VERSION;
	const downloadedExecutablePath = testVersion === undefined
		? await downloadAndUnzipVSCode()
		: await downloadAndUnzipVSCode({ version: testVersion });

	return process.platform === 'win32'
		? path.join(
			path.dirname(downloadedExecutablePath),
			'bin',
			testVersion === 'insiders' ? 'code-insiders.cmd' : 'code.cmd',
		)
		: downloadedExecutablePath;
}

async function main(): Promise<void> {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
		const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
		const vscodeExecutablePath = await resolveVscodeExecutablePath();

		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath,
		});
	} catch (error) {
		console.error('Failed to run tests');
		if (error instanceof Error) {
			console.error(error.message);
		} else {
			console.error(error);
		}
		process.exit(1);
	}
}

void main();
