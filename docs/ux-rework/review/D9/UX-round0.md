# D9 UX independent audit, round 0

**PASS — no blocker or major findings in the initial cleanup.**

Reviewed `feat/ux-rework-p4-ui-test-cleanup` at `bf61562a0eaf5c09d749a9701331e57b6fb2dcf7` against predecessor `68998602a74b7c8bad7801d5401ec7236da71aae`. Product/test state is frozen at `e143cca2071b007005f2d231901721203de83f7a`; the difference from that state to the reviewed head is the eight-line root evidence addition only. Worktree was clean when inspected. I authored none of the assessed tests or implementation.

This verdict accepts the initial implemented cleanup, not final D9 release completion. Later theme/D10/D7 integration, first-visit and subsequent test additions, exact-head CI and final phase-end reviews remain open as specified.

## Method and limits

Read ORCHESTRATOR, PLAN owner D9 requirement, the active D9 spec including its explicit two-export allowance, all initial cleanup hunks, current surviving assertions and relevant implementation, and the D9 inventory/decisions/evidence. Read the original independent audit and historical attribution, including mixed-file and migrated-filter traps, plus the later-provider source-bound decisions. Inspected root gate/benchmark receipts and independent repeat results.

This was read-only inspection: no repository edits, Git mutation, tests, builds, servers, browser or capture operation. Only this requested report was written under `/tmp`. Root execution evidence is identified as root evidence, not an independent test execution by this auditor.

The diff is bounded to 23 UI test files, the D9 records/spec, and removal of exactly two `export` keywords: `clock-generator-ui/src/theme/tokens.ts:27` and `clock-generator-ui/src/components/WakeWindowsChart.tsx:388`. Neither declaration's value, type, use or runtime behavior changes. No engine test, dependency, runner, configuration, exclusion, capture or unrelated production modification occurs.

## Owner intent and finding closure

Owner D9 B requires actual independently justified cleanup of UX-added UI tests while preserving meaningful player behavior. **Fixed for the assessed milestone:** the branch contains real removals/consolidations, not only a report; each C01–C24 has a behavior/overlap rationale and named survivor. The diff follows those rationales rather than a deletion quota. Executed tests fall 1305 → 1248 while all 81 files remain.

**Partly complete for the release-wide requirement:** `docs/ux-rework/review/D9/INVENTORY.md:121` explicitly leaves the final reachable theme/D10/D7 and subsequent changes open. That is the correct closure state. Do not mark owner D9 fully complete until the final source-bound refresh, reviewed implementation and feature inclusion are done. This is an acknowledged later gate, not a blocker or major against the bounded initial diff.

The six-file pre-rework baseline is distinguished from later UX authorship using the plan's pre-product parent, not today's master merge-base. The four mixed files retain protected declarations; the actual removals in edits/formConfig are separately attributed additions. The old filterSlots coverage is traced into inserterFilters, and its unique outcomes are transferred. No pre-existing or unrelated upstream test is removed by this diff.

## Consolidation assessment

Paths below are relative to the repository. Line references name a current survivor unless explicitly described as a removed hunk.

| Group | Current protection and UX assessment |
|---|---|
| C01 | `clock-generator-ui/src/hooks/useCopyBlueprint.test.ts:122`: one request → identity replacement → late resolution scenario preserves all callbacks/state assertions. The three old labels never changed input behavior. Failure snapshots, stale confirmation, newer requests, unmount and timers remain separate. |
| C02 | `clock-generator-ui/src/hooks/usePersistedConfigForm.test.ts:99`: exact 0.0625, 0.0001 and 1/3 serialization/read/export values and roundtrip byte equality survive. Six-inserter omission/value distinctions and regenerated UUIDs run once. Serializer/mapping do not branch metadata on Copies; reducing their cross-product is justified. |
| C03 | `clock-generator-ui/src/theme/contrast.test.ts:5`: black/white/self/symmetry, AA threshold neighbors, alpha and parser checks remain. Historical palette-note numbers add no distinct player contract beyond actual AA pair checks. |
| C04 | `clock-generator-ui/src/theme/theme.test.ts:44`: overlay removal remains because it affects measured contrast. Removed radius literals pin styling values; actual palette/AA and focus guards remain. |
| C05 | `clock-generator-ui/src/theme/tokens.test.ts:8`: every real pair still meets AA; surface/role/control/focus completeness remains. Six-digit hex spelling is not an accessibility requirement. |
| C06 | `clock-generator-ui/src/utils/a11yLabels.test.ts:13`: literal owning-row, select, recipe, lane, filter and help outputs replace a cross-product of simple interpolations. `utils/entityLabel.test.ts` still owns all entity kinds. The nonempty constant dictionary smoke did not prove rendered control naming. |
| C07 | `clock-generator-ui/src/utils/checkErrorText.test.ts:6`: exact translated sentence already excludes obsolete wording; unknown/empty passthrough remains. |
| C08 | `clock-generator-ui/src/utils/checkThenGenerate.test.ts:108`: startsRun still covers all seven decision kinds. Source-state precedence, exact chip labels/visibility and PendingChecks races remain. Removing identical classifications and a duplicate constant expectation is justified. |
| C09 | `clock-generator-ui/src/utils/clockSummary.test.ts:196`: supported precise fraction and both sides of one remain, with unchanged total-rate/per-copy wake-up assertions. Exact-one/integer scope and startup/recovery distinctions remain outside this trim. |
| C10 | `clock-generator-ui/src/utils/configForm/edits.test.ts:374`: all-kind remove/reorder checks retain UUID order, contiguous IDs, same-entity references and lanes; at :382 the exact remaining Infinity chest payload/type is transferred. Removed machine/chest subset scenarios are subsumed. |
| C11 | `clock-generator-ui/src/utils/enableControlDraft.test.ts:93`: untouched undefined/ALWAYS/inverted CLOCKED/CONDITIONAL retain distinct structures. Dedicated save, changeback, half-typed and override ownership checks still cover AUTO/NEVER/normal CLOCKED behavior. |
| C12 | `clock-generator-ui/src/utils/firstProblem.test.ts:56`: direct field failures, machine recipes, coverage, order/capacity and focus targets remain. Removing a copied obsolete canGenerate implementation avoids a second oracle with no unique contract. |
| C13 | `clock-generator-ui/src/utils/headerOverlap.test.ts:7`: remaining true case already straddles the header; below-header, above-window and exact edge remain. No focus boundary disappears. |
| C14 | `clock-generator-ui/src/utils/inserterFilters.test.ts:4`: both consolidated groups preserve append-at-length, empty explicit fallback, inferred-ignore, clear-second, last inferred removal and second explicit removal, now asserting becameExplicit as well. Nonmutation and compaction remain. |
| C15 | `clock-generator-ui/src/utils/introCard.test.ts:27`: five literal fresh/dismissed/manual/populated/forced policies supersede copied Boolean formula enumeration. Blank-build detection and blocked-storage behavior survive. First-visit provider refresh remains open. |
| C16 | `clock-generator-ui/src/utils/nextStep.test.ts:16`: five exact decision/precedence cases retain Configure Copy, Results card/fallback, stale/running/problems and absent blueprint behavior. The removed enum-membership loop supplied no stronger outcome for those states. |
| C17 | `clock-generator-ui/src/utils/ruleTemplates.test.ts:65`: automatic bulk/fast and explicit override composition remain; direct defaultAmount and inserterMetadata cases retain default/missing/unsupported capacity. Template shape/schema/endpoints remain untouched. |
| C18 | `clock-generator-ui/src/utils/shareLink.test.ts:225`: all three Copies classes traverse actual encode/decode/file/worker/export. Exact Copies, strict schema result and source nonmutation remain for each; full metadata matrix runs once. Compression/version/size/stream/Unicode and malformed worker rejection remain. |
| C19 | `clock-generator-ui/src/utils/timelineGeometry.test.ts:29`: production layer ordering and exact DPR1/2 snapped outputs remain, with minimum/edge geometry. Removed native-sort demonstration and repeated width3 expectation do not add player protection. |
| C20 | `clock-generator-ui/src/utils/wakeWindowCopy.test.ts:204`: definitions and dynamic row/window/watch narration remain. `utils/glossary.test.ts:38` retains factual wake-up linkage. Removed component filename/literal scanning enforced copy placement, not factual/help output behavior. |
| C21 | `clock-generator-ui/src/utils/wakeWindows.test.ts:333`: five distinct scale/fractional/small-period pairs retain all per-pair assertions; :345 retains four exact finest-step outputs. Geometry, slack, modes, pointer and keyboard cases remain unchanged. |
| C22 | `clock-generator-ui/src/worker/formConfig.test.ts:108`: supported decimal and two unsupported editable fractions retain save/worker/file preservation plus strict-schema classification. One metadata check is enough for this independent refinement; fallback implementation returns original config and mapping is separately covered. |
| C23 | `clock-generator-ui/src/worker/formConfig.test.ts:141`: malformed entities remain rejected for 1, 0.0001 and 1/3, including exactly the removed broken-machines input. Missing machines, fractional IDs, malformed endpoints/quality and exact custom path/message guard at :127 remain. |
| C24 | `clock-generator-ui/src/worker/installFacts.test.ts:37`: grouped ascending fixture already proves merged membership and group separation. Empty/no-schedule, nonmutation, drill fallback and structuredClone behavior remain. |

## Preserved player contracts

Accessibility protection is retained in actual AA pair/completeness tables and actual theme fill/alert/focus assertions, not inferred from removed styling or spelling literals. Owning row/filter/lane/help labels retain independent literal expectations. Focus-overlap edge cases, keyboard routing, manual dialog focus, row-focus recovery, announcements, and the glossary factual/provisional linkage are untouched or directly preserved. Product copy, glossary and visual interaction behavior do not change.

Race/cancellation/freshness, result assumption ownership, Undo and whole-build snapshots, library conflicts/recovery, cache/store eviction and lean storage remain outside the deletion targets. The cleanup does not collapse pure helper coverage into hook/component coverage or remove the latter on the basis of apparent overlap. Fractional/precision/unit scope and malformed-data policies retain real boundaries. Metadata matrix repetition is removed only across unrelated Copies values; actual omission-versus-explicit values, UUID regeneration and transport behavior survive.

## Evidence and claims

Read `/tmp/ux-p4-d9-checks-r1/SOURCE.json`, `RESULTS.json`, `BENCHMARK.json` and `/tmp/ux-p4-d9-repeat-r1/RESULTS.json`. Root receipts pin after source `e143cca...`, a clean verifier and its own engine dependency. Full UI test/lint/default knip/icons/build and independent test/build repeat have exit zero. Initial knip failure is retained and resolved through the spec-authorized visibility changes rather than waived.

BENCHMARK binds before `6899860...` and after `e143cca...`, lists all 412 byte-identical emitted production files, and records 1305/81 versus 1248/81. Its same-command local pair is 4.612s versus 2.672s wall time after installs/builds/gates, with no cache flush and one measured run each. `EVIDENCE.md:39` states those qualifications and explicitly disclaims a runtime or CI guarantee; CI comparison is unavailable. There is no human usability claim or claim that case removal alone proves faster CI.

No new product screenshots are needed for this bounded cleanup: source inspection finds only the two allowed declaration visibility changes outside tests/docs, and root provides production asset identity. Existing final fresh phase captures and all three phase-end reviewers remain required. This audit supplies no fresh browser PASS.

## Findings and required action

Blocker: none. Major: none. No fix round is required for this initial diff.

Before final owner feature→master approval, retain the acknowledged final reconciliation gate: inspect actual merged theme/D10/D7/first-visit and later test deltas, preserve C04/C05 across theme integration, update source-bound D9 evidence and obtain exact-head CI/final required reviews. These are existing release requirements and do not change this initial PASS.
