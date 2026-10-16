# Deferred design discussion — draft roadmap proposals

Owner request: 2026-10-16. Record these ideas for later discussion, not implementation now. D1 already covers Compact view and wider-screen composition. These are draft proposals, not finalized implementation specs or additions to the current release scope. Revisit after the owner's broader audit; preserve current reviews and verification.

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
