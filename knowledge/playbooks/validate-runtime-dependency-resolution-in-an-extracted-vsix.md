---
type: Playbook
title: Validate Runtime Dependency Resolution in an Extracted VSIX
description: Verify that a dynamically resolved Pro dependency is present and loadable from the VSIX even when Webpack does not bundle it.
tags: [vsix, dependency-resolution, webpack, vscode-extension, packaging]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.91
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:c1eefb28179087baf2241e1ba1c1b6fa65b378e06c00cddf90717b2a724b8c2c"
---
# Preconditions

- The extension loader resolves `@tempuskg/session-control-pro` through `nodeRequire.resolve(specifier)`, where `specifier` is a runtime variable. Webpack therefore does not bundle the package.
- A VSIX has been built with the Pro package explicitly included under `node_modules/`.
- The package has no transitive dependencies.
- The check can run outside the Extension Host; `vscode` is unavailable there and may produce an expected error.

# Steps

1. Inspect the Webpack module output. Confirm that the Pro package is absent from `dist/extension.js`; its absence is expected for a dynamic module lookup.
2. Extract the VSIX and inspect its installed layout. Confirm that it contains exactly `node_modules/@tempuskg/session-control-pro/package.json` and `node_modules/@tempuskg/session-control-pro/dist/index.js`.
3. Confirm that the extracted package does not include `index.js.map` or stale build artifacts such as `dist/extension.js`.
4. From the extracted extension directory, run the same resolution check used by the loader: `require.resolve('@tempuskg/session-control-pro')`.
5. If resolution fails, adjust `.vscodeignore` so the blanket `node_modules/**` exclusion is negated only for the Pro package and its required files.
6. Run the compile, lint, and unit-test commands after packaging changes.
7. Install the resulting VSIX in VS Code. Confirm that the Command Palette shows `Session Control Pro: Harvest Knowledge to OKF Bundle`, then verify the command with and without a Pro license.

# Expected outcome

The Pro package remains outside the Webpack bundle but is physically available in the extracted VSIX. `require.resolve('@tempuskg/session-control-pro')` succeeds from that layout. A subsequent `Cannot find module 'vscode'` error outside the Extension Host is expected and does not indicate failed Pro-package resolution. Compilation, linting, and tests pass, and the installed extension exposes the corrected command.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
