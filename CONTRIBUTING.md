# Contributing to Chat Commit

Thank you for your interest in contributing! This document covers how to set up the dev environment, run tests, and submit changes.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [VS Code](https://code.visualstudio.com/) 1.93.0+
- GitHub Copilot extension installed and signed in (for manual testing)

## Dev Setup

```bash
git clone https://github.com/your-username/chat-commit.git
cd chat-commit
npm install
```

Open the project in VS Code:

```bash
code .
```

Press `F5` to launch the **Extension Development Host** — a new VS Code window with the extension loaded.

## Build

```bash
# Compile (development, with watch)
npm run watch

# Bundle for production
npm run package
```

## Tests

```bash
# Unit tests (no VS Code needed)
npm run compile-tests
npm test
```

Integration tests run inside the VS Code extension host — use the **Extension Tests** launch configuration in `.vscode/launch.json`.

## Code Style

- **TypeScript strict mode** — all strict checks enabled
- **ESLint** — run `npm run lint` before committing
- No `any` types without justification
- Use `void` operator for intentionally-ignored promise returns

## Submitting Changes

1. Fork the repository and create a feature branch from `main`
2. Make your changes with tests
3. Run `npm run lint` and `npm test` — both must pass
4. Update `CHANGELOG.md` under the `[Unreleased]` section
5. Open a pull request against `main` using the PR template

## Reporting Issues

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) when filing a bug. Include your VS Code version, the extension version, and steps to reproduce.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.
