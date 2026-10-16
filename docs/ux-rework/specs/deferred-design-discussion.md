# Deferred design discussion — draft roadmap proposals

Owner request: 2026-10-16. Record these ideas for later discussion, not implementation now. D1 already covers Compact view and wider-screen composition. These are draft proposals, not finalized implementation specs or additions to the current release scope. Revisit after the owner's broader audit; preserve current reviews and verification.

Current decisions, 2026-10-16: D1–D6 are approved for Phase 4. Original D2–D6 draft rows below are superseded by [D2 approved scope](D2-theme-modes.md), [D3 approved scope](D3-task-audit.md), [D4 approved scope](D4-clock-tradeoffs.md), [D5 approved scope](D5-exceptions-assumptions.md), [D6 approved scope](D6-display-preferences.md) and [the Phase 4 decision register](phase4-decisions.md). D7–D8 remain pending individual approval; all three phase-end reviewers and current verification remain required.

| ID | Proposal | Problem / intended outcome | Decisions for later |
|---|---|---|---|
| D2 | Light/dark mode | Offer a saved colour-scheme preference independently of density/layout. Shared tokens help; light surfaces, semantic colours, diagrams/charts, focus and contrast all need deliberate palettes and verification. | Light/dark/system options, default, preference placement, migration of static dark tokens and visualization colours. Moderate feature; no implementation estimate committed. |
| D3 | Task-based usability audit | Evaluate real owner builds through import → generate → compare → choose → copy, including editing and returning to Results. Record scrolling, interaction count and confusion as well as correctness/accessibility. | Representative small/large builds, task set, comparison baseline and useful success metrics. Complements the existing three phase-end reviewers and gates; does not replace them. |
| D4 | Recommendation rationale and tradeoffs | Explain why a clock is recommended and what another choice trades off using the engine's actual ranking criteria and displayed metrics. Audit what already exists before adding more UI. | Which decisions need explanation, concise wording, optional deeper detail and whether comparison UI is warranted. No ranking or engine-behaviour change implied. |
| D5 | Emphasize exceptions and changes | Make overrides, warnings, changed values and nondefault metadata easy to spot while repeated defaults stay quieter. Coordinate with D1 to reduce repetition without concealing important assumptions or accessible names. | Default vs Compact behaviour; which metadata can be summarized once per section; how exceptions are represented without colour-only meaning. Existing imported-metadata requirements remain until a concrete design is approved. |
| D6 | One display-preferences entry | Keep density, colour scheme and responsive-layout preferences in one small, accessible settings entry rather than increasing toolbar height with separate controls. | Entry placement, keyboard flow, which choices are automatic, persistence scope and defaults. Preferences should stay separate from exported/shared build data. |
| D7 | Preserve working context | Assess selection, sorting/filter state, expanded details, active tabs and scroll position across routine edits/navigation/reload, so returning to a task does not require rebuilding the view. | Per-build vs browser-local context, reset rules, invalid/removed selections and cross-tab behaviour. Reconcile with planned3.3 chosen-clock/cache work first; avoid duplicating it. |

## Suggested discussion order

Finish current safety/persistence work. Use D3 and the owner's audit to prioritize D1 and D4–D7; consider D2 separately as a colour-scheme feature. This is a discussion sequence, not a new implementation schedule.

For any proposal selected later, finalize exact behaviour/files, measurable acceptance, risks and evidence before implementing. Keep newcomer defaults, essential validation/status feedback, keyboard/focus/contrast requirements and the owner's then-current model instructions.

## D8 — Per-machine target production rate

Owner addition, 2026-10-16: show the target production rate for each machine alongside maximum capacity. Deferred draft; no engine or UI implementation now.

- Intended display: required/planned average output for each machine, maximum attainable output, and optionally utilization/headroom. Keep requested target, maximum capacity and selected-clock achieved/simulated output distinct, especially for below-target clocks.
- Current boundary: `SerializableMachineFacts` exposes intrinsic `output_rate_per_second` and its exact ratio, not a required per-entity target. `TargetProductionRate.fromConfig` represents build-total/per-copy final-output demand; that is not sufficient by itself to assign an intermediate machine's rate. Inspect existing cycle/transfer planning before proposing new calculation logic.
- Likely work spans engine planning/serialization, the worker response and machine display. Prefer publishing authoritative engine-derived rates over independently reconstructing flow arithmetic in the UI.
- Define units explicitly: each machine in one modeled unit versus totals across Copies, including fractional Copies. Cover multiple machines producing the same item, intermediates, productivity, by-products, loops, fuel/fluid cases where relevant, and ambiguous or infeasible plans without inventing a target.
- Decide later whether targets become available after Check or Generate, and how stale/missing planning is represented after changes. New target values depend on build target, Copies and connected build topology, not just intrinsic machine settings.
- Later acceptance: validate simple hand-calculable chains and real representative builds; preserve exact rational boundaries; update freshness/versioned payload handling as needed; ensure compact and normal views distinguish target/max/actual clearly and accessibly.

This draft does not extend the currently frozen upstream integration or authorize engine changes during the current compatibility pass.
