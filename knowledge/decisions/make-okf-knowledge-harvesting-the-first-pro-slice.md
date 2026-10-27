---
type: Decision
title: Make OKF Knowledge Harvesting the First Pro Slice
description: "Use repo-local OKF knowledge harvesting as the first narrow Pro workflow instead of beginning with a broader search or skills-sync feature."
tags: [okf, knowledge-harvesting, product-strategy, pro-feature, local-first]
timestamp: "2026-07-26T01:23:14.551Z"
source_sessions:
  - /sessions/9d0009f2-dca3-408f-a679-f633dd6ae0b8.md
source_commits:
  - 028655e5f8a39f4ed3f631d22b794f750bef27c5
provider: copilot
confidence: 0.9
harvested_by: session-control-pro-chat-handoff
content_hash: "sha256:d83a4bc41773731eeec16d322d7a2d2dc16d1f48811b2985c29c49f8d6ea15b8"
---
# Make OKF Knowledge Harvesting the First Pro Slice

## Context

The product needed one narrow paid workflow that was differentiated, useful across AI coding assistants, compatible with a local-first privacy position, and able to compound in value as more sessions were saved.

## Options

1. Start with cross-IDE skills synchronization.
2. Start with global cross-repository session search.
3. Analyze saved sessions and produce a portable, repo-local Open Knowledge Format bundle.

## Choice

Use OKF knowledge harvesting as the recommended first Pro slice. Keep reading and using knowledge bundles available to the free extension, while making bundle production the paid capability. The workflow should preview proposed concepts, require confirmation, merge without duplicates, write citation-backed concepts and session summaries, append a run log, and lint the resulting OKF v0.1 bundle.

## Consequences

The first paid feature reinforces the product's multi-assistant positioning and produces portable repository assets rather than a proprietary database. It also introduces model-quality, inference-cost, privacy, merge, and schema-drift risks, so confidence thresholds, local review, secret scanning, and conformance validation are part of the feature rather than optional follow-up work.

# Citations

1. [Monetization sequencing and OKF knowledge harvesting session](../sessions/9d0009f2-dca3-408f-a679-f633dd6ae0b8.md)
