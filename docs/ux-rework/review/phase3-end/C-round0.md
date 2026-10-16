# Fresh Phase 3 review C — visual design, data presentation and accessibility

**Verdict: PASS for Phase 3, with minor carries.** I found no unresolved blocker or major in the reviewed Phase 3 player workflow. The seven explicit Phase 2 safety/accessibility carries are addressed, including Fuel equivalents, clipboard recovery, selective-Paste acknowledgment and readable stale plans. Remaining density and navigation-context problems are visible current limitations; Phase 4 approval does not count as their implementation.

This is an independent phase review of product `21261c5d86089f273a7880cc3a6f180eba17760c`, UI tree `da84a421c68e193343c1803db89d0301dde42f96`, through immutable source `/tmp/ux-phase3-3ghi-round1-verifier-21261c5`. The phase-equivalence receipt maps this tested product to phase head `b3e14807f3aca7584721d1a6e9f75025772d71bb` through documentation-only changes.

I read the original brief/persona/synthesis, current roadmap and decisions, Phase 2 dispositions, and relevant 3.F material. I inspected actual current PNGs, accessibility trees, geometry/paint excerpts, coverage records and live-region traces. I did not operate the app, run tests, use assistive technology, edit files, or read another current persona report.

For evidence references below:

- **B** = `/tmp/ux-phase3-end-final-r16-four`
- **S** = `/tmp/ux-phase3-3ghi-r16-four`
- **H** = `/tmp/ux-phase3-followups-round1-final`
- **Source** = `/tmp/ux-phase3-3ghi-round1-verifier-21261c5/clock-generator-ui/src`

The fresh broad capture records **8002 PASS / 0 FAIL / 0 failed steps**; the supplement records **8043/0/0**. These totals support the exercised states, not an unrestricted WCAG conformance or human-usability claim.

### 1. Gut reaction

I now see a coherent player workflow instead of competing cards and unexplained charts. Orange selects the current view, green commits work, yellow identifies consequential warnings, and the donation link stays out of the way. Results answers the important questions before presenting evidence: what this clock makes, its one-copy wake-ups, whether it recovers, and which belt assumption it needs. The expert additions generally respect that hierarchy, although the explanatory default remains long and the header still consumes too much space in short windows. Fuel finally gives me the information without requiring me to hover over pixels.

### 2. Top 5 changes I’d make tomorrow

1. **Format Fuel’s new trace prose.** “82.09359999999995 items burned” is visible and exposed as text. Display approximately `82.094 items burned`, using a shared formatter for measured fractional quantities. Preserve exact event ticks and quantities in the events table. This is a small current defect in otherwise useful equivalent content.

2. **Preserve page position when dismissing the build menu.** The opener regains visible focus, but the page moves significantly. Reconcile header sizing and focus restoration in D1, retaining the same connected opener and avoiding an unnecessary document scroll. The current 390px baseline comparison establishes inheritance there; it does not establish baseline parity at every width.

3. **Finish passive visibility of the 320px Exclude chip.** Stable width prevents the label from growing, but the focused chip can remain partly clipped in its local table scroller. Bring the whole focused chip into view without replacing its node. Opening a tooltip and subsequently scrolling it into view does not close the passive case.

4. **Put the three first-visit routes immediately after the purpose sentence.** The present header tells everyone to pick a recipe while the main card correctly promotes importing from Factorio. Complete the approved route-first refinement: Paste, example and manual entry first; recipe guidance after manual entry. Keep the complete Sidecar instructions available on demand.

5. **Reduce repeated explanation while retaining interpretation.** Complete D1/D4’s approved composition work: keep comparison available, put Why/Wake/Install in the contextual detail area, and make repeated definitions available deliberately. Preserve rate scope, recovery and belt conditions. The long current pages are usable, but the visual evidence still arrives after substantial repeated instruction.

### 3. All findings

These are current minor limitations or retained original proposals. None requires reopening the completed Phase 3 feature scope.

| # | What’s confusing or odd | Who it hurts | Severity | Proposed change | Effort | Evidence |
|---|---|---|---|---|---|---|
| C3E-1 | The new Fuel trace prints raw floating-point noise: **“82.09359999999995 items burned.”** This makes both scanning and spoken output unnecessarily laborious. | Players reading or listening to Fuel details | minor | Format fractional summary quantities consistently, for example “approximately 82.094 items burned.” Keep exact event ticks/amounts unchanged. | S | **B** `w1440/85-fuel-events-and-trace-text-1440-part4of5.png`; `w720/85-fuel-events-and-trace-text-720-part5of6.png`; matching ARIA; **Source** `utils/fuelAccessibility.ts:40` |
| C3E-2 | Closing the build menu can move the document substantially despite restoring focus to the same visible opener. Current records include a −325px movement at 720×560 and −481px at 1440×900. This loses the player’s place. Baseline parity is proven only at390. | Keyboard users consulting the library while editing farther down a build | minor | In D1’s header/focus reconciliation, preserve document position on dismissal where no navigation occurred. Retain correct opener focus and modal cleanup. | M | **S** `KNOWN-MINOR-SCROLL.json`; `w720/85-build-switcher-560-menu-suppresses-popup-720.png`; paired baseline `/tmp/ux-phase3-scroll-focus-COMPARISON/COMPARISON.json` |
| C3E-3 | The larger-plan Excluded chip still has a passive partly clipped state at320. Its left gold ring remains visible, so this evidence does not establish complete focus obscuration. | Narrow/zoomed keyboard users inspecting the swing plan | minor | Reveal the entire focused chip within the local scroller without remounting it or waiting for tooltip interaction. | S/M | **H** `w320/06-larger-editable-excluded-tooltip-320.png`; `CHECKING-TRACE.json`; **Source** `components/TransferPlanPanel.tsx:189` |
| C3E-4 | The first-visit header says **“Start: pick the recipe you want to make”** before the player has chosen between Paste, example and manual entry. The detailed Sidecar instructions precede those routes. | Newcomers arriving to import an existing build | minor | Implement the approved route-first introduction and route-specific initial guidance. | S | **B** `w1440/01-first-visit-1440-part1of2.png`; Phase4 first-visit decision |
| C3E-5 | The explanatory Results layout still requires considerable travel between the answer, installation, Wake windows, comparison and Details. Large builds similarly repeat metadata/helpers on substantial rows. | Returning players comparing alternatives or editing many inserters | minor | Complete approved D1/D5 composition and default-summary work. Preserve consequential metadata assumptions and all warnings; do not simply shrink text. | M | **B** Results full-page slices; `w720/78-bulk-selected-720.png`; `w960/64-diagram-inserter-focused-save-960.png`; **S** `w720/42-compare-keyboard-560-columns-toggled-720.png` |
| C3E-6 | Multiple alternatives still share the prominent label **“For belts that stand still”**; their distinct method/count is subordinate text. The condition is clear, but differentiation is slower than it needs to be. | Players comparing standing-belt alternatives | minor | In approved D4, group the belt condition and give each option a concise differentiator using existing metrics. Preserve independent rate/recovery verdicts. | M | **B** `w1440/13-results-insights-1440.aria.yml`, comparison rows; **Source** `utils/clockSummary.ts` |
| C3E-7 | Original C19’s shape distinction remains absent in the swing comparison: on-plan and unmatched clock drops are filled circles distinguished by color. The exact-ticks table mitigates information access, but the plot itself retains the original visual weakness. This is source-confirmed; the inspected fresh logistics insight state did not exercise that plot. | Colorblind players interpreting a swing discrepancy | minor, retained original | Use an additional shape for unmatched drops and show the same shape in the legend; retain exact ticks. | S | **Source** `components/SwingComparison.tsx:81`, `:92`, `:139`; `components/InsightsPanel.tsx:83` |
| C3E-8 | **“Exclude from LCM”** above **“Included”** retains the original double negative. The old misleading green Excluded state is gone. | Experts changing plan inclusion | nit, retained original | Use “In LCM” and a clearly named state/control when this surface next changes. The previously proposed switch was not an implemented requirement. | S | **B** `w1440/27-stale-swing-plan-pointer-reopened-1440.png`; **Source** `components/TransferPlanPanel.tsx` |

#### Prior-finding closure

“Fixed” closes the underlying accepted problem, not every decorative suggestion in the original report.

| Original finding/carry | Closure | Current evidence and boundary |
|---|---|---|
| **C1 — header hides navigation/main actions** | **Fixed** | Actual390 Results shows Configure, Results and main actions exposed. Supported-width screenshots are clear. **B** `w390/08-results-answer-390-part1of7.png`; **S** direct-navigation and keyboard records. Menu-close context movement is a separate minor, C3E-2. |
| **C2 — charts accessible only through hover** | **Partly fixed overall; player-facing carry fixed** | Wake windows has summaries, keyboard stepping and table access. Fuel now supplies persistent trace text and every actual event in a semantic table, with keyboard/touch disclosure. **B** `w720/85-fuel-events-and-trace-text-720.aria.yml`, parts5–6;390 parts7–8. Old developer timelines retain their explicit light-fix boundary; their full keyboard redesign is not delivered. |
| **C3 — inverted action hierarchy** | **Fixed** | Paste is the filled first action; Generate becomes green when appropriate; the answer card has green Copy. Ko-fi is in the static footer. **B** first-visit and Results PNGs at1440/720/390. |
| **C4 — warnings resemble brand orange** | **Fixed** | Stale and nonrecovering states use yellow warning icons/text/backgrounds and explicit language. **B** `w1440/28-stale-results-1440-part1of3.png`; `w960/89-generation-cancelled-960.png`. |
| **C5 — live stale results invite an accidental copy** | **Fixed** | Banner identifies saved recipe/rate/time and actual change; Generate again is present; Copy says “Copy old clock…” and requires consent. **B** stale-results, old-clock-consent and manual-copy states. Old evidence remains readable. |
| **C6 — toast obscured by footer/header** | **Fixed for reviewed routes** | Messages occupy the header area; copy failure remains available after modal dismissal, with a deliberate manual recovery. **B** copy-failure/manual-copy states; current live traces. A modal may correctly hide the background message while an exposed announcer delivers its text. |
| **C7 — comparison is a manual, without a decision** | **Fixed for core problem; broader request partly** | Answer card, recommendation, reason, collapsed choice method, common-rate sentence and unstable grouping are present. Data bars and broader sorting proposals remain absent. D4 grouping is future work. **B** Results PNG/ARIA. |
| **C8 — unnamed controls** | **Fixed for enumerated controls** | Current trees expose named clock radios, entity controls, help and dialogs. **B** Results, bulk and shared-editor ARIA. Generic Increase/Decrease labels remain the already documented contextual-naming limitation, not unnamed controls. |
| **C9 — tooltips replace names** | **Fixed for accepted surfaces** | Comparison exposes concise headers with separately named Terms buttons; plan inclusion names its state/item. **B** Fuel/Results ARIA; **Source** `TransferPlanPanel.tsx:189`. |
| **C10 / C2E-8 / N23 — hover-only Advanced help** | **Fixed** | Three deliberate HelpButtons, short persistent helpers and actual-input description associations are present. **B** `w720/22-advanced-help-force-output-swings-720.png`; **Source** `OverridesForm.tsx:93`, `:106`, `:118`, `:138`. |
| **C11/C12 — palette collisions and invisible state marks** | **Fixed within agreed light-fix scope** | Separate item palette, state-strip legend and stronger marks are inherited from completed2.10. This is not closure of the excluded merged-timeline/keyboard-redesign proposal. |
| **C13 — no workflow announcements** | **Fixed for exercised workflow** | Current Results exposes completion status; shared-open trace contains coherent success, Undo hint and restoration text in a connected unhidden region. Owned delayed delivery is guarded at actual write. **B** `LIVE-TRACE-shared-open-720.json`; **Source** `Messages.tsx:57`, `utils/announcer.ts:43`. Native pending-Undo interval remains unexercised. |
| **C14 — narrow layouts fail** | **Fixed at supported widths; partly below720** | Ordinary controls reflow; charts/tables use bounded local scrollers. Main390 navigation/actions are reachable. Comparison and genuinely two-dimensional data still require sideways exploration. Passive320 chip clipping remains C3E-3. This is not a blanket narrow-width waiver. |
| **C15 — destructive reset without recovery** | **Fixed** | Reset is separated and offers Undo. Library/import/reorder routes also retain recovery. **S** More Reset/Undo states; **B** import and reorder Undo states. |
| **C16 — inconsistent help grammar** | **Fixed for ordinary player controls** | Grey explicit help buttons are consistent, including Advanced. Diagram uses a labeled Show rates control. |
| **C17 — old timeline axes/duplicated rows** | **Partly fixed by new player view; old proposal not implemented** | Wake windows supplies a shared tick/seconds axis and equivalent information. Developer timelines remain separate, under their explicit scope boundary. |
| **C18 — cross-view entity color unification** | **Not fixed; excluded proposal** | No evidence of a completed unified entity-color system. This was expressly outside the light timeline work; do not count it as delivered. |
| **C19 — swing-comparison color-only distinction** | **Not fixed visually** | Source still uses filled circles for both categories. Exact-ticks access mitigates the problem; C3E-7 records the remaining visual issue. |
| **C20 — diagram readability and keyboard editing** | **Fixed for accepted scope** | Inherited arrows/flow/readability remain, and current shared draft dialog is inspectable. **B** `w960/64-diagram-inserter-focused-save-960.png`; source/shared-editor evidence. |
| **C21 / C2E-11 / N32 — unreadable inert stale plan** | **Fixed** | Normal-contrast data remains exposed; warning explains staleness; inspection disclosure works; mutations are separately guarded. **B** `w1440/27-stale-swing-plan-pointer-reopened-1440.png`; **Source** `CheckPlanSection.tsx:111`, `TransferPlanPanel.tsx:59`, `:194`. |
| **C22 — flat/missing heading structure** | **Fixed in reviewed player trees** | h1, named h2 sections and meaningful nested headings are present. **B** current Results/Fuel ARIA. |
| **C23 — equal-weight Configure cards** | **Fixed for structural problem** | Target, one coherent Build card and collapsed Advanced establish rhythm; List/Diagram belongs to Build. Remaining row density is C3E-5. |
| **C24 — wasted inserter rows, red furniture, hidden mode** | **Fixed for accepted layout; density partly remains** | Fields use available width, one Add filter slot, quiet delete and named Enable state are visible. Shared editor and bulk operations are delivered. **B** `w720/78-bulk-selected-720.png`; `w960/64-diagram-inserter-focused-save-960.png`. |
| **C25 — nested/tiny filter controls and absent focus** | **Fixed for original controls** | Separate filter removal controls and visible focus replace the original nested-button structure; current gates include target/name/nesting checks. This does not imply every control has an ideal voice-command name. |
| **C26 — noisy numbers/ambiguous units** | **Partly fixed** | Existing speed/rate/duration formatting and total-versus-one-copy scope are improved. The new Fuel summary reintroduces raw precision, C3E-1. |
| **C27 — repeated text and dead-end search notice** | **Fixed for core interaction; density partly remains** | Search deeper is actionable; Why? contains supporting insight explanation; repeated manual material remains C3E-5. |
| **C28 — inconsistent Factorio grammar** | **Fixed** | Current rule/shared-editor Save is green, selections are orange, warnings yellow, panel title bars and inset fields are consistent. **B** rule/shared-editor PNGs. |
| **C29 — green Excluded/double negative** | **Partly fixed** | Misleading green is removed; double negative remains C3E-8. Proposed In LCM switch was not adopted. |
| **C30 — inconsistent terms/legend affordance** | **Partly fixed** | Player terminology is substantially reconciled and wake-up copy includes input starts/output finishes/payouts. Retained developer terminology and noninteractive legend design remain outside completed work. |
| **C2E-1 — silent clipboard rejection** | **Fixed** | Visible/spoken failure plus failed-attempt snapshot dialog and selectable exact string. No false success/pinning on manual selection. **B** copy-failure and `w720/33-manual-copy-snapshot-720.png`; `useCopyBlueprint.ts`. |
| **C2E-3 / B19 / N35 — unsafe partial Paste** | **Fixed for authorized replacement safety; Append not implemented** | Current→imported/result counts, actual crossing endpoints and explicit resettable acknowledgment precede Apply. **B** `w720/47-paste-cross-category-preview-720.png`; acknowledged state; `utils/pastePreview.ts`. |
| **C2E-4 / N4 — drag-only pointer reorder/no recovery** | **Fixed** | Move up/down, reorder message and Undo are delivered. **B** row-actions/move-up-Undo states75–77. |
| **C2E-5 / N5 — inconsistent dialog commit models** | **Fixed** | All-five draft/Save/Cancel paths are represented in the fresh workflows; shared field semantics are delivered. **B** states59–74 and ARIA. |
| **C2E-6 — obsolete wake-up definition** | **Fixed** | Current Wake windows ARIA describes craft starts for inputs and finishes/productivity for outputs, matching Terms. |
| **C2E-7 / N53 — aggregate swings called per-inserter** | **Fixed** | Advanced and plan copy name each output machine’s total and explain equal division among its output inserters. **B** Advanced help and aggregate-plan states; **Source** `OverridesForm.tsx:95`, `:158`. |
| **C2E-9 — fractional Makes caption** | **Fixed by completed2.F, retained** | Corrected scope is inherited; the Phase2 disposition records real fractional verification. No conflicting new behavior was found. |
| **N12/N13/N42/N44 — stale context, Cancel, kept results/chosen clock** | **Fixed within3.3 scope** | Saved-result provenance/change list, Generate again, early-stop explanation, reload/library return and chosen-clock restoration are present. **B** states28,34–35,39,43,51,88–90. |
| **N43 — editing at scale** | **Fixed within3.2 scope** | Duplicate, bulk stack/filter/rule editing and recovery are present. **B** states75–82. |

#### Evidence limits that remain open

- **Pending native Undo race:** the critical interval was not exercised. Early native shortcuts were ignored while the closing modal retained focus; fallback Undo occurred after speech. Production timer tests and actual-write ownership/exposure guards are meaningful complementary protection, not native race proof.
- **Fuel focus:** at1440 the native state shows three outline bands; the lower band lies outside the viewport. The separate13px observation measures the fourth band with unchanged focus/data/open state. Other widths show four native bands. I do not convert the framed1440 observation into a four-band native claim.
- **Contrast:** current Fuel receipts independently recompute48 actual PNG samples and96 pairs, minimum7.767:1. Paint excerpts expose the leaf/background chain; historical3.F evidence covers3,600 composited leaves. These are scoped measurements.
- **Busy intervals:** additional native busy input and painted busy-tooltip behavior remain unsampled. The controlled node/focus observations and guards do not prove those extra states.
- **Menu scope:** named menu regions and actual ARIA show isolated content. Root’s32 scope receipts cover open/closed restoration. The720 normal/560 comparison evidence reaches the control through16 genuine Tabs before any wheel, with exposed geometry and successful toggle/restore. This supports keyboard reachability independently of screenshot framing.
- No VoiceOver/NVDA/JAWS session or human usability exercise was performed by me. Historical negative runs remain negative.

### 4. What I’d cut or hide

- Put the full Sidecar procedure behind deliberate help after the initial import/example/manual routes.
- Collapse repeated definitions and routine defaults in the approved density work; retain concise units, assumptions and warnings where values are interpreted.
- Keep developer timelines, detailed simulation controls and logs behind Developer tools.
- Keep installation instructions available and complete. Their length is a composition problem, not a reason to remove necessary wiring guidance.

### 5. What already works

- **The visual grammar carries meaning.** Orange selection, green commit and yellow warning are distinguishable, with words/icons supporting the color.
- **The data now has persistent alternatives.** Wake windows and Fuel offer text/table access instead of making hover precision mandatory.
- **Recovery belongs to the workflow.** Clipboard failure, partial replacement, draft cancellation, Undo and kept chosen results are visible parts of the product.

### 6. Open questions for the author

There is no new author decision required to close Phase 3 from this lens.

The remaining release question is how accessibility will be described publicly: the evidence supports the specific reviewed behavior, not unrestricted WCAG certification. D3’s approved before/after task exercise will help quantify the density changes; it will still be agent walkthrough evidence rather than human-user validation.

D1–D7 and first-visit refinement remain approved future work. D8 remains investigation only. D9 requires actual independent, justified cleanup of UX-added UI tests before feature→master; a report or deferred issue cannot satisfy it. Owner-confirmed Sidecar and in-game installation cases are already passed and need not be reopened by this review.
