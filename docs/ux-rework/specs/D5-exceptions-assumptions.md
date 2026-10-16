# D5 Exceptions and assumptions — approved Phase 4 scope

Owner approval, 2026-10-16: A / A / A. Phase 4 targets `feat/ux-rework`. Coordinate with D1's shared editor and responsive layouts; detailed item specs and normal verification/reviews precede implementation.

## Approved behavior

- Compact summarizes common defaults once per section, while rows retain visible differing values. The explanatory view retains fuller labels.
- Keep concise Automatic/Explicit distinctions even when numerical values currently match. Labels must express the actual source/setting semantics, with text so the distinction does not depend on color.
- Show a concise modeling-assumptions summary during import review and on Results, with further detail available. Result assumptions belong to the snapshot that produced that result; do not silently substitute the current edited build's assumptions for an old result.
- Keep meaningful missing-metadata assumptions apparent, including Stack inserter / Legendary timing where that is the actual fallback. Preserve effective values, read-only imported metadata, full-research capacity explanations where needed, accessible names/descriptions, essential warnings and validation.

## Boundaries and evidence

- Reuse existing metadata and the finished shared editor. No new inserter type/quality selectors, export changes, arithmetic changes or change-history system are implied.
- Do not convert routine defaults or every explicit value into warning banners. Summarization must not hide genuine exceptions or confuse missing metadata with an explicit setting.
- Finalize the precise field inventory and placement in the item spec. Reuse existing import surfaces where suitable; this approval does not require an extra acknowledgment or new modal for routine assumptions.
- Verify repeated defaults, differing metadata, Automatic/Explicit equal-value cases and stale-result assumption provenance in both density views. Preserve existing edit/clear/Undo and live/draft semantics.
- Use normal checks and independent code/UX reviews, with current accessibility requirements and all three phase-end reviewers retained.
