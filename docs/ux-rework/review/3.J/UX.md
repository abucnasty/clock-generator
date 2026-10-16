# Independent UX review — Phase 3.J result copy

**Verdict: PASS for this bounded minor-copy child. No blocker or major UX findings.**

Reviewed product `bca47c8d666178f37f8dbb9334e1379812ef9e3a` from immutable `/tmp/ux-phase3-result-copy-verifier`, against `/tmp/ux-phase3-result-copy-review/DIFF.patch` and finalized `/tmp/ux-p3-integration/docs/ux-rework/specs/3.J-result-copy.md`. This is an independent UX assessment of the small copy change, not engine/rate implementation approval or approval to merge the feature to master.

## Method and boundaries

I read the brief, complete supplied diff and spec; inspected the two changed product utilities, the reused test cases and established number formatter; followed the unchanged render/source consumers in App, BeltAssumptionLine, ResultSummaryCard, ResultsWorkspace and FuelPanel; read current targeted native ARIA and evidence indexes; and opened the actual before/after PNGs listed below. I waited for the standing-selection evidence to be complete and inspected its actual index, PNG, ARIA and CURRENT-COPY.json before issuing this verdict.

Source and existing evidence remained read-only. I ran no Git, npm, browser automation or product writes, added no tests, and read no other current independent reviewer report. The sole write is this requested report artifact.

## Belt wording and selected-clock condition

The new sentence accurately describes a historical setting: “This run used your Moving belt setting.” It no longer attributes the moving-belt assumption to every generated alternative. The analogous Standing sentence uses the exact established setting label. This is a useful, bounded correction of the conflicting old prose.

The source still derives the line from `generatedFor?.beltQuestion`, passes that saved assumption to BeltAssumptionLine, and renders its text as persistent body prose. Alternative selection does not replace that source with the selected clock or the currently edited form. The two labels and corresponding `switchTo` actions are unchanged. No ranking, simulation, settings, export or source snapshot logic appears in the diff.

The current native standing case is the decisive mismatch evidence:

- `/tmp/ux-phase3-result-copy-native-standing/INDEX.md`: 23 PASS, 0 FAIL, 0 failed steps, including real SMALL worker completion, native standing-only radio selection and unchanged exact build RAW.
- `/tmp/ux-phase3-result-copy-native-standing/w720/01-standing-alternative-saved-moving-setting-720.png`: I opened it. The **Standing still** selected-clock tile and **This run used your Moving belt setting.** sentence are both visibly present. The action remains adjacent and readable.
- The matching `.aria.yml` independently contains the selected heading “For belts that stand still,” the explanatory paragraph that this clock is made for standing belts, the Standing still fact, the saved Moving sentence, and the checked standing-only radio. CURRENT-COPY.json records that same full card text with `selectedStanding: true` and `rawUnchanged: true`.

This screenshot is a bounded viewport observation: the top of the long card lies above the sticky header. I do not treat it as focus proof or claim that it depicts the entire card. Its visible tile/sentence pairing plus the complete ARIA and recorded actual card text establish the copy context requested by 3.J.

I also opened the preceding `/tmp/ux-phase3-end-final-r16-four/w720/89-generation-cancelled-720.png`: it shows a Standing still clock alongside the old assertion that the clocks assume moving belts. The new wording resolves that contradiction. The current `/tmp/ux-phase3-result-copy-native-belt/w720/02-generation-cancelled-720.png` visibly preserves the saved Moving sentence and the independent non-recovery warning. Its selected clock happens to be Moving; I do not count that cancellation image as proof of the standing mismatch. The separate standing case supplies that proof. The cancellation index reports 61 PASS, 0 FAIL, 0 failed steps and preserved kept clocks/RAW after a fresh Check.

## Fuel readability, units and accessible prose

The real observed floating-point tail is now presented as **82.094 items burned**, with one inline **(fuel amounts rounded for display)** qualifier. I opened both:

- Before: `/tmp/ux-phase3-end-final-r16-four/w720/85-fuel-events-and-trace-text-720-part5of6.png`.
- After: `/tmp/ux-phase3-result-copy-native-fuel/w720/03-fuel-events-and-trace-text-720-part5of6.png`.

The after image plainly shows the shorter quantity and qualifier, with the paragraph wrapping inside the existing content width. This adds one line in the observed summary, but does not create a new helper block, warning panel or reserved form-helper space. Fuel events remains immediately below the persistent descriptions. There is no blocker or major readability regression.

The matching current ARIA presents the same paragraph: 1920 ticks; start 1.43 items; end 15.34 items; minimum 0.76 items; maximum 24.5 items; 96 items inserted; 82.094 items burned with the rounding qualifier; and 0 ticks with no fuel. Quantities retain their items units, while run duration and empty ticks remain clearly tick counts. The qualifier scopes rounding to fuel amounts; it does not claim the counts or event timings are rounded.

All six continuous summary amounts call the established `formatNumberText` with `maxDecimals: 3`. Its existing small-nonzero branch remains intact, so a tiny positive quantity is not displayed as zero. Existing numberText cases already cover the tiny-value behavior and the half-step boundary. The summary test reuses the existing case with the meaningful observed `82.09359999999995` input; no new test file, permutation matrix or framework is introduced.

FuelPanel still renders `fuelTraceSummary` in the same visible Typography paragraph with an id referenced by the Fuel level chart's `aria-describedby`. This retains the persistent visual and accessible equivalent; it is not relegated to hover text. The summary helper only formats its returned text and does not modify its input. Exact duration, empty tick count, first-empty tick zero and sampled-interval wording remain outside quantity formatting. The code continues to state that sampled bins are not exact empty-interval boundaries. The current zero-empty real run cannot independently exercise the nonzero empty-bin branch; preserved source and existing relevant assertions cover that unchanged behavior.

Event rows still expose their original amount/start/end fields; FuelPanel still prints `event.amount`, `event.startTick` and `event.endTick` directly. The targeted Fuel index reports **108 PASS, 0 FAIL, 0 failed steps**, including exact equivalents for all six real events. The visible event table matches the prior values in the inspected image region (for example 1–12, 385–396 and 577–588, each 16 items). Nothing in this change rounds event quantities or changes event/interval semantics. Existing non-recovery and stopped-run cautions are independently preserved in the inspected cancellation UI.

## Scope, capture consumers and verification evidence

The supplied diff contains exactly two product utilities, two reused UI test files and two capture consumers. Capture expected prose is reconciled to the new sentence: the belt script's exact strings and stale-banner exclusion use the new saved-run wording; the results-answer predicate still requires either the established selected-clock belt line or one of the two precise saved-run sentences. The changes do not loosen this to an arbitrary truthy or generic text check. No preserved historical runtime or evidence artifact is modified by the supplied diff.

I inspected the gate result records and logs as evidence, without rerunning commands in this review:

- Author gates: test, lint, default knip, check:icons and build all exited 0, with own engine install/build and data copy recorded.
- Independent root repeat: separate UI/engine install, own engine build, data copy, test and build all exited 0.
- Both test logs record **1295 tests in 80 files**, all passed.
- Both SOURCE.json records identify product `bca47c8`, identical UI/engine tree ids and identical 412-asset manifests, with 11 JSON assets each.
- Root `repeat/PREVIEW-IDENTITY.json` identifies the same product at the separate 5311 preview, `sameOwnEngine: true`, all 412 actual HTTP assets exact, and the precise four-UI-file delta from preceding product `21261c5`.

The preceding full r16 broad/supplement captures and fresh A/B/C reviews remain preceding-source evidence. The current-source evidence used here is the bounded Fuel, Cancel and standing-selection material above, not a fresh whole broad matrix. This is consistent with ORCHESTRATOR.md's minors-only provision at line 135 and finalized 3.J acceptance. The inherited runtime metadata's generic “Fresh broad integration” scope text is not treated as evidence of a current full sweep; actual indexes and configured 720px scope control the claims in this review.

## Remaining process requirements and limits

No mandatory product fix follows from this UX review. The affected fresh persona rechecks, documentation integration and independent CODE review are separate process steps owned by the root; this report does not substitute for them. No new broad capture is requested solely for these minor prose changes.

D9 remains a hard requirement **before feature-to-master**: an independent audit **and actual justified cleanup of UX-added UI tests, including later cases**, must occur. Passing existing gates or this bounded copy review does not complete D9, and it is not a request for arbitrary coverage additions.

Pending-Undo's critical interval remains unexercised. Passive 320 chip / 390 Escape baseline parity and busy-state limitations remain explicit and unaffected. This report makes no blanket AA, human-usability, all-width, game-test or engine/rate correctness claim. The standing image is not focus proof, and current targeted evidence does not replace the preserved preceding-source broad workflow evidence.
