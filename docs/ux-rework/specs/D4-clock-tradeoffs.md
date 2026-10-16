# D4 Clock recommendations and tradeoffs — approved Phase 4 scope

Owner approval, 2026-10-16: A / A / A. Phase 4 targets `feat/ux-rework`. This is approved presentation scope; final item spec and normal evidence/reviews precede implementation.

## Approved behavior

- Group comparison by “Matches your belt setting” and “Requires a different belt setting,” based on the actual build/result assumptions. Keep alternative clocks inspectable and selectable under existing rules; show their conditions visibly.
- Place one concise recommendation reason or selected-clock tradeoff beside the selected clock. Deeper ranking explanations and metric breakdowns remain available on demand, coordinated with D1's contextual area.
- Apply the same semantic improvements in both explanatory and Compact views, adapted to the layout.
- Reuse current recommendation/ranking logic and existing selected-clock explanations. No ranking, engine arithmetic, optimization-objective or selection-rule change is implied.

## Interpretation and evidence

- Derive deltas and reasons from the actual result and existing authoritative metrics. Keep wake-ups distinct from wake windows, achieved from requested rate, and one-copy from all-Copies values. Do not claim measured net UPS savings from wake-up differences.
- Keep rate, recovery and belt warnings visible where needed. A matching-belt group must not imply that separate target/recovery checks passed. Preserve fallback and below-target behavior.
- Preserve the recommendation marker, current selection, Generate/Cancel/Copy and conditional alternatives. Finalize group labels and edge cases against the finished Phase 3 implementation.
- Verify representative compatible/conditional choices, selected-alternative explanations and preserved ranking in both density modes and responsive layouts. Use normal checks and independent code/UX review; retain all three phase-end reviewers.
