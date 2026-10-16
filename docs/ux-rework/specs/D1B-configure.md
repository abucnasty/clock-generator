# D1 stage B Compact Configure with shared editors
Findings: owner D1 B/A/A and D5 repetition choices · Implementer model: gpt-6.1-sol/high, fast off · Branch: feat/ux-rework-p4-configure-density (bundle D1B + D5 Configure)

## Change
- Compact machine/belt/inserter rows and routine help within existing Build List; retain explanatory fuller presentation and the same controlled editors.
- Keep core fields and exceptions readily visible; move routine explanation behind labeled disclosure, with actual errors/first-problem destinations revealed automatically.
- Preserve live List edits and all Diagram draft Save/Cancel behavior, row/bulk actions, renumbering and Undo.

## Files
- `src/components/BuildPanel.tsx:6–18` List/Diagram tab; `MachinesForm.tsx:118–260`, `BeltsForm.tsx:132–297`, `InsertersForm.tsx:84–123,133–262`: mode-specific row composition and D5 summaries. `App.tsx:994–1110` props/validation/focus bridge only where required.
- `InserterEditor.tsx:25–38` existing controlled value/layout/onChange API; `:59` live-vs-draft common fields; `:109–123` stack/filter behavior. Extend with presentation-only `density?: DisplayDensity` if needed, default explanatory; preserve value and onChange shape. `InserterConfigPanel.tsx:89–106`, `EntityEditDialog.tsx:558–563` retain draft ownership. No parallel compact editor.
- `MachineFactsAccordion.tsx`, `TargetOutputForm.tsx`, `Panel.tsx` only necessary disclosure/composition; retain IDs/names/units. D5 Configure common-default/exception summaries use current inserterMetadata/inserterFilters and saved metadata contracts; no competing buildAssumptions provider. D6 useDisplayPreferences is the sole density source. Existing `rowFocus.ts`, `useFocusAfterRemove.ts`, `BulkEditBar.tsx`/`SortableList.tsx` contracts reconcile if row geometry changes, not redesign.

### Dependencies and state contract
After 4.1: D6 density provider and compatibility saved-facts API committed; D5 row summaries reuse existing metadata semantics. D1B+D5 edit the same three form sections and shared editor, so one implementer/branch. Any new collapse state uses stable section identifiers (`machines`, `belts`, `inserters`) and live UUID keys for rows; export only controlled presentation seam for D7, never persist IDs blindly. Proposed `ConfigureSections` is a partial map of these section IDs to boolean; section state ownership must be finalized once in App/BuildPanel before D7 consumes it.

## Acceptance criteria
- [ ] New browser still explanatory; opt-in Compact remembered browser-wide by D6. Changing density keeps active input/draft, build, current view, selection, pending edits and result freshness unchanged. Do not key editor/subtree by density.
- [ ] Machine rows retain ID/recipe, productivity %, speed, type and applicable energy % edits; belts retain ID/type/strategy, lane item/stack and export /s consumption; inserters retain ID/source/destination/near lane, effective stack+Automatic/Explicit, filters+source and enable-rule state. D5 common summaries reduce repeated labels/help but all differences/errors/units remain visible.
- [ ] Use readable compact alignment rather than globally shrinking NumberField or targets. At 1440/960/800/720 no page horizontal overflow, no unusable fields; at 390 all actions/inputs reachable. Long names, multiple filters, explicit metadata and long conditional rules wrap without covering delete/menu/drag/selection controls. No fixed per-row height or acceptance based on mock counts.
- [ ] For identical Configure input/expanded states record header/section heights, above-fold usable rows and scroll distance, comparing baseline/explanatory/Compact. Demonstrate reduced repetition/scroll without smaller type solely to mask bad layout, an arbitrary row-height target or loss of edit access.
- [ ] All row actions (duplicate, move up/down, delete, add), pointer/keyboard reorder, bulk selection+Apply and Undo preserve prior behavior/renumbering and focus. Compact labels still identify entity and field; shared column labels do not remove accessible names. Existing safer explicit/raw numeric handling remains.
- [ ] If a section/row field is disclosed, first-problem/coverage navigation reveals the owning section and row **before** focus; page scroll accounts for dynamic sticky header/BulkEditBar. Invalid field/error remains apparent even when a routine helper collapses. Diagram/fullscreen dialog field focus does not target hidden List duplicate IDs.
- [ ] List changes remain live; Diagram changes remain draft across all five entity types. Save commits once, Cancel/Escape/discard leaves form unchanged under current dirty-confirm model. No unsaved-draft recovery, new type/quality selectors or altered enable-rule semantics.
- [ ] Existing chests/drills editing, Advanced/LCM swing plan, List/Diagram switch and validation remain fully reachable. Their redesign is outside specific machine/belt/inserter density stage; do not drop them to reduce Configure height.

## Tests
Reuse shared inserterDraft/bulkEdit/rowFocus/renumber/configMapping and existing draft cancellation tests. Add only a necessary regression for reveal-before-focus when a new collapse can conceal a validation target; no style or row-count snapshots, D5 semantics duplication or theme/density permutations. Native browser evidence proves focus/reflow/action contracts.

## Screens to capture
Common gate; small/larger D3 inputs explanatory and Compact, mixed machine/belt/inserter defaults/exceptions, long filters/rules/names, native add/move/delete+Undo and bulk Apply, empty section; validation jump to previously hidden target; dirty shared Diagram dialog both Cancel and Save, 390/short-height focus; chests/drills and Advanced reachable. One visible action response per changed control/state at captured widths.

## Risks and checkpoints
Cannot replace live controls with dead summary text; reduced density must retain discoverable edits. Do not silently change row-UUID identity or invalidate unsaved dialogs. D7 requires this final state ownership, not a guessed generic persistence API. D1 complete only after A+B evidence/code/UX pass; all common phase/owner gates retained.

## Root adoption against the committed provider

Compatibility and the D3 baseline are complete. Stack this child on the Results bundle at e571dd7 while it is in review; the single DisplayPreferences provider and exact density API are committed105cbeb. Use the canonical API-DEPENDENCY-NOTE/ROOT-ADOPTION contracts. Main UI product sources remain under that predecessor until it merges; never merge the phase base directly while stacked.

Keep existing live controls mounted across density changes. Reduce repeated helper prose and labels using genuinely common defaults plus visible exceptions; do not hide essential controls or errors to meet a geometry target. Do not introduce wholesale section collapse solely to create a persistence API. If a real disclosure can hide a problem target, finalize its controlled stable-key seam with root before consumer work, and reveal before focus. D7 will persist actual remaining states, not a competing preference/form owner. Preserve D10's committed form-owner/Undo APIs when they integrate; this item is presentation-only and must not change them.

Author owns machine/belt/inserter/shared-editor row presentation. App changes only density/validation focus bridges if necessary, avoiding the Results header/detail and D10 conversion hunks. Add no tests unless a concrete missing behavior is introduced. Full gates, source-matched native evidence, root repeat, independent CODE+UX and exact-head CI remain required.
