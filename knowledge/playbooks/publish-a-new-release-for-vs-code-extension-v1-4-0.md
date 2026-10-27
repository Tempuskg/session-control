---
type: Playbook
title: Publish a new release for VS Code extension v1.4.0
description: Step-by-step guide to publish a new release of a VS Code extension.
tags: [vs-code, release, playbook, extension, publishing]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md
source_commits: [39e612f]
provider: codex
confidence: 0.9
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:8bd184d5a9a48fb9c6fc088549b6ef276254d3057a6dccd48a13b93655f983f2"
---
## Preconditions
- Ensure the working tree is clean and all changes are committed.
- Verify that the release files and changelog are updated.
- Confirm the versioning follows the project's guidelines.

## Steps
1. Check the current version and validate the release candidate.
2. Ensure the release candidate passes all tests, including TypeScript and extension tests.
3. Update the changelog with the new version entry.
4. Build the VSIX package using the `vsce` CLI.
5. Verify that the VSIX does not include any unwanted files.
6. Commit the release candidate changes to the local repository.
7. Push the commit to the `main` branch.
8. Create and push an annotated tag for the new version.
9. Monitor the release workflow for successful publication to both marketplaces.

## Expected Outcome
The VS Code extension version `1.4.0` is successfully published to both the VS Marketplace and Open VSX, with a corresponding GitHub Release created.

# Citations
1. [Session 01a0e2e9-ea29-7252-9185-0931fb366ac8](../sessions/01a0e2e9-ea29-7252-9185-0931fb366ac8.md)
