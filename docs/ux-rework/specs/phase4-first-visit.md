# First-visit routing — approved Phase 4 scope

Owner approval, 2026-10-16: A / A. Phase 4 targets `feat/ux-rework`. This refines the existing Phase 2 introduction after the owner review; final item spec/evidence and normal independent review precede implementation.

## Approved behavior

- Lead with a short purpose statement and immediately expose Paste from Factorio, Try an example and Build by hand. Paste remains the primary route.
- Put complete Sidecar/export instructions behind an on-demand guide, preserving the mod link and full instructional content.
- The initial hint describes the available routes. Recipe guidance appears after Build by hand is chosen, rather than instructing users of every route to pick a recipe.
- Preserve existing manual-paste recovery, intro dismissal and the ability to reach all routes. Reuse current import/example/manual actions and persistence; no compulsory wizard or new import subsystem.

## Preservation and evidence

- Finalize precise guide placement, route state and copy against the finished Phase 3 UI, preserving newcomer accessibility and the Factorio visual direction.
- Verify each route through native pointer/keyboard activation, visible destination and safe focus after intro dismissal/route changes. Keep the full guide and manual-paste path reachable at supported/narrow widths.
- Preserve existing clipboard safety, validation, results/Undo behavior and build state. Do not repeat the already-passed owner in-game installation checks merely for this introductory layout change.
- Use current checks, independent code/UX review and all three phase-end reviewers. Add new tests only for meaningful behavior not already sufficiently protected, in accordance with D9.
