# Phase 4 proposal decisions

Owner direction, 2026-10-16: discuss each proposal critically so the owner can approve, reject or narrow it. Approved scope becomes Phase 4, targeting the main feature branch `feat/ux-rework`. This discussion supersedes the deferred status only for explicitly approved scope.

D1 is approved for Phase 4 with the exact choices below. Other proposals remain pending. Approval of D1 does not approve every illustrative behavior shown in the mock. Record exact decisions and remaining questions below before finalizing item specs.

Phase 3 verification and its merge checkpoint remain required. Phase 4 retains independent code/UX review, current verification requirements and three fresh phase-end reviewers. Final `master` merge remains owner-only. The active worker setting remains GPT-6.1 Sol / high reasoning / fast mode off.

| Proposal | Decision | Scope to resolve |
|---|---|---|
| D1 Compact view and responsive composition | Approved — B / A / A | Results/header first, then compact Configure; explanatory default with remembered opt-in Compact; comparison visible with one contextual Why/Wake/Install detail area and routine helpers collapsed |
| D2 Light/dark mode | Pending | Whether included; system/light/dark choices; default; charts/diagrams |
| D3 Task-based usability audit | Pending | Design input versus standalone audit; representative builds; bounded deliverable |
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

Next discussion: D2 light/dark mode. No other proposal is approved yet.
