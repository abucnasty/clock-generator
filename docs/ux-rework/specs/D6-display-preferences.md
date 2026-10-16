# D6 Display preferences — approved Phase 4 scope

Owner approval, 2026-10-16: A / A / A. Phase 4 targets `feat/ux-rework`. Coordinate with D1's header/density work and D2's themes; detailed item spec and normal verification/reviews precede implementation.

## Approved behavior

- One labeled Display button in the slim header. Do not add another header row solely for display controls.
- Open a small popover with Compact on/off and System / Light / Dark. Changes apply immediately and are remembered locally; no Apply/Cancel dialog is required for these reversible preferences.
- Use one browser-wide preference set across builds. Keep it separate from build data, exports and share links. D1's explanatory default and D2's System theme default for new installations remain unchanged.
- Responsive composition follows the available width automatically. This is a bounded preference entry, not a manual layout-mode selector or a broader settings project.

## Preservation and evidence

- Changing density/theme and switching builds must retain the applicable display preferences without altering build content, pending edits, results or selected clock.
- Verify keyboard opening/selection/dismissal and appropriate focus return; both themes/densities, narrow-width reachability and long build/action labels must fit without an extra display-only header row.
- Reuse the D1/D2 preference implementation rather than duplicate storage or add competing controls. Finalize exact placement, accessible controls, persistence/fallback and narrow-width behavior in the item spec.
- Keep normal checks, independent code/UX review, current accessibility requirements and all three phase-end reviewers.
