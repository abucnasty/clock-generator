# UX rework — Phase 2 end issue draft

**DRAFT FOR ORCHESTRATOR AND OWNER REVIEW. No issues have been filed.**

Draft started: **2026-10-16 09:23:16 UTC**. Writer: GPT-6.1 Sol, high reasoning, fast mode off. Read-only source/evidence review; no browser reproduction, tests, clipboard access, repository edits or Git mutations were performed by this writer.

## Status and filing rules

This is the Phase 2 draft required by `ORCHESTRATOR.md` → “Issues found” and `PLAN.md` → “The final PR”, step 0. The orchestrator should review it, integrate the forthcoming Phase 2 personas, update it at Phase 3 end, and remove findings fixed since. The owner reviews/edits/drops/approves the final draft **before** the orchestrator files approved issues in one pass. Proposed labels below are descriptive; confirm existing repository labels before filing.

Source baseline: Phase 2 `29fd922bab24394a17ecc08e952503782d9f5880` (all Phase 2 items merged); Phase 3 `865f460c36b71108e7e9b2d20ef40f13997de836` already contains 3.1, library/share work and merged 3.3. The root is reviewing the combined `83e…` tree separately. An omission on Phase 2 alone is **not** evidence that Phase 3 work is absent. The initial draft preceded the Phase 2 personas. Root’s reconciliation at the end now assigns their actual findings; the earlier candidate entries retain their historical provenance.

“Source-supported” means the cited behavior is visible in the read source, not that this writer reproduced it in a browser. “Historical / reverify” means a ledger/reviewer observation whose current reproduction still needs checking. Reproduction instructions for such entries are a verification recipe, not a claim of a fresh run. Severity is provisional unless explicitly inherited from a review. Owner item identifies a roadmap item or a proposed future home, not a GitHub assignee.

## Evidence index — keep detailed evidence here once

- **L:** `docs/ux-rework/PROGRESS.md`, “Follow-ups” (lines 349–564 at the draft baseline); historical observations are not automatically open bugs. The Phase 1 end synthesis has the deduplicated finding IDs.
- **P1:** `docs/ux-rework/review/phase1-end/SYNTHESIS.md`, section 3, N1–N53. Personas A/B/C and original screenshot references are in the linked reports. `phase1-end/w1440/10-logistic-configure-list-1440-part1of2.png`, `13-diagram-entity-edit-dialog-1440.png`, `14-diagram-inserter-edit-dialog-1440.png` are explicitly referenced by the 3.2 spec.
- **B:** committed `docs/ux-rework/capture/build-card-EVIDENCE.md`, especially “Browser results” and “Review history and next verdicts”. Exact product/capture identity, original failures and repair explanations live there; do not copy the whole narrative into issues. Supplemental final review: `/tmp/ux-build-card-final-evidence/CODE-FINAL.md`.
- **H:** `/tmp/ux-build-card-final-evidence/browser/half-width.log`, matched to `/tmp/ux-capture/out/2.9.log` by `half-width-baseline-comparison.json`. The rerun is **775 PASS / 9 FAIL / 0 failed steps**; 1440/960/800/720 pass. The nine 390 failures comprise one header-height check, seven compact-table observations of the same overflow, and one landmark-region observation. They are not nine distinct product bugs and are not a whole-suite pass.
- **C:** `/tmp/ux-cancel-keep-final/EVIDENCE.md`, latest “formal fixround2” and “Cheap capture-minor closure” sections. 3.3 merged as #197 / `865f460`; final CODE round2 PASS and UX round1 PASS. This closes worker startup/crash recovery and the genuine nonrecommended-pick evidence gap; earlier failed runs remain historical. Commit this evidence or preserve stable references before deleting scratch files or `docs/ux-rework/`.

## A. Already assigned current Phase 3 work — track to closure, do not file duplicates now

### A01 — Finish one shared inserter editor and draft all Diagram dialogs

- **Severity / labels / owner item:** major (P1 N5/B#5); proposed `ux`, `accessibility`; **3.2 A**.
- **What / reproduce:** Open the same inserter from List and Diagram; compare source/destination labels, options, inferred filters and Stack size. Open Machine/Belt/Chest/Drill in Diagram, change a field, then Cancel/close; historically those non-inserter dialogs apply live while the inserter uses Save/Cancel. Expected: the shared fields and approved draft semantics in spec 3.2.
- **Source / evidence:** `specs/3.2-editing-at-scale.md`, “Why it is wrong today”, “Pick: every Diagram dialog”; P1 N5, B17; P1 shots 10/13/14 above; P2 `components/EntityEditDialog.tsx:565,610–656` and duplicated form components.
- **Proposed scope:** implement existing 3.2 A only, preserving imported type/quality read-only and omitted Stack size → Automatic. Q3(a) is already resolved; no repeated design approval is needed. Drop from final issues if 3.2 A closes it.

### A02 — Preserve automatic-filter meaning and prioritize the source’s items

- **Severity / labels / owner item:** minor (B26); proposed `ux`, `bug`; **3.2 A**.
- **What / reproduce:** On a row with multiple inferred filters, remove one automatic filter, or choose an item in a later empty slot. Inspect the stored list and whether remaining filters still follow source changes. Historical result: automatic silently becomes explicit and later-slot edits can serialize holes as nulls. Expected: contiguous filters, clear “Set by hand” feedback, a way back to automatic, and source items first.
- **Source / evidence:** spec 3.2 lines 64–71 and 119–128; `InsertersForm.tsx` filter handlers and `InserterConfigPanel.tsx`; original B26. No new screen captured by this writer.
- **Proposed scope:** the already approved shared-editor/filter work; do not add a separate bulk-filter implementation. Remove after its evidence passes.

### A03 — Align Automatic filter slots with the actual Stack size input box

- **Severity / labels / owner item:** minor, cosmetic/nonblocking; proposed `ux`; **3.2 A**, explicitly assigned.
- **What / reproduce:** Load the compatibility-metadata inserter state; compare the center of Filter 1 with the adjacent 40px Stack size input box at 1440, 800 and 720px. Automatic Inserter 1 is **31.86px lower** because alignment includes multiline helper height. Explicit Inserters 3/5 align at **0px** and their original case is closed.
- **Source / evidence:** B; `CODE-FINAL.md` embedded geometry probe/table; P2 `InsertersForm.tsx:85`; spec 3.2 “Final Build-card carry-forward” lines 725–740.
- **Proposed scope:** input-box alignment to ±1px at 1440/960/800/720 for Automatic and explicit values, retain Automatic capacity/full-research help and read-only metadata, preserve 390 reach/focus. Do not reopen explicit-helper removal or general compact design (D1).

### A04 — Add reorder feedback/Undo and a single-pointer alternative

- **Severity / labels / owner item:** major (P1 N4/B#4); WCAG 2.5.7 gap; proposed `ux`, `accessibility`; **3.2 B**.
- **What / reproduce:** Drag Inserter 5 to position 2. Historically every following ID changes with no message/Undo; repeat with a pointer user who cannot drag. Expected: approved renumber message + Undo and Move up/down. Verify Undo, then a second drag uses the restored order.
- **Source / evidence:** P1 N4; spec 3.2 lines 51–62, reorder acceptance; List dnd order and `App.tsx` direct reorder callbacks. dnd announcements reading `_uuid` are part of this same audit, not a separate issue unless they survive the replacement.
- **Proposed scope:** approved Q2(a), five entity kinds, stable identity, one announcement, no stale sortable order. No repeat owner decision. Drop when 3.2 B passes.

### A05 — Finish duplicate, bulk edit, new-row focus and reduced row tab stops

- **Severity / labels / owner item:** major (P1 N43/B#10; B22); proposed `enhancement`, `ux`; **3.2 B**.
- **What / reproduce:** In `intermediates/low-density-structure/low-density-structure.json`, change Stack size on 15 inserters or add a row below the viewport. Historical behavior requires individual edits and does not reveal/focus the new row; logistic Configure had 64 Tab stops. Expected existing 3.2 spec behavior.
- **Source / evidence:** P1 N43; spec 3.2 lines 40–49 and acceptance/tests/screens for PR B. Use fresh before/after counts on the final Phase 3 tree; the old 64 is a historical baseline.
- **Proposed scope:** existing duplicate/select/bulk/keyboard work, preserving fractional Copies, metadata and Stack-size omission, exact Undo and sticky-bar focus. Remove if 3.2 closes it.

### A06 — Reconcile remaining 3.3 ledger notes against merged Cancel/Keep work

- **Severity / labels / owner item:** verification task, not a new bug; **3.3 / root final audit**.
- **Verification recipe:** Generate logistic at a supported rate with a demonstrably nonrecommended pick; regenerate and reload. Import/Paste/Reset and Undo; check clocks/pick restoration. Edit a different field; check stale change list/time. Force a pending-check worker failure and a startup failure; use the next explicit Generate to recover. These are already addressed by merged 3.3 and C; do not file P1 N12/N13/N42/N44 or the old worker-pending/crash/retry findings as still absent.
- **One residual needing judgment:** L’s final note says a stopped run keeps an internal pick for a clock not yet made. At P3 `useSimulationWorker.ts:372–392`, partial Cancel keeps `userSelectionRef.current`; full completion clears a lost pick at 443–452; restoration normalizes via `selectionAfterRun` at 335–350. Check whether keeping the preference during a partial stop is intentional, and whether the displayed row/note becomes misleading. Reproduce by picking a later clock, changing config, starting a new run, then cancelling before it arrives (no prior complete results for that key). Do not claim a newly observed defect; C’s captures passed the agreed Cancel contract.
- **Another residual:** “found N fewer wake-ups after deeper search” is a historical request, not proven delivered by cache persistence. See B25 below if still desired. PLAN already has Undo/stale bullets; do not add them again.

## B. Future issue candidates — owner review before filing; no new current-release obligations

### B01 — Make compact clock metrics reachable at 390px

- **Severity / labels / owner item:** minor within the owner’s below-720 layout policy; proposed `ux`, `responsive`; **future layout**, reconcile with D1. Upgrade only if main-action reachability fails in a fresh audit.
- **What / reproduce:** At 390px, load logistic, Generate, open Results with the compact comparison table. Inspect Wake-ups/min (1 copy) and Works?. Repeat in Details/Blueprint/Developer/Fuel states. The decision table needs **174px more**; seven failures are repeated observations of this one table defect. Page itself need not scroll sideways for this failure to occur.
- **Source / screens:** H lines 223,354,387,426,528,891,910; H `w390/07-results-390-*`, `11-details-insights-390-*`, `12-details-blueprint-390.png`, `28-details-fuel-390.png`. Original P1 N9/C#1 and L 2.5 B / 2.9. B explicitly preserves this baseline.
- **Proposed scope:** content-fit or reachable internal scrolling while retaining the decision columns. 2.9 explicitly excluded below 720 geometry; do not reopen its completed 720–1440 work or describe this as lost Configure/Results reachability.

### B02 — Stabilize the workflow header during checks at 390px

- **Severity / labels / owner item:** minor; proposed `ux`, `responsive`; **future header layout**, overlap D1.
- **What / reproduce:** At 390px, trigger Check only and observe the reason/chip transition through Checking to Check passed. H measures header **138.3px → 176px** across frames. Expected future improvement: avoid the layout jump while keeping status/actions readable.
- **Source / screens:** H line 72, matching original 2.9 baseline; P1 N20/C#10; `WorkflowBar.tsx` / sticky header measurement. Not a regression at supported half widths.
- **Proposed scope:** compact/reflow state layout after owner prioritization. Keep this separate from B01’s table overflow.

### B03 — Investigate the 390px production-form landmark region violation

- **Severity / labels / owner item:** minor, axe “moderate”; proposed `accessibility`; **future a11y audit / root triage**.
- **What / reproduce:** At 390px load the production science state with drills, Advanced Overrides and Machine Facts open, then run the shared unchanged axe rules. One content node is outside landmarks. Identify the actual node rather than hardcoding a generated React ID.
- **Source / screens:** H line 940, selector `#_r_pf_`; historical 2.9 equivalent `#_r_p4_`; H `w390/29-forms-production-390-part1of9.png` and its state/aria/INDEX. B says the normalized defect exactly matches baseline.
- **Proposed scope:** inspect landmark ownership of the actual node and fix it if still present on combined Phase 3. This is an accessibility finding, not automatically waived by the owner’s phone-layout exclusion. Current 2.7 B reach/focus/axe states passed; retain both facts.

### B04 — Resolve the 320px reflow requirement against the owner’s width policy

- **Severity / labels / owner item:** owner policy decision, potential WCAG 1.4.10 gap; proposed `accessibility`, `design`; **owner/root**.
- **Verification recipe:** At 320 CSS px (and the equivalent zoom condition), walk Configure, Results and main actions and document which content requires two-dimensional scrolling; exempt only content with a valid two-dimensional exception.
- **Source:** L “1.11 → Phase 2 retro”; PLAN Widths (full layout ≥720, reachability only below) versus full player-facing WCAG 2.2 AA. There is no new 320px capture in this draft.
- **Proposed scope:** owner review of the conflict with concrete evidence, then define the smallest measurable reflow work if needed. Preserve this unresolved decision; do not infer approval to broaden release scope or claim the nine 390 failures settle 320 compliance.

### B05 — Investigate Never on rules that still move or erase the schedule

- **Severity / labels / owner item:** major, inherited engine observation; proposed `bug`, `engine`; **future engine**.
- **Verification recipe:** Use agriculture science, set an inserter to Never on, Generate and compare its movement/wiring list; repeat with logistic science. L reports movement/wiring despite Never on in agriculture and a 0/s empty schedule in logistic. Record exact sample/inserter IDs, generated clock and exported behavior before filing.
- **Source:** L “Engine (from 2.5 A’s re-check)” and 3.1 follow-up; current engine rule evaluation plus `installSteps.ts` comment correction. Historical note did not preserve exact row IDs; do not invent them.
- **Proposed scope:** engine behavior plus meaningful regression fixtures and accurate 3.1 rule/installation explanation. Owner’s “keep it off yourself” install wording remains accepted; this issue is not authorization for a mod change.

### B06 — Preserve ownership of Exclude-from-LCM forced Always on through external round trips

- **Severity / labels / owner item:** minor (P1 N47/B#16); proposed `bug`, `persistence`; **future UI serialization design**.
- **Reproduce:** On an AUTO inserter, exclude all its ingredients from LCM so Always on is forced; Save build file, Open that file, then include the ingredients again. Compare the resulting rule to the same sequence without saving. A forced rule can look player-owned after round trip.
- **Source:** P1 N47; P2 `utils/configForm/configMapping.ts:126–131` intentionally strips `_forced_always`; `configMapping.test.ts:92–106` tests that stripping; `edits.ts:459–463`. Browser-local persistence already preserves it (`usePersistedConfigForm.test.ts:59–68`); this is specifically an exported/shared-config boundary. Recheck library/share and the final Phase 3 format rather than assert every storage path fails.
- **Proposed scope:** decide a compatible UI metadata strategy that never sends private fields to the engine, preserves intentional Always on and makes reset semantics clear. Owner review required; do not casually add fields to engine config.

### B07 — Sum final recipes sharing one product when suggesting the target

- **Severity / labels / owner item:** minor; proposed `bug`, `sidecar`; **future TS/Lua inference**.
- **Reproduce:** Select a foundry casting iron and a furnace making iron plate, both final outputs of the selection; export/paste. Compare suggested target to the sum of both final groups. Current algorithm picks the largest recipe group, so the ceiling can be too low for their shared product.
- **Source:** L 2.2; `clock-generator/src/config/suggested-target.ts:74–108` (`by_recipe`, final reduction); `clock-generator-sidecar/scripts/suggested-target.lua:69–130` same grouping. No new in-game evidence captured here.
- **Proposed scope:** aggregate eligible final groups by product with matched TS/Lua tests, preserve tie/cycle/by-product rules. Sidecar release/checkpoint planning belongs to a future approved item.

### B08 — Make old-export suggested targets explicit when site data omits recipes

- **Severity / labels / owner item:** minor; proposed `bug`, `import`; **future import compatibility**.
- **Verification recipe:** Export a build with a recipe absent from the site’s bundled data using a pre-0.8.0 export without suggested_target. Compare TS inferred target to a current Lua suggestion for the same selection. TS skips unknown recipes while Lua can count them.
- **Source:** L 2.2; `suggested-target.ts:recipeGroupOf`/`inferSuggestedTarget`; `scripts/suggested-target.lua` prototype lookup. This affects legacy inference; do not generalize it to all current exports.
- **Proposed scope:** clear unsupported/partial-inference guidance or compatible inference policy, without silently inventing a target.

### B09 — Close the sidecar copy popup with its parent

- **Severity / labels / owner item:** minor, historical; proposed `bug`, `sidecar`; **future sidecar**.
- **Verification recipe:** Open the sidecar export/copy popup in Factorio, press Escape and separately E. L reports the main window closes while the popup is orphaned. Capture exact game/mod versions and focus sequence.
- **Source:** L 2.2 “existing quirk”; `clock-generator-sidecar/` copy-popup event handling. No current in-game check by this writer.
- **Proposed scope:** coupled close/focus behavior in a future mod item; keep the final built 0.8.0 zip owner smoke check as release verification, not a substitute for this reproduction.

### B10 — Validate fractional clock constants in exported deciders in game

- **Severity / labels / owner item:** unverified correctness risk (potential major); proposed `bug`, `engine`; **future engine, owner explicitly deferred 2026-10-14**.
- **Verification recipe:** Generate a build with a noninteger clock period, choose its rounded-clock alternative, decode the blueprint and inspect the counter decider constant. Paste into Factorio and compare the actual period to displayed/exported intent.
- **Source:** L “After the rework”; current `blueprints/entity/decider-combinator.ts:81–95`, `clock(period)` calls `.setConstant(period)`; `crafting/alternatives.ts:493–519` exact/subtick/rounded alternatives. The old numeric line reference 82 moved; this writer has not established a failing emitted blueprint.
- **Proposed scope:** engine/in-game investigation and a regression only if an affected call path is confirmed. Do not apply Math.floor blindly or label every rounded clock broken.

### B11 — Clear book payloads on a single-blueprint subtick alternative

- **Severity / labels / owner item:** minor defensive hardening; proposed `engine`; **future engine**.
- **Verification recipe:** For every `-subtick` alternative inspect that the exported artifact is the intended single subtick blueprint, not a retained modulo book. L explicitly says the guard changes no current output; no failing current fixture is known.
- **Source:** L “Engine guard”; `crafting/alternatives.ts:506`, `result: { ...result, blueprint: result.subtick.blueprint, schedule: result.subtick.schedule }` retains any other result fields.
- **Proposed scope:** explicit `modulo_blueprint`/`modulo_schedule` clearing plus meaningful fixture if a source result can carry them; owner may keep as hardening rather than a bug issue.

### B12 — Key inserter-coverage results to the build being shown

- **Severity / labels / owner item:** major race risk, historical UI observation plus current source; proposed `bug`; **future coverage validation**.
- **Reproduce:** Load a build with missing coverage, then replace it or delete/renumber a machine/inserter; before the worker replies, inspect/click the first problem or apply its fix. The previous build’s issue can remain and name an absent/wrong row.
- **Source:** L 1.9 and 1.4 duplicate observations; `hooks/useInserterValidation.ts:6–10,17–34` explicitly retains old issues until the next reply and only ignores outdated promises. This is distinct from the merged 3.3 main-worker startup/crash fixes. Recheck this hook on final combined Phase 3 before filing.
- **Proposed scope:** associate coverage with its config key or reset to pending on replacement; guard fix application against stale identity. Show Checking rather than offer old row actions.

### B13 — Keep the last failed-check reason available while correcting the field

- **Severity / labels / owner item:** minor (P1 N46/B#15, original B23); proposed `ux`; **future check feedback**.
- **Reproduce:** Run a failing Check only (e.g. capacity refusal), then change the target rate by one keystroke. The alert disappears, taking its useful capacity figure with it. Expected future behavior: retain clearly stale guidance such as “from the last check” without implying current validation.
- **Source:** P1 N46; L 2.3 → later; `utils/checkThenGenerate.ts:checkStatusOf` and `App.tsx` error rendering. Live maximum helper from 2.1 W partly mitigates this; verify which failed reasons still lose necessary guidance.
- **Proposed scope:** preserve prior explanation and distinguish stale/current error semantics, without reintroducing a Generate gate.

### B14 — Retain focus when the swing plan’s initial Check only unmounts

- **Severity / labels / owner item:** minor; proposed `accessibility`, `bug`; **future Advanced check plan**.
- **Verification recipe:** Open Advanced before any check, keyboard-focus its own Check only button and activate it. When the empty state changes to a plan, inspect activeElement and continue Tab. L reports focus falls to body.
- **Source:** L 2.3; P2 `components/CheckPlanSection.tsx:57–76` renders the initial button only for an empty state. Do not confuse with the header Check only or incorrectly claim inert exclude chips are absent.
- **Proposed scope:** explicit meaningful result focus if the initiating control disappears, appropriate announcement, no forced focus on automatic rechecks.

### B15 — Re-audit the dimmed stale/running swing plan’s contrast and keyboard behavior

- **Severity / labels / owner item:** minor, potential AA failure pending measurement; proposed `accessibility`; **future plan presentation**.
- **Reproduce:** Check a build, edit it, then open Advanced; inspect computed contrast of dimmed table/text and Tab through exclude controls; repeat while rechecking. `pointer-events: none` does not by itself remove keyboard activation.
- **Source:** L 1.11 / 2.3; P1 N32; current `CheckPlanSection.tsx:79–96` still applies opacity 0.45 and pointer-events none. Historical routing to 2.7 A is not proof this particular source pattern disappeared. Verify actual handlers/inertness before claiming a new failure.
- **Proposed scope:** measurable contrast and correct disabled/stale operation while keeping the existing plan visible. Do not file the already-fixed hover-only Advanced help as part of this entry.

### B16 — Include the field name in NumberField stepper accessible names

- **Severity / labels / owner item:** minor, allowed historical spec gap; proposed `accessibility`; **future shared fields**.
- **Reproduce:** Inspect accessibility names of multiple numeric field steppers with a screen reader or aria snapshot. Every increment/decrement is “Increase”/“Decrease”, without the associated field.
- **Source:** L 1.11 B; `components/NumberField.tsx:204,213`. They are intentionally absent from ordinary Tab order, so this is a naming improvement, not proof of excessive tab stops.
- **Proposed scope:** field-specific names containing visible context, preserve numeric behavior and input focus.

### B17 — Restore Diagram focus when an edit changes split-node topology

- **Severity / labels / owner item:** minor; proposed `accessibility`, `bug`; **future Diagram**, recheck after **3.2 A**.
- **Verification recipe:** In Diagram edit a belt so it splits/unsplits into twin nodes, Save/close, and inspect focus. L reports body focus when the original node disappears; separately verify delete focus using historical 1.5 F failures.
- **Source:** L 2.11 topology note and 1.5 F “diagram delete” failures; `ConfigFlowDiagram.tsx` focused-node restoration. Ordinary node close focus and 2.7 B Diagram Save states passed, which does not prove this topology case.
- **Proposed scope:** choose the surviving entity node or meaningful Diagram fallback after topology/delete. Root should split delete into a separate issue only if its current cause differs.

### B18 — Avoid repeat refits and late-facts clipping in Diagram

- **Severity / labels / owner item:** minor; proposed `ux`; **future Diagram**.
- **Verification recipe:** Open Diagram, highlight a twin inside the 2s facts refit window; count fitView calls/view jumps. Then delay Machine Facts beyond 2s and inspect whether the loaded node facts fit. L reports double refit and no late refit.
- **Source:** L 2.11; `ConfigFlowDiagram.tsx:45–59,161–187`, node-size subscription, `REFIT_WINDOW_MS`, twin class. No fresh timing capture here.
- **Proposed scope:** distinguish actual content-size changes from visual highlighting; honor intentional player pan/zoom. Keep the phone top-to-bottom layout request as a later design option, not a bug obligation.

### B19 — Expose a retained nearest-lane setting when belt items become equal

- **Severity / labels / owner item:** minor; proposed `ux`, `bug`; **future inserter editor**, recheck after **3.2 A**.
- **Reproduce:** Set nearest lane 2 for a belt with two different items, change both lanes to the same item, then inspect the exported source and controls; change them back. Saved `near_lane` can persist while its control is hidden.
- **Source:** L 2.11; `components/NearLaneSelect.tsx:43–46` returns null when `nearLaneItems` has no distinct lanes; `utils/nearLane.ts`; existing round-trip tests intentionally preserve lane values.
- **Proposed scope:** decide whether the setting remains dormant with an explanation or is cleared with appropriate semantics. Do not silently delete an imported physical-lane fact without owner review.

### B20 — Recheck Recipe text after Reset and Undo

- **Severity / labels / owner item:** minor; proposed `bug`; **future picker state**.
- **Verification recipe:** Select a recipe, Reset, then Undo; repeat after Paste/Open followed by Undo. Compare the visible text, icon, controlled recipe value and next-step guidance. L reports the old text without the icon after Reset and raises priority because it contradicts the first-visit state.
- **Source:** L 1.3 / 2.1; `components/ItemSelector.tsx` controlled value and MUI internal input text; `TargetOutputForm.tsx`. ItemSelector changed substantially in 2.8, so fresh reproduction is required; do not assume the historical symptom survives.
- **Proposed scope:** synchronize displayed text with external value replacement without destroying a recoverable active draft. Remove if the final picker already resolves it.

### B21 — Explain unknown typed recipes before generation without losing imported data

- **Severity / labels / owner item:** minor (P1 N48/B#17); proposed `ux`, `validation`; **future pickers**.
- **Reproduce:** Type a nonexistent recipe string and press Enter, then Check/Generate. P2 permits freeSolo and keeps unknown text; inspect whether the first problem clearly identifies it rather than treating it as a valid choice.
- **Source:** P1 N48; `TargetOutputForm.tsx:39–57`; `ItemSelector.tsx:103–104,145`. Existing unknown/modded imported values must remain recoverable; 2.8 fixed in-game names/search but does not automatically mean unknown inputs are rejected.
- **Proposed scope:** clear validation for unsupported values, retain drafts/imports and ID/name search. Do not replace freeSolo wholesale without reviewing legitimate mod-data cases.

### B22 — Explain preserved custom rules when excluding ingredients from LCM

- **Severity / labels / owner item:** minor; proposed `ux`, `validation`; **future rule/plan integration**, recheck merged **3.1** first.
- **Verification recipe:** Set a Clocked rule, exclude its ingredient from LCM and inspect the swing plan and new clock period. Confirm the custom rule remains and whether the UI says so; check ranges against the period used by the resulting plan.
- **Source:** L 1.8 → 2.3 or later; `TransferPlanPanel.tsx`; `edits.ts:updateIgnoredIngredients`. 3.1 already adds rule checks; do not file a duplicate missing rule validator based only on P2’s old editor.
- **Proposed scope:** a per-row preserved-rule explanation and only any validation gap demonstrably left on final P3.

### B23 — Finish player-facing engine terminology and numeric wording

- **Severity / labels / owner item:** minor/nit (P1 N25, L 2.5 B); proposed `copy`, `engine`; **future engine copy**, owner definitions where needed.
- **Reproduce:** Inspect generation task/log/Insights strings for Even hands, Observed windows, Full-hand output swings and internal item IDs. Compare a displayed integer wake-ups/min against Insights’ rounded decimal count. Trigger an engine rate error and inspect precision. These strings can bypass the UI’s plain clock labels.
- **Source:** `crafting/alternatives.ts:304,314,377`; `crafting/insights.ts:288–304`; L 1.10 `plan-run.ts` unrounded rate error and 2.5 B follow-up; P1 N25. Preserve the engine’s real wake-up count and actual ranking; provisional wake-up definition still awaits the owner’s strict wording.
- **Proposed scope:** glossary-consistent engine-visible text and intentional numeric precision only, no ranking/timing changes. Keep private Developer text severity proportional. Owner-written definitions for “hand” and “assembling machine” can be edited as part of this copy issue after review (`utils/glossary.ts:136–139,179–183`).

### B24 — Correct swing-plan totals that are described as per-inserter counts

- **Severity / labels / owner item:** minor; proposed `bug`, `copy`; **future check-plan/engine contract**.
- **Reproduce:** Load a final-output machine with multiple output inserters having a known split; Check only. Compare total `output_swings_per_cycle` with “Each output inserter makes N swings”. They are different quantities when N is summed across inserters.
- **Source:** L 1.12 and 1.12 B on p2; current `CheckPlanSection.tsx:101`; engine `crafting/plan/validate-config.ts:48–54` sums output transfers. `OverridesForm.tsx:158` now correctly says forced output swings are divided equally, so exclude that old “per output inserter” label if already corrected.
- **Proposed scope:** accurate total/per-inserter wording across plan summary/glossary/table help; change engine payload only if needed and separately approved.

### B25 — Decide which comparison/navigation improvements remain useful

- **Severity / labels / owner item:** enhancement/nit, not a newly confirmed bug; proposed `enhancement`, `ux`; **future design**, reconcile **D1/D4/D7**.
- **Verification recipe:** Generate several clocks and try to sort by a metric, keep comparison controls visible while inspecting details, inspect a per-row “not picked because” rationale, then Search deeper and compare the prior wake-up count. L carries B12/B14 sorting/sticky-tabs, B7 “Show only overridden”, and 1.7’s “found N fewer wake-ups” request. Check final Phase 3 before selecting any scope.
- **Source:** L 1.6, 1.13 and 1.7; P1 N10’s remaining sorting part; `ClockAlternativesPanel.tsx` / compare helpers / `DeeperSearchNotice`; 3.3 caches results but does not by itself promise a difference summary.
- **Proposed scope:** owner-selected small design issues after auditing existing recommendation/compact behavior. Split accepted proposals into one coherent issue each; do not file this whole menu as a single implementation request. Search deeper checkbox/caption noise (P1 N38) belongs in the same design discussion, not a safety regression.

### B26 — Explain what Paste replaces and discuss Append separately

- **Severity / labels / owner item:** minor remaining clarity, enhancement for Append (P1 N35 was major in its original context); proposed `ux`, `import`; **future import design**.
- **Reproduce:** Start with several entities, Paste a different sidecar selection, inspect confirmation before committing. Current UI shows incoming counts and says ticked parts replace the same parts, but compare whether it says how many existing entities will be removed. There is no Append path.
- **Source:** P1 N35/B#8 (original B19); L 2.1 says counts/Append are in no spec; P2 `ConfigImportExport.tsx:544,583–626` already displays incoming counts and `handleConfirmImport:343–359` replaces lists.
- **Proposed scope:** drop the stale “no counts at all” claim. Owner may choose replacement counts as a clarity fix and a separately scoped Append feature with ID/reference/Undo rules. No unapproved Append implementation in this rework.

### B27 — Check browser-native Undo outside numeric inputs

- **Severity / labels / owner item:** minor, pre-existing historical observation; proposed `ux`; **future keyboard behavior**.
- **Verification recipe:** In Chrome type in Items per Second, Tab away, ensure no application Undo is offered, then Ctrl/Cmd+Z. L reports browser-native field Undo can still revert the last edit.
- **Source:** L 1.5/1.3; `useUndo.ts` / `utils/undoKeys.ts`. This is distinct from the old application import Undo lifetime, which 1.5 F fixed.
- **Proposed scope:** decide whether native behavior outside editable controls should be suppressed; preserve normal text-field undo and platform conventions. Current browser behavior must be reproduced before filing.

### B28 — Verify fullscreen message keyboard distance and Safari header movement

- **Severity / labels / owner item:** minor usability for keyboard distance; Safari symptom unverified; proposed `ux`; **future message/header audit**.
- **Verification recipe:** With an offered Undo in fullscreen Diagram, start at Exit and count Tab to Undo (L reports 16 presses). Separately on Safari scroll to several positions, trigger the same message/header change and measure viewport movement (L suspected 39px; **untested**, not an established defect).
- **Source:** L 1.5 F PASS follow-up. Earlier messages covering forms/dialogs/Results were fixed by 1.5 F and must not be filed again.
- **Proposed scope:** keyboard order if still unreasonable; file Safari only after a real reproduction. Do not add an Undo timer.

### B29 — Complete targeted manual accessibility checks and resolve only demonstrated failures

- **Severity / labels / owner item:** verification task; proposed `accessibility` for confirmed survivors; **future a11y audit / root triage**.
- **Verification recipe / source:** L 2.6 VoiceOver: inspect Wake-window row labels for repeated announcements; L 1.5: test the 100ms polite-region write with NVDA/JAWS and unmount/remount module state; L 1.11 A: forced-colour switches, checkbox ripple/ring, AUTO-slot badge/remove overlap and wrapped chest filters at 390; L 1.11 B: rule-dialog heading including Fullscreen/Close and an empty unstable group; L 2.11: Tab order by left edge versus center and lane-name truncation. Test current P3 rule/editor replacements before filing.
- **Proposed scope:** one issue per confirmed cause with real screen/AT/version evidence. Missing manual verification is not proof of a defect; white Diagram focus ring is an approved exception, not a bug. Current per-state axe/focus checks do not certify full WCAG compliance.

### B30 — Restore a focused internal scroll region when overflow disappears

- **Severity / labels / owner item:** minor, historical; proposed `accessibility`, `bug`; **future scroll regions**.
- **Verification recipe:** Keyboard-focus an overflowing `ScrollX` table, then change width/content so it fits. Inspect activeElement and the next Tab destination. L says the focused box loses focus when it stops overflowing.
- **Source:** L 2.9 (#184); shared `components/ScrollX.tsx`. macOS overlay scrollbar absence alone is a platform characteristic, not another bug; verify the existing fade cue before filing an affordance issue.
- **Proposed scope:** preserve meaningful focus when tabIndex/region status changes, without leaving unnecessary scroll stops on tables that fit.

### B31 — Recheck target-limit handling for missing facts and very small rates

- **Severity / labels / owner item:** minor, conditional correctness risk; proposed `bug`; **future capacity helper**.
- **Verification recipe:** Include an output machine whose facts resolve to null (not pending undefined), compare the computed maximum to engine validation; separately use a supported rate below 0.01/s and inspect the printed upper limit. L reports missing facts omitted from the sum and possible rounded-up text.
- **Source:** L 2.1 W; current `utils/targetRateLimit.ts:machinesMaxOf,roundedDown,maxRateText`. Pending undefined is already guarded and exact ratios/fractional Copies were fixed by compatibility. Null facts remain skipped by the filter; tiny-rate rounding code already uses significant digits, so its historical symptom needs a concrete boundary example before filing.
- **Proposed scope:** only surviving discrepancy with a precise numeric fixture; do not reopen the fixed exact comparison/fractional Copies work.

### B32 — Finish small display-copy leftovers that survive final Phase 3

- **Severity / labels / owner item:** nit; proposed `copy`; **future copy pass**.
- **Verification recipe:** Inspect Swing Plan source/destination labels (“Machine 1 - Name” versus parentheses), redundant type chip and multi-ID bracket rendering; inspect Auto tooltip “runs” versus rule dialog “switched on”, Config tab label and wake-window “Between its windows the inserter is off” wording. L notes these individually. Inspect below-target Copy for `/S` uppercasing before keeping that old note.
- **Source:** L 2.8 b, 1.12 B, 2.6 nits, 1.14; `TransferPlanPanel.tsx`, `utils/enableRuleLabel.ts:44`, `EntityEditDialog.tsx`, `utils/wakeWindowCopy.ts`, `WorkflowBar.tsx`. 3.1 and 3.2 replace some surfaces; verify final source first.
- **Proposed scope:** one cheap coherent copy pass only for surviving text, preserving unit semantics/accessibility; do not repeat already renamed Stable/Unstable or fixed import menu text.

### B33 — Clarify developer timeline labels and legend affordances

- **Severity / labels / owner item:** nit (P1 N52); proposed `copy`, `ux`; **future Developer tools**.
- **Reproduce:** Open Developer tools → timelines; inspect “Transfer Activity Timeline” and the noninteractive legend chips. L/P1 note glossary drift and chips that look like toggles.
- **Source:** P1 N52/A25/C30; `TransferHistoryVisualization.tsx:303,335`; `StateTransitionTimeline.tsx` palette/legend. Developer charts have light-fix scope and remain mouse-driven by owner decision; do not relabel omitted canvas keyboard interactions as a new release blocker.
- **Proposed scope:** accurate developer-view naming/affordance, no chart redesign. The Fuel palette was already aligned with `colors.ts` (`FuelPanel.tsx:17`); exclude the old palette mismatch.

### B34 — Share authoritative wake-window constants with the engine

- **Severity / labels / owner item:** nit / maintenance; proposed `refactor`; **future engine/UI API**.
- **Reproduce / inspect:** Compare UI `CIRCUIT_LATENCY_TICKS = 2` / `MOSTLY_ON_SHARE = 0.8` to engine constants; changing one side could leave the explanation inconsistent.
- **Source:** L 2.6; current `utils/wakeWindowCopy.ts:29–33`; engine `clock.ts` / `insights.ts` definitions.
- **Proposed scope:** export stable constants from the engine/light API and reuse them with meaningful boundary tests. No observed current numeric mismatch and no authorization for an engine API change now.

### B35 — Profile Even hands before changing worker task ordering

- **Severity / labels / owner item:** unverified performance hypothesis; proposed `performance`; **future profiling**.
- **Verification recipe:** Measure `even-hands` task duration against the existing SLOW_TASKS members on representative builds; only keep an issue if it materially delays useful results or blocks another task.
- **Source:** L master 0.10.0 note; P2 `hooks/useSimulationWorker.ts:92` excludes even-hands. Check the final P3 list before filing; changes in upstream searches invalidate old timing assumptions.
- **Proposed scope:** measured task scheduling improvement, no speculative membership change or extra worker mechanism.

### B36 — Repair only still-stale capture expectations and document environment constraints

- **Severity / labels / owner item:** maintenance; proposed `tooling`; **capture tooling / root**.
- **Verification recipe:** Run the final relevant a11y-names/wake-windows cases after checking selectors. L reports six old Validation/Swing Plan/LCM checks in `capture-a11y-names.mjs` and a drills row count compared to a now-hidden developer timeline. Match expectations to approved specs without removing keyboard/axe/announcements checks.
- **Source:** L 3.1 and capture-wake-windows; `capture/capture-a11y-names.mjs`, `capture/capture-wake-windows.mjs`. B records current GUI/first-visit/belt repairs as closed; C records Cancel capture provenance repairs as closed. Do not file those already repaired scripts again.
- **Proposed scope:** remaining stale checks only. The nested `.claude/worktrees` Knip issue is documented and normal Knip passes on an identical detached tree; owner may retain it as an environment/tooling issue, not dead product code. Playwright NODE_PATH and StrictMode-focus notes are operating guidance. README already documents SAMPLES_DIR, textContent waits and preview; these historical documentation follow-ups are closed.

## C. Deferred design discussion drafts D1–D8 — not bugs or current release obligations

All eight are owner-requested later discussion. Proposed label only `design` / `enhancement`, if the owner chooses to track them externally. **No bug severity, implementation allocation, selected layout, new checkpoint or release requirement is implied.** Preserve the detailed scoped notes in `specs/D1-compact-view.md` and `specs/deferred-design-discussion.md`; these paragraphs are issue-discussion summaries, not replacement implementation specs.

| ID / possible discussion title | Intended outcome / source | Later acceptance or unresolved decision | Owner item / status |
|---|---|---|---|
| **D1 — Explore Compact view and width-dependent composition** | Owner reports Results scroll fatigue, excessive padding/helpers and double-header footprint; version requires scrolling. Explore opt-in saved density, Results/header first, plus selected-detail composition on wide screens. Source: D1 spec, including 1440/1600/1920/2560 composition candidates. | Later wireframe/audit selects breakpoints, controls and removable routine copy; measure header height/rows/scroll distance against identical states at 1440/960/800/720/390. Preserve newcomer defaults, warnings, names, targets and essential feedback. Density preference remains separate from build/share data. | Deferred D1; no final layout or delivery selected. |
| **D2 — Explore saved light/dark/system colour schemes** | Independent colour preference with deliberate semantic palettes for text, charts, diagrams and focus. Source: deferred design table D2. | Choose default/options/placement, migrate static dark colours, verify full contrast/focus across modes. No time estimate or implementation approved. | Deferred D2. |
| **D3 — Audit real build tasks end to end** | Import → generate → compare → choose → copy, including editing/returning to Results; record scroll, interactions and confusion. Source: D3. | Choose representative small/large owner builds, tasks, baseline and metrics. Complements the required phase-end personas/gates and does not replace them. | Deferred D3. |
| **D4 — Explain recommendation tradeoffs** | Audit existing reasons before adding explanation of actual engine ranking and alternative tradeoffs. Source: D4. | Decide concise/default versus optional detail and any comparison UI; no ranking/engine behavior change. Reconcile B25. | Deferred D4. |
| **D5 — Emphasize exceptions and changes** | Quiet repeated defaults while revealing overrides, warnings, changed values and nondefault metadata; coordinate with D1. Source: D5. | Decide which defaults can be summarized and how exceptions remain accessible without colour-only meaning. Existing imported-metadata requirements continue until an approved design replaces them. | Deferred D5. |
| **D6 — Consolidate display preferences** | One accessible settings entry for density/colour/layout choices without another toolbar row. Source: D6. | Placement, keyboard flow, automatic versus manual choices, persistence/defaults; keep separate from exported/shared build data. | Deferred D6. |
| **D7 — Preserve working context beyond 3.3** | Audit selection, sorting/filter state, expanded detail, tabs and scroll across routine edits/navigation/reload. Source: D7. | Reconcile with finished chosen-clock/cache/library behavior first; choose per-build/browser scope, reset/invalid-selection/cross-tab rules. Do not refile merged 3.3 persistence as absent. | Deferred D7. |
| **D8 — Show per-machine target alongside max/achieved rate** | Owner asks for required/planned average output alongside intrinsic maximum; selected-clock achieved output remains distinct. Source: deferred D8 appended section. | Existing SerializableMachineFacts supplies intrinsic output rate/exact ratio, not intermediate per-entity target. Inspect authoritative planning/serialization before proposing engine logic. Define per-modeled-unit vs Copies totals (including fractions), multiple producers/intermediates/productivity/by-products/loops/fuel/fluid/ambiguous plans and freshness after edits; validate hand-calculable chains. No rate may be invented. | Deferred D8; likely engine/worker/UI scope, explicitly excluded from frozen compatibility pass. |

## D. Reconciliation notes — excluded historical findings and verification holds

These are not proposed open bug issues. They prevent the long historical Follow-ups list from being mistaken for a list of current defects.

- **Closed by merged 1.5 F and owner Undo decision:** P1 N1/N2/N3 message coverage/import-Undo lifetime; sticky-footer coverage; errors over modal titles. Untimed Undo remains intentional. B28 retains only its separate keyboard/Safari questions.
- **Closed by Phase 1 end fixes:** N18 chip focus ring, N19 unusable 14px lane field, N27 stale Clock-only column text. Do not confuse the fixed 390 lane target with B01 compact-table overflow.
- **Closed by merged newcomer/results/theme/layout work:** blank-form red count; separate Validate gate/disabled Generate; lack of first-visit explanation/paste fallback/examples; raw parser import errors/menu “config” names; no target prefill; above-max target with no blocker; no answer/install card/default Wake windows; green/orange action hierarchy, idle red-delete furniture, header/Advanced help, plain clock labels, blueprint string copy-padding, duplicate Back-to-recommended, Copied reset, Developer tools placement, original 720–960 table/layout failures, inserter Source/Destination truncation and empty-slot cleanup. Use committed evidence/item verdicts; refile only a new final-review regression with its own evidence.
- **Closed specific source checks:** `InsertersForm.tsx:518–519` now passes entityType and forcedAlways; `buildFlowGraph.ts:309` uses `describeEnableRule` for node modes; accessible Recipe names are supplied; AUTO tooltip gets explicit entity type instead of parsing the entity label. README already records SAMPLES_DIR/textContent/preview. Machines help at `MachinesForm.tsx:61–68` already points to Sidecar and warns that `/c` disables achievements (P1 N37 closed). `FuelPanel.tsx:17` shares state colours; do not refile the orange Fuel mismatch. Explicit Stack size helper/slot alignment is closed; only A03 Automatic alignment remains.
- **Closed/covered on Phase 3 despite absence from P2:** cancel/progress/copy-current-best, chosen-clock retention/cache/reload, import/reset Undo restoring clocks, stale change list/time (P1 N12/N13/N42/N44), named library/share/multi-tab foundation, rule templates/live explanation (3.1). C supports corrected worker failures/explicit retry. The final combined tree still needs the normal root audit; absence from P2 proves none of these missing.
- **Owner-approved or expected, not bugs:** white Diagram focus ring; olive warning snackbar with accepted contrast; current UI version/in-app changelog before final release bump (P1 N51); native browser/overlay scrollbar behavior alone; Developer chart keyboard expansion beyond light fixes; a stored invalid rule blocking a Config-only save where spec permits it; sidecar type/quality export deliberately deferred with its timing assumption explained. Do not reopen these as automatic release debts.
- **Release tasks, not issue backlog:** preserve install-step owner check before Phase 2 PR and phase-merge approval; final built 0.8.0 zip owner smoke check; aligned sidecar version/release wording with 2.1; final version/changelog changes only in final PR. These checkpoints remain with root; this draft adds none.
- **Process lessons already applied:** merged-tree type-check after clean text merges; do not remove worktrees before final agent report; no source suppression for nested-worktree Knip. They belong in the retro/operating rules, not product issues.
- **Verify before deciding closed/open:** obsolete 1.13 “Configure Enable Control” capture selector; no-recovery/deadlock wording directly on Copy; focus-ring offset on yellow; full-value title field descriptions; stale banner live role when Results hidden; duplicate coverage IDs in fullscreen; 2px scroll-anchoring threshold during Check only; small 0.6.0 notice colour; tooltip cover of More/Copy; belt-action unmount on first no-belt clock; diagram double ring; wake-window Escape selection scope/spacing nit; row-delete-column alignment across kinds; forced-colours switches; rule-dialog heading semantics; empty unstable group. The ledger contains these historical notes but this writer has no fresh failing evidence. Root should check final source/captures and retain any survivor under the nearest focused B entry, or add a separate issue with exact reproduction. Do not silently drop them, and do not label them current regressions without verification.

## E. Pending Phase 2 and Phase 3 review additions

**Phase 2 A/B/C personas: pending at draft time.** Insert only actual findings with persona ID, exact commit/build, viewport/state, screenshot/aria/log, severity, reproducible steps and a proposed owner item. If Phase 3 has already rebuilt the affected surface, route it to that item/current combined audit instead of adding a Phase 2 patch by default.

**Phase 3 final pass: pending.** Remove A01–A05 and any B candidates closed by 3.2/current work; resolve A06 against final Cancel/Keep semantics, reconcile D7 overlaps, add genuine new findings, and preserve B01–B04 until evidence/owner decisions close them. Review the draft with the owner before any `gh issue create`; no automatic filing is authorized by this document.

Draft completed: **2026-10-16 09:29:50 UTC**. No GitHub issues filed; root and owner review remain required.

## Root reconciliation after the fresh Phase 2 review

All three exact reports and original/carry matrices are preserved in `review/phase2-end/`; see its SYNTHESIS.md for disposition. Root reviewed this draft; it remains a verification/owner-review queue, not a confirmed36-bug filing list. No issues are filed.

- 2.F owns wake-up copy consistency, fractional Makes scope and the intro UPS claim. Remove those from final issues after verification.
- 3.F now owns partial-Paste safety (B26), clipboard failure, Fuel event/trace equivalents, output-swing scope (B24), Advanced help, stale-plan readability (B15) and the concrete320 audit/policy reconciliation (B04). Those earlier future entries are superseded by assigned current carries; do not file duplicate issues. Append remains deferred.
- 3.2 A/B is implementing A01–A05; A's untouched row counts were recorded before product edits. Provider P3c29 already inherits reviewed library/Cancel/rule work; root combined captures are complete and independent merge code/UX PASS. A06 is final semantics verification, not a newly established bug.
- Phase2 review also suggests onboarding-prerequisite order, standing-belt consequence copy, a product identity on the answer card and local selection navigation; keep as focused future candidates alongside D1/D4/D7. These are not permission to implement deferred design work now.
- The nine390 failures remain historical observations of three causes; the landmark is not waived as phone geometry. Actual320 evidence is still required before a policy decision or compliance claim.
- Phase3 final review must close assigned carries, refresh remaining candidates with concrete evidence, and remove closed entries. Owner review precedes any filing.


## Phase4 review additions — draft, not filed

### Clarify clock belt timing versus the saved run setting
Minor; A-P4-1. A result can show raw “Standing still” clock timing, a saved Moving run and a selection-rule match. Explain these as separate facts without changing ranking, simulation or compatibility policy. Proposed copy should describe pickup-slack timing separately from the saved setting/engine-rule acceptance. Evidence: review/phase4/PERSONA-A.md and the selected-result screenshots.

### Preserve page position when dismissing a header menu
Minor; A-P3-05/B3E-2/C3E-2, reconfirmed by all Phase4 personas. From scrolled Results, open More options and Escape: focus returns correctly, but the underlying page moves1048→93 in the recorded sequence. Preserve the position through plain open/dismissal and restore the sticky opener without scrolling; deliberate navigation keeps intentional scroll. Evidence: review/phase4/receipts/menu-return.json. D7 saved-context restoration does not close this menu issue.
