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


## Finalized initial implementation slice

# D6 Browser-wide Display foundation — refreshed draft

Approved A/A/A; explanatory default from D1, System default from D2. This bundle delivers functional density/preferences foundation. D6 theme portion stays incomplete until D2 renders all approved themes after both density stages. Keep a separate D6 progress row with these two stages.

## Provider and consumers

Single new `utils/displayPreferences.ts`, `hooks/useDisplayPreferences.tsx` and `components/DisplayPreferences.tsx`; exact proposed exports in `API-DEPENDENCY-NOTE.md`. App mounts one provider with stable identity outside the consuming header/Results tree. D1A Results/header and later D1B Configure consume `density`; D2 consumes `scheme` and alone wires System media resolution to actual theme/chart/diagram consumers. No competing preference store/hook in D1B/D2/D7.

## Acceptance

- [ ] One visibly labeled Display button inside the composed slim header, no extra Display row. Named keyboard-accessible immediate-apply popover exposes Compact on/off. Space/Enter open, Escape/outside dismissal closes and focus returns to the live visible opener. It fits390 and short height without clipped/hidden controls.
- [ ] Missing/malformed/unsupported storage yields explanatory/system. Unsupported version resets to defaults; valid-version invalid individual values fall back independently. Denied read/write leaves working in-memory controls, without a routine storage-error banner. One browser-wide set survives reload/build switching independently of per-build content.
- [ ] Compact applies immediately/reversibly, no Apply/Cancel. Current build/view/draft inputs/rules/manual selection/results/generatedFor/copy ownership/worker activity stay intact; no App/editor remount keyed by preference. Responsive composition is automatic, no manual layout selector.
- [ ] Storage/preferences never enter Config, build library payload, exports/share links, worker input or generation key. D7 per-build context later uses separate ownership. Existing result-cache schema/version guard is unchanged.
- [ ] Foundation popover has functional Compact only. System/Light/Dark controls appear only when D2 implements all modes; no disabled/inert theme placeholders. Stored `scheme` preserves valid explicit preference for later D2. D6 is not marked complete until theme controls, System behavior and full-interface themes pass D2 gates.
- [ ] Saved preferences are browser-wide; another tab reads the latest validated choice on reload. No live cross-tab synchronization project is required. Preserve any valid stored scheme when density changes.

Meaningful verification: one focused preference parse/storage-failure group and, if existing integration lacks it, one mounted dirty-draft/result preservation regression. Reuse build/share/key exclusions and avoid preference permutations. Native evidence checks Display open/close/focus, explanatory→Compact with selected clock, two named builds and a dirty shared-editor dialog, source/key/input equality, narrow/short-height fit. D2 later adds actual System/explicit-mode behavior without duplicating this provider suite. All common reviews/gates remain.
