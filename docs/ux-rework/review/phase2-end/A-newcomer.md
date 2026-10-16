# Phase 2 end — Reviewer A: newcomer advocate

Review started **2026-10-16 09:31:22 UTC**; completed **2026-10-16 09:37:05 UTC**.

Reviewed product **3115caf106f0c0c0894ca448700553325413217b**, using the final assembled evidence at `/tmp/ux-phase2-end/review/` and source at `/tmp/ux-build-card-final/clock-generator-ui/src/`. Screenshot paths below are relative to that evidence directory; source paths are relative to that source directory unless stated otherwise.

I inspected first visits, populated Configure pages and complete Results pages at **1440, 960, 720 and 390px**, including their accessibility snapshots. I also inspected the rest-settled paste/help dialogs, diagram and entity dialogs, stale results, generation, broken-build recovery, developer timelines, blueprint strings, and complete fuel Configure/Results slices.

This was read-only. I did not run the application, browser, tests or Git. Documented checks are supporting evidence, not checks I independently performed.

### 1. Gut reaction

I can now understand the offer and find a credible way into it without already knowing the generator. Paste, examples and the grouped Build editor give me a usable route from my factory to a result, and Results finally gives me a clock before asking me to understand the simulator. I still encounter contradictory teaching: the introduction starts me with the mod while the sticky bar tells me to start with a recipe, and two parts of Results define a wake-up differently. I would try this version; I would still want the installation instructions checked in Factorio before trusting it with my real build.

**Verdict:** the main newcomer structure is implemented. I do not find a remaining first-visit or result-retrieval blocker at the agreed fully supported widths. I would fix the incorrect Wake windows definition before closing Phase 2, explicitly carry the remaining findings below, and retain the pending owner installation checkpoint. The current evidence does **not** establish full WCAG 2.2 AA conformance.

### 2. Top 5 changes I'd make tomorrow

1. **Make the wake-up explanation agree with the current engine.** Wake windows says a wake-up happens because a machine “finished a craft”; Terms correctly distinguishes craft starts for input inserters from finishes and productivity payouts for output inserters. This is the metric the tool ranks by. Use the updated explanation in both places, with one short version on the chart and the fuller definition in Terms.

2. **Warn when a partial paste combines two different builds.** The dialog still offers independent Machines, Inserters and Belts checkboxes without explaining their dependencies or showing current versus incoming counts. Importing new inserters while retaining old machines can make their numbered endpoints refer to a different factory. Show “Machines: 3 currently → 1 imported” and a visible dependency warning when the selection retains referenced entity types. This is the unresolved part of original B19, beyond Phase 2’s explicitly scoped old-mod wording.

3. **Stop promising a guaranteed UPS improvement.** “Costs less UPS” is stronger than the evidence described in the changelog: combinator overhead and the wake-ups removed determine whether clocking is worthwhile. Say “reduces inserter wake-ups, which can reduce UPS cost.” That preserves the product’s purpose without encouraging a player to wire an entire build on an unconditional performance promise.

4. **Put the onboarding prerequisites before their instructions.** “Get the Clock Generator Sidecar mod” and the Factorio 2.1 requirement appear after the Alt+E, selection and copy steps. Lead with “Install the Clock Generator Sidecar mod for Factorio 2.1,” then show the actions. While the introduction is visible, make the sticky start line say “Paste a build, try an example, or build by hand”; reserve “pick the recipe” for the manual route.

5. **Make comparing a clock visibly lead back to its answer.** Choosing a row changes the answer several screens above it. At 720px the sticky bar does not even show the selected clock name. Keep the selection in place, but offer an adjacent “View selected clock ↑” action and identify the product on the answer card, such as “Logistic science pack · 240/s across 11 copies.” This gives a newcomer a clear confirmation of what will be copied.

### 3. All findings

Rows explicitly marked **Phase 3 carry** concern already assigned work. They are not requests to expand Phase 2.

| # | What's confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| A-P2-01 | Wake windows says wake-ups happen because a machine “finished a craft.” Terms says inputs wake on craft starts, outputs on finishes or productivity payouts. The page teaches two different meanings for its main optimization metric. | Anyone trying to understand why one clock is better | major | Replace the chart definition with the current input/output distinction and maintain both surfaces from the same approved wording. | S | `w1440/21-logistic-results-1440-part2of4.png`; `w720/09-logistic-results-720-part2of5.png`; `utils/wakeWindowCopy.ts:17–19` versus `utils/glossary.ts:81–85`; root `CHANGELOG.md`, 0.13.0 |
| A-P2-02 | Partial paste still replaces entity types independently. The dialog shows incoming counts only and gives no dependency warning when, for example, imported inserters retain the old build’s machines. **Inherited B19 remainder; only its old-mod sentence was explicitly scoped into 2.2.** | A player importing a second build and unticking apparently optional boxes | major | Show current → imported counts. Warn when imported endpoints rely on retained entities; require an explicit acknowledgment of that combination. Keep Append as a separate future feature. | M | `w1440/09-paste-from-factorio-confirm-1440.png`; `components/ConfigImportExport.tsx:311–361, 578–626` |
| A-P2-03 | The introduction promises the build “costs less UPS.” That reads as a guaranteed net benefit, while the changelog describes thresholds where leaving inserters unwired is preferable. | Players deciding whether the wiring work is worthwhile | major | Say “reduces inserter wake-ups, which can reduce UPS cost.” Do not require a new advice UI to correct this claim. | S | All four first-visit PNGs; `utils/sidecarGuide.ts:24–25`; root `CHANGELOG.md`, 0.11.0–0.13.0 |
| A-P2-04 | Diagram dialogs have conflicting commit models: Machine changes apply immediately and the dialog has only Close; Inserter changes require Save/Cancel. **Known N5 / Phase 3 carry, 3.2.** | A newcomer inspecting a diagram who assumes Close discards an experiment | major | Complete the agreed draft/Save/Cancel model for all five entity editors in 3.2. | M | `w1440/15-diagram-entity-edit-dialog-1440.png` versus `w1440/16-diagram-inserter-edit-dialog-1440.png`; `components/EntityEditDialog.tsx:552–568, 610–628` |
| A-P2-05 | Generation has no way to stop. The visible status is engine language such as “Batched swings” and “Checking clock-only output, clock start 1/12.” **Known N13/N42 / Phase 3 carry, 3.3; already implemented on P3, absent from this product.** | Someone who starts a slow search or realizes the build is wrong | major | Deliver the assigned Cancel/keep-results behavior and give progress a plain primary description. | M | `w1440/39-generating-1440.png`; `components/WorkflowBar.tsx:290–318` |
| A-P2-06 | Dragging still renumbers entities without an Undo offer or an explanation. Those numbers are now also used in the installation instructions. **Known N4 / Phase 3 carry, 3.2.** | A player who has begun matching numbered inserters to the game | major | Complete the agreed reorder message, Undo and Move up/down alternative in 3.2. | M | `components/App.tsx` is actually `App.tsx:687, 697, 708, 722, 758` — direct reorder handlers; `utils/configForm/edits.ts:513–526`; original N4 mapping |
| A-P2-07 | A completely unknown recipe can still be committed as free text and only rejected by a later check. Matching known game names is improved, but a typo still looks like a selected value until then. **Known N48 remainder; deliberately retained by the 2.8 spec.** | Manual builders | minor | Keep imported unknown values visible, but show “Unknown recipe — choose a listed recipe” immediately for newly typed unknown text. | S | `components/ItemSelector.tsx:103–104, 145`; `components/TargetOutputForm.tsx:39–53`; `components/MachinesForm.tsx:139–151`; `specs/2.8-item-names.md:116–118` |
| A-P2-08 | Standing belts are explained as an opportunity for fewer wake-ups, but the question does not state the consequence of choosing this incorrectly. A player can interpret “backed up” as a belt that is usually full but occasionally moves. | Players attracted by the 177 → 0 offer | minor | Add: “Use this only if the pickup lanes stay full and stationary. If they move or run short, this clock may miss its rate.” | S | `w960/07-logistic-configure-list-960-part1of3.png`; `w720/07-logistic-configure-list-720-part2of3.png`; `utils/beltQuestion.ts:17–23`; the fuller warning already appears in `extra/w1440/01-alternative-how-made-help-1440.png` |
| A-P2-09 | The fresh answer card says “Makes 240/s” and “all 11 copies,” but never names the product. The page title and sticky selected-clock label also do not identify the build. | Someone returning from Factorio or comparing more than one build | minor | Add a product/name line to Your clock, using the generation’s product and copies, so stale and current views retain their own identity. | S | Results part 1 at all four widths; `components/ResultSummaryCard.tsx:103–150` |
| A-P2-10 | The introduction tells me to press Alt+E before telling me to install the mod. The Factorio 2.1 prerequisite is also after the procedure. At 390px this is a substantial amount of reading before the real prerequisite. | A first-time visitor without the mod | minor | Put the linked installation prerequisite first, followed by the four copy actions; retain the existing paste fallback. | S | All four `02-first-visit-above-fold` PNGs; `components/IntroCard.tsx:77–85`; `utils/sidecarGuide.ts:16–20` |
| A-P2-11 | The sticky “Start: pick the recipe you want to make” instruction competes with the intended primary route, Paste from Factorio. It makes the blank fields appear to be a prerequisite to importing. | A newcomer following the first visible instruction | minor | While the intro is present, use “Paste your build or try an example.” After Build by hand, show the recipe instruction. | S | All four first-visit PNGs and ARIA snapshots; `utils/firstProblem.ts:27–28` |
| A-P2-12 | Selecting another clock changes the card and wiring information far above the comparison table without a nearby route back. Selection itself is visible, and screen-reader announcements help, but the primary consequence is offscreen. | Mouse users comparing choices, particularly at 720px | minor | Provide “View selected clock ↑” beside the comparison controls. Keep automatic scrolling optional so successive comparisons remain easy. | S | `w720/09-logistic-results-720-part1of5.png` versus parts 3–4; `components/ClockAlternativesPanel.tsx:204–218`; `App.tsx:283–289` |
| A-P2-13 | Several rows have the same plain name: three “For belts that stand still” entries in logistic science, and tied “Fewest wake-ups” entries in the fuel example. Distinguishing them requires decoding the technical subtitle. | A newcomer attempting an intentional comparison | minor | Keep the shared trade-off name, but add a concise distinguishing value: “Standing belts · 0 wake-ups/min,” “Standing belts · 82/min.” | S | `w1440/21-logistic-results-1440-part3of4.png`; `extra/w390/12-fuel-results-fuel-tab-390-part5of7.png`; `utils/clockSummary.ts:79–83, 102–113` |
| A-P2-14 | Wake windows places three definitions, a legend and the full keyboard instruction paragraph before the actual chart. At 720px this consumes much of a screen; at 390px it becomes a lecture before a three-row picture. | Players who just want to understand when their inserters turn on | minor | Keep one explanatory sentence and the legend visible; move the detailed definitions and keyboard reference into the existing click-help pattern. Preserve the accessible descriptions. | S | `w720/09-logistic-results-720-part2of5.png` and part 3; `w390/09-logistic-results-390-part3of7.png` and part 4; `components/WakeWindowsView.tsx:141–151, 197–199` |
| A-P2-15 | Search deeper’s good one-line offer is followed by an “Always” checkbox and a second explanation naming the underlying Advanced switch. This exposes the implementation of a simple choice. **Known N38 optional copy carry.** | Newcomers who are already unsure whether more searching is necessary | nit | Keep Search deeper in the default offer; put “Always search deeper for this build” behind a small options disclosure and remove the duplicate Advanced-switch explanation. | S | `w960/09-logistic-results-960-part4of5.png`; `components/DeeperSearchNotice.tsx:90–105` |

For A-P2-06, the source file is **`App.tsx`**, not a file under `components/`.

### 4. What I'd cut or hide

- The repeated chart definitions and keyboard manual from the default visual path. Keep the chart’s semantic descriptions and table alternative.
- The implementation note explaining which Advanced switch Search deeper changes.
- Low-level installation exceptions should be progressively disclosed after the normal instructions. The wire list and “Anything > 0” instruction must remain visible. This is a copy/layout refinement, not a claim that the unverified installation procedure is wrong.
- Do not put the developer timelines or Log back onto the newcomer path. Their current separation is doing useful work.

I am not requesting the deferred compact/theme/wide-layout or target/max/achieved-rate designs D1–D8.

### 5. What already works

- **The route in exists:** named mod link, prominent Paste, recoverable paste dialog, examples, and a manual alternative.
- **The answer exists where I expect it:** Your clock, the reason, rate, recovery, belt assumption, Copy and installation steps precede comparison and developer material.
- **The manual editor now has a coherent order:** Target → Build, with Machines → Belts and chests → Inserters → Drills, and Advanced collapsed.

### 6. Open questions for the author

1. The installation check is still pending. Does the actual in-game walk-through confirm the exact blueprint-library import action, combinator identification, green-wire connections, enable condition, book variant and lock instructions? This is an existing release checkpoint, not a request for another approval process.
2. Should partial type replacement remain on the newcomer paste path? The remaining B19 dependency/count problem needs a named owner even if Append stays deferred.
3. How should the project reconcile **full WCAG 2.2 AA** with the separate decision to guarantee only reachability below 720px? The latter does not settle the former’s 320 CSS-pixel reflow requirement. The present evidence does not answer that policy conflict.
4. Should the input/output wake-up definition in Terms now be the authoritative provisional wording everywhere? The recent engine change has already made the older chart explanation inaccurate.

## Original finding verification

**Status convention:** “fixed” means the approved Phase 2 behavior is present. “Partly” distinguishes a repaired Phase 2 portion from a broader original request, an explicit deferred portion, or pending manual verification. It must not be read as a demand to implement everything in the original review during Phase 2.

### Original IDs addressed by Phase 2 or its carried work

| Original ID | Status | Evidence and remaining boundary |
|---|---|---|
| A1 | **Fixed** | Intro explains the tool, procedure and entry routes; first-visit PNGs/ARIA at all four widths. A-P2-10/11 are refinements to the new content, not the old absence. |
| A2 | **Fixed** | Named linked Sidecar, header/card Paste and manual paste box; `w1440/07-paste-from-factorio-bad-clipboard-1440.png`; `IntroCard.tsx:19–24`. |
| A3 | **Fixed for approved scope** | Machines help points to Sidecar and says `/c` turns off achievements; `MachinesForm.tsx:61–69`. No speed calculator was authorized. |
| A4 | **Fixed for approved scope** | Try an example is available in intro/menu; nine examples verified by the recorded first-visit item gate. `ExamplesDialog.tsx:47–70`; `capture/build-card-EVIDENCE.md`. A complete playable scaffold tutorial was not the Phase 2 requirement. |
| A6 | **Fixed** | Neutral blank-build start text, enabled Generate, focus on first problem; four-width capture checks and broken-build images. |
| A8 | **Partly: app fixed; manual checkpoint pending** | Numbered import/place/wire/enable/lock instructions and wiring list are present, including book-specific instructions in the fuel example. Owner’s in-game installation review has not passed yet. |
| A9 | **Fixed** | Persistent Recommended marker, explicit moving-belt reason and alternate-belt action; Results part 1/3 at 1440. |
| A10 | **Fixed** | Visible input-belt question, Moving default and matching Results assumption/action; Configure and Results at all widths. |
| A12 | **Fixed** | Generate checks first; first problem receives focus; Check only remains secondary; plan in Advanced. Capture checks; `CheckPlanSection.tsx:56–76`. |
| A15 | **Fixed** | Open build file / Save build file in menu; Paste remains visible. `ConfigImportExport.tsx:473–495`. |
| A16 | **Fixed for the assigned P2 portions** | Total/per-copy helper, Copies explanation, pasted target and target-capacity blocking line are present. This does not turn deferred D8 rate presentation into a current requirement. |
| A17 | **Fixed** | Suggested/inferred target appears in confirmation; complete older imports receive the non-contradictory optional-update sentence. `pasteTarget.ts:35–49`; engine `sidecar-version.ts:118–121`. |
| A19 | **Fixed** | Answer first; developer timelines, Plan and Log separated; default Results ARIA and complete Results slices. |
| A20 | **Partly** | Compact comparison, click help, recommended-first and separate unstable rows are present. General column sorting from the broader original proposal is absent. `ClockAlternativesPanel.tsx:186–198, 357–398`. |
| A21 | **Fixed for approved scope** | Plain names, technical secondary line and “Selected clock” header at widths with room. Repeated plain names are A-P2-13. |
| A25 | **Partly** | Glossary and most UI copy are repaired; engine terms remain deliberately exposed, and the chart/Terms wake-up definitions disagree. A-P2-01. |
| A27 | **Fixed for approved scope** | Game names in target, machines, belts, error messages and diagrams; source intentionally retains engine-text exceptions. Four-width Configure/Results evidence. |
| A28 | **Fixed** | Build grouping/order and collapsed empty chest/drill add rows; complete Configure slices. |
| B7 | **Partly overall** | Readable Enable chips are present. “Show only overridden” belongs to the documented 3.2 carry, not 2.11. |
| B10 | **Fixed** | Generate checks without a separate required Validate step; Check only is secondary. Fresh capture first-problem checks; `WorkflowBar.tsx:290–318`. |
| B12 | **Fixed for approved scope** | Recommendation survives selection; reason, Works and About expose the relevant differences. Dedicated “Not picked because” column was replaced by the approved summary/comparison design. |
| B14 | **Partly** | Compact table, collapsed selection explanation, recommended first and unstable grouping are present. Sorting, collapsible-to-one-row table and sticky Details tabs are not. |
| B16 | **Partly by explicit scope decision** | Backspace harm was addressed earlier; P2 provides arrowheads and left-to-right flow. Draggable/saved node positions were explicitly excluded from 2.11. `w1440/17-diagram-fullscreen-1440.png`; `specs/2.11-diagram.md:48–50`. |
| B17 | **Partly overall; P2 portion fixed** | Near lane is present in List and Diagram; game-type wording and capacity handling agree. One shared all-entity editor remains 3.2. |
| B19 | **Partly** | The scoped old-mod sentence is fixed. Current/incoming count comparison, dependency warnings and Append are absent; A-P2-02. `specs/2.2-sidecar.md:4` explicitly limits this item to the old-mod sentence. |
| B21 | **Fixed** | Generate/first-problem text names the missing ingredient and takes focus there; broken-build 1440/390 evidence. |
| B27 | **Partly overall** | Target-capacity limit is fixed; optional capacity is now explicitly Automatic rather than silently hard-coded on clear. The broader mouse-click select-all request remains outside the completed P2 scope. `NumberField.tsx:165–173`; `inserterMetadata.ts:24–28`. |
| B32 | **Partly** | UI glossary and Fuel wording improved; inherited engine terminology and the A-P2-01 disagreement remain. |
| C2 | **Partly overall; new player-facing chart fixed** | Wake windows has textual row summaries, keyboard guidance, selectable windows and table alternative. The legacy charts do not receive a complete interaction redesign under the approved light-fix scope. |
| C3 | **Fixed** | Intro Paste is primary on first visit; valid Configure uses Generate; fresh Results uses the card’s green Copy with outlined header actions. Four-width first-visit/Results images. |
| C7 | **Fixed for approved P2 scope** | Compact table, recommendation first, stable visual recommendation marker, belt-specific Works messages and click help. 720–960 comparison is legible. Broader phone layout remains restricted by owner scope. |
| C10 | **Fixed for assigned portions** | Grey click-help controls and Terms buttons replace the important hover-only teaching surfaces; rest-settled About screenshots. |
| C11 | **Fixed for light-fix scope** | Separate magenta/cyan/rose item palette and named Factorio-state strip legend; timeline final slices at 1440/960/720. |
| C12 | **Fixed for light-fix scope, supported by item gates** | Dark tracks and visible Disabled marks; documented minimum-width/paint checks. I did not independently remeasure contrast or every transition. |
| C13 | **Fixed for assigned accessibility feedback scope** | Named status/progress feedback and first-problem focus are present. Cancel is independently assigned to 3.3. |
| C14 | **Partly relative to original; agreed ≥720 scope fixed** | Forms reflow and comparison works at supported widths; internal scroll regions preserve the page width. 390 comparison/detail overflow remains historical, not newly introduced. |
| C16 | **Fixed** | Consistent grey question-mark help and labeled Show rates toggle; Configure, About and diagram screenshots. |
| C20 | **Fixed for approved scope** | Arrowheads, readable left-to-right flow and fullscreen fitting; `w1440/17-diagram-fullscreen-1440.png`, plus documented item checks for keyboard/text requirements. |
| C21 | **Not fixed** | The out-of-date/checking plan still applies opacity `0.45`. `CheckPlanSection.tsx:79–96`. The 2.7 spec explicitly hands this outside its own implementation; assign its final disposition rather than claiming it closed. |
| C23 | **Fixed** | Grouped Build card, contained List/Diagram switch, correct section order and collapsed empty sections. |
| C24 | **Fixed for P2 scope** | Source/Destination use the available row area at supported widths, delete icons are quiet at rest, and filters expose one add slot. Recorded Automatic-helper alignment follow-up remains with 3.2; owner-approved explicit-helper removal is not a defect. |
| C26 | **Partly overall** | UI rounding, units and alignment improved. Engine prose still uses 177.3 while the overview rounds to 177; that deliberate engine-text exception remains. |
| C27 | **Fixed for approved scope** | Why/Explanation collapsed, prose constrained, old Validation paragraph removed, Search deeper directly actionable. New chart teaching density is A-P2-14. |
| C28 | **Fixed** | Green Save/Import/Copy, quiet Cancel, square chips and orange selections; settled dialogs and Results evidence. |
| C30 | **Partly** | Broad copy consistency improved. Legacy “Transfer Activity Timeline” and engine wording remain; the chart definition also drifted from Terms. |

**Referenced exclusions, not failed Phase 2 commitments:** A30’s metadata/SEO request was explicitly excluded from 2.1; C18’s cross-view entity-color harmonization was not part of 2.10; C29’s proposed “In LCM” switch was explicitly excluded from 2.7. C29’s green/off color problem is improved—the chip no longer sets green—but “Exclude from LCM” with “Included/Excluded” remains (`TransferPlanPanel.tsx:116, 184–188`).

## Phase 1 end carry mapping

This table maps the Phase 1 synthesis’s **N IDs** to the reviewed Phase 2 product. “Fixed” does not imply every original proposal around that area was implemented.

| Carry | Phase 2 owner | Status in this product | Evidence / remaining boundary |
|---|---|---|---|
| N1 | 1.5 F | **Fixed** | Import Undo is docked in the header, clear of Configure; ends when a check/generation starts. Four-width imported Configure; `App.tsx:385, 419`. |
| N2 | 1.5 F / owner Q1 | **Fixed per decision** | Starting a run withdraws Undo; no timer was added. Same source. |
| N3 | 1.5 F | **Fixed for observed states** | Settled paste dialogs are unobscured; import message is no longer an overlay across form/dialog content. |
| N6 | 2.1 W / owner Q4 | **Fixed** | Target-capacity blocking problem and under-field explanation; `TargetOutputForm.tsx:55–66`; `firstProblem.ts:20`. |
| N7 | 2.7 A | **Fixed** | Fresh Results’ green next action is Copy; four-width Results part 1. |
| N8 | 2.7 A | **Fixed** | Grey idle delete/removal controls; Configure slices. |
| N9 | 2.9 + 2.5 B | **Fixed at ≥720; historical 390 limitation remains** | Rates are folded when constant, Wake-ups and Works fit at 720/960. 390 still requires horizontal scrolling. |
| N10 | 2.5 B | **Partly** | Constant Makes folded, recommendation first, About inline, disclosure chevron beside words. No general sorting/data bars. |
| N11 | 2.1 | **Fixed** | Neutral first-step instruction replaces red blank-build problems at every width. |
| N13 | 2.5 B + 3.3 | **Partly** | Debug Output removed from default progress; first-clock placeholder exists. Cancel and better sustained-run workflow remain P3. |
| N14 | 2.5 A/2.6 | **Fixed in app; install check pending** | Your clock and install procedure precede Wake windows and Details. |
| N15 | 2.3 | **Fixed** | One Generate/check flow with first-problem landing; no mandatory Validate round trip. |
| N16 | 2.10 | **Fixed within light-fix scope** | Named state chart, separate item palette, bottom-strip legend and documented contrast/mark repairs. |
| N17 | 2.11 | **Fixed within assigned scope** | Diagram direction, arrowheads, readable nodes and fullscreen view. |
| N20 | 2.9 | **Fixed for assigned supported widths** | Compact, reachable desktop/half-width header; 390 wrapping remains the documented boundary. |
| N21 | 2.3 | **Fixed** | Generate’s helpful tooltip/first-problem action works; no disabled circular prerequisite. |
| N22 | 2.7 A | **Fixed** | Recommended is a neutral outlined marker; selection owns the orange row. |
| N23 | 2.7 A/2.5 B | **Fixed for assigned help** | Clickable grey help and Terms controls; `extra/*/01-alternative-how-made-help` PNGs. |
| N24 | 2.5 B | **Partly** | About is now accessible and split into readable paragraphs, but still lengthy engine prose. `ClockAlternativesPanel.tsx:229–238`. |
| N25 | 2.5 B | **Fixed for assigned layout; engine rounding remains** | Prose capped at 75ch and numeric tables aligned; `InsightsPanel.tsx:36–53`; Results Details slices. |
| N26 | 2.5 B | **Fixed for player-facing presentation** | Tick/second durations are readable in summary, windows and fuel; developer wording still spells out “seconds.” |
| N28 | 2.5 B | **Fixed** | String has its own bounded box and a separate copy icon; blueprint-string screenshots at 960/390. |
| N29 | 2.7 A | **Fixed** | Settled Save and Import Selected are green; captured rule/inserter/paste dialogs. |
| N30 | 2.7 B | **Fixed at supported widths** | Wider endpoint fields, single add-filter slot; full Configure at 1440/960/720. |
| N31 | 2.7 A | **Fixed** | Grey question-mark header help throughout captured Build sections. |
| N32 | Ledger gave 2.7 A; spec excludes it | **Not fixed; ownership conflict remains** | `CheckPlanSection.tsx:96` retains `0.45`. Do not lose this between the ledger and the exclusion note. |
| N33 | 2.1 | **Fixed** | “Tick what to import. Each ticked part replaces the same part…” and corrected old-mod sentence. |
| N34 | 2.1 | **Fixed** | Target checkbox and sensible inferred target in settled confirmation; `pasteTarget.ts:35–49`. |
| N35 | Synthesis suggested 2.1; implementation scopes only old-mod B19 portion | **Not fixed beyond replacement copy** | No current → incoming entity counts or Append; no dependency warning. A-P2-02. |
| N36 | 2.5 A | **Fixed for assigned naming** | Plain trade-off names and selected-clock header; repeated-label refinement is A-P2-13. |
| N37 | 2.1 addendum | **Fixed** | Sidecar pointer and explicit achievements warning; `MachinesForm.tsx:61–69`. |
| N38 | Optional 2.5 B follow-up | **Not fixed** | Always checkbox and Advanced-switch caption remain; A-P2-15. This was not a mandatory Phase 2 completion criterion. |
| N39 | 2.7 B | **Fixed** | Coherent Build order and compact empty add rows. |
| N40 | 2.8 | **Fixed for assigned UI surfaces** | Human game names throughout captured form, diagrams and results; engine-text exception retained. |
| N41 | 2.5 B | **Fixed** | Copied state compares both blueprint and staleness identity; `useCopyBlueprint.ts:72–76`. |
| N45 | 2.3 | **Fixed** | Broken-build problems are consistently errors and receive first-problem focus. |
| N48 | 2.8, plus numeric follow-up | **Partly** | Typed known game names resolve correctly, but unknown recipe text intentionally remains commit-able until engine rejection; A-P2-07. Automatic stack capacity is now explicit. |
| N49 | 2.5 B | **Fixed** | Debug/Log/timelines are under Developer tools; fresh default Results ARIA. |
| N50 | 2.5 B | **Fixed for requested copy** | Fuel uses “Switched on every,” “Wake window” and “Wake windows with a swing”; complete fuel-tab evidence. |
| N53 | 2.3 | **Fixed for newcomer path** | Old Validation panel removed; plan is in Advanced. Its remaining technical and dimmed-state concerns are separate. |

**Already assigned outside Phase 2:** N4/N5/N43 belong to 3.2; N12/N42/N44 to 3.3. They remain absent from this immutable P2 product even where P3 already contains their implementation. N18/N19/N27 were Phase 1 end fixes, not unfinished Phase 2 work. N46/N47/N52 remain follow-ups rather than silently becoming new Phase 2 deliverables.

## Width, accessibility and release boundary

At **1440/960/720**, the inspected primary flow is usable: forms reflow, comparisons are readable, and actions remain available. At **390**, Configure, Results and the main actions are reachable; comparison and Details retain the documented internal-overflow limitations. I do not treat those historical sub-720 geometry limitations as a new failure of 2.9.

The recorded **775 PASS / 9 FAIL / 0 failed steps** half-width run must remain described that way. The nine historical 390 failures cannot be renamed a whole-suite pass. Likewise, the final main **28/0/0**, extra **6/0/0**, rest-settled reruns and Build/first-visit gates support their tested states; they are not complete AA certification.

The owner’s **full WCAG 2.2 AA** decision and the **below-720 reachability-only** decision remain unresolved at the policy boundary around **320px reflow**. I have not inspected a fresh 320px capture and do not claim a new measured 320px failure or a waiver.

**Sidecar 2.2:** owner’s in-game check passed on October 14, according to the current authoritative progress record.
**Installation 2.5 A:** owner’s in-game check remains pending and continues to hold the Phase 2 PR.
