import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
		const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
		const testVersion = process.env.VSCODE_TEST_VERSION ?? (process.platform === 'win32' ? 'insiders' : undefined);
		const downloadedExecutablePath = testVersion === undefined
			? await downloadAndUnzipVSCode()
			: await downloadAndUnzipVSCode({ version: testVersion });
		const vscodeExecutablePath = process.platform === 'win32'
			? path.join(
				path.dirname(downloadedExecutablePath),
				'bin',
				testVersion === 'insiders' ? 'code-insiders.cmd' : 'code.cmd',
			)
			: downloadedExecutablePath;

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
