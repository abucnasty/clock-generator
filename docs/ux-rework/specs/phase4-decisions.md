# Phase 4 proposal decisions

Owner direction, 2026-10-16: discuss each proposal critically so the owner can approve, reject or narrow it. Approved scope becomes Phase 4, targeting the main feature branch `feat/ux-rework`. This discussion supersedes the deferred status only for explicitly approved scope.

D1–D6 are approved for Phase 4 with the exact choices below. Other proposals remain pending. Approval of D1 does not approve every illustrative behavior shown in the mock. Record exact decisions and remaining questions below before finalizing item specs.

Phase 3 verification and its merge checkpoint remain required. Phase 4 retains independent code/UX review, current verification requirements and three fresh phase-end reviewers. Final `master` merge remains owner-only. The active worker setting remains GPT-6.1 Sol / high reasoning / fast mode off.

| Proposal | Decision | Scope to resolve |
|---|---|---|
| D1 Compact view and responsive composition | Approved — B / A / A | Results/header first, then compact Configure; explanatory default with remembered opt-in Compact; comparison visible with one contextual Why/Wake/Install detail area and routine helpers collapsed |
| D2 Light/dark mode | Approved — A / A / B | Include after density work; System / Light / Dark, remembered locally; System default for new installations; complete interface including charts and diagrams |
| D3 Task-based usability audit | Approved — A / A / A | Integrated bounded exercise: two representative builds, three tasks; baseline before D1 and repeat after Phase 4; agent measurements, owner participation optional |
| D4 Clock recommendation and tradeoffs | Approved — A / A / A | Group by belt compatibility; concise selected-clock reason/tradeoff with deeper details on demand; both explanatory and Compact views; existing ranking/selection rules unchanged |
| D5 Exceptions and assumptions | Approved — A / A / A | Compact summarizes common defaults per section, differences visible on rows; explanatory view keeps fuller labels; distinguish Automatic/Explicit even when values match; import and result-snapshot assumption summaries |
| D6 Display preferences | Approved — A / A / A | Labeled Display button in slim header, no extra row; Compact and System/Light/Dark in immediate-apply popover; one browser-wide preference set shared across builds |
| D7 Working context | Pending | Specific remaining gaps after Phase 3; reset and persistence rules |
| D8 Per-machine production rates | Pending | Semantics/feasibility only versus implementation; authoritative source; target/max/achieved and units |
| D9 Independent audit of new UI tests | Pending | Audit/proposal versus approved cleanup; only UX-rework additions in clock-generator-ui; remaining coverage |
| First-visit route refinement | Pending | Choices before instructions; guide default; preserve Paste/Example/Manual routes |

## Decisions

### D1 approved, 2026-10-16

Owner: “Approve D1 with B / A / A.”

- Scope B: include both Results/header and Configure in Phase 4, delivered in two stages: Results/header first, then compact machine, belt and inserter rows. Reuse the existing shared editor and its live/draft semantics.
- Default A: new users start in the explanatory view; Compact is opt-in, reversible and remembered locally, separate from build/export/share data.
- Detail A: keep comparison visible and use one contextual area for Why, Wake and Install, with only the selected detail open. Collapse routine helper text; preserve help on demand.
- Use the latest compact mock as the design direction: one slim header with version visible, compact rows, related details beside comparison at wide widths, and reflow at narrower widths. Exact responsive breakpoints and Configure details are finalized in the item specs.
- Keep units, assumptions, errors, stale/below-target warnings and belt conditions visible wherever needed to interpret results. Preserve current selection, Generate/Cancel/Copy, full installation guidance, keyboard/focus/contrast and usable touch targets.
- Approval adds this work to Phase 4 against `feat/ux-rework`; it does not bypass specs, evidence, independent review or Phase 3 closeout. The mock's roughly 432px default height is illustrative evidence, not a fixed-height constraint for all builds.

### D2 approved, 2026-10-16

Owner: “Approve D2 with A / A / B.”

- Inclusion A: include light/dark mode in Phase 4 after the density work.
- Choices A: offer System / Light / Dark. Remember the choice locally, independently of Compact and separately from build exports/share links.
- Default B: new installations follow System immediately, using the device's light/dark preference. Preserve explicit saved choices; legacy-user migration details remain for the final item spec.
- Scope covers the complete interface, including dialogs, warnings, item slots, charts, diagrams and focus indicators. Preserve the Factorio visual direction: orange selection, green confirmation, inset controls and panel headers, with readable theme-appropriate colors.
- Existing contrast/accessibility, independent review, checks and phase-end requirements apply. Coordinate preference placement with D6 if approved; D2 does not itself approve D6 or any new toolbar row.

### D3 approved, 2026-10-16

Owner: “Approve D3 with A / A / A.”

- Scope A: integrate a bounded task exercise with Phase 4 using two representative builds and three tasks: import/edit/generate; compare/select/copy; reopen/find installation guidance.
- Timing A: record a baseline before D1, then repeat the same tasks after Phase 4. Compare scroll distance, interactions and interpretation problems under comparable conditions.
- Participation A: agents provide walkthrough measurements; owner hands-on participation is optional and introduces no new owner-test checkpoint. Agent measurements are not proof of human usability.
- Deliver one short before/after scorecard linked to supporting evidence. This is not another broad review cycle or test suite; existing verification and all three phase-end reviewers remain required.
- Findings outside approved scope return to the owner for a decision instead of automatically extending Phase 4. Select exact builds/tasks and measurement details in the final item spec.

### D4 approved, 2026-10-16

Owner: “Approve D4 with A / A / A.”

- Organization A: group comparison clocks by “Matches your belt setting” and “Requires a different belt setting.” Keep alternatives inspectable/selectable under existing rules with conditions visible.
- Explanation A: show one concise reason or tradeoff beside the selected clock; deeper ranking/metric details are available on demand. Use only facts supported by the actual result. Rate, recovery and belt warnings remain visible where relevant; wake-up differences are not measured UPS savings.
- Coverage A: apply in both explanatory and Compact views, adapted to each layout and coordinated with D1's contextual detail area.
- Reuse existing recommendation logic, explanations and metrics. Preserve ranking and selection rules; this is presentation work and does not authorize engine changes or new optimization objectives.
- Finalize group treatment and conditional/fallback cases in the item spec. Belt compatibility does not imply that target rate/recovery checks passed; preserve those separate statuses and unit scopes.

### D5 approved, 2026-10-16

Owner: “Approve D5 with A / A / A.”

- Repetition A: in Compact, summarize common defaults once per section and display differing values on their rows. Keep fuller labels in the explanatory view.
- Explicit settings A: retain concise Automatic/Explicit distinctions even when their current numerical values match; use text rather than color alone.
- Assumptions A: show a concise assumptions summary during import review and on Results, with further detail available. Results describes the assumptions of the saved result, not a later edited build.
- Preserve consequential missing-metadata timing assumptions and accessible names, essential warnings and validation. Reuse existing metadata/editors; no new type/quality selectors or change-history system are implied. Routine defaults do not become warning banners.
- Finalize exact summarized fields and assumption placement with D1's finished editor/layout. Normal independent review, checks and all three phase-end reviewers remain required.

### D6 approved, 2026-10-16

Owner: “Approve D6 with A / A / A.”

- Placement A: one labeled Display button in the slim header without adding another header row.
- Application A: a small popover containing Compact on/off and System / Light / Dark; apply changes immediately and remember them.
- Scope A: one preference set for this browser shared across all builds. Keep preferences outside build exports/share links; preserve D1's explanatory default and D2's System default for new installations.
- Responsive composition adapts to available width automatically. This bounded entry does not add a manual layout mode or broader settings project.
- Preserve editing state, results and selection when display changes. Finalize accessible keyboard/focus/dismissal and narrow-width behavior in the item spec; existing verification/reviews remain required.

Next discussion: D7 working context. D7–D9 and first-visit refinement remain pending.
