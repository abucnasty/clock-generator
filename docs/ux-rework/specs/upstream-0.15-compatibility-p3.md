# Upstream 0.15 compatibility — Phase 3 adjunct

Findings: upstream compatibility owner decisions, 3.1 B8/B9, 3.4 B20, 3.3 B11/B18.
Implementer: GPT-6 Astra, high reasoning, no fast mode.
Branch: `feat/ux-rework-p3-upstream-compatibility`.
Dependency: reviewed Phase 2 upstream compatibility, propagated into Phase 3.

This is the Phase 3 partition of `upstream-0.15-compatibility.md`, not a new feature.
The scout inspected p3 df21248 and pending 3.3 child 38a7b25. Current p3 is 66dc5c9;
upstream is frozen at 1d27cde. Reconcile the actual inherited tree before implementation.
The provider's interface is committed at fe18341, but its final evidence/reviews remain
pending. Do not treat that checkpoint as an approved implementation baseline.

## Change

- Latched output drain uses twice the effective inserter hand: Automatic bulk gives
  24, Automatic fast gives 8, and explicit 16 gives 32 in both rule editor surfaces.
- Fractional Copies, imported type/quality, and omitted versus explicit stack size
  survive library, file, share, duplicate, reload and Undo flows.
- An editable invalid Copies draft remains available with an actionable problem.
  It does not cause a library backup/reset solely because of that refinement.
- Preserve current timing freshness, library behavior and the pending 3.3 cache and
  player-choice behavior. No schema, share-version or release change.

## Files

Paths below are relative to `clock-generator-ui/src`.

Required caller changes:

- `components/InsertersForm.tsx`, the `EnableControlModal` caller: pass
  `effectiveInserterStackSize(selectedInserter)` rather than raw optional stack size.
  Preserve null-selection handling, ids, item inference and live List commits.
- `components/InserterConfigPanel.tsx`, the `EnableControlFormContent` caller: pass
  `effectiveInserterStackSize(draft)`. Clearing an unsaved draft must affect its
  template defaults while preserving Save/Cancel semantics and rule validation.
- `utils/ruleTemplates.ts` and `components/QuickTemplateSelect.tsx`: retain the
  twice-the-supplied-size calculation and Replace conditions confirmation. Resolve
  metadata at the callers; do not copy another 4/12/16 table or add a rule mode.

Inherit and preserve these boundaries; change only for a demonstrated defect:

- `utils/inserterMetadata.ts` is the reviewed provider. Reuse exactly:

  ```ts
  export function effectiveInserterStackSize(
      inserter: Pick<InserterFormData, 'prototype' | 'stack_size'>,
  ): number;
  export function inserterMetadataText(
      inserter: Pick<InserterFormData, 'prototype' | 'quality'>,
  ): string;
  ```

- `utils/configForm/formData.ts`, `configMapping.ts` and `App.tsx` replacement paths:
  inherit lossless optional metadata/stack mappings without replacing Phase 3's
  library/share callbacks with the shorter Phase 2 implementation.
- `worker/formConfig.ts` and `worker/simulation.worker.ts`: retain the narrow
  editable Copies exception at the existing saved/file/shared form boundary.
  Exact marker plus exact `target_output.copies` path is required. Do not accept
  every custom validation error or bypass generation validation.
- `hooks/usePersistedConfigForm.ts`: retain Phase 3's multi-build implementation,
  migrations, active-document keys, validation, duplicate and restore behavior.
  Existing generic serialization strips `_uuid` and retains inserter properties;
  test that composition before adding redundant serialization code.
- `hooks/useSharedBuildLink.ts`, `utils/shareLink.ts`, `App.tsx`,
  `utils/undoSnapshot.ts`, `hooks/useUndo.ts`: preserve real file/worker validation,
  shared-open confirmation, new/blank handling, Undo and unchanged source builds.
- `utils/ruleTiming.ts`, `utils/resultsStaleness.ts`, `App.tsx`: stale Results cannot
  provide planned windows or period references. Assess period integrality from
  engine timing, independently of whether Copies is fractional. Full exported
  config identity must retain metadata and omission versus explicit override.

Pending 3.3 owns `utils/resultsCache.ts`, `utils/resultsStore.ts`,
`hooks/useSimulationWorker.ts` and its cache/cancel integration. These files are
absent from the current phase head. Do not transplant the feature into this adjunct.
After compatibility inheritance, 3.3's existing evidence/rechecks must retain schema
and runtime app-version guards and prove the chosen clock differs from recommendation
before both regeneration and reload. Preserve its current review/fix rounds.

## Acceptance criteria

- [ ] Both actual List and Diagram rule editors initialize Latched output drain to
  24 for normal Automatic bulk, 8 for normal Automatic fast, 32 for explicit 16,
  32 for absent metadata/default stack, and 16 for explicit 8. Quality does not
  invent a different capacity table. Metadata remains read-only.
- [ ] List clear commits Automatic immediately. Diagram clear changes the draft's
  template default; Cancel keeps the old stored override, Save commits omission.
  Replace conditions still requires confirmation; Cancel preserves the old rule.
  Existing source inventory release behavior remains intact.
- [ ] Copies 5.5, 2.25, 0.5, 0.001 and 0.0625 survive library switch/back, reload,
  duplicate, genuine file/share open and Undo round trips. Assert stored values,
  not only rounded blurred display text. Duplicating does not alter the source.
- [ ] Normal bulk/normal quality with omitted stack stays omitted. Fast/normal,
  explicit 8/16 and absent metadata remain distinguishable after those transitions.
- [ ] Invalid decimal drafts 0.0001 and repeating-third approximation reopen intact
  with an actionable Copies problem and blocked generation, including default and
  named-build storage keys. No backup/reset is caused solely by this editable
  refinement. Preserve duplicate/Undo and existing unfinished-file/share behavior.
- [ ] Malformed structures, invalid quality, unrelated custom errors and the Copies
  marker at another path still reject through the genuine worker boundary. Corrupt
  or newer share wrappers leave the current build unchanged. Existing backup and
  rejection behavior remains for genuinely unreadable stored builds.
- [ ] Changing Copies, metadata or omitted stack to explicit 16 changes config
  identity and makes old Results stale. Stale Results cannot supply template timing;
  a current check supplies only its own timing. Preserve inclusive start=end rules
  and fractional-period refusal independently of fractional Copies.
- [ ] Existing per-tab keys, other-tab warning episodes, shared-open behavior,
  Undo lifetime and restore announcements remain consistent with 3.4 and 3.3.
- [ ] No metadata selectors, bulk type editor, sidecar extension, repeated-unit
  converter, ranking change, engine behavior change, new dependency, settings/CI
  change, schema/version bump or new owner checkpoint.

## Tests

- `utils/ruleTemplates.test.ts`: compose the shared capacity helper with templates
  for bulk/fast/default/explicit values; retain schema-valid source-release cases.
  Browser checks must also exercise both actual callers; multiplication tests alone
  cannot prove the wiring.
- `hooks/usePersistedConfigForm.test.ts`: table-driven serialization/read/export
  round trips across supported fractional values and metadata/stack distinctions.
  Assert omission after JSON and tolerate regenerated UUIDs. Cover invalid editable
  decimals and both backup-key forms without claiming this reader alone performs
  engine structural validation.
- `worker/formConfig.test.ts`: inherit reviewed Phase 2 tests, then cover any missing
  Phase 3 composition with genuine `ConfigSchema`: exact permitted refinement,
  wrong marker/path and malformed structure combined with the permitted issue.
- `utils/shareLink.test.ts`: actual encode/decode followed by file parsing, worker
  form validation and config mapping. Preserve wrapper/version/size failure tests;
  decoder-only round trips are insufficient because decoded config is unknown.
- `utils/ruleTiming.test.ts` and `utils/resultsStaleness.test.ts`: retain equivalent
  coverage, add only missing fractional/metadata/omission identity and freshness
  cases. No fabricated period-parity assumption based on Copies.
- Pending 3.3 keeps its own cache/store tests and captures: mismatched schema OR
  runtime app version rejects; async restores remain guarded; a distinct saved
  player choice restores or uses the existing missing-choice fallback. Recheck after
  inheritance, not by importing these files prematurely.

Run the actual inherited tree's full UI gate: manual data copy, tsc, tests, lint,
knip, icons and production build. Build the local engine first; ensure the UI's
`clock-generator` dependency resolves to that same tree, not stale main-checkout
dist. Follow the parent upstream spec for merged-tree engine/generation checks.
Root or a Luna runner independently reruns tests/build and opens screenshots before
the independent Astra code and UX reviews.

## Screens to capture

Use production preview and matching source/data/shared lib. Run Phase 3 explicitly;
absence of `PHASE3=1` is NOT RUN, never PASS. Preserve existing core checks and add
missing Phase 3 states with centralized `lib.ui` selectors and shared helpers.

- Widths 1440/960/800/720/390. At 390 row geometry is observation only; main actions,
  keyboard/focus, behavior and player-facing AA remain required. At 720+ verify full
  geometry, no page sideways scroll, 2.7B Source/Destination text and aligned columns.
- Both rule surfaces with bulk/fast/explicit defaults, Replace confirmation and
  Diagram clear/Cancel/Save. Capture metadata and the actual template amount.
- Library fractional 0.0625 focused full value, switch/back, duplicate, reload;
  invalid 0.0001 reopened with inline problem and no backup; genuine file/share
  confirmation and resulting build; Undo after shared open and import/delete.
  Inspect serialized target/inserter fields at each transition.
- Generate a fractional-Copies build, change Copies to stale its clocks, then open
  Clocked editor and verify no stale planned-window import. Check timing from a new
  current Check. Use an actual engine fractional period for that separate case.
- After compatible 3.3 integration: retain cancel-keep 1440/720/390 and library1440,
  a provably non-recommended selected clock before/after regenerate/reload, stale
  restore and cache-version refusal. Do not force historical app-version values.

Each new/changed state gets aria names, Tab reach, focus-not-obscured, short-height
dialog/footer checks, axe, measured contrast, visible results of changed mouse
actions, and unhidden live-region announcements with/without dialogs. Serialize
clipboard access across width contexts. No silent missing-fixture/feature skips.

## Risks and checkpoints

The main integration risk is overwriting Phase 3's persistence/library/share behavior
with Phase 2's shorter implementation. Reconcile named functions and test genuine
boundaries. Reuse the committed helper; review any later provider changes before
accepting the adjunct. Do not duplicate the capacity or Copies validation policy.

An editable form can remain invalid for Generate. Preserving it is not permission
to relax engine generation validation. Existing owner install-step/phase/final
checkpoints remain; the four resolved upstream decisions are not reopened.

No results are claimed by this spec. Preserve prior item rounds and report actual
heads, command results, evidence and review verdicts in the ledger.
