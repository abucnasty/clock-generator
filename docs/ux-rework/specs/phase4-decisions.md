# Phase 4 proposal decisions

Owner direction, 2026-10-16: discuss each proposal critically so the owner can approve, reject or narrow it. Approved scope becomes Phase 4, targeting the main feature branch `feat/ux-rework`. This discussion supersedes the deferred status only for explicitly approved scope.

D1, D2 and D3 are approved for Phase 4 with the exact choices below. Other proposals remain pending. Approval of D1 does not approve every illustrative behavior shown in the mock. Record exact decisions and remaining questions below before finalizing item specs.

Phase 3 verification and its merge checkpoint remain required. Phase 4 retains independent code/UX review, current verification requirements and three fresh phase-end reviewers. Final `master` merge remains owner-only. The active worker setting remains GPT-6.1 Sol / high reasoning / fast mode off.

| Proposal | Decision | Scope to resolve |
|---|---|---|
| D1 Compact view and responsive composition | Approved — B / A / A | Results/header first, then compact Configure; explanatory default with remembered opt-in Compact; comparison visible with one contextual Why/Wake/Install detail area and routine helpers collapsed |
| D2 Light/dark mode | Approved — A / A / B | Include after density work; System / Light / Dark, remembered locally; System default for new installations; complete interface including charts and diagrams |
| D3 Task-based usability audit | Approved — A / A / A | Integrated bounded exercise: two representative builds, three tasks; baseline before D1 and repeat after Phase 4; agent measurements, owner participation optional |
| D4 Clock recommendation and tradeoffs | Pending | Eligibility grouping; concise deltas; preserve existing ranking |
| D5 Exceptions and assumptions | Pending | Which defaults may be summarized; visible overrides and model assumptions |
| D6 Display preferences | Pending | One entry; preference placement; persistence separate from build data |
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

Next discussion: D4 clock recommendation and tradeoffs. D4–D9 and first-visit refinement remain pending.
