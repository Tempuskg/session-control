# Independent verification of adjusted triage — 2026-11-15

Owner: `card-mwhqmgjl-1`. Verification is **incomplete**. The missing-input
configuration gap is repaired; a successful end-to-end verifier receipt is still
blocked by repository test execution. No production implementation changed.

## Supported installed contract

Inspected the installed `darrenjmcleod.mwnn-kanban` 1.0.15 bundle at
`C:/Users/darre/.vscode/extensions/darrenjmcleod.mwnn-kanban-1.0.15/dist/extension.js`.
SHA-256: `f6b8ee9d9368a22f008349911e11abfe41d1c605b80d3b690711e9df61132b14`.
Its internal module 9125 exports `parseVerificationProfile`, `criterionTexts`,
`createOutcomeEvidenceFactory`, and `snapshotRevision`. `verify-profile.cjs`
loads that actual module in memory without extension activation or installed-file
edits. This inspection is version-specific and fails closed if the bundle changes.

- Profile JSON requires `version: 1`. `commands` is an optional nonempty array of
  `{id, command, args?, cwd?}`; ids must be unique. `cwd` must stay project-relative.
- `criteria` entries use exact **checkbox text**, not card ids or ordinal numbers:
  `{text, checks, human?}`. `checks` must reference known command ids. Duplicated
  criterion text is rejected. `human: true` cannot produce automated completion.
- `defaultChecks` may cover unmapped criteria. This profile supplies explicit
  mappings for all 13 original criteria and the follow-up's 3 criteria (16 total).
  Default checks are retained for other cards; they are not evidence of their
  substantive acceptance. There is no claim to verify other board work.
- With custom commands, the factory runs **every command in array order**, not
  only those selected by the current card. It checks command success and stable
  requirements/profile/scripts/instructions/repository snapshots before receipt
  persistence. The npm adapter invokes the installed npm JS entry directly to
  preserve Windows arguments without shell quoting.
- `focusedTests` is incompatible with custom commands. The built-in focused-test
  path invokes plain `node --test`, which repository guidance prohibits; this
  profile uses offline CJS checks plus the supported `npm test` host instead.

The loop generated an empty-criteria profile at this card's dispatch. The new
profile parses using the installed parser and all 16 exact mappings resolve.
Changing a profile after dispatch invalidates the loop's frozen inputs; a fresh
dispatch must capture the final profile. An offline parser/factory check is not
a forged live-loop receipt. No receipt was produced by the failed factory run.

## Per-criterion evidence

`verification-2026-11-15.json` contains dated, detailed offline results for every
original criterion. Offline evidence checks pass 13/13. The full verdict for
payload criterion 2 remains **failed/unverified** because its separately mapped
repository test command fails. Do not read the offline source/fixture check as a
passing repository test run.

| Card | Criterion | Independent result |
| --- | --- | --- |
| accounting `card-mvq03qy7-1` | 1 | Tokenizer counts, provider-reported usage, estimates and unavailable/null billed amounts remain distinct. |
| accounting | 2 | Independently summed all analysis/synthesis calls and applied recorded USD rates; TypeSafe usage included; unavailable cache/retry/billing prevents verified totals/savings. |
| accounting | 3 | Existing missing-usage/arithmetic/decision-preservation regression suite passes in a scratch copy, including two recomputations and history creation. Originals remain untouched. |
| accounting | 4 | Precise historical usage/billing export requirements retained in cost-evidence.md; adjusted invoices also absent. |
| payload `card-mvq03qy7-2` | 1 | Current-source scratch build reproduces every payload measurement row and reduction: fixture 187002→81376 (56.48%), production-shaped 92042→66633 (27.61%), isolated adapter 39.94%. |
| payload | 2 | Source tests cover evidence/disabled/error/versioned cache behavior. Compile-tests, compile and lint pass; full host run is **698 passing / 25 failing**, with local HTTP fetch failures. Required green validation is not established. |
| payload | 3 | Original v1 artifacts retained; production and prepared files identify analysis-triage-v2 / triage-payload-v2 and threshold 0.7. |
| payload | 4 | Preparation is versioned and live evidence separate; synthetic sizes do not establish recall or money saved. |
| re-evaluation `card-mvq03qy7-3` | 1 | Three complete pairs alternate baseline→triage, triage→baseline, baseline→triage. Checked all 44 fixture bytes/fingerprints, aggregate hash and labels, all 132 successful judgment records, matching configs and runtime identities. |
| re-evaluation | 2 | Per-call tokenizer sums, TypeSafe record sums, per-arm E2E and recorded aggregates reconcile. Pair 3's analysis E2E explicitly uses pair 1's 1246.4522 ms triage overhead. |
| re-evaluation | 3 | Raw trivial probabilities recompute 16/16 at 0.7 in original and all adjusted repetitions; no misses/fallbacks; same five negatives skipped. |
| re-evaluation | 4 | Recomputed synthesis lengths and cited-session counts (27→22, 23→20, 22→19). Human accepted changed themes, reduced coverage and the false all-44 coverage claim. Those remain limits, not semantic-equivalence evidence. |
| re-evaluation | 5 | Full saved summary reproduces in memory except generatedAt, including accounting/quality/negative outcomes. JSON and referenced files parse. |

Historical identities: session-control 1.12.1; prompt 5; 48000-character budget;
OpenAI: GPT-6.1 Sol, `openai/gpt-6.1-sol`, vendor `openrouter`, provider version
`1.0.0` (not a model-weight snapshot); configured `jev-latest`, returned
`jev-1.14.0`; SDK range `^0.6.0`; recorded Node v24.22.1. Current workspace
validation uses package 1.13.1 and runner Node v24.21.0; it does not retroactively
identify the evaluated build as the current build.

Cache labels describe procedure only. TypeSafe repeats never read the local
judgment cache. Cold/warm labels do not establish provider cache usage. The third
standalone triage repetition exists, but the third analysis pair references the
first triage run. Cross-arm report semantic equivalence remains unmeasured.
No current tariff, provider invoice or monetary-savings claim is verified.

## Commands and remaining gap

- `node --check .mwnn/triage-benchmark/verify-adjusted.cjs` — pass.
- `node --check .mwnn/triage-benchmark/verify-profile.cjs` — pass.
- `node .mwnn/triage-benchmark/verify-adjusted.cjs all` — 13/13 offline checks pass.
- `npm run compile-tests`, `npm run compile`, `npm run lint` — pass.
- `node .mwnn/triage-benchmark/verify-profile.cjs` — installed parser accepts
  configuration; real factory passes compilation and all three evidence groups,
  then refuses completion when `npm test` cannot start the installed Code host.
  Exact logs: `verification-profile-2026-11-15T11-26-56-143Z.json`.
- Installed Code host failure: `EPERM` changing into
  `d:/Users/darre/AppData/Local/Programs/Microsoft VS Code`; Electron reports
  AppContainer ACL denial. No ACL or installation permissions were changed.
- A different, already cached host was tried with
  `$env:VSCODE_EXECUTABLE_PATH = 'E:\chat-commit\.vscode-test\vscode-win32-x64-archive-1.139.1\Code.exe'; npm test`.
  It successfully executed tests: **698 passing, 25 failing**, exit 1.
  Failures occur in TypeSafe API-key, consent, judgment-service and spike local
  HTTP tests; requests report `Connection error: fetch failed` instead of reaching
  expected test-server responses. This is consistent with the restricted network
  environment, but that cause is an inference, not proof that every failure is
  environmental. The 25 failures are not waived or changed to passes.
- Scoped `git diff --check` — pass.

Recovery: run `node .mwnn/triage-benchmark/verify-profile.cjs` in an environment
where a supported VS Code test host and local HTTP fixture servers are accessible;
use `VSCODE_EXECUTABLE_PATH` if needed. Resolve any remaining real test failures.
Then obtain a valid fresh-input outcome and redispatch the loop with the final
profile. No fresh external model evaluation or expanded data scope is necessary.

The original three Done cards retain their columns, checklists and completion /
handoff-failure logs; appended evidence does not erase the failures. Product
sign-off and its results annotations are preserved. The follow-up remains
incomplete until the test/verifier gap is resolved.

## Resolution — 2026-11-15

The remaining validation gap is resolved. Fresh installed-verifier run at 2026-11-15T11:35:59.869Z passed all eight configured commands and returned valid=true and revalidatedBeforeExport=true. Receipt and full command output: verification-profile-2026-11-15T11-35-59-869Z.json. Dated per-criterion final results: verification-resolution-2026-11-15.json (13/13 pass; all 16 mappings resolve). Payload criterion 2 now includes green compile-tests, compile, repository-tests and lint results.

The restricted sandbox reproduced 698 passing / 25 failing tests in verification-profile-2026-11-15T11-35-07-630Z.json. The same command and cached host outside that sandbox passed 723/723, supporting sandbox restrictions as the cause of the observed failures; no source or test changes were needed. Exact successful command: $env:VSCODE_EXECUTABLE_PATH = 'E:\chat-commit\.vscode-test\vscode-win32-x64-archive-1.139.1\Code.exe'; node .mwnn/triage-benchmark/verify-profile.cjs (require_escalated). Installed-host ACLs were not changed.

The missing-input defect is repaired and independent verification is complete. Historical incomplete/failed entries above remain history. Original measurements, human decisions and product sign-off are unchanged. Billing and semantic equivalence remain unverified; accepted cache, reused-overhead and report-quality limits still apply. No fresh external evaluation or publication occurred. The successful exported receipt covers the captured revision before export; appending this evidence changes the repository digest. It is not a receipt for the old frozen live-loop dispatch: redispatch must capture final inputs, using the accessible cached host outside the restricted sandbox.
