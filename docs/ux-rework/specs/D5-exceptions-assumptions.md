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


## Finalized initial implementation slice

# D5 Import and saved-result assumptions — refreshed draft

Approved A/A/A plus approved 0.16 refinements. This bundle delivers Results/import presentation; Configure default/exception row composition stays with D1B. One D5 ledger item records both slices and completes only after both pass.

## One source for facts

Accepted compatibility owns worker `ClockModelAssumptions`/`GenerationAssumptions`, saved hook/cache/Undo ownership and any `utils/modelAssumptions.ts` presentation exports. Consume its exact accepted API; do not resurrect the prior draft's competing `buildAssumptionsOf` provider or add a cache schema/payload here. Root must pin the accepted public exports first (see API note).

Generation config/metadata identity is existing `GeneratedFor` in `utils/resultsStaleness.ts`: `key` is the serialized config that generated the result. App currently passes `staleFor` only and already decodes its key for stale differences. Pass `generatedFor` also when fresh. Selected candidate period/windows/start/loss facts and assumptions come from worker view, not the parsed generation config when a candidate differs. Unavailable legacy data is unavailable, never replaced by today's form.

Other sources: `inserterMetadata.ts` effective capacity/missing timing, `inserterFilters.ts` actual automatic semantics, `pastePreview.ts` selected-and-nonempty replacements, `ConfigImportExport.tsx` Apply/acknowledgment/Undo, `utils/configForm/formData.ts` and `configMapping.ts`. Compatibility owns preservation of imported fuel, sink.drop and global overrides, cross-field validity and its chosen read-only unsupported geometry edits/duplication policy. Presentation must retain that policy, not invent geometry editing.

## Acceptance

- [ ] One concise visible “These results assume…” summary covers relevant saved metadata/Copies/belt and modeled-start/check qualifications. Important differences stay apparent in both densities; details live in the shared Why context/disclosure instead of new repeated helper walls. Start dependence/warnings stay visible when Wake/Install is active.
- [ ] Model meaning remains explicit: full input supplies; empty modeled machines/buffers/hands; clock phase0 and actual relevant loop seed; separate prepared planning state; rate judged after model warm-up. No promise of immediate first-period target, arbitrary live-start convergence, every build order, physical belt capacity or in-game recovery proof. A concise visible qualification plus reachable complete meaning suffices; do not turn routine defaults into warning banners.
- [ ] Not requested, actual evaluated starts, unavailable/null, no clocks and incomplete generation remain distinguishable. Counts/status use actual `assessment.start_dependence.starts`, not the requested flag, presence of a non-null object or a fixed engine constant. Generation completion qualifies the run; selected candidate details describe that candidate. Existing clock-phase checks are separate.
- [ ] Relevant loop seed amount/item, supplied shared-output drop positions versus free-lane timing, imported machine fuel and explicit supported overrides remain inspectable from saved facts. Show only relevant qualifications. Imported geometry does not certify backup, foreign traffic or every belt speed. Preserve existing input-belt slack rule-of-thumb meaning and current research limitations.
- [ ] Missing prototype and quality counted independently; absence implies actual Stack/Legendary timing fallback, explicit equal metadata remains explicit. Automatic capacity includes actual full-research explanation; unsupported capacity is unavailable, never NaN/zero/fabricated 16. Omitted stack_size and explicit equal 16 retain distinct labels. Filter omission/empty follows usesAutomaticFilters; explicit equal filters remain set by hand. Enable-rule Auto and explicit equal behavior remain distinct. No normalization, new selectors or export/arithmetic change.
- [ ] Import assumptions describe the prospective composition actually applied: selected nonempty categories replace; unselected/empty retain. Recompute with selection/current form changes; label incoming/retained scope. Target/Copies change only when real Apply changes them. Never describe ignored metadata as current or call exportConfig on an invalid live form merely to summarize it. Preserve crossing acknowledgment, apply guard, manual recovery and one atomic Undo; no new routine acknowledgment/modal.
- [ ] Fresh/stale/cache/reload/build-switch/Undo/Cancel ownership follows accepted compatibility. Metadata/belt/Copies shown for saved results use generatedFor; candidate-specific facts use selected worker view. Dirty form/preference changes never rewrite assumptions or validate old clocks. Keep app-version/results-schema rejection unchanged; this slice does not create a new cache.

Configure slice later: bounded inventory is existing machine type/productivity/speed/applicable energy %, belt prototype/strategy/lane capacity (consumption /s stays visible), inserter type/quality/capacity/filter/rule source. Compact summarizes genuinely common defaults once with counts/scope and visible row exceptions; no common value means Mixed or retained row labels, never arbitrary majority. Recipes/endpoints/near-lane/actual filters/rule state/errors remain visible; explanatory retains fuller labels and shared editor Save/Cancel/clear/Undo.

Use existing metadata/filter/pastePreview/staleness/cache/compatibility coverage. Add only a missing explicit-equal/prospective-composition/saved-snapshot regression after inspecting accepted tests. Native evidence combines import retained/incoming/empty transitions, fresh→stale→reload, one-field-missing versus explicit metadata, actual model/check/lean qualifications and geometry read-only feedback. Full common gate applies; no new matrix.
