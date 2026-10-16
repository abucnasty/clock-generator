# Phase 3 end review — A, newcomer advocate

**Verdict: PASS for Phase 3, with explicit minor findings and carries below.** I found no remaining newcomer blocker or major defect in the inspected current product. Import, Generate, error recovery, chosen-clock retrieval and installation now form a usable path. This is not release approval or a claim of full WCAG 2.2 AA conformance.

I reviewed immutable product `21261c5d86089f273a7880cc3a6f180eba17760c`, UI tree `da84a421c68e193343c1803db89d0301dde42f96`, with unchanged engine `81e2f2279361387d3141a14e53e147d37288c3d4`. The [phase equivalence receipt](/tmp/ux-phase3-closeout-review/PHASE-REVIEW-EQUIVALENCE.json) maps this to phase head `b3e14807f3aca7584721d1a6e9f75025772d71bb` through documentation-only differences.

Evidence shorthand used below:

- **B:** `/tmp/ux-phase3-end-final-r16-four`
- **H:** `/tmp/ux-phase3-3ghi-r16-four`
- **S:** `/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src`
- **F:** `/tmp/ux-phase3-followups-round1-final`

I read the original brief, newcomer report and synthesis; current PLAN/PROGRESS and Phase 4 decisions; Phase 2 synthesis/disposition and newcomer carries; and relevant 3.F dispositions. I inspected current PNGs and ARIA at 1440/960/720/390, including long Results slices, import/recovery dialogs, shared builds/Undo, editors, Fuel, Cancel, both header menus and 560px-high header/menu states. I read geometry, PAINT, coverage, live traces and relevant current source. I did not run the app, browser, tests or Git, and did not mutate files.

### 1. Gut reaction

I now understand what I will get before touching the form: a circuit clock, a blueprint and wiring work to do in Factorio. I can paste a build, try an example or enter one manually, and a failed clipboard operation no longer leaves me stranded. Results gives me an actual answer with rate, recovery, belt requirement and a clear Copy action. I would still find the page unnecessarily long, and the initial “pick the recipe” instruction conflicts with the intended Paste route. I would trust the recovery affordances enough to experiment, while reading the selected clock’s belt condition carefully.

### 2. Top changes I’d make tomorrow

1. **Correct the belt-setting sentence before polishing its layout.** A cancelled Military science run selects “For belts that stand still” and explicitly warns that it may fail on a moving belt, then says “These clocks assume your input belts are moving.” The latter describes the run setting as though it described every produced clock. Say “This run used your Moving belt setting,” and keep the selected clock’s actual requirement separately visible. This is a current copy defect; D4’s future grouping does not close it.

2. **Bring comparison beside the answer, with installation and chart detail available on demand.** The small Logistic science result is 3275px tall at 1440 and 3837px at 720. Its full installation procedure and Wake windows teaching come before comparison. A newcomer can copy immediately, but comparing alternatives and returning to the changed answer requires substantial travel. The approved D1/D4 direction addresses this; it remains unimplemented and open.

3. **Offer the three entry routes immediately after the purpose sentence.** The first screen tells me to “Start: pick the recipe you want to make,” while its main offer is Paste from Factorio. The intro also puts Alt+E and copy instructions before the mod-install prerequisite and before the route buttons. Use the approved route-first introduction, and reserve recipe guidance for Build by hand.

4. **Format quantities in Fuel’s text summary.** The new equivalent text is useful, but “82.09359999999995 items burned” looks like a broken calculation and becomes cumbersome speech. Display an appropriately rounded value such as “82.094 items burned.” Preserve exact event ticks and underlying values.

### 3. All findings

| # | What’s confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| A-P3-01 | The selected standing-belt clock is followed by “These clocks assume your input belts are moving.” The selected reason correctly says that this clock may fail on moving belts, so the page gives conflicting descriptions. | A newcomer deciding whether a stopped run produced something safe for their actual belts | minor | Rename the line to describe the saved run setting: “This run used your Moving belt setting.” Keep “Selected clock requires belts that stay full and stationary” separate when applicable. Preserve the existing ranking and switch action. | S | **B** `w720/89-generation-cancelled-720.png` and matching ARIA; **S** `utils/beltQuestion.ts:26–29,83–86`; `components/BeltAssumptionLine.tsx:23–27`; `components/ResultSummaryCard.tsx:225–237` |
| A-P3-02 | Installation and chart teaching separate “Your clock” from comparison. Selecting another row changes the answer and wiring list several screens above. | Newcomers making an intentional comparison, particularly beside the game at 720px | minor | Deliver D1’s contextual Why/Wake/Install area with comparison visible nearby. In the explanatory view, collapse routine teaching while retaining installation access and essential warnings. Provide a clear route to the selected answer if comparison remains distant. | M | **B** `w1440/08-results-answer-1440-part1of4.png` through `part4of4.png`; `w720/08-results-answer-720-part1of5.png`; **H** `w720/42-compare-keyboard-560-columns-toggled-720.png`; **S** `components/ResultsWorkspace.tsx:136–188` |
| A-P3-03 | The first instruction says “pick the recipe” before I have chosen manual entry. The mod prerequisite and three entry buttons follow the longer Sidecar procedure. | A first-time visitor without the mod, or someone who assumes blank recipe fields must be completed before Paste | minor | Deliver the approved purpose → Paste/Example/Manual order. Put the linked mod prerequisite at the beginning of the expanded Sidecar guide. Change the initial hint to describe the routes. | S | **B** `w1440/01-first-visit-1440-part1of2.png`; `w390/01-first-visit-390-part1of3.png`; **S** `utils/firstProblem.ts:28`; `components/IntroCard.tsx:77–95` |
| A-P3-04 | Fuel’s persistent text exposes floating-point noise: “82.09359999999995 items burned.” | Anyone inspecting fuel safety; screen-reader users hearing the entire number | minor | Format displayed summary quantities consistently to a useful precision. Do not round event boundaries or change engine data. | S | **B** `w720/85-fuel-events-and-trace-text-720-part5of6.png`, matching ARIA line 232; **S** `utils/fuelAccessibility.ts:42–43` |
| A-P3-05 | Escape from a scrolled header menu at 390px moves the page context even though focus returns to the same visible opener. This is baseline-equivalent, but it still loses the player’s place. | Narrow-window keyboard users reopening a menu during a long edit | minor, existing carry | Reconcile sticky-header focus restoration and approximate page position within D1/D7. Preserve the native modal scope and exact opener restoration. | M | `/tmp/ux-phase3-scroll-focus-COMPARISON/ROOT-DIAGNOSIS.md` and `COMPARISON.json`; **H** narrow menu/restored-state evidence. Recorded movement is −467px at 844px height and −325px at 560px height. |
| A-P3-06 | The focused Included/Excluded chip remains partly clipped in the passive 320px Swing plan position. Stable width prevents growth; opening its tooltip does not prove passive visibility. | A keyboard user inspecting a large plan at 320 CSS pixels | minor, existing carry | Ensure the complete focused chip is visible inside the local data scroller without replacing its node or losing focus. | S/M | **F** `w320/06-larger-editable-excluded-tooltip-320.png`, `CHECKING-TRACE.json`; current **S** `components/TransferPlanPanel.tsx:189–199`; canonical 3.F round-1 disposition |

A-P3-01 is minor because the clock title, Belt tile, recommendation reason and comparison status already expose the standing-belt requirement. It is still a real factual presentation defect. A-P3-02/03 are present usability problems with approved future owners, not delivered fixes.

#### Original newcomer finding closure

“Fixed” below means the adopted behavior is present. It does not mean every suggested implementation in the original review was accepted.

| Original finding | Closure | Current evidence and remaining boundary |
|---|---|---|
| **A1 — no purpose or starting route** | **Fixed** | Current first-visit PNGs show purpose, procedure, Paste, examples and manual entry. Route ordering remains A-P3-03; the old absence is closed. |
| **A2 — unnamed/hidden Sidecar and no paste fallback** | **Fixed** | Named mod link and prominent Paste are present. `PasteFromFactorioDialog.tsx:37–70` supplies persistent guidance, textarea and Continue. |
| **A3 — unsafe `/c` instruction** | **Fixed for adopted scope** | `MachinesForm.tsx:76–84` leads with Sidecar and explicitly says `/c` turns off achievements for that save. A speed calculator was not an adopted commitment. |
| **A4 — no examples** | **Fixed for adopted scope** | **B** `w1440/05-examples-1440.aria.yml` exposes nine science examples, their scale and replacement/Undo explanation. A complete scaffold tutorial was not the adopted requirement. |
| **A5 — stale clock silently copyable** | **Fixed** | **B** `w1440/29-old-clock-consent-1440.png` names the previous recipe/rate/time and actual change, offers Cancel, and labels the deliberate old-copy action. Imports clear results; Undo restores them. |
| **A6/A12 — circular disabled actions and mandatory Validate** | **Fixed** | Generate checks first; broken-build guidance names the missing item and provides repair actions. **B** `w1440/52-broken-build-first-problem-1440.png`; current `firstProblem.ts:15–28`. Check only remains secondary. |
| **A7 — unreachable Configure at 390px** | **Fixed** | Configure, Results, Generate and Copy remain visible in current 390px shots. Both menus also work at 560px height. Context movement on Escape remains A-P3-05, not a recurrence of unreachable navigation. |
| **A8 — missing installation instructions** | **Fixed** | Full import/place/green-wire/Anything > 0/lock instructions and actual wiring list appear in **B** Results parts 1–2. Current disposition records owner PASS for all installation cases, including books, drills and replacing an older clock. No new manual checkpoint is required. |
| **A9 — unexplained recommendation** | **Fixed** | Recommended marker, selection reason and moving-versus-standing tradeoff appear before Copy. The recommendation remains distinct from a manual pick. **B** Results parts 1/3 and `34-manual-clock-pick` state. |
| **A10 — hidden belt question** | **Fixed** | Visible question in Belts; Moving default; Results offers a direct alternative-belt regeneration action. The inaccurate run-setting sentence is A-P3-01. |
| **A11 — Potential Clocks wall of method prose** | **Fixed for that surface** | Comparison uses a short introduction and collapsed “How clocks are chosen.” New density across installation/Wake windows remains A-P3-02. |
| **A13 — default Validation jargon and contradictory swing wording** | **Fixed for adopted scope** | Default Validation panel is gone; Swing plan is in Advanced. Output-swing scope now explicitly says total per output machine, divided across its output inserters. |
| **A14 — messages hidden by footer** | **Fixed** | Current failure and Undo messages occupy the header flow, above content. **B** `32-copy-failed`, `52-broken-build-first-problem`; `Messages.tsx:146–148`. |
| **A15 — file actions dominate and reject Sidecar files** | **Fixed** | Open/Save build file are in More options; Paste is visible. `ConfigImportExport.tsx:325–332` routes a Sidecar export file through the paste review. |
| **A16 — total/per-copy ambiguity** | **Fixed for adopted scope** | Target helper gives total and per-copy scope, Copies explains one modeled unit and fractional units, and result tiles distinguish all copies from one-copy wake-ups. Per-machine planned-demand display remains D8 investigation only. |
| **A17 — Paste leaves the target unexplained** | **Fixed** | Import review offers the suggested/inferred target, explains maximum versus desired rate and names the target it replaces. **B** `47-paste-cross-category-preview` ARIA. |
| **A18 — destructive Reset with no recovery** | **Fixed** | Reset is separated and red in the menu; persistent Undo is available. **H** More→Reset→Undo states and current shared/library recovery evidence. |
| **A19 — Results opens on developer material** | **Fixed** | Your clock leads; timelines, Plan and Log require Developer tools. `ResultsWorkspace.tsx:128–151,191–206`. |
| **A20 — engine-heavy comparison and hover-only help** | **Partly** | Compact default columns, named radios, click-help, recommended-first order and separate unstable rows are present. General sorting is absent; distant comparison remains A-P3-02. |
| **A21 — internal names and unlabeled selection** | **Partly** | Plain tradeoff names and “Selected clock” are present where header room permits. Repeated “For belts that stand still” names still need the technical subtitle to distinguish them; D4 remains future work. |
| **A22 — “Not searched” sounds broken** | **Fixed** | Direct Search deeper action and plain explanation replace the algorithm-failure list. The extra Advanced-switch explanation remains a minor density carry. |
| **A23 — unexplained Enable gear** | **Fixed for adopted scope** | Quiet Enable: Auto/mode chips replace the bare gear. The rule editor explains planning versus exported blueprint behavior. |
| **A24 — two meanings of Stack size** | **Not fixed as the literal rename proposal** | The current 960px Configure slice still uses Stack size for belt lanes and inserters. This is a retained terminology refinement, not an unfinished Phase 3 safety item. |
| **A25 — drifting terminology** | **Partly** | Terms, plain clock names and corrected provisional wake-up definition are present. Advanced/progress/engine detail still uses technical vocabulary. The factual wake-up mismatch from Phase 2 is closed. |
| **A26 — noisy numbers** | **Partly** | Ordinary editor values and maximum-rate chips are formatted. Fuel’s new text summary reintroduces unrounded numerical noise: A-P3-04. |
| **A27 — internal item IDs everywhere** | **Fixed for adopted UI scope** | Current target, rows, errors, diagrams and installation list use game names. Explicit JSON/technical-detail exceptions remain. |
| **A28 — editor order and full empty sections** | **Fixed** | Machines → Belts/chests → Inserters → Drills; empty chest/drill sections are add rows; Advanced is collapsed by default. **B** complete Configure slices. |
| **A29 — Ko-fi dominates** | **Fixed** | Quiet outlined support link in the non-sticky footer; green marks the current commit/next action and orange marks selection. |
| **A30 — missing metadata/unfurl description** | **Not fixed; explicitly excluded** | Current `clock-generator-ui/index.html` still has the title without description/OG tags. This was excluded from the adopted first-visit scope and is not a Phase 3 completion defect. |

#### Phase 2 and Phase 3 carry closure

| Carry | Closure | Evidence and limits |
|---|---|---|
| **A-P2-01 — conflicting wake-up definitions** | **Fixed** | Current Wake windows and Terms both distinguish machine starts for inputs from finishes/productivity payouts for outputs. **B** Results part 2 and Terms ARIA; authoritative 2.F disposition. |
| **A-P2-02 / B19 / N35 — partial-Paste replacement safety** | **Fixed for replacement scope** | Current→incoming counts, explicit numbered crossing consequences and acknowledgment appear in **B** `47`/`48` PNG+ARIA. Import remains disabled before acknowledgment. `ConfigImportExport.tsx:179–184,404–406,698–718` resets and rechecks the acknowledgment against current input. Append remains separate. |
| **A-P2-03 — unconditional net UPS promise** | **Fixed** | Current intro describes fewer inserter wake-ups rather than guaranteeing net build UPS savings. No measured savings claim is inferred. |
| **A-P2-04 / N5 / N43 — inconsistent Diagram commit models** | **Fixed** | All five draft families have captured Save/Cancel states; the inspected Machine dirty-close confirmation offers Keep editing/Discard. **B** states `59–74`, especially `w960/61-diagram-discard-confirm-960.png`. |
| **A-P2-05 / N13/N42 — cannot stop generation** | **Fixed for cancellation; partly for copy** | Real in-flight Cancel, stopped-run qualification and recovery are captured in **B** `88–90`. The current progress still says “Batched swings” and “Checking clock-only output, clock start 1/12”; that technical primary description remains. |
| **A-P2-06 / N4 — reorder recovery and pointer alternative** | **Fixed** | Duplicate/Move up/down row actions, renumbering explanation and Undo are present. **B** `75–79`; current `MachinesForm.tsx:106–108,242`. |
| **N12/N44 — kept results/manual choice restoration** | **Fixed for adopted scope** | **B** `34–39`, `43`, `51` capture manual pick, reload, build return and Undo restoring the chosen clock. Broader view/selection/scroll context remains D7. |
| **Clipboard failure/manual-copy route** | **Fixed** | Visible persistent failure action, exact failed-attempt snapshot and Select string are shown in **B** `31–33`. `ManualBlueprintDialog.tsx` preserves the snapshot and provides focus fallback. |
| **Fuel keyboard/touch/text equivalents** | **Fixed functionally** | Current Fuel events table lists all six start/end/item events; persistent trace text describes levels and fuel clock. **B** `85`/`86` and ARIA. Numerical presentation remains A-P3-04. |
| **Aggregate output-swing scope** | **Fixed** | Actual help says total per output machine and equal division across its output inserters. **B** `22` and `87`; current `OverridesForm.tsx` helper/note. No engine arithmetic change is implied. |
| **N23 — Advanced hover-only help** | **Fixed** | Deliberate HelpButton dialogs and persistent input descriptions are present. Current `22–24` states; `OverridesForm.tsx` retains switch roles and descriptions. |
| **C21/N32 — dim stale plan with unsafe/unclear ownership** | **Fixed for adopted behavior** | Current stale plan stays readable and inspectable, identifies its age, and guards mutations. **B** `25–27`; `TransferPlanPanel.tsx:59–60,158–171,194–199`. Passive 320px chip visibility remains A-P3-06. |
| **320px ordinary-control reflow audit** | **Partly** | 3.F repaired measured ordinary overflow; fresh four-width evidence supports current supported-width/narrow behavior. Historical six-width evidence remains supplemental. The passive chip defect remains open; no blanket AA closure follows. |
| **3.G shared-success speech and recovery** | **Fixed with a stated native limit** | Cached/uncached live traces expose one coherent opening+Undo hint, with cache restoration appended where applicable. Ordinary Undo restores exact data and choice. Actual-write ownership/exposure guards and production timer regressions protect delayed delivery. The native pending-Undo critical interval was **not exercised**. |
| **3.H obstructing Copy/build-name tooltips** | **Fixed in inspected paths** | Normal/560 direct Configure navigation, retained slow-hover full-name help and menu suppression are captured. Separate 720px proof reaches Show all columns after 16 genuine Tabs, before any wheel, and restores RAW/clock. |
| **3.I both header-menu accessibility scopes** | **Fixed** | Current menu ARIA exposes only the named menu region; raw scope receipts confirm background isolation and exact opener restoration for both menus, keyboard/touch and normal/560 heights. A-P3-05 remains separate. |
| **A-P2-07/08/09/10/11/12/13/14/15; N38/N48** | **Partly or not fixed, as applicable** | Unknown free-text recipe rejection remains deferred until checking; belt-warning refinement remains; answer identity improves through named builds but is still weak on icon-only narrow headers; intro order, comparison travel, repeated names and teaching density remain. D1/D4/D5/D7/first-visit work is approved future scope, not current closure. |

### 4. What I’d cut or hide

- Move repeated Wake windows definitions and the full keyboard manual behind the established help pattern while preserving semantic descriptions and the table.
- Collapse routine installation explanation after presenting an obvious Install entry. Keep the wiring list, green wire and Anything > 0 easy to find.
- Remove the default Search deeper implementation note about which Advanced switch changes.
- Keep developer timelines, Plan and Log outside the default newcomer path.

These are presentation refinements. They do not justify removing belt warnings, stale provenance, unit scopes or recovery controls.

### 5. What already works

- **Recoverable entry:** named Sidecar guidance, examples, editable paste fallback, replacement review and Undo let me get a build in without trusting a blind overwrite.
- **A usable answer:** Your clock now explains rate, recovery and belt compatibility before Copy, with installation instructions that the owner has checked in game.
- **Consistent commitment and recovery:** Save/Cancel drafts, dirty-close confirmation, persistent destructive-action Undo, Cancel and kept chosen clocks make experimentation substantially safer.

### 6. Open questions for the author

No new owner decision or manual checkpoint is required by this review.

The remaining usability uncertainty is whether first-time players correctly interpret belt compatibility and find comparison/install guidance without excessive travel. The approved D3 baseline and repeat exercise should measure those tasks; screenshots and agent assertions cannot establish human success rates.

The evidence boundaries must stay explicit:

- The fresh broad **8002/0/0** and supplement **8043/0/0** support their executed assertions; I did not independently rerun them.
- Current Fuel contrast receipts verify sampled pixels/ratios, not every interface state. At 1440, three focus-outline bands are native; the fourth is a separately labeled wheel observation.
- Pending shared-speech Undo remains **not exercised natively**. The source and production timer tests are complementary protection, not a native race PASS.
- Extra native busy-input blocking and a painted busy-tooltip interval remain unsampled.
- The 390px Escape movement and passive 320px chip clipping remain current minor carries.
- D1–D9 and route-first introduction remain future work. D8 authorizes investigation only. D9 requires an actual independent audit **and justified implemented cleanup of UX-added UI tests before feature→master**; a report or post-release issue does not satisfy it.
