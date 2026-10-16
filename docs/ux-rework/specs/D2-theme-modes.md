# D2 Light/dark mode — approved Phase 4 scope

Owner approval, 2026-10-16: A / A / B. Phase 4 targets `feat/ux-rework`; implement D2 after the density work. This is approved scope for a later detailed item spec, not a claim of implementation or evidence completion.

## Approved behavior

- Offer System / Light / Dark and remember the selected color preference locally. Keep it independent of Compact and outside build data, exports and share links.
- Default new installations to System, following the device's current color-scheme preference. Explicit Light/Dark choices override the device preference. Preserve saved user choices; finalize treatment of legacy installations without a saved theme in the implementation spec.
- Cover the complete interface: application surfaces, forms, dialogs, item slots, warnings/status, charts, diagrams and focus indicators. A partially themed interface is outside the approved direction.
- Retain the Factorio visual grammar: orange selection/accent, green confirmation/commit, title-bar panel headers and inset controls. Choose theme-appropriate semantic colors with readable contrast.
- Coordinate one display-preferences entry with D6 if separately approved. Exact placement remains to be finalized without adding avoidable header height.

## Verification and boundaries

- Both Compact and explanatory views work in both themes. Theme changes preserve builds, results, selection and current editing state.
- Verify System follows the device preference and that an explicit choice remains stable across reloads. Define fallback behavior when local storage is unavailable without blocking application use.
- Inspect player-facing states and the charts/diagrams in each theme, including selected, disabled, warning, stale and focused states. Preserve existing accessibility requirements and normal evidence/checks, independent code/UX reviews and three phase-end reviewers.
- Finalize exact files, token changes, migration behavior and bounded evidence in the item spec before implementation. No new dependencies, ranking changes or generation arithmetic are implied.
