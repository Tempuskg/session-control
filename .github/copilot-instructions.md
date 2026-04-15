# Copilot Instructions for Session Control

## Project Overview

Session Control is a VS Code extension that saves and resumes GitHub Copilot Chat sessions linked to git commits. It is written in TypeScript, bundled with webpack, and published under the `darrenjmcleod` publisher.

## Language & Build

- TypeScript with **strict mode** (`strict`, `noImplicitAny`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Target: ES2022, module system: Node16.
- Bundled via webpack (`dist/extension.js`). Tests compiled to `dist-test/`.
- Node.js 20+, VS Code engine `^1.93.0`.

## Code Style

- Use ES module syntax (`import`/`export`). Prefer Node.js prefixed imports: `import * as fs from 'node:fs/promises'`.
- Import the vscode API as: `import * as vscode from 'vscode'`.
- No `any` types without justification. Use `void` operator for intentionally-ignored promise returns.
- Follow ESLint rules: `curly`, `eqeqeq`, `no-throw-literal`; `@typescript-eslint/strict` config.
- Import naming: camelCase or PascalCase only.

## Architecture Patterns

- **Factory functions** for module initialization: `createSessionStore()`, `createChatParticipant()`, etc.
- **Dependency injection** via `Deps` interfaces (e.g., `SessionStoreDeps`, `SaveSessionFlowDeps`). Factories accept `overrides: Partial<Deps>` for testing.
- **Discriminated unions** for variant types (e.g., `SavedTurn = RequestTurn | ResponseTurn`).
- **Type guards** for runtime validation (e.g., `isChatSession()`).
- Types centralized in `src/types.ts`; pure utilities in `src/utils.ts`.
- Configuration via `vscode.workspace.getConfiguration('session-control')`.

## File Organization

- `src/` — extension source (one module per domain: `sessionStore`, `sessionReader`, `chatParticipant`, `gitIntegration`, etc.)
- `test/unit/` — unit tests (Node.js built-in test runner: `suite()`, `test()`)
- `test/suite/` — integration tests (VS Code extension host)
- `test/fixtures/` — test fixture files
- `wiki/` — LLM-maintained project wiki (see `AGENTS.md`)
- `raw/` — immutable source documents

## Testing

- Unit tests use the **Node.js built-in test runner** (`node:test`), not Mocha/Jest.
- Test helpers use factory functions (e.g., `createSession()`) to build test data.
- File system tests use `fs.mkdtemp()` with cleanup.
- Run: `npm run compile-tests && npm test`.

## Commands

- `npm run compile` — build the extension
- `npm run compile-tests` — compile tests to `dist-test/`
- `npm test` — run unit tests
- `npm run lint` — ESLint check
- `npm run package` — production bundle

## Commit & PR Conventions

- Commit messages use conventional commit prefixes: `chore:`, `feat:`, `fix:`, `docs:`, `test:`.
- Update `CHANGELOG.md` under the `[Unreleased]` section for user-facing changes.
- Both `npm run lint` and `npm test` must pass before committing.