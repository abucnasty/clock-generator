# Phase 3 compatibility adjunct evidence

2026-10-16. Round0 code FIX for missing actual-engine fractional-period refusal evidence; scoped UX PASS. Fix round1 affected capture now passes1140/0/0 at all five widths; code re-review pending. No product defect identified.
Provider #195 is already reviewed/merged; this is the separate Phase3 adjunct. Owner install/phase/final checkpoints remain open.

## Source and scope

- Base phase `8c974cf646bd06005a7b6e2c2e7b41f2d31d8367`; frozen upstream `1d27cde`.
- Full P3A–E captured source `bc4c978bddd51ae14371b64c24d628b90981672c`; fix1 source `beaa980d8074135730fc7c5e328746d4ef8fdc13` adds P3F and a foreground M1 shot. UI/engine directories are byte-identical (root git diff verified); earlier adjunct product `237f1f5`, owner helper correction `18167b5`.
- Both actual rule callers use shared effective hand size. Tests exercise real persistence/share/worker boundaries, fractions, invalid drafts and metadata/omission identity. No 3.3 cache code is transplanted.
- Owner requested removing explicit Stack size helper text and its reserved space; shared helper returns undefined for explicit values. Stack size label and Automatic effective-capacity explanation remain. Owner approved the refreshed preview, reserving broader audit for later.
- Phase ancestry merge `fab7ef4` preserved the entire `fa73634` tree exactly (`a7a2a11e632a7f88a7b71f34a957b79748a568bd`); root verified empty diff. Decisions: `/tmp/ux-p3-compatibility-evidence/phase-ancestry-merge.md`.
- Worktree `/tmp/ux-p3-compatibility`; production preview5273. Baseline runtime-current scripts/fixtures byte-match bc4c978: `/tmp/ux-p3-compatibility-evidence/runtime-current/SOURCE.txt` (42 files). Owner preview5280 is an independent snapshot of this build.

## Local and independent verification

Full UI gate on captured source: `/tmp/ux-p3-compatibility-evidence/compact-stack-gate/results.json` and corresponding logs. Manual data copy, tsc, tests, lint, knip, icons and production build all exit0. Tests: **1099 /60 files**. Independent UI test/build repeat also exit0; logs `independent-ui-test.log` and `independent-ui-build.log` in the same directory. Root read actual result lines and successful build completion. Existing chunk advisory remains.

Engine source is unchanged by the latest helper/capture corrections. Fresh merged-phase engine gate: **1008 unit /76 files,142 generation /11 files**, build/lint/knip all exit0; logs `/tmp/ux-upstream-194-evidence/p3-provider-gate`. Adjunct full and post-conflict gates also pass these commands: `/tmp/ux-p3-compatibility-evidence/{final-gate,post-phase-gate}`. UI resolves this worktree's own engine. No in-game harness pass is claimed.

## Production browser verification

All final commands are unfiltered except the explicitly focused helper/repair runs. Common environment: `BASE_URL=http://127.0.0.1:5273`, `UI_DIR=/tmp/ux-p3-compatibility/clock-generator-ui`, matching `SAMPLES_DIR`, `PHASE3=1`. Scripts run with node from `runtime-current`; output/log root `/tmp/ux-p3-compatibility-evidence/final-browser`.

| Script / scope | Widths | Result | Index / log |
|---|---|---|---|
| capture-upstream-compatibility.mjs, full P3A–E atbc4c978 |1440/960/800/720/390|**19838 PASS,0 FAIL,0 failed steps; exit0**|core-final/INDEX.md; core-final.log|
| capture-rate-limit.mjs |1440/720/390|156/0/0; exit0|rate-final/INDEX.md; rate-final.log|
| capture-first-visit.mjs, GEN_EACH unset |1440/720/390|1093/0/0; exit0|first-visit-final/INDEX.md; first-visit-final.log|
| capture-results-answer.mjs |1440/720/390|790/0/0; exit0|results-final/INDEX.md; results-final.log|
| capture-build-library.mjs, full |1440/720/390|1104/0/0; exit0|library/INDEX.md; library.log|
| M1/M2/G1 focused helper/geometry |1440/960/800/720/390|1483/0/0; exit0|compact-stack/INDEX.md; compact-stack.log|
| repaired old-core P3 +P3C affected states |1440/960/800/720/390|3210/0/0; exit0|repaired-affected/INDEX.md; repaired-affected.log|
| fix1 M1 +genuine P3F atbeaa980 |1440/960/800/720/390|1140/0/0; exit0|fix1-fractional-period-final/INDEX.md; fix1-fractional-period-final.log|

Final core totals3972 each at1440/960/800/720;3950 at390. P3A/B exercise both actual rule editors'24/8/32 defaults, Replace confirmation, clear/live/draft/Cancel/Save semantics. P3C/D cover all supported fractions, stored values and metadata/omission through file, library switching, duplicate, reload, genuine share open, Undo, invalid default/named drafts and rejection boundaries. P3E covers genuine fractional Copies timing, stale Results and current Check without old windows. Actual engine/schema composition also has unit coverage; no mocked capacity claim substitutes for these browser paths.

Library full run used the identical library/share/persistence product before the later explicit-helper-only correction. No library source or selector changed; final current-source core P3C/D repeats the genuine fraction/metadata/Undo boundaries after that correction. Selector selftest with PHASE3 enabled completed ALL PASSED/exit0: `final-selftest.log`; selector map is unchanged by later capture sequencing/helper omission.

All nine examples meet <=60s generation: logistic0.6s, automation0.9s, utility0.5s, chemical2.7s, electromagnetic2.0s, military2.7s, production1.8s, metallurgic11.1s, agriculture13.7s. Actual command arrays/exits for three regression scripts: `regression-results.json`; full/focused commands and outcomes are preserved in root session records and logs.

Root independently opened fresh core screenshots: `w1440/61-p3a-diagram-bulk-auto-template-confirm-1440.png` (amount24), `w720/98-p3c-share-confirm-0.0625-720.png` (exact shared fraction), `w390/100-p3d-default-0.0001-390.png` (retained invalid draft). Also opened focused1440 List Automatic-row state and720 Diagram-reopened explicit7. The1440 List shot does not itself show the below-viewport explicit row; the new fix1 foreground `w1440/02-m1-explicit-stack-no-helper-1440.png` now shows explicit8 with no helper block. Root and UX independently viewed it; root also opened final390/06-p3f-manual-inclusive-rule-390.png. Names, keyboard/focus, short-height dialogs, mouse effects, live announcements, measured contrast and selected axe checks pass in the indexes. Representative ratios: template Open/Use8.35:1, Cancel8.37:1, Repeat every15.72:1. At390 row geometry remains observational; action reachability and player-facing checks remain required.

## Preserved failures and repairs

Initial five-width full run was **16888 PASS,10 FAIL,10 failed steps; exit1**. It remains at `core.log`, `core/`, `source-failed/` and `FAILED-RUN.md`; never relabeled PASS. Two capture sequencing defects were proven from actual product behavior: menu close occurs before worker-validated saved-build switching completes; exporting a file replaces the message and correctly ends Undo. Repair `ae588e8` awaits actual build identity before existing assertions/reload. Repair `4f49728` verifies genuine shared-open Undo before export, then reopens the same real shared build separately to preserve export assertions. All prior assertions remain. Diagnosis: `/tmp/ux-p3-compatibility-evidence/core-p3-switch-diagnosis.md`. Repaired affected and final full runs above passed on matching runtime. No product defect was hidden by these repairs.

## Fix round1 — actual fractional engine period

Code C1 required a genuine engine fractional period, independently of fractional Copies. Added P3F uses the unchanged recorded sample `intermediates/advanced-circuit/advanced-circuit-230.json`, integer Copies3/rate230. Actual same-tree engine probe reports Check826.4347826086956 and selected stable full-hand-subtick550.9565217391304 (=12672/23), with nonempty Inserter1 clock windows; log `fractional-period-engine-probe.log`. Production UI Check and Generate reproduce the non-whole-period explanation. P3F asserts no planned-window import/reference/defaults, refusal of the actual reported fractional Repeat, focused/announced actionable errors and exact saved/reopened manual inclusive1..1. No timing or worker response is mocked. Root read actual per-width/log totals and opened the final390 reopened-rule shot.

Root independent affected command: `PHASE3=1 STEPS='^(M1 |P3F )' node runtime-fix1-final/capture-upstream-compatibility.mjs final-browser/fix1-fractional-period-final` with common environment above, default five widths. All five are228 PASS/0 FAIL/0 failed steps, exit0. Runtime42-file manifest `runtime-fix1-final/SOURCE.txt` byte-matches beaa980. P3A–E bodies/prior assertions and all product source are unchanged, so their complete baseline gate remains valid; this follows the major-fix affected-state capture rule, not a claim that the older19838 count includes P3F. Existing UI/engine gates are for identical product source.

The first fix1 affected run remains FAILED:1106 PASS/0 FAIL/1 failed step, at `fix1-fractional-period.log` and frozen `runtime-fix1`. Only390 timed out reopening the rule after exact manual Save/export had passed. Actual hit-test/full stack proved interactive stale-Results/Check tooltips intercepting Configure. Bounded capture repair moves pointer away, presses Escape and condition-waits shared tooltip detachment before the unchanged real click/reopen assertions; no force click or assertion change. Diagnosis `fix1-tooltip-diagnosis.md`; failed probe/source and author161/0/0 repaired probe remain retained. Final root1140/0/0 supersedes that failed capture outcome without relabeling it.

## Review and limits

Independent code and UX reviewers use GPT-6.1 Sol/high/fast off under the owner's temporary model override; same role independence and gates remain. Reports: `/tmp/ux-p3-compatibility-review/{CODE,UX}-ROUND0.md`. Code C1 records that P3E1920/240 are integer periods and literal550.957 unit tests do not prove the required genuine fractional-period refusal branch. Scoped UX PASS does not close C1. P3F now supplies that real-engine case and its independent five-width affected gate; code round1 acceptance remains pending. Review/fix counters remain explicit. Selected axe rules/canvas exclusions are inherited, not exhaustive WCAG certification or assistive-technology speech testing. Pending2.7B full layout,3.3 cache/chosen-pick/cancel-keep and3.2 editing work remain separately owned with their existing counters. No new dependency/schema/release/CI/settings/sidecar feature or master merge is included.
