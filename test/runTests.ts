import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
		const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
		const testVersion = process.env.VSCODE_TEST_VERSION ?? (process.platform === 'win32' ? 'insiders' : undefined);

		await runTests({
			...(testVersion === undefined ? {} : { version: testVersion }),
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-updates'],
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
