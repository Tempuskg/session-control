---
type: Decision
title: Ship only Pro package.json and dist/index.js in the VSIX
description: Include only the Pro manifest and compiled entrypoint so runtime resolution works without shipping source maps or unrelated artifacts.
tags: [vsix, vscode-extension, packaging, webpack, runtime-loading]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.95
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:eb4b98f91e6faa0a127a706b4f2dde1e033ab583dd1178443021b0716897b571"
---
# Context

The extension loads `@tempuskg/session-control-pro` through `nodeRequire.resolve(specifier)`, where the module name is a runtime variable. Webpack cannot statically bundle this dynamic lookup, so the Pro package is not included in `dist/extension.js`. The VSIX therefore must contain the package in its installed `node_modules` layout. A blanket `.vscodeignore` rule currently excludes `node_modules/**`.

The Pro package has no transitive dependencies, so only its required runtime files need to be shipped.

# Options considered

1. Rely on Webpack to bundle the Pro package. This does not work because the module specifier is dynamic.
2. Ship the entire Pro package directory. This would include unnecessary files such as source maps and stale build artifacts.
3. Re-include only the package manifest and compiled runtime entrypoint from the ignored `node_modules` tree.

# Decision

Choose option 3. Configure `.vscodeignore` to include only:

- `node_modules/@tempuskg/session-control-pro/package.json`
- `node_modules/@tempuskg/session-control-pro/dist/index.js`

Exclude the Pro source map and stale artifacts, including `index.js.map`, `dist/extension.js`, and its sourcemap.

# Consequences

The installed VSIX can resolve the Pro package using the loader's existing runtime lookup. The package adds only its required compiled code and manifest, without pulling in the other 333 development dependencies. Excluding the sourcemap prevents straightforward de-minification of the private Pro logic.

The resulting VSIX was verified at 2.73 MB, with the expected 51.97 KB `dist/index.js`. Compilation, linting, and tests pass, and resolution succeeds from the extracted VSIX layout. Manual editor installation and verification of licensed and unlicensed behavior remain necessary.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
