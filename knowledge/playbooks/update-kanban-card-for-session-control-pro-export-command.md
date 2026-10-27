---
type: Playbook
title: Update Kanban Card for Session Control Pro Export Command
description: Steps to update a Kanban card after implementing a new export command.
tags: [kanban, playbook, session-control, export, pro]
timestamp: "2026-10-23T11:38:39.465Z"
source_sessions:
  - /sessions/1bff48ed-e135-435c-9bae-7e0e5bfe3425.md
source_commits: [213c52b]
provider: claude-code
confidence: 0.9
harvested_by: session-control-pro@1.9.0+harvest-v1
content_hash: "sha256:6e90339b7dc091a64717359dfea463b8d0aeb4242e6c15650c931e6a820765b8"
---
## Preconditions
- The Kanban card is stored as a markdown file.
- The Pro package is installed and updated to the required version.

## Steps
1. Open the Kanban card markdown file located at `.mwnn/cards/card-mu7hzcrv-1.md`.
2. Review the "## Acceptance criteria" checklist and update each verified `- [ ]` item to `- [x]`.
3. Ensure that the last open criterion is checked, confirming that both the export and harvest commands work from analyzed and unanalyzed rows.
4. Append a summary of the work done under the "Activity" section of the markdown file.
5. Add the exact terminal marker `STATUS: DONE` on its own line in the Activity entry.
6. Save the changes to the markdown file.

## Expected Outcome
The Kanban card is updated with the current status of the acceptance criteria, and the activity log reflects the completion of the tasks with the appropriate status marker.

# Citations
1. [Session 1bff48ed-e135-435c-9bae-7e0e5bfe3425](../sessions/1bff48ed-e135-435c-9bae-7e0e5bfe3425.md)
