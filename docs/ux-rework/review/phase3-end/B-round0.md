# Phase 3 end review B — power-user interaction designer

**Verdict: PASS for Phase 3, with minor carries.** The planned rule, shared-editor, bulk-editing, Cancel, result-retention and build-library work is present. I found no remaining blocker or major defect in those workflows. The original experience of losing work or accidentally copying an unrelated build’s clock has materially changed.

This is a phase UX verdict, not release authorization, blanket WCAG certification or a human usability study. Phase 4 remains future work. D9’s independent audit **and implemented cleanup of UX-added UI tests remains mandatory before feature → master**.

I reviewed files and actual images only. I did not modify files, run the product or tests, operate a browser, or consult another current persona report.

Evidence shorthand below:

- **S:** `/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src/`
- **F:** `/tmp/ux-phase3-end-final-r16-four/`
- **G:** `/tmp/ux-phase3-3ghi-r16-four/`
- **H:** `/tmp/ux-phase3-followups-round1-final/`

The inspected product is `21261c5d86089f273a7880cc3a6f180eba17760c`, UI tree `da84a421c68e193343c1803db89d0301dde42f96`. The [equivalence receipt](/tmp/ux-phase3-closeout-review/PHASE-REVIEW-EQUIVALENCE.json) records that current phase `b3e14807f3aca7584721d1a6e9f75025772d71bb` changes documentation only.

## 1. Gut reaction

I can now edit a substantial build without maintaining a second copy in a text editor merely to protect myself. The visible rule modes, shared inserter fields, protected Diagram drafts and bulk Undo make the List credible as a working editor. Saved clocks and a retained manual choice remove much of the old restart cost. I still spend too much time moving between the comparison table, the selected clock and its wake windows, and switching builds still loses navigation context; those improvements are approved for Phase 4 and are not implemented yet.

## 2. Top changes I’d make next

1. **Deliver D1’s comparison-and-detail composition.** The current Results sequence remains expensive for repeated comparison: expanded installation guidance and Wake windows precede the table, while selecting a row changes information above it. Keep comparison visible beside, or directly adjacent to, the contextual selected-clock detail. The present controls are operable; the problem is repeated travel.

2. **Resolve the header’s focus-restoration scroll movement as part of D1.** Escape returns focus to the correct build-menu opener, but recorded scrolled cases also move the page hundreds of pixels. Preserve the page position when restoring focus to an already visible sticky-header control. Baseline equivalence is established at 390px only; wider measurements must retain that distinction.

3. **Deliver D7’s per-build working context.** Retaining results and the manual clock is implemented. Returning to the same entity, view, Details tab and approximate place on the page is not. Restore those separately from build data, with validation navigation taking precedence and no new unsaved-draft recovery promise.

4. **Finish the small reading-and-recovery details.** Format the new Fuel trace’s floating-point quantities, preserve the previous check reason while correcting a build, and retain the existing unknown-recipe feedback follow-up. These are bounded improvements; none justifies reopening the completed Phase 3 architecture.

## 3. All findings

These are current observations and retained debt, not a quota of new defects.

| # | What’s confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| B3E-1 | Choosing a clock changes its explanation and Wake windows well above the comparison table. Even the small logistic result occupies 3,275px at 1440 and 3,837px at 720. The table is compact, but the overall repeated-comparison loop remains long. | Players comparing several clocks repeatedly | minor | Implement approved D1’s visible comparison plus contextual Why/Wake/Install area, coordinated with D4’s concise selected-clock tradeoff. Keep radio focus in place. | M | **F** `w1440/08-results-answer-1440-part1of4.png`, `-part3of4.png`; `w720/08-results-answer-720-part4of5.png`. **S** `components/ResultsWorkspace.tsx:136`, `:153`, `:176` establishes the current sequence. |
| B3E-2 | Build-menu Escape restores the correct opener but can move the underlying page substantially. At 720×900, the recorded keyboard case moves from scrollY 914 to 419; at 720×560, 1424 to 1099. The visible focus is correct, but I lose my place. | Keyboard users opening the build menu during a long edit | minor | In D1’s header/focus reconciliation, restore focus without scrolling an already visible opener; preserve scroll unless an explicit navigation action requires movement. | S–M | **G** `KNOWN-MINOR-SCROLL.json`, `BUILDS-MENU-SCOPE.json`; 390 normal/short images and scope records. Wider baseline parity is **not established**. |
| B3E-3 | The build library restores clocks and their choice, but opening another build deliberately returns to Configure and closes Advanced. Reload starts with Configure state. Full per-build navigation context remains absent. | Players alternating between builds or reopening a tuning session | minor | Implement approved D7 for selected entity, view, Details tab, expanded sections and approximate page position. Preserve Phase 3’s existing result/pick storage. | M | **S** `App.tsx:265`, `:701–714`, `:735–748`; **F** `w960/35-kept-results-after-reload-960-part1of4.png`, `w720/39-library-return-kept-results-720.png`. |
| B3E-4 | The new Fuel trace says **“82.09359999999995 items burned.”** This exposes floating-point noise in visible and accessible prose, unlike the nearby rounded table. | Players reading or listening to fuel diagnostics | minor | Use the established number formatter for continuous fuel quantities, for example “82.094 items burned”; preserve exact underlying values and integer event ticks/amounts. | S | **F** `w720/85-fuel-events-and-trace-text-720-part5of6.png`; **S** `utils/fuelAccessibility.ts:40–46` interpolates raw values. `utils/numberText.ts:50` already provides display-only formatting. |
| B3E-5 | The failed-check explanation still disappears on the first corrective edit. The capacity figure or reason I am using to choose a replacement value is then unavailable without another check. This is original B23/N46, not a new Phase 3 regression. | Players correcting an engine check failure | minor | Retain the last failure as readable text labelled “From the last check”; remove it when replaced by a new result or another build. Do not present it as the current build’s verdict. | S | **S** `App.tsx:969–970` passes the message only while both validation and current check status are invalid; `utils/checkThenGenerate.ts:52–56` makes an edited check out of date. |
| B3E-6 | The larger 320px Swing plan can still leave the Included/Excluded chip partly clipped inside its horizontal scroller. The fixed width removes growth, but tooltip-induced scrolling does not establish passive full visibility. | Narrow-width keyboard users inspecting the plan | minor | Reveal the full focused chip within its existing labelled scroller without replacing its node or losing focus. Retain the current guarded interaction states. | S | **H** `CHECKING-TRACE.json`, `w320/06-larger-editable-excluded-tooltip-320.png`; **S** `components/TransferPlanPanel.tsx:187–199`. Visible left gold focus remains; this evidence does not demonstrate a complete focus-obscuration failure. |

Unknown recipe text remains an additional **existing minor follow-up**, not a newly discovered Phase 3 defect: `MachinesForm.tsx:173` and `EntityEditDialog.tsx:106` retain `freeSolo`. Keep recoverable imported/typed text, but eventually mark an unrecognized committed recipe inline and route Generate to that field.

### Planned Phase 3 findings: closure

| Item | Status | Independent assessment and evidence |
|---|---|---|
| **3.1 — B8: Clocked timing, validation and defaults** | **Fixed** | The editor states crafting cycle and clock period, shows the selected clock’s windows against the draft, offers “Use the clock’s wake windows,” and exposes inline problems. Save refuses and focuses the first problem. **F** `w720/18-rule-invalid-range-720.png`, `w1440/19-rule-live-sentence-and-strip-1440.png`; **S** `EnableControlModal.tsx:180–209`, `:286–300`; `utils/ruleProblems.ts:114–145`. Equal start/end is permitted where valid; tick-zero end remains refused according to the documented engine constraint. |
| **3.1 — B9: readable rules and safe templates** | **Fixed** | “In words” and “In the blueprint” distinguish planning rules from exported clock windows. Template selection opens an explicit item/amount step; replacement is deliberate, and the hard-coded 32 is gone. **F** `w960/20-rule-template-confirm-960.png`, `w1440/19-rule-live-sentence-and-strip-1440.png`; **S** `QuickTemplateSelect.tsx:96–103`, `:158–207`; `EnableControlModal.tsx:303–313`. |
| **3.2A — B17: one inserter editor** | **Fixed** | List and Diagram use `InserterEditor`; Source, Destination, nearest lane, filters and Automatic stack behavior share one implementation. Imported type/quality is read-only. **S** `InsertersForm.tsx:106`, `InserterConfigPanel.tsx:188–198`, `InserterEditor.tsx:58–129`; **F** `w720/63-diagram-inserter-draft-720.png`, large List slices. |
| **3.2A — B6/N5: consistent Diagram drafts** | **Fixed** | All five entity kinds show Save/Cancel and unsaved state. Dirty close offers a discard decision; switching inserter tabs preserves both drafts. I inspected actual machine, inserter, belt, chest and drill states. **F** shots `59–74`, including `w960/66-diagram-belt-draft-960.png`, `w720/69-diagram-chest-draft-720.png`, `w1440/72-diagram-drill-draft-1440.png`, `w390/61-diagram-discard-confirm-390.png`. **S** `EntityEditDialog.tsx:559–617`, `:714–727`; `InserterConfigPanel.tsx:186–217`. |
| **3.2A — B26: automatic/manual filters** | **Fixed within the approved model** | Editing an inferred list now says “Set by hand,” announces the conversion and supplies “Use automatic filters.” Source items lead the picker. This is an explicit conversion of the list, not independent automatic state per slot. **S** `InserterEditor.tsx:65–69`, `:113–123`; **F** List/editor and bulk-filter states `63`, `80–81`. |
| **3.2B — B22/N43: scale editing** | **Fixed within the approved scope** | Duplicate, selection, bulk stack/filters/rule actions, new-row focus and reduced redundant Tab stops are present. This is not a one-stop-per-row ARIA grid; that proposal was excluded. **F** `w960/78-bulk-selected-960.png`, `w720/79-bulk-stack-undo-720.png`, `w390/80-bulk-filter-editor-390.png`; **S** `InsertersForm.tsx:142–203`, `BulkEditBar.tsx:70–105`, `useFocusAfterRemove.ts:18–27`. |
| **3.2B — N4 and drag alternative** | **Fixed** | Move up/down and drag share announced, undoable renumbering. The visible message names the changed numbers. **F** `w960/77-move-up-undo-960.png`; **S** `App.tsx` undoable reorder handlers, `utils/configForm/edits.ts:514–520`. |
| **3.3 — B11/N42: keep results and manual pick** | **Fixed for results and choice; working context remains partial** | Results are kept by config key and manual selection by clock identity; restoration has guards against being overtaken. The manual choice survives the demonstrated reload/library return. **F** shots `34–35`, `39`, `51`; **S** `useSimulationWorker.ts:210–237`, `:305–350`, `:736–789`; `resultsCache.ts:17–24`. View/detail/scroll restoration belongs to D7 and is not closed. |
| **3.3 — B18: Cancel and provisional copying** | **Fixed** | Actual in-flight state exposes Cancel; stopped output is labelled incomplete. Source distinguishes restoring previous results, keeping partial results and keeping none, and replaces busy workers. **F** `w720/88-generation-in-flight-720.aria.yml`, `w720/89-generation-cancelled-720.png`, shot `90`; **S** `useSimulationWorker.ts:371–390`, `:696–709`. Short unsampled intervals remain supplemented by lifecycle evidence, not invented native passes. |
| **3.3 — N12/N44: changed-fields banner and replacement Undo** | **Fixed** | Stale results now include generation time and what changed; old copying is explicit. Import Undo restores the former build and its chosen results. **F** `w390/28-stale-results-390-part1of5.png`, shots `29`, `49–51`; **S** `useSimulationWorker.ts:712–789`, `App.tsx:699–709`. |
| **3.4 — B20: library/share/cross-tab recovery** | **Fixed** | Named builds, duplicate/rename/delete, share confirmation, Undo and cross-tab warning are present. Loading another tab’s version offers recovery rather than silently replacing this tab’s work. **F** shots `36–46`, especially `w720/44-other-tab-warning-720.png`; **S** `App.tsx:716–839`, `BuildSwitcher.tsx:168–215`. |
| **3.G/H/I — shared speech, tooltips and menu scope** | **Fixed, with the stated timing limit** | Cached/uncached success is composed coherently, direct navigation remains reachable, full-name hover help persists, and both menus expose their own named region while hiding background main content. **G** live traces, scope JSON, actual shots described below. The pending native Undo/speech interval is not exercised. |

### Original B findings: complete disposition

“Fixed” means the authorized treatment resolves the original harm. It does not mean every original proposal was adopted.

| Original | Status | Current evidence or remaining portion |
|---|---|---|
| **B1 — stale unrelated blueprint** | **Fixed** | Stale banner and explicit old-clock consent; replacement clears results. **F** `28–33`, `49–51`; **S** `App.tsx:701–709`. |
| **B2 — destructive Reset** | **Fixed within owner scope** | Separated red Reset plus untimed Undo. A confirmation and five-snapshot history were not required by the final decision. **G** `w960/91-more-reset-Undo-restored-960.png`; **S** `hooks/useUndo.ts`. |
| **B3 — no recovery / unnamed deletes** | **Fixed within owner scope** | Undo covers destructive actions, replacement, reorder and bulk edits; controls have names. Full history/redo was explicitly excluded. **F** `43`, `46`, `51`, `77`, `79` and matching ARIA. |
| **B4 — inconsistent identity** | **Fixed within owner scope** | Consistent current entity numbers, reference remapping and announced reorder. Permanent IDs and optional names were not adopted. **F** `77`; **S** `utils/configForm/edits.ts:514–520`, shared `entityLabel` usage. |
| **B5 — exclusion overwrites personal rules** | **Fixed for the original mutation** | Non-Auto rules remain untouched; only tagged forced Always is removed on reinclusion. **S** `utils/configForm/edits.ts:446–489`. Export provenance is separately open as N47. |
| **B6 — discarded rule/modal edits** | **Fixed** | Protected close and persistent inserter tabs; all-five Diagram drafts. **F** `59–74`; **S** `EnableControlModal.tsx:702–776`, `InserterConfigPanel.tsx:186`. |
| **B7 — invisible List mode** | **Fixed in scope** | Labelled mode chips show Auto/Always/Clocked/Conditional. “Only overridden” filter remains unimplemented. **F** large List slices; **S** `EnableRuleChip.tsx:18`. |
| **B8 — silent invalid windows** | **Fixed** | Timing, comparison strip and save refusal; see 3.1 closure. |
| **B9 — opaque/unsafe templates** | **Fixed** | Preview, blueprint explanation, explicit template item/amount/replacement; see 3.1 closure. |
| **B10 — Validate ritual** | **Fixed** | Generate checks first; generation-only overrides do not stale the check. **S** `utils/checkThenGenerate.ts:32–56`, `App.tsx:513–563`. |
| **B11 — reload/manual-pick loss** | **Partly** | Results and chosen clock fixed by 3.3; navigation context remains D7. |
| **B12 — unexplained recommendation** | **Fixed in scope** | Persistent Recommended badge, concise reason, belt qualification and Back to recommended. Dedicated per-row rejection column was not delivered. **F** `w1440/08-results-answer-1440-part1of4.png`, `-part3of4.png`. |
| **B13 — total/per-copy ambiguity** | **Fixed** | Total Makes and one-copy wake-ups are explicit; table headers and target helpers carry scope. Fractional caption correction is retained from 2.F. **F** Results/Configure ARIA; current summary source. |
| **B14 — comparison bulk/sorting** | **Partly** | Compact/default columns, collapsed ranking help and unstable grouping fixed. Long overall travel remains B3E-1; sorting remains unimplemented. |
| **B15 — deeper-search round trip** | **Fixed** | Search deeper and persistent-build choice are local to Results. **F** comparison slices; **S** `App.tsx:841–853`. |
| **B16 — destructive/backward Diagram** | **Partly** | Backspace deletion disabled and directional layout improved. Saved manual positions/node dragging remain excluded. **S** `ConfigFlowDiagram.tsx:355–362`; actual Diagram draft images. |
| **B17 — List/Diagram drift** | **Fixed** | Shared inserter fields and Automatic behavior; see 3.2A. |
| **B18 — no Cancel/provisional pick** | **Fixed** | Cancel, incomplete-run explanation and current-best handling; see 3.3. |
| **B19 — selective Paste risk** | **Partly** | Current→incoming counts, explicit crossing references and acknowledgment are fixed. Append remains deferred. **F** `w720/47-paste-cross-category-preview-720.png`; **S** `ConfigImportExport.tsx:402–449`. |
| **B20 — one slot/no sharing** | **Fixed** | Named library, links and other-tab warning/recovery; see 3.4. |
| **B21 — disabled-action dead end** | **Fixed** | First-problem text and navigation remain; Generate/check route is actionable. **F** `02`, `52`. |
| **B22 — no scale tools** | **Fixed in scope** | Duplicate/bulk/focus/reduced redundant stops delivered; full grid interaction excluded. |
| **B23 — error vanishes while correcting** | **Not fixed** | Existing minor follow-up, B3E-5. |
| **B24 — timeline interaction limits** | **Partly** | Player-facing Wake windows has keyboard/touch/table access; developer timelines received bounded fixes. Zoom, multiple periods and two-clock stacking remain excluded. |
| **B25 — narrow header blocks navigation** | **Fixed** | Main actions and Configure/Results remain reachable at 390. Escape’s page movement is separate minor debt, not the old navigation blocker. |
| **B26 — silent filter conversion** | **Fixed in scope** | Explicit manual state, announcement/return action and source-first picker; see 3.2A. |
| **B27 — noisy entry/fallbacks** | **Partly** | Number fields round presentation, retain precision and support replacement entry; cleared inserter stack means Automatic. Engine-prose rounding and new Fuel prose noise remain. |
| **B28 — repetitive Insights/rounding** | **Partly** | Why is collapsed; remaining explanatory bulk and cross-surface precision differences persist. **F** `w720/08-results-answer-720-part4of5.png`. |
| **B29 — default debug dead end** | **Partly** | Logging is behind Developer tools and stale button wording is repaired. Persistent warnings from every prior run were not added. **S** `ResultsWorkspace.tsx:191–207`. |
| **B30 — messages behind sticky footer** | **Fixed** | Messages occupy header flow; footer is nonsticky. **F** Undo and cross-tab screenshots; **S** `Messages.tsx:93–148`. |
| **B31 — freeSolo typo acceptance** | **Not fixed** | Existing intentional picker behavior; retain the minor field-feedback follow-up. |
| **B32 — copy inconsistency** | **Partly** | Main rule modes, help and swing wording are repaired; documented engine prose/technical wording exceptions remain. |

### Phase-end carries and 3.F closure

| Carry | Status | Evidence and boundary |
|---|---|---|
| **N4, N5, N43** — reorder recovery, modal parity, editing at scale | **Fixed** | 3.2 closure above. |
| **N12, N42, N44** — stale details, Cancel/cache/pick, clocks after Undo | **Fixed within scope** | 3.3 closure above. D7 is separate. |
| **N23** — Advanced hover-only help | **Fixed** | Explicit HelpButtons and descriptions; **F** shots `22–24` with ARIA. |
| **N32 / P2-B20** — unreadable stale plan | **Fixed** | Readable old values and guarded mutations; **F** shots `25–27`; **S** `CheckPlanSection.tsx:85–118`, `TransferPlanPanel.tsx:131–199`. Historical actual-leaf contrast evidence supports excluded-row readability. |
| **N35 / P2-B2** — replacement counts/crossing references | **Partly** | Immediate safety gap fixed, Append deferred; screenshot `47` explicitly identifies retained Inserter → imported Machine crossings. |
| **P2-B1/B11** — wake-up definition and fractional Makes scope | **Fixed by 2.F; retained** | Current ARIA distinguishes input craft starts from output finishes/productivity payouts and preserves copy scope. No new engine-definition claim. |
| **P2 clipboard carry** | **Fixed** | Failed copying has visible/spoken recovery and a selectable snapshot string. **F** `31–33`, especially `w960/33-manual-copy-snapshot-960.png`. |
| **P2 Fuel equivalence** | **Fixed functionally; minor precision issue remains** | Persistent trace descriptions and six event rows give exact interval/amount access. **F** `w720/85-fuel-events-and-trace-text-720-part5of6.png`, `-part6of6.png`; `86` and ARIA. B3E-4 does not invalidate event equivalence. |
| **P2 aggregate swing wording** | **Fixed** | It says each output machine’s total is shared across its output inserters. **S** `CheckPlanSection.tsx:102–107`; **F** shot `87`. |
| **320 ordinary reflow audit** | **Substantially addressed; minor local carry remains** | Historical six-width 3.F evidence plus fresh ordinary-layout geometry; passive chip clipping remains B3E-6. No blanket AA declaration. |
| **N46** — prior check failure context | **Not fixed** | B3E-5. |
| **N47** — forced exclusion provenance through export | **Not fixed; retained follow-up** | `_forced_always` is stripped at the config boundary and not reconstructed as provenance on import. **S** `utils/configForm/configMapping.ts:56–70`, `:126–131`. This does not reopen the fixed in-memory B5 overwrite. |
| **N48** — unknown recipe/stack fallback | **Partly** | Automatic stack semantics fixed; unknown-recipe immediate feedback remains. |

### Accessibility, evidence and limits

I inspected actual PNGs at 1440, 960, 720 and 390, including long Configure/Results slices, all-five drafts, rule/template states, bulk operations, stale consent/manual copying, Fuel, menus and short-height focus.

The evidence supports these narrower conclusions:

- **Keyboard comparison remains reachable.** `G/COMPARE-KEYBOARD-720.json` records 16 actual Tab presses from a different header control at both 900 and 560 heights, before wheel framing. The focused Show all columns control is wholly below the 146.25px header and its sampled points hit the control. The 560 image shows the complete focus ring.
- **Menu scope is repaired.** Actual menu ARIA exposes only the named Your builds or More options region. The 32 scope records cover keyboard/touch and normal/560 heights; sampled background roots/main content are hidden while open and exposed afterward, with the same opener restored.
- **Shared success composition is repaired.** Cached and uncached live traces expose one coherent success with the Undo hint; cached restoration adds “Its clocks are back.” `Messages.tsx:57–68`, `utils/messages.ts:89–102` and `utils/announcer.ts:42–68` recheck ownership and exposure through actual delivery.
- **The native pending-Undo interval remains unexercised.** Recorded shared speech precedes actual exposed Undo. The early shortcut was ignored during the closing modal. Subsequent restoration and absence of obsolete later writes do not prove cancellation inside the pending interval. The production-announcer timer regressions are complementary source-level protection.
- **Measured paint is not whole-product certification.** I read the actual PAINT records: broad evidence contains 227 recorded pairs and the supplement 40, with no recorded ratio below its stated requirement. Empty focus-paint entries are not contrast passes. Fuel’s 1440 native viewport shows three focus bands; the separately framed full ring must remain separately labelled.
- Extra native busy input and the painted busy-tooltip interval remain unsampled. The passive 320 chip issue remains open. Historical failed runs are not replaced by the current successful totals.

The current `8002/0/0` and `8043/0/0` capture totals, root checks and exact-source receipts support the review’s provenance. They do not independently prove preservation across every race, full AA compliance or human task efficiency.

## 4. What I’d cut or hide

- Collapse routine Wake windows definitions and the keyboard lesson through approved D1, while retaining on-demand and accessible instructions.
- Avoid repeating the full installation section during every comparison session; retain complete guidance in the contextual Install area.
- Summarize common inserter metadata once per section in Compact through D5, while preserving explicit exceptions and Automatic/manual distinctions.
- Keep Developer tools opt-in. The original debugging surfaces should not return to the ordinary path.

I would keep the owner-approved drag operation with its recovery, the manual copy route, explicit import acknowledgment and protected Save/Cancel drafts.

## 5. What already works

- **Recovery now matches fast editing.** Reorder and bulk messages identify what changed, and replacement Undo can bring back the build and selected clocks.
- **The modal model is consistent.** All five Diagram entities are drafts; inserter tabs retain work and invalid rules cannot silently save.
- **Result identity is dependable in the reviewed flows.** Manual choice, recommendation, saved results, stale status and old-clock consent remain distinguishable.

## 6. Open questions for the author

No new owner decision is required to accept Phase 3’s scoped UX work.

The remaining execution obligations are already explicit: preserve the minor carries, establish D3’s baseline before D1 changes, implement approved Phase 4 features under their separate reviews, and complete D9’s independent, justified UI-test cleanup before master. D8 remains investigation only. The owner’s Sidecar and installation cases have passed; this review does not reopen or replace them.
