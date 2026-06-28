# Session Control Pro

Private Pro feature package scaffold for Session Control.

## Purpose

- Keep paid feature code out of the public `session-control` repository.
- Export a single `registerProFeatures()` entrypoint that the public extension can load when this package is installed.
- Reuse the public boundary contract from `src/pro/contracts.ts` in the main repository when implementing real Pro features.

## Expected Exports

- `dist/index.js` should export `registerProFeatures`.
- `registerProFeatures` receives the public extension's Pro context with:
  - `hasProLicense()`
  - `showUpgradePrompt()`
  - `registerDisposable()`
  - `log()`

## Next Build Step

Implement the first paid command in `src/registerProFeatures.ts`, then publish/install this package in the extension environment so the public boundary can discover it.
