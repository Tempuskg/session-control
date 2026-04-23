const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

const packageJson = readJson(packageJsonPath);
const nextVersion = bumpPatch(packageJson.version);
packageJson.version = nextVersion;
writeJson(packageJsonPath, packageJson);

if (fs.existsSync(packageLockPath)) {
  const packageLock = readJson(packageLockPath);
  packageLock.version = nextVersion;
  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].version = nextVersion;
  }
  writeJson(packageLockPath, packageLock);
}

const readmePath = path.join(rootDir, 'README.md');
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const updated = readme.replace(
    /img\.shields\.io\/badge\/VS%20Marketplace-v[\d.]+-blue/,
    `img.shields.io/badge/VS%20Marketplace-v${nextVersion}-blue`
  );
  if (updated !== readme) {
    fs.writeFileSync(readmePath, updated, 'utf8');
  }
}

process.stdout.write(`${nextVersion}\n`);
