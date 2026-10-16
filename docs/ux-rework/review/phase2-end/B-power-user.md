# Phase 2 end review B — power-user interaction designer

Review inspection started **2026-10-16 09:31:39 UTC** and ended **2026-10-16 09:36:39 UTC**.

Reviewed product **3115caf106f0c0c0894ca448700553325413217b**, using `/tmp/ux-build-card-final/clock-generator-ui/src`. Source references below are relative to that directory. Screenshot references are relative to `/tmp/ux-phase2-end/review/`.

I read the brief, root README and changelog, current PLAN and PROGRESS, original B review and synthesis, Phase 1 end synthesis, relevant Phase 2 specifications and committed Build-card evidence. I opened actual PNGs across **1440, 960, 720 and 390px**, including multiple Configure and Results states, relevant long-page slices, settled dialogs, stale results, generation, blueprint output, developer timelines, and extra help/fuel evidence. I inspected their accessibility snapshots and interaction source. I did not operate the app, browser, git or npm, change files, or read current peer reports.

**Phase 2 verdict: FIX.** The factual wake-up explanation still contradicts the integrated engine and the explicit compatibility specification. The import workflow also retains a substantial original B19 risk; its target suggestion and wording are fixed, but selective replacement still has no dependency protection or replacement preview. The latter needs explicit disposition rather than a blanket “B19 fixed.”

The main Phase 2 structure works at the supported widths. Most remaining large power-user problems already belong to Phase 3; I have identified those as carries, rather than asking for another Phase 2 redesign. The owner’s **2.5 A in-game installation check remains pending**. The sidecar’s **2.2 owner check passed October 14**. Neither capture totals nor my review constitute full WCAG certification.

### 1. Gut reaction

I can now tell what I am generating, why it was selected, and whether I am about to copy an old clock. At 720px beside Factorio, the important controls and build fields are usable, and Generate finally supports the edit-and-run loop directly. I still pay too much navigation cost when comparing alternatives: I select a clock far below the chart and explanation that change, then travel back to inspect it. Editing a large build remains the weak point, but most of that weakness is the already scheduled Phase 3 work rather than a failure to deliver Phase 2.

### 2. Top 5 changes I'd make tomorrow

1. **Correct the wake-up explanation everywhere.** Wake windows says a wake-up happens “because a machine finished a craft”; the full comparison help repeats that explanation. The Terms glossary correctly distinguishes input craft starts from output finishes and productivity payouts. Reuse that corrected definition across these surfaces. Explaining the wrong event undermines the expert’s interpretation of the product’s central optimization metric.

2. **Make selective Paste from Factorio safe to understand.** “Each ticked part replaces the same part” does not explain that imported inserters can attach to unrelated existing machines with matching numbers. Show current → imported counts and identify references crossing unticked categories before Import Selected. This is the significant remaining part of original B19; updating the target and old-mod warning does not close it.

3. **Finish the already assigned Phase 3 safety work.** Drag reorder still changes current numbers without an Undo offer, and Diagram dialogs still mix immediate changes with Save/Cancel drafts. Implement the owner’s resolved decisions in 3.2: retain drag, add announced Undo and Move up/down, and make all five entity dialogs drafts. These are scheduled carries, not reasons to reopen the owner’s decisions.

4. **Keep a run and its chosen clock through iteration.** Current generation clears the previous results and manual pick; reload keeps only the configuration. Deliver 3.3’s Cancel, result retention, restored selection and explicit provisional copying. A serious tuning session should survive a reload or a deeper search without reconstructing its working context.

5. **Close the distance between choosing and inspecting a clock.** Keep the comparison table in place, but give it a compact local selected-clock summary and an explicit “Show its wake windows” action. At present the explanation and graph change well above the selection, and “Back to recommended” is also up there. This makes repeated comparison unnecessarily physical even though the actual radio interaction is sound.

### 3. All findings

“P3 carry” means the owner has already assigned the work to Phase 3. “Follow-up” means a concrete improvement, not a new Phase 2 release requirement.

| # | What's confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| 1 | **P2 factual miss:** Wake windows defines a wake-up as occurring “because a machine finished a craft.” Full-table help repeats the same finishes-only model, while Terms correctly says input starts versus output finishes/productivity payouts. | Experts checking why clocked inputs save wake-ups; anyone interpreting the core metric | major | Use the corrected glossary definition in Wake windows and full-table help. Keep wake windows and wake-up counts distinct. This is the narrow correction already required by compatibility, not a new strict-definition exercise. | S | `w1440/21-logistic-results-1440-part2of4.png`; `w720/09-logistic-results-720-part2of5.png`; `w390/09-logistic-results-390-part3of7.png`; `utils/wakeWindowCopy.ts:17`; `components/ClockAlternativesPanel.tsx:60`; corrected `utils/glossary.ts:84`; compatibility spec:44 |
| 2 | **Original B19 remains partly open:** independently replacing entity categories can connect imported inserters to unrelated retained entities with the same numbers. The confirm dialog shows incoming counts only. | Repeat sidecar users updating part of an existing build | major | Show “Machines: 4 current → 2 imported,” etc. If selected categories refer to unticked categories, identify that explicitly and require the player to resolve or deliberately accept those references. Retain the existing whole-paste Undo. | M | `w1440/09-paste-from-factorio-confirm-1440.png`; `components/ConfigImportExport.tsx:311`, `:342`, `:543`, `:578`; `utils/configForm/edits.ts:149`, `:193`, `:231`, `:302` |
| 3 | **P3 carry, Q2 resolved:** reorder still renumbers entities without offering the same recovery as delete. It has keyboard drag support, but no Move up/down pointer alternative. | Fast editors; users tracking inserter numbers in notes or game wiring | major | Deliver 3.2’s announced reorder message, Undo and Move up/down. Keep consistent current renumbering and retained drag as the owner decided. | M | `components/SortableList.tsx:56`, `:118`; `hooks/useConfigForm.ts:131`; `App.tsx:687`, `:722`; PLAN 3.2 |
| 4 | **P3 carry, Q3 resolved:** an inserter Diagram dialog is a protected Save/Cancel draft; a machine dialog changes the build immediately and only has Close. Moving between entity kinds changes what closing means. | Anyone alternating machine and inserter edits | major | Deliver 3.2’s draft model for machines, belts, chests, inserters and drills, with Save/Cancel and consistent dirty-close handling. | M | `w1440/15-diagram-entity-edit-dialog-1440.png` versus `w1440/16-diagram-inserter-edit-dialog-1440.png`; `components/EntityEditDialog.tsx:562`, `:610`; `components/InserterConfigPanel.tsx:325`, `:423` |
| 5 | **P3 carry:** generation cannot be cancelled. A clock arriving during the run can be copied through a generically labelled Copy blueprint action while further clocks are still being made. | Large builds and deeper-search users | major | Deliver 3.3’s Cancel and either defer copying until completion or say “Copy current best.” Preserve an explicit distinction between provisional and finished selection. | M | `w1440/39-generating-1440.png`; `hooks/useSimulationWorker.ts:380`; `components/ResultSummaryCard.tsx:175`; `utils/recommendedClock.ts:51`; PLAN 3.3 |
| 6 | **P3 carry:** starting another generation clears the previous clocks and manual selection; a reload restores configuration but no completed working result. | Experts tuning one variable at a time | major | Deliver 3.3’s generation cache, restored selected clock and selection retention when the same clock still exists after regeneration. | M | `hooks/useSimulationWorker.ts:152`, `:394`, `:400`; `hooks/usePersistedConfigForm.ts:197`; PLAN 3.3 |
| 7 | **P3 carry:** one automatically saved configuration slot remains, with no named build switcher or other-tab conflict warning in this product. | Players juggling several builds or browser tabs | major | Deliver 3.4’s named builds, storage-event conflict warning and share links. Do not confuse its already merged P3 implementation with this P2 snapshot. | L | `hooks/usePersistedConfigForm.ts:16`, `:139`, `:197`; `w1440/06-more-options-menu-1440.png`; PLAN 3.4 |
| 8 | **P3 carry:** Clocked starts with an arbitrary 0–100 range, and the saved rule filters out ranges whose end equals or precedes the start. Equal ends are valid under the owner’s clarified inclusive-range rule. | Experts writing or repairing wake windows | major | Deliver 3.1’s period-aware range editor and inline validation; preserve valid single-tick ranges. Do not silently normalize a user’s intended rule. | M | `utils/enableControlDraft.ts:25`, `:44`; `components/EnableControlModal.tsx:128`; PLAN 3.1 |
| 9 | **P3 carry:** Quick Templates immediately substitutes a rule using the first available item; the latched template still contains 32 and releases against the sink. | Authors adapting an existing custom rule | major | Deliver 3.1’s item/amount prompt, replacement confirmation, readable rule preview and owner-agreed source-level release condition. | M | `components/EnableControlModal.tsx:312`; `components/QuickTemplateSelect.tsx:50`, `:58`, `:64`, `:79`; PLAN 3.1 |
| 10 | **P3 carry:** editing at scale still means repeating complete row forms. There is no Duplicate or bulk-edit bar, and the inserter Add action directly appends rather than landing focus in a new editor. | Builds with many inserters | major | Deliver 3.2’s Duplicate, multi-select/bulk changes, new-row focus and reduced tab cost using the shared editor. | M | `w720/07-logistic-configure-list-720-part2of3.png`, `-part3of3.png`; `components/InsertersForm.tsx:280`; `utils/configForm/edits.ts:157`; corresponding Configure ARIA snapshots |
| 11 | **P2 compatibility polish:** the summary’s Makes tile labels the total for Copies > 1, but drops the copy qualifier for supported fractional values below 1. The adjacent wake-up tile still says “one copy.” | Players using 0.5 copies or another partial unit | minor | Show the total qualifier whenever Copies differs from 1, including “all 0.5 copies,” or use a clearer partial-unit phrase consistent with Target Output. | S | `utils/clockSummary.ts:140–145`; correctly generalized helpers at `utils/numberText.ts:90`, `:110`, `:115`. Source-only state; not claimed as a captured fractional result. |
| 12 | Selecting a clock changes the card and Wake windows above the comparison table. The local table gives no quick explanation of how the selection differs, and the return-to-recommended control is above it too. | Experts repeatedly select → inspect → compare → copy | minor | Add a compact selection summary beside the table with its delta from the recommendation, “Back to recommended,” and “Show its wake windows.” Leave radio focus in place; make travel explicit. | M | `w1440/21-logistic-results-1440-part1of4.png` through `-part3of4.png`; `w720/09-logistic-results-720-part3of5.png`, `-part4of5.png`; `App.tsx:286`; `components/ResultSummaryCard.tsx:123` |
| 13 | The comparison table still cannot sort, and three rows share “For belts that stand still.” Their 102, 0 and 82 counts are easy to compare visually on desktop but have no ordering control. | Experts inspecting many generated alternatives | minor | Follow-up: allow sorting by wake-ups and windows, preserving the recommendation marker and unstable group. Keep the secondary technical label for identity. This was explicitly excluded from 2.5 B’s implementation scope, so it is not a surprise P2 blocker. | M | `w1440/21-logistic-results-1440-part3of4.png`; `w960/09-logistic-results-960-part3of5.png`; `components/ClockAlternativesPanel.tsx:359`; 2.5 spec:616 |
| 14 | **P3 carry:** the stale banner says the recipe and rate, but a machine/rule/stack edit may leave both unchanged. It warns safely without saying what I changed. | Experts comparing an earlier run with a current experiment | minor | Deliver 3.3’s changed-fields summary and generated time; add a direct Generate-again action where appropriate. | S | `w1440/31-edited-results-stale-1440.png`; `components/StaleResultsBanner.tsx:6`; PLAN 3.3 |
| 15 | **P3 carry:** removing one inferred filter converts the remaining inferred values into a manual list. The filter picker still begins from all item names, not the source’s candidates. | Editors changing sources or filters repeatedly | minor | Deliver 3.2’s source-first picker. Explicitly announce the transition to manual filters and provide an obvious return to Automatic. | M | `components/InsertersForm.tsx:261`; `utils/filterSlots.ts:2`, `:15`; `components/FilterSlotSelector.tsx:162`; PLAN 3.2 |
| 16 | Unknown recipe text can still be committed through freeSolo without an immediate field-level problem; the eventual engine check has to explain it. This is intentionally preserved by the 2.8 spec, despite original B31 and P1 N48. | Fast keyboard users who mistype or expect completion to validate a choice | minor | Follow-up: keep recoverable typed text but mark it “Recipe not recognized—choose a result” on commit/blur. Route Generate to that field. Do not remove recovery for unknown imported values. | S | `components/TargetOutputForm.tsx:53`; `components/ItemSelector.tsx:103`, `:110`, `:145`; 2.8 spec:116–118, :240–242 |
| 17 | At 720px the Insights table fits by wrapping labels and routes into tall cells. “Inserter 3” and a short route occupy multiple lines while the six numerical columns remain spread across the table. | Half-width users scanning a long ranked list | minor | Give this table sensible minimum widths and let it use the existing internal scroll container before entity names wrap to this degree; keep numeric columns aligned. | S | `w720/09-logistic-results-720-part5of5.png`; `components/InsightsPanel.tsx:110` |
| 18 | Wake windows places three definitions, a full legend and a long keyboard lesson before the graph on every view. These are useful once, but impose repeated scanning and scrolling during comparison. | Returning users who already understand the chart | minor | Follow-up: retain the one-line chart introduction and visible table toggle; move definitions into the existing Terms/help pattern and make the keyboard instructions an expandable help line. Keep descriptions available to assistive technology. | S | `w1440/21-logistic-results-1440-part2of4.png`; `w720/09-logistic-results-720-part3of5.png`; `components/WakeWindowsView.tsx:141`, `:197` |
| 19 | Below 720px, the comparison’s wake-up values and Works? column are off-screen. The fade hints at scrolling, but this makes an initial phone comparison slow. This is an acknowledged width limitation, not evidence that the main actions are unreachable. | Phone-width visitors comparing clocks | minor | Keep this explicitly recorded as accepted narrow-width debt; if later authorized, use stacked comparison rows or preserve name, count and Works? together. Do not describe current 390px comparison as full support. | M | `w390/09-logistic-results-390-part5of7.png`; `extra/w390/12-fuel-results-fuel-tab-390-part5of7.png`; committed evidence’s historical 775/9/0 half-width result |
| 20 | The out-of-date swing plan still renders at 0.45 opacity. Its warning exists, but the values someone may want to compare are deliberately made hard to read. This was explicitly excluded from 2.7 and carried. | Experts inspecting the previous plan after an edit; low-vision users | minor | Keep stale values at readable contrast, retain the Out-of-date warning, and disable only the actions that cannot apply. Assign an explicit follow-up owner. No new measured contrast ratio is claimed here. | S | `components/CheckPlanSection.tsx:79`, `:89`, `:96`; 2.7 spec:104; P1 N32 |

There are **no newly demonstrated blockers** in this evidence. Rows 3–10, 14 and 15 are existing Phase 3 carries. Rows 12–13 and 16–20 are bounded follow-ups or accepted limitations, not permission to implement deferred D1–D8.

### 4. What I'd cut or hide

- The permanently expanded Wake windows definitions and keyboard lesson after a user has learned them. Use the established help pattern.
- The repeated “With Search deeper, also turns on…” caption. The checkbox label already expresses the persistent setting; the implementation relationship to Advanced adds reading without improving the decision.
- The extra “What is particular to the clock shown at the top” sentence under Notes on this clock.
- Do not remove drag reorder: the owner has decided to keep it. Supply the recovery and alternatives already assigned to 3.2.
- Keep developer timelines, Plan and logging behind Developer tools. Their rougher interaction should not expand back onto the ordinary path.

### 5. What already works

- **Generate is now an iteration action.** It checks first and takes a broken build to a useful problem. Check only remains available without forcing the old Validate → Generate ritual.
- **Selection and copy safety are understandable.** Recommendation survives manual selection, stale results are conspicuous, old copying requires a confirmation, and importing another build clears its predecessor’s clocks.
- **The supported half-width editor is materially usable.** Source/Destination fields grow, nearest lane is available in List, filter slots stop repeating empty placeholders, and Configure/Results remain reachable at every captured width.

### 6. Open questions for the author

1. **How should the remaining B19 import risk be closed?** The ledger carried counts and Append toward 2.1, but the implemented dialog still offers independent replacement categories. A minimum dependency warning and replacement preview would address the immediate risk without requiring an Append design.
2. **Resolve the policy conflict between “full WCAG 2.2 AA” and the below-720 reachability-only guarantee.** A full AA reflow claim must address the relevant 320 CSS-pixel experience; a 390px main-action check does not settle it. Tables/diagrams can have applicable two-dimensional-layout exceptions, but those do not automatically exempt the rest of the interface. I have not tested 320px and am not asserting a new measured 320px failure. The decision and verification scope need to be explicit.
3. **Who owns the remaining non-P3 follow-ups?** In particular: partial-import protection, stale swing-plan readability and immediate unknown-recipe feedback. Recording a finding without an accountable destination is how it becomes permanent.
4. **The install checkpoint is still real.** The visible steps are much better, but the owner’s in-game review must close before the Phase 2 PR proceeds. This review does not substitute for that check.

### 7. Original findings Phase 2 was meant to address

“Fixed” below means the authorized Phase 2 treatment resolves the original problem. “Partly” distinguishes a working scoped implementation from remaining parts of the original finding. Proposed features explicitly excluded by the owner/spec are not silently promoted to release criteria.

| Original finding | P2 home | Status | Evidence / remaining part |
|---|---|---|---|
| A1 — no introduction or path | 2.1 | fixed | `w1440/02-first-visit-above-fold-1440.png`; equivalent 960/720/390 states show explanation and three entry paths. |
| A2 — hidden/unnamed Sidecar | 2.1/2.2 | fixed | Intro and toolbar name Paste from Factorio; instructions link the mod; `w1440/07-paste-from-factorio-bad-clipboard-1440.png`; first-visit ARIA. |
| A3 — crafting-speed `/c` risk and no mod pointer | 2.1 addendum | fixed | Machines help includes the Sidecar pointer and achievements warning; 2.1 spec:428 and current Machines help. No new speed-helper scope inferred. |
| A4 — no examples | 2.1 | fixed | Try an example in intro/menu; `ConfigImportExport.tsx:291`; committed fresh first-visit evidence exercised nine examples. A scaffold browser was not a P2 deliverable. |
| A6 — dead-end disabled actions | 2.3 and retained 1.4 | fixed | `w1440/35-bad-config-first-problem-1440.png`; `extra/w390/08-bad-config-first-problem-390.png`; final INDEX records actual focus changes. |
| A8 — no install instructions | 2.5 A | partly | Steps, wiring list and 2.1 requirement are present in logistic and fuel images. Owner’s in-game verification remains pending. |
| A9 — recommendation unexplained | 2.4/2.5 | fixed | Summary reason, persistent Recommended marker and belt qualification visible in all result widths. |
| A10 — belt assumption buried | 2.4 | fixed | Visible belt radios in Configure; summary assumption and regeneration action in Results. |
| A11 — clock intro is a wall of jargon | 2.5 B | fixed | Short introduction and collapsed How clocks are chosen; `w1440/21…part3of4.png`. |
| A12 — Validate required separately | 2.3 | fixed | Generate performs the check; Check only remains; `ResultsWorkspace` and final capture checks. |
| A13 — validation jargon on default path | 2.3 | fixed | Swing-plan tools moved into collapsed Advanced; no default Validation card. |
| A14 — messages hidden by footer | 1.5 F on P2 | fixed | Message occupies the header’s own row; non-sticky footer; Configure images at all widths. |
| A15 — ambiguous Import/Export entry | 2.1 | fixed | Open build file / Save build file in menu; sidecar files route into paste flow, `ConfigImportExport.tsx:233`. |
| A16 — Copies/rate ambiguity and limits | 2.1 W/compatibility | partly | Target helper shows total and per-copy rate; above-capacity target blocks. Summary omits fractional-total qualifier below one: finding 11. |
| A17 — missing suggested target and contradictory old-mod notice | 2.1/2.2 | fixed | Target row in settled confirm image; `sidecar-version.ts:91`, `:121` now says nothing is missing when appropriate. |
| A19 — wrong Results default / developer surfaces | 2.5 | fixed | Your clock → Wake windows → Compare → Details; developer timelines/log are opt-in. |
| A20 — engine-heavy comparison, inaccessible help, mixed unstable rows | 2.5 B | fixed in scoped P2 treatment | Compact columns, constant Makes folded, click help, recommended first, unstable group; sorting was explicitly excluded. See findings 12–13 for remaining expert comparison friction. |
| A21 — technical-only clock names and unlabeled bar selection | 2.5 | fixed | Plain name plus secondary technical name; desktop bar says Selected clock. |
| A22 — search notice reads as failure and sends user away | 2.5 B / retained 1.7 | fixed | Plain explanation and local Search deeper action. |
| A23 — enable state hidden behind gear | 2.7 / retained 1.13 | fixed per owner treatment | Labelled Enable chips; Auto stays visible as the accepted compromise. |
| A25 — terminology drift | 2.5/copy/compatibility | partly | Major labels and enums improved; wake-up definition is inconsistent again, finding 1. Developer timeline naming remains an accepted light-fix follow-up. |
| A26 — noisy numbers and facts labels | 2.11 / retained 1.10 | fixed | 68.906; max 22.97/s; readable node facts; Configure and fullscreen images. |
| A27 — internal IDs instead of game names | 2.8 | fixed in scoped P2 treatment | Game names in fields, routes, tables and icon accessible names; retained engine prose exceptions remain documented. |
| A28 — wrong entity order and empty cards | 2.7 B | fixed | Build groups Machines → Belts/chests → Inserters → Drills; empty chest/drill Add rows; Advanced collapsed. |
| A29 — Ko-fi dominates | 2.7 / retained 1.5 | fixed | Quiet outlined footer control; main action follows workflow state. |
| B10 — repeated Validate/Generate loop | 2.3 | fixed | Generate checks; Check only does not perform the former navigation ritual. |
| B12 — no lasting recommendation or explanation | 2.5 / retained 1.6 | fixed in scoped treatment | Recommended marker stays, card explains pick/difference and offers return. Per-row “Not picked because” was explicitly excluded; local comparison feedback remains finding 12. |
| B13 — mixed unlabeled units | 2.5/compatibility | partly | Comparison headers and summary identify total/per-copy units; below-one Makes qualifier remains finding 11. |
| B14 — large comparison and displaced detail | 2.5 B/2.9 | partly | Compact table, collapsed method text and unstable grouping fixed. No sort/sticky detail navigation; explicitly excluded features remain follow-ups. |
| B16 — dangerous/backwards diagram | 2.11 plus prior 1.8 | fixed in authorized scope | Arrowheads, left-to-right split belt nodes, readable fullscreen; Backspace deletion disabled. Draggable positions were intentionally excluded. |
| B17 — List/Diagram parity | 2.11/compatibility; remainder 3.2 | partly | Nearest lane, machine wording and Automatic stack behavior aligned. Separate editor/commit models remain for 3.2. |
| B19 — selective-paste risk and confusing warning | 2.1/2.2 carry | partly | Suggested target and old-mod warning fixed. Incoming-only counts, independent references and no Append remain; finding 2. |
| B24 — timeline palette and interaction limits | 2.10 light fixes | partly | Separate item palette and visible states fixed. Zoom, merged charts and direct clock comparison remain excluded developer-view scope. |
| B27 — number entry and silent defaults | 2.1 W/compatibility | fixed in authorized treatment | Rounded display preserves actual precision; capacity guard; clearing inserter Stack size restores explained Automatic. Pointer select-all was not established as a P2 requirement and is not claimed fixed. |
| B28 — Insights wall and inconsistent rounding | 2.5 B | partly | Why/Explanation collapsed, prose width bounded, numbers aligned. Engine’s 177.3 versus rounded 177 remains explicitly retained. |
| B30 — hidden messages and sticky footer | 1.5 F / 2.7 | fixed | Header messages and non-sticky footer visible across widths. |
| B31 — typo accepted as recipe | 2.8 / P1 N48 | not fixed by design | 2.8 explicitly preserves unknown freeSolo text for the engine’s error. Finding 16 is a follow-up, not a failure to follow that spec. |
| B32 — copy inconsistencies | 2.5/copy | partly | Old typo, obsolete action names and raw mode labels corrected. Definition inconsistency remains finding 1. |
| C2 — inaccessible charts | 2.6; old charts light fixes | partly overall; new chart fixed | Wake windows has keyboard stepping, text summaries and table mode. Old developer charts remain scoped light fixes. Fuel has text tables and chart labelling, not a fully equivalent interactive chart. |
| C3 — wrong primary action | 2.7 | fixed | First visit promotes Paste; valid Configure promotes Generate; fresh Results promotes card Copy. |
| C7 — table reads like a document | 2.5 B/2.4 | partly overall; scoped P2 fixed | Short method disclosure, folded constant rate, recommendation and belt caveats present. Data bars and richer sorting were not included. |
| C10 — hover-only help / dead end | 2.5 B/2.7 | fixed | Real HelpButtons and Terms popovers; Generate identifies and focuses problem. |
| C11 — palette collisions / missing state legend | 2.10 | fixed in light-fix scope | Magenta/cyan/pale-rose items; separate state palette and bottom-strip legend; timeline images at all widths. |
| C12 — invisible Disabled / thin transitions | 2.10 | fixed in light-fix scope | New track/state contrast and minimum-width drawing. Hatch/triangle redesign was excluded. |
| C14 — narrow layout beyond header | 2.9 | fixed at ≥720; partly across original finding | Usable supported-width forms, contained scrollers and no page-sideways movement. Accepted 390px comparison limitations remain finding 19. |
| C16 — inconsistent help controls | 2.7 | fixed | Grey click HelpButtons, labelled Show rates diagram toggle. |
| C20 — backwards, tiny diagram | 2.11 | fixed | Settled fullscreen image shows readable source → machine → destination flow and arrows; keyboard opening implemented. |
| C23 — disconnected Configure cards | 2.7 B/2.1/2.3 | fixed | Shared Build card and coherent order; first-run guidance above form. |
| C24 — truncated inserter rows, excessive empty slots, red furniture | 2.7 B | fixed in supported widths | Growing Source/Destination, one plus slot, neutral delete icons and enable chip; 1440/960/720 Configure images. Automatic-helper alignment remains a recorded 3.2 A cosmetic carry. |
| C26 — number/duration formatting and alignment | 2.5 B | fixed in scoped treatment | Consistent duration display and right-aligned numeric Insights columns. Retained engine rounding exception is recorded separately. |
| C27 — expanded Insights and remote search | 2.5 B | fixed | Why disclosure, collapsed About this build, local Search deeper. |
| C28 — inconsistent confirm colors / shapes | 2.7 | fixed | Green confirm actions, grey cancellation, square chips; settled Save and Import screenshots. |
| C30 — language/interaction wording drift | 2.5/copy | partly | Main copy substantially aligned; wake-up contradiction remains; developer legend/naming follow-up is still outside the light-fix remit. |

The prior safety fixes also remain intact in the inspected evidence: **A5/B1/C5** stale-copy protection, **A7/B25/C1** header reachability, **A18/B2/C15** Reset recovery, **B6** protected inserter/rule drafts, **C8/C9/C13/C22/C25** named controls, announcements, headings and filter-slot treatment. This is regression evidence for inspected states, not a claim to have exhaustively certified every state.

### 8. Phase 1 end carry mapping

This table accounts for all N rows so that Phase 2 assignments do not disappear among the larger Phase 3 backlog.

| P1-end ID | Current disposition | Evidence / destination |
|---|---|---|
| N1 — persistent Undo covering content | fixed | Message has its own header/fullscreen row; 1.5 F; fresh Configure images. |
| N2 — import Undo lifetime / Ctrl+Z | fixed to owner decision | Undo withdrawn by check/generation or an editing dialog; `hooks/useUndo.ts:147–175`; no timer invented. |
| N3 — errors over dialogs | fixed | 1.5 F closes stale errors on dialog/retry; settled dialogs are unobscured. |
| N4 — reorder renumbering without recovery | not fixed in P2; 3.2 carry | Finding 3; Q2 is already resolved. |
| N5 — mixed Diagram commit models | not fixed in P2; 3.2 carry | Finding 4; Q3 is already resolved. |
| N6 — impossible target accepted | fixed | 2.1 W capacity line/guard; stale image visibly reports maximum; TargetOutputForm:66. |
| N7 — Generate filled after results | fixed | Fresh Results has outlined Generate and green card Copy. |
| N8 — routine delete icons red | fixed | Neutral row/slot delete controls at rest; 2.7. |
| N9 — table key columns lost at half width | fixed for ≥720 | 720/960 compact table shows count and Works?; 390 limits retained explicitly. |
| N10 — comparison still hard to scan | partly | Compact table, folded Makes, recommended first and grouped unstable rows fixed; sorting/data bars remain excluded follow-ups. |
| N11 — red problem count on untouched form | fixed | Neutral Start line at all four widths. |
| N12 — stale banner lacks change detail/action | partly; remainder 3.3 | Wording now valid; diff/time remains finding 14. |
| N13 — empty generation screen / progress | partly | Making the first clock replaces empty developer output. Cancel and previous-run retention remain 3.3. |
| N14 — wrong default / no installation | partly | Summary-first/default Wake windows fixed; installation content present; owner’s in-game check pending. |
| N15 — Validate loop | fixed | 2.3. |
| N16 — developer timelines unchanged | fixed in light-fix scope | Palette, legend and state contrast changed; further keyboard/zoom work excluded. |
| N17 — tiny low-contrast diagram / no arrows | fixed | Fresh diagram/fullscreen images and 2.11 source. |
| N18 — status-chip focus ring | fixed by P1 end fix; retained | Shared focus treatment preserved; not counted as a new P2 achievement. |
| N19 — tiny 390 lane Stack size | fixed by P1 end fix; retained | 390 Configure shows separate usable lane Stack size fields. |
| N20 — excessive/jumping header reason layout | fixed in scoped 2.9 treatment | Reserved reason space at half width; primary controls visible; no claim that message rows never increase header height. |
| N21 — disabled tooltip covering its reason | fixed | Generate is actionable and moves to the first problem. |
| N22 — Recommended uses selection orange | fixed | Neutral outlined recommendation badge; selected row alone carries selection fill. |
| N23 — hover-only header/override help | fixed | Click HelpButtons and Terms; source and settled help evidence. |
| N24 — unbroken clock-help paragraph | fixed | Fresh extra help images show separated short paragraphs and distinct Works? section. |
| N25 — Insights width/alignment/rounding | partly | Prose bounded, Why collapsed, numbers aligned; engine rounding retained. |
| N26 — inconsistent durations | fixed in scoped result surfaces | Blueprint and summary period use ticks/seconds formatting; no new engine-text rewrite inferred. |
| N27 — obsolete Clock-only column name | fixed by P1 end fix; retained | Developer explanation says Output per clock period. |
| N28 — string under Copy icon | fixed | Separate string and copy-button columns at 1440/960/720/390. |
| N29 — confirm colors disagree | fixed | Green Save/Import; grey Cancel. |
| N30 — truncated rows / four empty slots | fixed in supported widths | Build-card grid and single plus slot; 3.2 A retains Automatic-helper alignment follow-up. |
| N31 — blue help furniture | fixed | Grey HelpButtons. |
| N32 — stale plan at 0.45 opacity | not fixed; explicitly carried | Finding 20; 2.7 spec:104 excludes it from that item. Needs an accountable follow-up. |
| N33 — paste “items” / old-mod contradiction | fixed | Confirm says parts/entity types; complete import notice no longer contradicts itself. |
| N34 — paste does not fill target | fixed | Suggested/inferred Target Output row in confirm. |
| N35 — no replacement counts / Append | not fixed | Incoming counts only; no Append; finding 2. Target-row replacement note is not an entity replacement preview. |
| N36 — technical names / unlabeled selected bar | fixed | Plain names and desktop Selected clock label. |
| N37 — `/c` advice without achievements warning | fixed | A3 added to 2.1; current Machines help. |
| N38 — Search deeper checkbox/caption noise | not fixed; minor follow-up | Still visible in fresh result slices; section 4. |
| N39 — entity order / oversized empty cards | fixed | Build-card grouping and compact empty chest/drill rows. |
| N40 — internal IDs in normal UI | fixed in scoped treatment | Game names/icons and accessible names; documented engine-prose exceptions remain. |
| N41 — Copied stays after edit | fixed | `useCopyBlueprint.ts:73–74` includes stale state in copied identity. |
| N42 — no Cancel/cache/retained pick | not fixed in P2; 3.3 carry | Findings 5–6. |
| N43 — no editing-at-scale tools | not fixed in P2; 3.2 carry | Finding 10. |
| N44 — Undo replacement restores build but not clocks | not fixed in P2; 3.3 carry | PLAN 3.3 explicitly owns restoration. |
| N45 — inconsistent failure severity | fixed | Former Validation panel removed; error treatment consistent. |
| N46 — check failure vanishes on first corrective edit | not fixed; existing follow-up | `App.tsx:655` only shows failure while the current check remains invalid. Preserve last-check context if later authorized. |
| N47 — forced exclusion provenance lost through file export | existing non-P2 follow-up | Do not claim it fixed merely because in-memory rules are protected. Retain its recorded destination/triage. |
| N48 — freeSolo typo / stack fallback | partly | Automatic stack semantics corrected; unknown text intentionally retained by 2.8. Finding 16. |
| N49 — debug content on ordinary path | fixed | Developer tools opt-in; absent from fresh default Results. |
| N50 — fuel table wording | fixed | “Switched on every,” “Wake window,” “Wake windows with a swing”; fresh extra fuel slices. |
| N51 — unreleased version/changelog | not a finding | Expected phase workflow; no phase release bump required. |
| N52 — developer timeline name / toggle-like legends | retained light-fix follow-up | Transfer Activity Timeline and legend presentation remain; not an unplanned P2 overhaul. |
| N53 — default Validation jargon | fixed | Validation panel removed; expert swing plan in Advanced. |

The evidence supports the new Phase 2 path and the ≥720px interaction layout. It does **not** support closing the wake-up copy discrepancy, declaring B19 entirely resolved, treating the historical **775 PASS / 9 FAIL** half-width run as a whole-suite pass, or bypassing the pending installation checkpoint.
