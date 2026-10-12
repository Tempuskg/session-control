---
type: Decision
title: Use GitHub Packages for CI-Safe Pro Distribution
description: Publish the Pro package to GitHub Packages so CI installs it without a local sibling-repository dependency.
tags: [github-packages, ci, npm, vscode-extension, pro-distribution]
timestamp: "2026-07-11T17:15:54.619Z"
source_sessions:
  - /sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md
source_commits: []
provider: claude-code
confidence: 0.91
harvested_by: session-control-pro@1.3.5+harvest-v1
content_hash: "sha256:d2a7e1d9a5a924000da9ef32a882fe818cb8da397211a3ae89a5b092bb12cb37"
---
# Context

The `session-control` VS Code extension loads Pro features from `@tempuskg/session-control-pro` at runtime. A local `file:../session-control-pro` dependency created a sibling-repository symlink, causing `vsce package` to fail and making `npm ci` fail in GitHub Actions because the sibling repository is not checked out there.

# Options Considered

- Keep the local `file:` dependency: convenient for development, but unsuitable for CI and VSIX packaging.
- Use `vsce package --no-dependencies`: avoids the immediate packaging error, but does not distribute the Pro package to end users or CI.
- Vendor or bundle the Pro source into the free extension: possible, but would change the intended separate-package distribution model.
- Publish the Pro package to a registry: provides a resolvable dependency for CI and production installs.

# Decision

Publish `@tempuskg/session-control-pro` to GitHub Packages and declare it as a registry dependency of `session-control`. Configure the release workflow to authenticate with the `GH_PACKAGES_TOKEN` repository secret before installing dependencies.

# Consequences

The Pro package can be installed as a registry tarball rather than a local symlink, allowing CI to run `npm ci` and enabling the extension build to resolve the package consistently. The release workflow now depends on valid GitHub Packages credentials, and the package must remain published and accessible to the repository. The package was confirmed live at version `0.1.0` and installed as a real registry directory with resolution and integrity metadata.

# Citations
1. [Session c9ab7444-922e-470c-a7c8-56c3510678cb](../sessions/c9ab7444-922e-470c-a7c8-56c3510678cb.md)
