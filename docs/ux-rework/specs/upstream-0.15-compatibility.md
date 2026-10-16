# Upstream 0.15 compatibility for the UX rework

Owner decisions: 2026-10-16. Implementer and every reviewer: GPT-6 Astra, high reasoning. No fast mode.
Base: master a67d5a2 (0.15.1), feature 829befc, p2 d692b7d, p3 5614c03 before this documentation update.
This spec implements PLAN's Upstream compatibility section; it adds no engine behavior or sidecar feature.

## Change

- Fractional Copies work consistently, including below one. Invalid input is explained inline and blocks generation;
  an unfinished saved build remains available to fix after reload.
- Imported inserter type and quality survive every round trip and are displayed read-only. No new selectors.
- Clearing Stack size restores Automatic: the type's fully researched capacity (16 stack, 12 bulk, 4 other supported
  types). Show the effective value and assumption, preserve numeric overrides, and keep omitted values omitted.
- Repeated-unit errors explain which machines repeat and how to select one unit and set Copies. No automatic reduction.
- Examples, game names, rate copy and rule defaults remain correct with master's data and engine changes.

## Scope and files

Integration takes master → feat/ux-rework → p2 → p3. Preserve phase behavior when resolving conflicts. Simple merge
compatibility goes with those merges; substantive UX additions use a child branch/PR with the normal code and UX reviews.
The implementer reports the exact partition before making substantive additions. Every merged tree gets tsc and the
full gate; engine/generation tests cover the new upstream engine. No merge to master or phase merge without its checkpoint.

- `clock-generator-ui/src/components/TargetOutputForm.tsx`, `utils/firstProblem.ts`, `utils/targetRateLimit.ts`,
  `utils/numberText.ts`: positive finite Copies with the engine's reduced-denominator <=1000 rule (not a decimal-place
  limit); preserve field ids, Panel layout, helper text, problem text, focus and generation blocking. Step 0.5 is only
  the spinner increment. Keep 0 visible as invalid rather than silently replacing it with 1.
- `utils/configForm/formData.ts`, `configMapping.ts`, `App.tsx` replacement paths, persistence, and p3
  `worker/formConfig.ts`: preserve prototype/quality/optional stack through the existing worker/schema boundary.
  Allow the specific editable Copies refinement failure in stored form state, without allowing malformed structure.
- Existing List/Diagram inserter editors and a small shared helper: read-only metadata, Automatic/effective stack
  display and clearing. 3.2 A reuses this API; communicate its exact exports before implementation there begins.
  Keep the two existing surfaces' commit models until 3.2 A changes them. Do not prematurely build the shared editor.
  If the changed metadata rows expose the existing Source/Destination truncation, reuse the minimal already-designed
  2.7B aligned inserter grid (ce131ae), preserving the current outer card; do not import the full Build card, Panel or
  filter-slot feature. 2.7B reconciles those shared layout hunks when it inherits compatibility and retains its final
  full geometry evidence. Keep the Diagram toggle's accessible name consistent with its visible beta text.
- p3 rule-editor callers/templates: use effective hand size, not a literal 16 when the value is omitted. No new rule modes.
- `scripts/copy-factorio-data.mjs`, `utils/exampleBuilds.ts`: replace removed chemical sample with the upstream
  shared-foundry sample; accept supported fractional Copies without loosening integer entity counts. Time the example
  against 2.1's existing criterion. One fractional row must not hide the entire list.
- `clock-generator/resources/filter-raw.js` and generated data: preserve intentional locale-name extraction alongside
  master's data version, recipe categories, inserter and quality extraction. Do not discard p2's #171 work.
- `utils/glossary.ts` and relevant help: narrow factual wake-up correction (true starts for inputs, finishes/payouts
  for outputs), keeping wake windows distinct and the owner's strict-definition experiment separate. Copies help
  describes partial units. Where relevant, state the existing sidecar's legendary stack timing assumption; do not
  add a global warning or new mod requirements.
- Check/Generate error presentation and existing first-visit/Paste guidance: explain repeated-unit refusal with
  machine groups and the Copies value from the engine. A small structured error payload is allowed if needed to
  render existing information reliably; do not duplicate the engine's graph detector or parse prose as an API.
- Relevant tests and capture scripts: repair removed fixtures with equivalent valid scenarios; preserve assertions.

No type/quality selectors, bulk type edits, sidecar metadata export, repeated-unit converter, new dependency, release,
CI/settings change, broad fuel changes, or unrelated engine fixes. Sidecar remains the existing planned 0.8.0 release.

## Acceptance and tests

- [ ] Copies 5.5, 2.25, 0.5, 0.001 and 0.0625 survive input/import/export; zero, negative, non-finite, 0.0001 and a
  repeating-third approximation are refused consistently with the engine. Test the shared validation boundary.
- [ ] With per-copy maximum 10/s and Copies 0.5, target 5/s is allowed and 6/s blocks with maximum 5/s. Test exact
  engine comparison boundaries on real machine facts, including below one; do not claim parity from UI tests alone.
- [ ] Valid fractional config values survive library switch, reload, file/share, duplicate and Undo on p3. An invalid
  decimal draft reopens intact with an actionable problem; no backup/reset caused solely by that editable value.
- [ ] Normal bulk with omitted stack stays normal bulk with omitted stack through file/Paste/reload/share/Undo;
  its effective capacity is 12. Fast uses 4, default stack 16. Explicit values are preserved. Saved legacy values
  stay explicit. Engine defaults apply only where metadata is genuinely absent.
- [ ] Clear in List takes effect live; clear in Diagram takes effect only after Save. Both show Automatic and its
  effective capacity. Read-only type/quality introduce no new editing controls or unnecessary Tab stops.
- [ ] Rule template thresholds use effective hand: automatic bulk 24, automatic fast 8, explicit 16 gives 32.
  Stale clocks still cannot supply timing; fractional Copies does not imply fractional period.
- [ ] Repeated identical unit fixture fails Check/Generate with manual correction guidance; a valid heterogeneous
  unit still passes. The build is not changed automatically. Total target rate is not confused with per-copy rate.
- [ ] Updated chemical example and all other eligible examples remain visible and import unchanged. Locale names
  remain present in generated data; icons check passes after upstream deletion.
- [ ] 3.3 cache schema/app-version guards remain; tests/captures assert the player's pick is different from the
  recommendation before regeneration and reload, even if upstream changes rank/order.

## Evidence and reviews

Run engine build first; ignore-scripts means UI's copy-factorio-data step is manual. Use npm 11.19.0 for any lockfile
regeneration. Full UI gate: test, lint, knip, check:icons, build plus tsc -b. Full engine checks and generation tests
after each upstream merge. Record command result lines and heads, not just PASS claims.

Capture changed field/help/error states at 1440 and 720, plus reachability at 390, using the shared lib. Include
keyboard/focus, announcements where added, accessible names, axe and measured contrast, plus 960/800/720 geometry.
Reuse existing scripts for first visit, target limit, build card, library and cancel/keep with updated valid fixtures;
add focused coverage for new Automatic/metadata/repeated-unit states. A capture writer may draft checks separately.
Code and UX review are independent Astra/high roles; root or a runner independently reruns tests/build and opens shots.

Preserve existing item review/fix rounds. Finish compatibility before the resumed items' final evidence and reviews.
Owner install-step and phase-merge checkpoints remain unchanged; no additional sidecar metadata check is opened.

## Shared metadata API (integration contract, 2026-10-16)

The upstream compatibility provider commits `clock-generator-ui/src/utils/inserterMetadata.ts` before 3.2 A uses it:

```ts
export function effectiveInserterStackSize(
    inserter: Pick<InserterFormData, 'prototype' | 'stack_size'>,
): number;
export function inserterMetadataText(
    inserter: Pick<InserterFormData, 'prototype' | 'quality'>,
): string;
```

`InserterFormData` gains optional `prototype`, the engine's optional quality union and optional `stack_size`.
The effective-size helper agrees with engine game data (4/12/16), honors explicit values and defaults an absent
prototype to stack-inserter. Metadata text shows the effective type/quality, including defaults, read-only.
Clearing writes `undefined`; template callers pass the effective size. 3.2 A reuses these exports, not another fallback.
