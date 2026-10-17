# D10 final implementation contract — repeated-unit conversion

Status: **root-reconciled implementation contract; authoring begins after the recorded D3 baseline**. Accepted compatibility product930feb7, mergedfb680f0 through PR210 with independent CODE+UXround1 and exactheadCI PASS. Written 2026-10-16 by the delegated read-only D10 scout. Product source inspected: `/tmp/ux-016-compat-verifier-r3`, product `036b4d6cfb6994d2dc04d07896c797d53121f38f`. Root reports compatibility full gates and native 3132/0/0 PASS; independent CODE/UX acceptance is still pending. Accept compatibility, complete the existing D3 baseline, then root pins/reconciles this contract in the actual item spec before assigning an author. No owner questions or extra approval checkpoint are introduced.

Read in full: existing D10 intent and the completed feasibility draft at `/Users/abucnasty/.codex/artifacts/ux-upstream-phase4-impact-20261016/D10-REPEATED-UNIT-CONVERSION-DRAFT.md`. This document replaces its illustrative API names with the exact proposed contract below. It incorporates root's subsequent decisions on contiguous numbering, authoritative form ownership, and conservative candidate Check failures.

## 1. Required player behavior

A valid selection containing eight identical modeled units offers **“Use one unit · 8 copies”**. It is unchanged until this action is accepted. The action keeps one complete modeled unit and sets Copies to **existing Copies × proved multiplicity**, using engine fraction arithmetic. Existing Copies 0.5 and multiplicity 8 produce Copies 4. The unit can be composite: `{A,A,A,A,B,B}` becomes `{A,A,B}` with Copies multiplied by 2.

Preserve `target_output.recipe` and `target_output.items_per_second` exactly. The existing Items per Second input is the final TOTAL for all copies. No second rate, per-unit rate entry, manual division, manual row deletion, Factorio reselection, wizard, additional confirmation, or automatic Generate. A successful accepted replacement automatically runs Check through the internal `validate` path while whole-build Undo remains offered. It can focus the existing total-rate field. No claim that conversion proves physical throughput, recovery, or clock quality.

Only offer automatic conversion after **both** a complete structural proof and the ordinary candidate schema/Check pass. A structurally proved candidate that fails its independent target/planning Check is unavailable, leaves the original unchanged, and explains that actual remaining error. Do not call its structure unsafe. The player can correct the existing total field and retry; no partial-invalid conversion state is added. This is root's conservative initial policy, not an outstanding owner decision.

## 2. Source facts and the proof boundary

All paths below are relative to the immutable source root above.

* `clock-generator/src/config/copies-validator.ts:107–222` joins machines, buffer chests, and drills through inserter and drill-target edges. It omits machine-free components, sorts filters, substitutes boundary resource specs for identities, and does not account for drop coordinates. `findRepeatedUnits` and `CopiesError.units[].machine_ids` are candidate detection only. Keep their existing public behavior; do not weaken `validateCopies` or treat a detector signature as a lossless proof.
* `clock-generator/src/state/{belt-inventory-state,constant-inventory-state}.ts` models belts with constant inventory and no-op inventory writes. In `control-logic/inserter/modes/drop-mode.ts:77–94`, a belt sink without `drop` uses its own hand's elapsed drop ticks and belt spec. Another hand does not consume that lane's space. By contrast, `:96–105` uses shared `lane_traffic` when `drop` exists. This supports shared normal **free-lane** boundaries and forbids silently reducing shared lane geometry.
* `state/infinity-chest-state.ts:17–79` gives constant inventory and a supply gate; `entities/chest/infinity-chest.ts` retains ordered filters. The initial supported class uses these only as external sources. Buffer chests are stateful unit members, not boundary supplies.
* `config/schema.ts:24–75,280–390,575–623` covers fuel, fractional Copies, source `near_lane`, sink `drop`, and the strict all-or-none per-belt drop rule. Enable rules use SOURCE/SINK relative to their owning inserter or drill, not numeric entity IDs. `crafting/target-production-rate.ts:14–27` already divides the total target by Copies. `crafting/plan/validate-config.ts:32–40` checks coverage and Copies before building its context; successful schema parsing or Check alone does not prove transformation equivalence.
* UI `utils/configForm/{formData,configMapping}.ts` in this pin already preserves fuel, endpoints including drop, and global overrides. The compatibility spec's accepted read-only geometry/edit-refusal policy is a prerequisite; do not redo that project. `configMapping.configToFormData` creates new UUIDs, so it is not the D10 Apply path.
* UI `utils/configForm/edits.ts:44–99` implements the existing sequential 1..n numeric ID policy and reference-following for delete/reorder. Its single-row deletion routines must not be looped to implement D10.
* `worker/simulation.worker.ts` has the private **`requireValidConfig(config): void`** strict-schema gate. There is no `strictConfigCheck` export in this pin. Reuse that real gate for worker Check, planning and conversion, rather than importing a nonexistent API.

The proof promises that the source is a product of identical complete local modeled units under the supported constant-boundary rules, with multiplicity factored into Copies. It does not promise the same selected clock, identical search/ranking outcomes, all possible physical layouts, or equivalence between unmodeled physical belt sharing and modeled free lanes. No simulation, ranking, recovery, detection-completeness, stable-ID, geometry-reconstruction, or general control-rule project belongs to D10.

## 3. Exact canonical engine API

New provider: `clock-generator/src/config/repeated-unit-conversion.ts`. Export it from `clock-generator/src/config/index.ts` and explicitly from `clock-generator/src/browser.ts`. The UI imports its types **with `import type` from `clock-generator/browser`**; only workers import its runtime function. Keep the main-thread heavy-engine boundary.

```ts
export type ConversionEntityKind =
    'machines' | 'inserters' | 'belts' | 'chests' | 'drills';

export interface RetainedConversionEntity {
    /** Index in the exact source array; drills means drills.configs. */
    sourceIndex: number;
    /** Original explicit ID; inserter ID can be omitted in engine Config. */
    sourceId?: number;
    /** Existing UI numbering policy: retained array position + 1. */
    resultId: number;
}

export type RetainedConversionEntities =
    Record<ConversionEntityKind, RetainedConversionEntity[]>;

export type RepeatedUnitConversionReasonCode =
    'invalid-config' | 'invalid-references' | 'not-repeated'
    | 'unassigned-entities' | 'nonuniform-units'
    | 'unsupported-boundary' | 'unsupported-order'
    | 'copies-not-representable' | 'candidate-still-repeated';

export interface RepeatedUnitConversionReason {
    code: RepeatedUnitConversionReasonCode;
    message: string;
}

export interface RepeatedUnitConversionPlan {
    kind: 'available';
    /** Exact JSON.stringify(source), matching the existing UI configKeyOf. */
    sourceConfigKey: string;
    multiplicity: number;
    previousCopies: number;
    copies: number;
    /** Fresh config; only retained membership, numeric IDs/refs and copies change. */
    candidate: Config;
    retained: RetainedConversionEntities;
}

export type RepeatedUnitConversionResult =
    | RepeatedUnitConversionPlan
    | { kind: 'unavailable'; reason: RepeatedUnitConversionReason };

export function planRepeatedUnitConversion(config: Config):
    RepeatedUnitConversionResult;
```

This is a synchronous pure structural helper: no mutable input, IO, Factorio data initialization, prepare run, simulator, UUID generation, UI metadata, or thrown expected refusal. It validates source and candidate schema/references and candidate Copies, but ordinary engine planning remains the worker's separate responsibility. Unexpected programmer failures still fail the request; they must not produce a partial candidate.

`sourceConfigKey` is an equality token, not a new persistence ID or hash. Never parse it to perform conversion. JSON keys reflect engine-config values; authoritative form identity and revision additionally protect UI-only edits and changed-then-restored values.

## 4. Exact sufficient proof and deterministic extraction

Implement this conservative sufficient algorithm. It deliberately does not attempt graph-isomorphism search. It handles ordinary identically ordered repeated units, including the normal eight-unit shared-free-belt case and composite GCDs. An equivalent but differently listed/ordered selection may use manual fallback. Do not change detector completeness to accommodate it.

### 4.1 Validate and assign every object

1. `ConfigSchema.safeParse(source)` must succeed. Use it as a validity check; do not substitute parsed/defaulted/stripped data for source rows. Preserve the original schema-supported fields and their presence. Reject unsupported unknown engine fields if supporting them would require guessing their reference/behavior semantics; never silently strip them.
2. Build namespace-specific ID maps for machines, belts, chests, drills, and effective inserter IDs (`id ?? sourceArrayIndex + 1`, matching engine construction). Refuse duplicate or colliding effective IDs in a namespace. Check every source/sink exists with its stated kind; every drill target exists and is a machine; source `near_lane`/sink `drop.lane` fit referenced belt lanes. Explicit IDs may overlap between kinds.
3. Build the full graph over machines, buffer chests, and drills. Join any two graph nodes connected by an inserter; join each drill to its target machine. Retain every connected component, including machine-free ones for classification. Every machine, buffer chest, and drill must belong to one component containing at least one machine. Otherwise `unassigned-entities`.
4. Assign **every** inserter to its touching graph component. Both graph endpoints must be in that same component (the graph union should ensure this). An inserter with neither endpoint in a graph component, such as belt→belt, belt→infinity, infinity→belt or infinity→infinity, is a machine-free subsystem and refuses conversion. No inserter is ignored or independently kept once.
5. Classify every remaining belt and infinity chest by the complete set of assigned inserter users. Initial policy refuses an unreferenced boundary object with `unassigned-entities`; this is a conservative coverage boundary, not evidence the object is physically dangerous. A private boundary is used only by one component. A shared boundary is used by more than one component. Buffer chests never enter this classification.

### 4.2 Supported boundaries

* Normal belts with `strategy` omitted or explicitly `normal`, and no sink drop coordinates anywhere on that belt, may be shared. Prove classification from all source users, sink users, and ordered complete belt records, not just the edge currently compared. Constant inventory plus the per-hand free-lane drop branch makes these boundaries independent under the model, even when the same belt feeds and receives from multiple units. Keep a shared resource once if any retained inserter uses it. This is why requiring all graph/resource components to be disconnected would be unnecessarily restrictive.
* A normal **private** belt may retain drop coordinates, provided every user belongs to its one complete component, the strict schema's all-or-none rule passes, and its full ordered users, lane records, all drop coordinates and local execution order match the corresponding private belt in every equivalent component. Keep the representative belt and its complete user set unchanged except numeric IDs/references. Removing other private belts cannot alter its `LaneTraffic`. Do not translate origins, synthesize positions, strip coordinates, infer lanes or use distance-only heuristics.
* A shared belt with any sink `drop` refuses as `unsupported-boundary`, even when coordinates happen to match across repeated machines. Shared traffic is coupled. A free-lane vs geometry difference is never normalized away.
* Any `strategy: 'export'` boundary refuses as `unsupported-boundary` in the initial class. Fixed external lane demand participates in transfer allocation (`sequence/cycle/swing-counts.ts:120–132`); merely multiplying Copies or dividing consumption is not a proof. Do not alter lane consumption.
* Source-only infinity chests may be private or shared if their complete ordered filter records match the required role. A chest used as a sink refuses in this initial class. Ordinary buffer chests are supported only as full internal component members, retaining inventory size/filter and every attached inserter.
* Shared boundary identity matters: the strict signature records its actual kind/ID plus full configuration. Corresponding components may share that exact resource; do not equate two different shared IDs by spec alone. Private boundary IDs may be alpha-renamed through an explicit per-component role map, preserving aliasing within that component. Mixed/nonuniform shared-vs-private roles therefore do not accidentally compare equal. This is narrower than the detector's spec substitution and supplies the missing aliasing proof.

The independence claim concerns the existing nominal modeled unit and preserved boundary configuration. Existing generation start/loss checks remain separate evidence about the resulting candidate. No conversion payload certifies their outcome or expands their policy.

### 4.3 Ordered component signatures and exact correspondence

6. For each component, take member machines, internal buffer chests, drills, and assigned inserters in their **relative original array order**. Do not sort those arrays or filters/rules/lanes. Establish local index labels `(kind, localIndex)` for graph members. Establish private-boundary labels by first endpoint encounter in that component's ordered inserters, separately for belt/chest kind; record each private resource once, with its complete record and all references to the same local label. Shared endpoints retain their actual kind/ID in the signature.
7. Construct a stable structural serialization of that component containing every complete entity record except its numeric own `id`, with graph endpoint/drill-target IDs replaced only by the labels above and boundary endpoints replaced by their classified label plus resource record. A private boundary's own numeric ID is also replaced by its local role label; shared boundary identity remains literal. Retain all other endpoint keys verbatim. Include private resources with their alias map, component-relative array execution order, and source-own-ID presence where omission vs explicit matters to effective execution ordering. Object key order may be canonicalized for comparison; array order and property presence must remain meaningful. Missing default vs explicit default is conservatively different. Never sort filters, CLOCKED ranges, conditional rules, infinity filters, belt lanes or any ordered nested metadata.
8. In particular this complete-record comparison includes machine recipe/type/speed/productivity/**fuel**/energy bonus; drills' type/item/speed/target/overrides; buffer size/filter; inserter prototype/quality/stack/filter order/animation/enable-control/rule tree/latch; source `near_lane`; sink `drop`; and all source-supported globals untouched outside the signature. SOURCE/SINK rules need no numeric rewrite: retaining the complete owner plus mapped endpoints retains their interpretation. If a future schema gains absolute entity references, fail closed until their rewrite/proof is implemented.
9. Numeric renumbering must preserve order that can affect the modeled component. The initial sufficient class requires each kind's explicit/effective IDs to be strictly increasing in its original array order (gaps are allowed). This is a conservative imported-order guard, not a new sorting policy. If not satisfied, `unsupported-order`: do not silently turn arbitrary ID order into another taker order. UI's established contiguous-numbered arrays naturally pass. Strict signatures preserve each component's relative execution order, and renumbering then preserves relative numeric priority. No coupled shared-state component may be split to manufacture this property.
10. Group by these strict signatures. Components in one group have a deterministic bijection: matching local indices and private-boundary roles, with identical records and identical normalized references. Explicitly verify that bijection against the original records/edges; an accidental signature collision is not enough. This is an ordered graph isomorphism witness, not the approximate detector's two-pass coloring. If a required correspondence cannot be verified, refuse.
11. Compute the GCD `g` of strict-group sizes. Require `g > 1`, otherwise `nonuniform-units` when the original detector saw repetition, or `not-repeated` otherwise. For every strict group of size `n`, order whole components by minimum source machine ID (deterministic tie impossible after ID validation) and take its first `n/g`. Union those components into the representative. The other `g-1` partitions consist of the next `n/g` whole components from each group. This proves the complete composite membership. `{AAAA,BB}` retains two A components and one B, not one machine or one of each type.

Strict grouping can refine a detector signature. It may yield a lower `g`; never display the detector's number as the proved multiplier. The retained candidate must still pass existing `validateCopies`; if the approximate detector refuses that candidate, return `candidate-still-repeated` with unchanged fallback rather than relaxing validation or repeatedly reducing unproved subgroups.

### 4.4 Extract, number once, multiply exactly, revalidate

12. Keep all graph members and **every assigned inserter** of retained components. Keep every shared boundary still referenced, once; keep each private boundary of retained components. Delete only private resources whose complete users were deleted or shared resources with no retained users. No reattachment, merging, new resource, endpoint clearing, or dangling reference is allowed.
13. Filter each original category array in original order. Produce `retained[kind]` in that same order, each with source index, original explicit ID if present, and `resultId = resultIndex + 1`. Assign sequential IDs once to all retained kinds. Build complete old→new maps from these retained source identities and rewrite both inserter endpoints and drill targets once. Any missing map target is an internal proof failure, never unset ID 0. Endpoint spreads retain every key including `near_lane`/`drop`.
14. **Numbering reconciliation:** the early D10 draft's literal “retain IDs” wording conflicts with accepted Phase1 contiguous numbering. Root directs the existing policy: retain semantic row identity/order and an authoritative source→result ID map; numeric IDs may change. For source machines 1,2,5 retained, candidate machines are 1,2,3, and all references to source 5 become 3. Preserve `_uuid`/`_forced_always` in the form and restore original numeric IDs in whole-build Undo. This interpretation must be stated in root's final D10 spec; it is not an exception or permanent-ID project. Do not change the approximate detector's ID behavior.
15. Compute `exact = fraction(source.target_output.copies).multiply(g)` using `data-types/fraction.ts`. That implementation can bound unsafe huge rationals, so D10 must not assume every result is exact: require safe integer numerator/denominator for source and product and verify the product's rational identity against `sourceNumerator * g / sourceDenominator` with BigInt cross-products. Convert with `exact.toDecimal()`, then require finite/positive output, successful normal target/Copies schema validation, and a fraction roundtrip equal to `exact` (again exact cross-products). Otherwise `copies-not-representable`. No `Math.round`, decimal truncation, raw JS `oldCopies * g`, or silent reset to `g`. No new arithmetic dependency/export.
16. Build a fresh candidate by preserving the source root/nested records, replacing filtered mapped arrays and only `target_output.copies`. Preserve omitted optional roots (e.g. `chests`/`drills`) where applicable, global override property presence including false/0, mining productivity and all ordered nested arrays. Do not use schema output to normalize explicit defaults. Do not mutate source through shared nested references.
17. Re-run candidate strict schema, ID/reference checks, full membership coverage, and existing `validateCopies(candidate)`; verify retained mapping is complete and bijective to candidate arrays. Return the pure available plan only after these pass. No ordinary candidate planning success is implied yet.

## 5. Exact worker recovery and query contract

Provider/consumer contract lives in existing `clock-generator-ui/src/worker/types.ts`. Runtime provider is `simulation.worker.ts`; `engineClient.askEngine` already generically transports the new query with no bespoke client or second worker system.

```ts
export type CheckedRepeatedUnitConversion =
    | { kind: 'available'; plan: RepeatedUnitConversionPlan;
        validation: ConfigValidation }
    | { kind: 'unavailable'; stage: 'proof';
        reason: RepeatedUnitConversionReason }
    | { kind: 'unavailable'; stage: 'check';
        reason: { code: 'candidate-check-failed'; message: string } };

export interface RepeatedUnitsRecovery {
    kind: 'repeated-units';
    sourceConfigKey: string;
    /** Detection facts only, not an executable plan. */
    detectedCopies: number;
    configuredCopies: number;
    units: { machine_ids: number[] }[];
    conversion:
        | { kind: 'available'; multiplicity: number; copies: number }
        | { kind: 'unavailable'; stage: 'proof' | 'check';
            code: RepeatedUnitConversionReasonCode | 'candidate-check-failed';
            message: string };
}

// Add one query member and its answer:
// EngineQuery | { kind: 'repeated-unit-conversion'; config: Config }
// EngineAnswers['repeated-unit-conversion']: CheckedRepeatedUnitConversion
// ValidationFailedResponse.recovery?: RepeatedUnitsRecovery
// ErrorResponse.recovery?: RepeatedUnitsRecovery
```

Add a single worker-private `checkRepeatedUnitConversion(config: Config): CheckedRepeatedUnitConversion` that calls the canonical pure function; for an available plan, calls existing `requireValidConfig(plan.candidate)` then `clockGenerator.validateConfig(plan.candidate)`. Catch expected candidate Check failures as `stage: 'check'` with the actual engine message. Such failure is not structural unsafety. Query transport/crash remains `query-failed`, never conversion eligibility. Do not compute rate capacity against the extracted machine list with the old Copies: the candidate already contains the multiplied Copies before this check.

Add one private `repeatedUnitsRecoveryOf(error: CopiesError, config: Config)` using that checked helper for the offer summary. Invoke it only for an actual `CopiesError` in both Check and generation plan/task catches. Retain human-readable `message` for generic surfaces. No parsing prose, no calling UI formatting code to prove membership, no class instances/Maps/Fractions in the payload. `runStreaming` must receive the exact request config (add `config: Config` to its parameters and both call sites) so its error recovery belongs to the actual plan/task. The direct query switch returns the complete checked plan; the failure summary never stores a candidate for blind later Apply.

`useSimulationWorker.ts` extends `ValidationState`'s invalid member with `recovery?: RepeatedUnitsRecovery`; `utils/checkThenGenerate.ts` extends the invalid `CheckOutcome` member identically. Its response handler propagates both from the matching validation request only. The `PendingChecks` request-ID/drop behavior stays authoritative. Crashes and dropped checks carry no conversion offer.

For the generation error path, add `errorRecovery: RepeatedUnitsRecovery | null` to the hook's return/state, pass recovery through `endRunWithError(message, except?, recovery?)`, and clear it wherever a new run, a generic/startup error, `clearResults`, cancellation/replacement or a restored result retires that error. Existing run-ID/worker ownership checks still apply. Do not put this ephemeral capability in results schema 2, cache/store, share links or saved forms. Check and generation surface the same typed recovery; the former is normally reached first by Generate's precheck.

App may show a generation recovery only when its **full** `sourceConfigKey === configKeyOf(exportConfig())`; generation-only overrides used by Search deeper must not be treated as the form merely because `checkKeyOf` ignores them. A mismatched generation recovery has no active conversion action; normal current-form Check can discover its own offer. Do not substitute `generatedFor.key` for the actual config used by the worker.

## 6. Exact form application and current-build guard

Provider: add UI-pure `applyRepeatedUnitConversion(form: ConfigFormData, plan: RepeatedUnitConversionPlan): ConfigFormData | null` in `utils/configForm/repeatedUnitConversion.ts`. Consumer: App's conversion handler. It imports engine types only, `formDataToConfig`, and `configKeyOf`; no engine runtime or independent detector.

It verifies source config key, every source index/source ID, result-array length/order, and every candidate row against the mapped source row after the declared ID/reference replacements. Then it constructs one new form from the actual retained source rows. Preserve `_uuid`, `_forced_always`, every source field and nested record; update only IDs, endpoint/drill target IDs and target Copies to the canonical candidate values. Preserve all root metadata/mining/global overrides and exact target recipe/rate. Reject inconsistent/missing mappings as null; never fall back to `configToFormData(plan.candidate)`, generate new UUIDs or run the single-row remove helpers. Require `configKeyOf(formDataToConfig(next)) === configKeyOf(plan.candidate)` before returning. This equality is a provider-contract check, not the semantic proof.

The immutable form owner is `hooks/usePersistedConfigForm.ts`, re-exported through `useConfigForm.ts`. App's current effect-updated `configKeyRef`/`replacementRevisionRef` alone do not provide an atomic build guard. Pin these minimal new owner APIs before implementing their consumers:

```ts
export interface BuildMutationSnapshot {
    buildId: string;
    revision: number;
    form: ConfigFormData;
}
// On the useConfigForm/usePersistedConfigForm result:
captureBuildMutation(): BuildMutationSnapshot;
commitBuildReplacement(
    expected: BuildMutationSnapshot,
    next: ConfigFormData,
    beforeCommit: () => void,
): boolean;
```

`captureBuildMutation` reads the owner-held current ID/form/revision synchronously. `commitBuildReplacement` compares all three against the authoritative current owner, refuses if any changed, then invokes `beforeCommit` **once in the event/async continuation, outside any React updater**, and commits one whole form to the same build ID. It returns true only for that commit. No await between the guard, callback and scheduling the form update. `beforeCommit` is bounded to offering existing whole-build Undo and replacement lifecycle; it must not mutate form/library ownership itself.

Keep owner ID/form/revision current synchronously for every actual form edit, Undo, import/reset, library show/switch/new/delete replacement, other-tab load and async saved-form acceptance. A change then restoration, a switch away then back, or a metadata-only row change increments ownership, even if exported JSON happens to match again. No-op edits need not increment. Existing callback-style state actions remain pure: evaluate a form transform against the authoritative snapshot, update owner refs outside a React updater, and schedule the resulting `OpenBuild`; never notify, offer Undo, validate, post work, or invoke `beforeCommit` from a replayable React state updater. The async saved-form initialization must commit only while its own expected default/build owner still matches. Root reviews this small ownership seam against the accepted source before authoring; there is no generic state-manager or permanent identity refactor.

`commitBuildReplacement` guards authoritative data ownership; a local operation token additionally guards request freshness/Cancel/unmount and latest Apply query. Token invalidation uses existing run/Cancel lifecycle: a Cancel while conversion is pending retires that query capability, late answers cannot apply. It need not terminate the shared query worker. Do not clear or replace another build's results/Undo on a stale reply.

## 7. App and Configure consumer sequence

`CheckErrorAlert.tsx` gains props `recovery?: RepeatedUnitsRecovery`, `conversionPending?: boolean`, `onConvert?: () => void` (beside existing `message`/`crashed`). App supplies only a current-full-config-matching, non-crashed recovery and owns the action; the component does no grouping or mutations. Existing role note/focus behavior remains. `utils/repeatedUnitsProblem.ts` may format typed detection/offer/manual words; it is never the conversion engine.

For an available normal example: “8 identical units found. Use one complete modeled unit with 8 copies. Items per Second stays the total for all copies.” Action **“Use one unit · 8 copies”**. With existing Copies 0.5: “8 identical units found. Copies will change from 0.5 to 4.” The action label uses the resulting Copies, not the detected count. For a composite representative, “unit” means its entire retained modeled composition. When detector and proof multiplicities differ, describe the proved grouping without claiming the detector's groups are lossless. Never show an enabled action for an unavailable or stale recovery.

Unavailable proof: concise actual reason plus “Select one complete unit in Factorio and paste it again. Keep Items per Second as the total rate.” Unavailable candidate Check: “One complete unit was identified, but its check failed: [actual error]. Your build has not changed.” Keep useful existing manual recovery and target correction routes. Do not claim coordinates can be inferred or direct the player to delete seven arbitrary machines. Query failure: original unchanged, specific failure and retry/manual route, without a false structural diagnosis.

On one action click:

1. Require idle/initialized state, current recovery/full source key and no open editing draft ownership conflict. Respect the existing live/draft editor lifecycle; a conversion button must not commit another open editor's draft implicitly. Capture authoritative `BuildMutationSnapshot`, exact `formDataToConfig(snapshot.form)`, full config key, and one local operation token. Require that captured authoritative config key also equals the displayed recovery's source key before posting work; a stale rendered button cannot silently authorize a new input. Disable duplicate clicks and route the existing busy/Cancel affordance to invalidate this conversion request. Do not withdraw an existing Undo merely to ask the engine.
2. `await askEngine({ kind: 'repeated-unit-conversion', config: capturedConfig })`. This recomputes proof and ordinary candidate Check against the exact accepted input. It does not trust the earlier offer summary. After await, require the same local token/mounted owner, matching sourceConfigKey, and available checked plan; `applyRepeatedUnitConversion(snapshot.form, plan)` must return a complete next form.
3. Call `commitBuildReplacement(snapshot, next, beforeCommit)`. The callback calls existing `offerUndoOfBuild(successMessage, { deferAnnouncement: true })` immediately before the single commit, with the captured old full config key used for `replacedKeyRef`. Do not use an App effect-ref value as a substitute for that known old key. Keep the returned announcement completion for the same operation. On a false return, discard silently or give the existing non-disruptive “build changed” status; no Undo or clearing callback ran.
4. After a true commit, call existing `handleBuildReplaced()` in the same continuation. It clears/sets aside results through `clearResults({ formKey: oldKey })`, drops old pending Check/Generate, advances replacement revision, lands on Configure and closes Advanced. Do not switch library build ID or invoke `importConfig`; D10 replaces this build's snapshot. If root chooses to place this lifecycle in `beforeCommit`, it still must execute once outside an updater and only after the ownership guard succeeds.
5. Arm the existing post-change internal revalidation pattern (`revalidateOnChangeRef`, currently used by exclusion edits), extended with the committed owner token/config key so a newer edit/switch/Undo cancels the scheduled D10 recheck. Run `validate(formDataToConfig(next))` after the replacement render; **never** `handleCheckOnly`, `handleGenerate`, `runChecked` or `runSimulation`. The explicit Check/Generate paths intentionally withdraw Undo; internal D10 Check does not. No generation/clock export follows a valid check.
6. Finish the single conversion announcement with the existing deferred Undo message mechanism; don't announce the same conversion both as live alert and focus. Focus the existing `focusProblemTarget({ kind: 'target-rate' })` when further rate entry is appropriate, or the ordinary first problem/check-error surface if the subsequent current Check fails. The disappeared conversion button must not leave keyboard focus on the body. A stale/dropped automatic Check never changes current focus or completes an old action announcement.

The ordinary automatic Check can fail later if input changed or the worker failed; preserve recoverable current form and Undo under existing ownership rules. The pre-Apply checked plan is not a stored valid result for a newer form and is never a freshly generated clock. A later **explicit** Check/Generate, edit, editing dialog or build switch retires Undo according to the accepted rules.

Whole-build Undo restores the exact captured form, including deleted entities, original IDs/order, `_uuid`, `_forced_always`, target and overrides. Existing `offerUndoOfBuild`/`clearResults({formKey})` and `restoreResultsFor` preserve the applicable original result plus manual `KeptPick` snapshot/provenance (schema 2) rather than recalculating choices. Undo changes ownership and invalidates pending conversion/autocheck; old results remain tied to their original `generatedFor`, with normal staleness/copy consent. No D10-specific results cache or schema bump.

## 8. Distinct verification contracts, using existing suites

Do not count permutations or add a framework/dependency. Reuse existing actual worker/Undo/race/payload helpers and accepted compatibility fixtures. Add only missing distinct assertions, grouped coherently:

1. **Complete normal conversion + total math.** A meaningful normal eight-unit selection sharing normal input/output free-lane belts, with whole representative membership and all reference maps. Assert source immutability; retained complete unit; exactly multiplied Copies (including one fractional value such as 0.5→4); unchanged total recipe/rate; candidate normal Check pass; no dangling/0 endpoint; source row order and contiguous mapped IDs. Exercise an actual planning-capacity check after Copies changes, not an isolated count-only fixture.
2. **Composite membership + metadata.** `{AAAA,BB}` with complete internal buffer/drill wiring and appropriate supply references reduces to `{AA,B}`×2. Carry meaningful fuel/global overrides/ordered conditional rules/near-lane metadata and representative UI `_uuid`/`_forced_always`; check source→result ID map with a real gap such as source machine 5→result 3. A private geometry-bearing belt can demonstrate exact retained coordinates and all droppers if implementation supports the private class specified here. Reuse compatibility roundtrip assertions for unchanged fields rather than duplicating all schema combinations.
3. **Proof vs ordinary validity refusals.** Use the existing detector blind spots to demonstrate an apparently repeated but unsafe shared drop-bearing belt and one material ordered/aliasing mismatch; schema can pass while conversion refuses. Include machine-free subsystem coverage in this proof contract where it exposes a separate ignored-membership bug. Independent candidate Check failure reports `stage: 'check'` with original untouched, distinct from a proof refusal. Fraction precision/representability rejection belongs with engine math/schema tests, not browser permutations.
4. **Real UI lifecycle and ownership.** Extend existing worker/form/Undo suites for typed Check and generation recovery propagation, current-action recomputation, opt-in atomic Apply→internal automatic Check retaining whole-build Undo, exact form+result/manual-choice Undo, no Generate call, and late replies unable to apply after an ownership change. Reuse one existing changed-then-return/switch/Cancel lifecycle helper to cover the new token rather than a Cartesian race matrix. Verify keyboard activation/focus after action disappearance and existing Cmd/Ctrl+Z behavior in the established native scenario.

Provider and consumer compile together: new engine exports, worker types/helper/query/catches, hook `ValidationState`/`CheckOutcome`/`errorRecovery`, form-owner capture/commit, pure form application, App callback, CheckErrorAlert props, and capture consumers must agree on exact names above. Existing `CopiesError`/`findRepeatedUnits` tests remain detection tests; do not rewrite them to imply the new sufficient proof is complete.

Root owns commands, test/build servers, Git and serial native browser/clipboard lane. Retain normal full engine and UI gates; native 1440/960/720/390 layouts; metadata/import/editor/Undo/keyboard verification; root independent repeat; independent CODE **and** UX acceptance; exact CI receipts; and all THREE fresh phase-end persona reviewers. Preserve D3's approved two-build/three-task baseline. D9 independently audits **all later UX-added UI tests, including D10, and implements justified cleanup before feature→master**. Engine regressions are outside D9 UI cleanup. Owner-only master merge remains unchanged.

## 9. Root finalization checklist and unresolved product decisions

There are no owner-facing scope questions in this draft. Root has resolved numbering and candidate Check-failure policy. Remaining integration work is a source/API consistency review, not new product authorization:

* Accept compatibility CODE/UX, record accepted source pin and complete D3 baseline before implementation.
* Reconcile this exact form-owner capture/commit seam with any shared owner API introduced by accepted preceding Phase4 work; one provider, no competing mutation token mechanism. Preserve the synchronous authoritative check and pure updater semantics either way, then copy the final exact names into provider/consumer specs together.
* Root's final D10 spec must explicitly resolve early literal-ID wording to the existing contiguous-numbering map policy, and record the chosen sufficient ordered-proof class and its honest fallback boundary. No author may quietly broaden it to detector signatures, shared geometry or extra partial-invalid flow.

This scout ran no tests/builds/Git/browser/dependency/server commands and changed no repository/product file. It used read-only file inspection and wrote only this delegated planning artifact. PASS counts above are root-reported prior compatibility evidence, not scout verification or D10 implementation results.


## Root source reconciliation (pending prerequisite acceptance/baseline)

Root read the complete draft and the actual 0.16 compatibility persisted-form owner. Adopt the exact provider/consumer APIs above when compatibility and D3 baseline are accepted, with these bounded implementation constraints:

- `usePersistedConfigForm` already owns `idRef`, `formRef`, `show`, `setConfig`, and the initial asynchronous saved-form load. Reuse that owner. Add one monotonic in-memory revision there; do not create another store or App-owned competing authoritative copy. Capture/commit uses those existing authoritative refs plus revision.
- Make the existing `setConfig` action evaluate once against authoritative `formRef.current`, update the form/revision refs synchronously, then schedule the resulting OpenBuild value. Remove the effect-only form-ref synchronization as authority. Preserve the current no-op semantics. Initial saved-form resolution checks its captured ID/form/revision before replacing anything; `show` updates both refs and revision synchronously. Route all existing actual owner changes through these two seams. Metadata-only row changes and away/back changes invalidate the snapshot even when serialized engine input becomes equal again.
- The guarded `beforeCommit` is called exactly once after identity/revision/form guard passes and outside any React state updater. It may use existing Undo/lifecycle callbacks only, without changing the form owner itself. No async gap is allowed between the successful guard and replacement. The local D10 operation token remains distinct request freshness, not another form authority.
- Preserve the existing public setConfig/BuildLibrary behavior and all accepted build actions. Do not broaden this change into unrelated async library operation redesign. Any additional mechanism discovered to be necessary must first name its concrete D10 race and exact API for root/spec reconciliation.
- Existing contiguous numbering supersedes literal retained numeric IDs: retain source rows/order/UI identities, expose the source-to-result maps, rewrite references once, and restore original IDs through whole-build Undo.
- This is finalized planning only. No D10 product implementation or new test suite is authorized before accepted compatibility and recorded D3 baseline. Normal engine/UI gates, independent CODE+UX/root repeat and all three phase-end reviewers remain.

Root dispatch adopts this complete contract against930feb7; the earlier036 source paths remain valid except the bounded C1–C4/UX01 changes. D10 source targets are unchanged by that UI-only batch. Exact form-owner API and contiguous-numbering policy above are final. See ROOT-ADOPTION.md and API-DEPENDENCY-NOTE.md for App hunk ownership with parallel Results/header author. No authoring before D3 baseline record.

## Authoring reconciliation: authoritative Undo snapshot

Root inspected the actual `useUndo` implementation: its configRef updates in an effect, while the accepted form-owner capture can observe a newer synchronous metadata edit. To preserve the exact captured form, extend existing `offerUndo` options with `snapshot?: ConfigFormData`; use that supplied snapshot for the entry, message and restored-label callbacks when present, retaining existing configRef behavior for all other callers. D10 passes the authoritative captured form and explicitly captured old full config key to its whole-build Undo offer. No new store, competing form authority or broad Undo redesign. Protect the concrete gap with an assertion in the existing race/Undo coverage, not a permutation suite. The snapshot is used only after the authoritative replacement guard succeeds and outside any React updater.
