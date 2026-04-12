import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Mocha from 'mocha';

async function collectTestFiles(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(directory, entry.name);

			if (entry.isDirectory()) {
				return collectTestFiles(fullPath);
			}

			if (entry.isFile() && entry.name.endsWith('.test.js')) {
				return [fullPath];
			}

			return [];
		}),
	);

	return files.flat();
}

export async function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
	});
	// Start at dist-test/test so suite and unit tests are both discovered.
	const testsRoot = path.resolve(__dirname, '..');
	const files = await collectTestFiles(testsRoot);

	for (const file of files) {
		mocha.addFile(file);
	}

	await new Promise<void>((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`));
				return;
			}

			resolve();
		});
	});
}
