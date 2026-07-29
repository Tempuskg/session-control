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

	// Never launch tests through the `code.cmd` / `code` CLI wrapper: it
	// starts VS Code detached and exits 0 immediately, so test failures never
	// propagate and every run reports success. On Windows, resolve a locally
	// installed VS Code to the electron Code.exe next to its bin\ directory;
	// otherwise download an archive and use its executable directly.
	if (process.platform === 'win32') {
		const localCli = await findExecutableOnPath(['code.cmd', 'code-insiders.cmd']);
		if (localCli) {
			const installRoot = path.dirname(path.dirname(localCli));
			const localExe = path.join(installRoot, 'Code.exe');
			if (await fileExists(localExe)) {
				return localExe;
			}
		}
	}

	const testVersion = process.env.VSCODE_TEST_VERSION;
	return testVersion === undefined
		? downloadAndUnzipVSCode()
		: downloadAndUnzipVSCode({ version: testVersion });
}

async function main(): Promise<void> {
	try {
		// Inherited from an editor's extension-host shell this variable makes
		// the spawned Code.exe run as plain Node.js, which rejects the
		// extension-test flags ("bad option: --extensionTestsPath").
		delete process.env.ELECTRON_RUN_AS_NODE;

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
