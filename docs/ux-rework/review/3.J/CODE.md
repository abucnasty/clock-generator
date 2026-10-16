# Phase 3.J independent code review

Verdict: **PASS**

No blocker, major, minor, or nit findings in the bounded change. This is a source/code verdict; it does not claim that the pending targeted native-image, UX, or affected-persona gates have completed.

| # | Severity | Finding | Evidence | Proposed fix |
| --- | --- | --- | --- | --- |
| — | — | No actionable findings | Source analysis below | — |

## Reviewed identity and boundaries

Reviewed the finalized `/tmp/ux-p3-integration/docs/ux-rework/specs/3.J-result-copy.md`, the review `BRIEF.md` and `DIFF.patch`, and actual source in `/tmp/ux-phase3-result-copy-verifier`. Read-only Git inspection confirms HEAD `bca47c8d666178f37f8dbb9334e1379812ef9e3a`. The six reviewed working files have no difference from HEAD, and the actual diff from `7433d6c` matches the supplied patch: four UI files and two capture consumers, 16 insertions/14 deletions. No additional paths differ in that commit range. The brief separately identifies later documentation integration as root-owned work.

This review used source and saved verification evidence. I did not alter product source, Git state, tests, runtime, browser, or historical evidence; I did not run test/build/capture commands. The only write is this requested report. I did not read current independent UX/persona rechecks or contact other reviewers.

## Saved run and selected clock

The new strings at `clock-generator-ui/src/utils/beltQuestion.ts:26` and `:28` accurately describe the saved run's setting, including the important case where a run for moving belts contains a selected alternative made for standing belts. They no longer assert that every clock shares one belt assumption.

The call path supports that wording: `generatedForOf` takes a fresh belt-question value from the generation config (`src/utils/resultsStaleness.ts:36–42`); `planGenerationRun` records the form config (`src/utils/deeperSearch.ts:48–52`); `runSimulation` publishes that snapshot (`src/hooks/useSimulationWorker.ts:638–645`). `App.tsx:600` reads `generatedFor?.beltQuestion`, and `App.tsx:1157–1163` passes it to `BeltAssumptionLine`. That component selects the copy from `assumption.answer` (`src/components/BeltAssumptionLine.tsx:20–27`), rather than current form state or the selected alternative. Persisted/cancel-restored results retain their generated snapshot through `useSimulationWorker.ts:317–320` and `:349`.

Selected-clock facts remain independent: the card's Belt tile derives from the selected clock's belt label (`src/components/ResultSummaryCard.tsx:152`), and the difference text can retain “It is made for belts that stand still” (`src/utils/clockSummary.ts:206–208`). The compare-table condition and its “Only if your input belts stand still” copy remain unchanged. The alternate-answer label, `switchTo` value, busy guard, focus-preserving mounting, ranking, generation config transformation, and stale-result semantics are unchanged. The existing no-belt fallback remains intact (`ResultSummaryCard.tsx:225–237`).

## Fuel formatting and exact data

`src/utils/fuelAccessibility.ts:43–45` formats exactly the six continuous summary quantities: start, end, minimum, maximum, inserted, and burned. It uses the established `formatNumberText` with `maxDecimals: 3`; no second rounding implementation or value assignment was introduced. For ordinary values this gives at most three fractional digits and removes trailing zeros. The one explicit “fuel amounts rounded for display” qualifier correctly applies to the quantities and avoids claiming numerical exactness.

The unchanged formatter (`src/utils/numberText.ts:50–62`) uses the browser locale via `Intl.NumberFormat`, disables grouping, treats true zero separately, and switches values below half the display unit to two significant digits. Therefore tiny nonzero fuel values retain the established behavior instead of becoming a false zero, including the deliberate more-than-three-decimals exception for tiny values. Existing formatter tests cover rounding boundaries (`numberText.test.ts:32–35`), tiny positive/negative values (`:50–58`), and locale decimal separators (`:66–68`). The changed existing summary case uses the observed `82.09359999999995` input and expects `82.094` in the recorded English test environment (`fuelAccessibility.test.ts:37–39`).

No underlying `FuelLevelSeries` fields are mutated. The interval helper only constructs/merges its own output objects, and the new quantity function returns strings. Duration, empty-tick total, first-empty tick including zero, sampled interval endpoints, and the explicit uncertainty about exact interval boundaries retain their original interpolation/logic (`fuelAccessibility.ts:46–48`). Event mapping still copies `swing.start`, `swing.end`, and `swing.amount` exactly (`:13–22`); the Fuel event table still renders these raw fields (`src/components/FuelPanel.tsx:336–341`).

The persistent visible summary and chart description remain one DOM source: `FuelPanel.tsx:313–316` renders `fuelTraceSummary` with an ID; the chart receives that same ID at `:395` and uses `aria-describedby` at `:204`. There is no separate accessibility-only quantity representation that could drift from visible text.

## Tests, capture consumers, and scope

The two existing tests were edited in place. The belt case continues to check both settings, actions, and switch targets. The Fuel case replaces an uninformative exact-decimal burned fixture with the observed floating-point residue while retaining the complete summary expectation. Existing event-immutability, first-empty-zero, sampled-boundary, and formatter coverage remains. No new case, file, framework, permutation matrix, or coverage-oriented assertion was added. This is proportionate to the specified minor copy change.

`docs/ux-rework/capture/capture-belt-question.mjs:55–56` retains exact expected strings consumed through exact text locators (`:87`); stale-banner selection keeps the existing negative copy exclusion with the new phrase (`:90`). Existing stale/edit/regenerate expectations remain present (`:501–509`). `capture-results-answer.mjs:422` replaces the old generic assumption prefix with both complete allowed saved-run sentences, including the final period; the original fallback belt sentences and surrounding behavioral assertions are retained. These adjustments reconcile the prose without weakening the prior behavior checks. The regex remains a card-text presence assertion as before; this change does not expand that contract.

The actual diff leaves engine, dependencies, lockfiles, CI, versions, settings, layout, timing, and event semantics untouched. No change to owner game-test behavior is involved.

## Verification evidence and remaining gate ownership

Read `/tmp/ux-phase3-result-copy-checks/gates/RESULTS.json` and `repeat/RESULTS.json`: author engine install/build plus UI test/lint/default knip/icon/build commands all exit 0; the independent verifier install/own-engine-build/test/build commands also exit 0. Both saved `test.log` files report **1295 tests / 80 files PASS**. This report accurately attributes those command runs to their saved evidence; I did not rerun them.

Both `SOURCE.json` files identify the same source SHA, UI tree `74bcbf9db4ea3f90f84a1867f061fb831edfbfca`, and engine tree `81e2f2279361387d3141a14e53e147d37288c3d4`, with 412 assets/11 JSON files and distinct corresponding own-engine paths. `repeat/PREVIEW-IDENTITY.json` records source `bca47c8`, own-engine identity, exactly the four UI-file delta from preceding product `21261c5`, 412 actual HTTP asset comparisons, and no failed asset entries. This is saved identity evidence, not a native visual review by this reviewer.

The preceding broad 8002/0/0 and supplement 8043/0/0 evidence remains preceding-source evidence. Under `ORCHESTRATOR.md:135`, this minor-only round needs checks plus targeted changed-state images and affected reviewer rechecks, not a broad matrix rerun solely for prose. At review time the brief explicitly marks current Fuel/belt native captures pending; I have not invented or certified those images. Root and UX must complete/open the actual current-source Fuel summary and standing-only-selection images/ARIA, followed by all three affected fresh-persona rechecks, before treating overall acceptance as complete.

D9 is unchanged and mandatory before `feat/ux-rework` merges to `master`: independent assessment **and implemented justified cleanup** of only UX-added UI tests, including later additions, with preserved meaningful coverage and measured scope reduction. This child PASS neither closes D9 nor defers it past master; its current requirement is explicit in `docs/ux-rework/specs/D9-ui-test-audit.md` and `ORCHESTRATOR.md:87–90`. Pending-Undo critical interval, passive/busy-state limits, and human-usability/blanket-AA limitations are unaffected and are not claimed as newly verified here.
