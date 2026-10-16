# D7 Working context — approved Phase 4 scope

Owner approval, 2026-10-16: A / A / A. Phase 4 targets `feat/ux-rework`. Identify actual remaining context losses against finished Phase 3 before finalizing the implementation spec. Extend existing behavior and preserve current result/chosen-clock persistence.

## Approved behavior

- Remember selected entity, Configure/Results view, detail tab, expanded sections, existing sorting/filter choices and approximate place on the page.
- Save this navigation context locally per build and restore it across reloads and switching builds. Keep it outside build exports/share links, distinct from D6's browser-wide display preferences.
- Retain existing Save/Cancel semantics. This scope does not recover unfinished dialog edits after reload, auto-commit drafts or add an autosave/draft-recovery feature.
- Use sensible fallbacks when entities are removed/renumbered or layouts change. Validation and deliberate task actions must still take the user to the relevant problem/content rather than be overridden by old scroll restoration.

## Boundaries and evidence

- Inventory existing Phase 3 persistence and mounted-view behavior first; implement actual missing context within approved scope rather than a general persistence rewrite.
- Persist existing filter/sort choices only where such controls exist. No new sorting/filtering, stable-ID system or generation cache redesign is implied.
- Finalize reset behavior for new/reset/imported/changed builds and local context invalidation/cross-tab behavior in the item spec. Avoid transferring context to the wrong build or restoring an unrelated entity after renumbering.
- Verify representative return-to-edit/detail flows, switching between builds, reloads and removed/changed selections. Check that restored context preserves safe editing/focus/validation and existing chosen-clock/cache/Undo behavior.
- Use normal checks, independent code/UX reviews, current accessibility requirements and all three phase-end reviewers.
