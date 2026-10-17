# D8 machine production rates — source-only feasibility proposal

Prepared 2026-10-16 against `/tmp/ux-phase3-final-verifier-2d31cc5` (owner-pinned final Phase 3 source: UI `e2df642`, engine `81e2f227`). Approval basis: D8 A/A/A in `/tmp/ux-p3-integration/docs/ux-rework/specs/phase4-decisions.md` and `D8-machine-rate-feasibility.md`.

**Status: investigation only; proposal for owner decision.** No product/repository files, schema, cache, dependencies or Git state were changed. No browser, install, tests or engine simulation was run. Existing test assertions below are source evidence, not freshly executed results. This preparation does not claim Phase 4 product implementation has started, a verification PASS, or implementation authorization.

## Finding and recommendation

The engine already solves exact, topology-dependent **gross main-product demand per machine per cycle**. `planMachinesFor` keeps this as `made_per_cycle`, then discards it after planning transfers. Exposing that authoritative result is feasible without inventing a planner or doing UI demand arithmetic. Maximum already exists as exact serialized machine facts. An honest selected-clock achieved **production** rate needs additional engine observation and serialization; neither the displayed transfer histories nor whole-build assessment can supply it for arbitrary intermediate machines.

Recommend a bounded first implementation, **only if approved**: expose planned main-product demand and snapshot maximum, with achieved explicitly unavailable until a subsequent scoped observation change. Alternatively approve the full observation work described below. Do not promise that adding three UI labels alone fulfills D8.

## Proposed semantic contract

| Figure | Meaning and engine authority | Units and qualification |
|---|---|---|
| Planned | Main-product output the engine assigns this machine to make to satisfy requested export plus downstream/recirculating demand. Use the fuel-inclusive `made_per_cycle` solution, before delivery-hand rounding, with the exact cycle duration. | Exact item/s = `items_per_base_cycle × 60 / total_duration_ticks`. Main product identified explicitly. This is a read-only assigned demand, never an editable goal, maximum-scaled estimate or measured result. |
| Maximum | Intrinsic main-product capacity from `Machine.getMachineFacts`: `output_rate_ratio`, with the existing `output_rate_per_second` as presentation value. | Item/s for this machine running continuously with its configured crafting speed and productivity. Assumes inputs, fuel and output room; does not promise transport or build feasibility. |
| Achieved | Actual main-product items produced by this machine during an explicitly identified simulation span under the selected exported clock. Proposed observation: snapshot `MachineState.totalCrafted` before/after that span, whose increment occurs when main output enters inventory. | `delta_items × 60 / observed_ticks`, in one modeled unit. Name the run/span and any failed-start or long-run qualification. If the span does not repeat, call it the observed rate over that span rather than a steady rate. Product held in `pendingOutput` has not entered inventory and is excluded under this definition. |

All three figures refer to the individual machine **in the single config-defined modeled unit**. Copies is a multiplier of identical modeled units, permitted to be fractional. A later all-Copies figure is separately labeled and computed with engine fractions; do not round Copies to a physical machine count. Never sum unlike output items as a production total.

For loops, planned/maximum/achieved are gross product creation, including products passed to another machine to seed a subsequent craft. Final target is exported output. Therefore an output machine's planned gross rate can exceed `target / Copies / number_of_output_machines`; that quotient describes the assigned terminal export share, not its whole production obligation.

Allocation is authoritative **under the current engine policy**, not a unique physical optimum: terminal producers receive equal export shares; loaders of an item divide its demand equally; belt fillers split per eligible item. A faster producer is not automatically assigned more. A unique linear-system solution can still be physically infeasible. Preserve existing ranking, selection and validation rules.

## What exists at each lifecycle stage

| Stage | Existing availability | Proposed display behavior |
|---|---|---|
| Before Check | Independent machine-facts worker query can supply maximum. No global planning demand or selected clock exists. | Show current keyed maximum when known; planned “Check your build”; achieved “Generate and select a clock.” |
| Successful Check | `validateConfig` runs Prepare, then the exact cycle/transfer planner. Returns transfer plan, LCM, numeric `cycle_ticks`, exact-product-derived `period_ticks`; no machine demand or machine facts. It does not simulate the selected clock. | Planned becomes available only after exposing the planner result and exact rate through `ConfigValidation`. Achieved remains unavailable. |
| Failed Check / crash | Returns error, no successful plan. Aggregate output capacity is checked, but that does not prove every intermediate or equal share can keep up. | Do not reuse old demand as current, infer zero, or clamp planned to maximum. Preserve the reason. “Unknown / check failed” is distinct from an engine-solved zero. |
| Generate / alternatives | Each result has its own cycle plan, facts and transfer plan internally; swing backoff and alternative counts can differ from Check. Worker flattens alternatives, currently dropping machine facts and transfer plan. | Carry rates on each alternative; Results binds planned, maximum and achieved to that alternative's snapshot. Do not attach live facts for an edited machine or another candidate's plan. |
| Edit, Undo, switch, reload | Validation retains its config and `checkKeyOf` ignores only generation-only overrides; generated results have full config key and stale banner. Result cache version rejects incompatible records. Lean cache strips developer histories. | Reuse those identities. Current Configure demand needs matching Check identity. Stale Results may show only labeled saved snapshot rates. Undo can restore identity. Preserve rates in lean records; changing `ClockAlternativeView` requires the existing cache version bump. |
| Loading / unknown metadata | Worker facts query can return null; `useMachineFacts` deliberately keeps previous facts temporarily while a new request resolves. | New rate comparison must verify the facts key, or show pending/unknown, so a new machine setting is never compared to previous settings' capacity. Draft dialog settings need their own facts key; no live plan is authoritative for unsaved topology edits. |

Check's current comment says machines can meet target, but implementation checks summed terminal capacity only. Mixed-speed terminal producers may pass that sum while equal allocation exceeds the slower producer's capacity. Planner solutions also do not cap intermediate demand. Reporting a demand above maximum is useful evidence; adding a new feasibility rejection or reallocating demand would be a separate engine behavior decision.

## Boundaries and limits that affect an honest display

- **Several paths and shared suppliers:** the existing exact solver accumulates demand from all downstream paths; intermediate rate is not final rate copied into every row. External belt-lane consumption adds demand beyond final export. A belt with no filler is treated as external input. A chest with no filler is external/prefilled for planning.
- **Chest ambiguity:** `computeSwingCountsThroughChest` divides by all fillers before filtering by item; its own comment admits the assumption that fillers can provide all items. With unlike filters this can allocate less than the full per-item demand. Do not certify such inferred rates as a complete physical allocation merely because a serialized transfer exists. Either mark that topology unsupported for planned-rate display, or request a separate planner fix with evidence.
- **By-product dependency:** the planner's scalar demand is main-output items. `computeUpstreamOfFiller` adds a filler’s total hands times its first item's hand size as source-machine demand, without converting a demanded by-product to crafts/main output. A by-product feeding another recipe or mixed main/by-product loader therefore needs an unsupported/ambiguous guard for this feature, or a separately approved per-product planner extension. This investigation does not authorize that extension.
- **Multiple output items:** `RecipeMetadata` selects the item result with the largest expected amount as main product. Target matching and output-producer allocation use that main item, not every result or recipe name. One configured target item plus additional export-lane demands is supported; this is not a general multiple-independent-target optimizer. Serialized `MachineFacts` exposes only main output. By-products can be supplemental expected output at assigned crafting, but must not be labeled independently assigned demand. Recommend initial display main output only, including machines whose unused by-products are merely cleared.
- **Productivity and probability:** main output amount includes productivity except `ignored_by_productivity`. By-product amounts use expected probability and deterministic fractional carry in simulation; this is not a stochastic guarantee. Do not derive achieved from `craftCount × effective output_per_craft`: actual productivity-bar payout and pending output need observing. Avoid broad claims about probabilistic main results: selection uses expected amount, while main construction uses raw result amount; an extension covering those recipes needs explicit validation rather than silently “correcting” this in the UI.
- **Fuel:** `planMachinesFor` solves both without fuel and with mixed-loader fuel, rounded upward to 1/1000 item per craft; delivery transfers then round fuel up again to compatible hand fractions. `made_per_cycle` represents the solver's modeled production demand before that latter overdelivery. Dedicated fuel-only inserters live outside the transfer plan and do not create corresponding upstream-production demand here. Mark a config with an internal machine supplying dedicated fuel-only loaders unsupported for a complete planned-demand claim until that boundary is resolved; external fuel stays an assumption. Fuel consumption is not a production output rate.
- **Loops:** Gaussian elimination solves all machine equations using exact fractions, including recirculation. A missing pivot throws; no finite unique demand is available. The implementation does not explicitly assert every solved value is nonnegative, and later skips nonpositive loader work. A new display should refuse nonfinite/negative/invalid solutions as unknown rather than show a misleading zero. Such guards may diagnose an unsupported plan without changing scheduling; changing solver behavior needs separate approval.
- **Fluids/drills:** game-data enrichment removes fluids from simulated item ingredients/results; fluid-only recipes are refused. Rate meaning is conditional on unmodeled fluid supply/removal. Drills have transfer-plan pseudo-hands (fixed 16 items), not machine production-facts rows. D8 should remain machine-scoped unless the owner adds drill rates.

### Achieved is the larger part of the work

The build's current achieved rate is terminal **delivery**, from output inserters’ `items_dropped` deltas, scaled across Copies. That does not identify how much an intermediate produced. Display transfer histories are unsuitable: their records complete when a hand returns, so a hand already dropped before the span ends may be missing; some histories are transformed into planned clock windows. The existing output-count fixture explicitly proves this boundary mismatch.

`totalCrafted` already counts main output added to a machine's inventory, so snapshot deltas are a small observation mechanism, not a new craft model. However run provenance must survive every engine boundary: planning run versus clock-only run; one-period versus repeat; long-run settled span; failed start offset. `runAsBuiltCheck` may report a later failing phase or a long-run shortfall while returning the unshifted `TrialRun`. Reusing that returned run’s counters could disagree with the displayed assessment. Capture the rates with the exact reported observation, or label an independently chosen unshifted span explicitly. Prefer matching reported observation for selected-clock Results.

Rounded-period alternatives are another limit: `alternatives.ts` explicitly says their clock-only check models the exact fractional period, then scales assessment to a rounded period. Per-machine “achieved under selected clock” must stay unavailable for that rounded alternative until its actual schedule is observed, or be clearly labeled modeled estimate under an owner-approved weaker meaning. Do not silently scale production counters and call it measured.

By-product achieved would require its own counters: `totalCrafted` counts main output only. `productsFinished` counts craft and productivity events, not items. Do not add by-product rows by treating either as a per-product counter.

## Worked source-backed examples

All numerical derivations here are static source arithmetic, **not executed engine outcomes**. Reading existing fixtures/test expectations does not certify current runtime behavior.

1. **Simple chain with duplicate paths.** Adapt `swing-counts.test.ts:25` to a feasible request of 1 circuit/s instead of the helper fixture's 10/s (that helper bypasses full capacity validation). Speed 1, no productivity: cable maximum 4/s and circuit maximum 2/s (0.5s default recipe time); one output hand of 16 circuits is a 960-tick cycle. Circuit demand is 16/cycle = 1/s; cable demand is 48/cycle = 3/s. Two cable inserters each carry 24/cycle; that is one cable machine's total 3/s, not 3/s per inserter. Achieved remains unknown without observation.

2. **External export demand.** `swing-counts.test.ts:98` plans 16 circuits over 64 ticks and a belt consumer taking 30 cable/s. Circuits require 48 cable/cycle and external demand adds 32; cable machine planned output is 80/cycle = 75/s. Its helper source's speed-1 capacity is only 4/s: this is intentionally an arithmetic-only transfer-plan fixture, not evidence that Check/Generate can deliver that rate. It demonstrates why gross demand and intrinsic maximum must remain distinct and why target scaling is insufficient.

3. **Several output machines and fractional Copies, real sample.** `chemical-science-shared-foundry.json` requests 240 packs/s across 5.5 Copies, with four science machines, four engine machines and one shared pipe foundry. One modeled unit exports `480/11` packs/s; each science machine is assigned `120/11 ≈ 10.9091` packs/s. At +100% science productivity, 2 engines yield 4 packs, so each engine machine needs `60/11 ≈ 5.4545` engines/s. At +100% engine productivity, 2 pipes yield 2 engines, so shared foundry demand is `240/11 ≈ 21.8182` pipes/s. Intrinsic maxima from source recipe times/settings are 11.00421875 packs/s per science machine, 9.8171875 engines/s per engine machine, and 355.125 pipes/s for the foundry. All-Copies totals are separately 240 packs/s, 120 engines/s across the engine rows, and 120 pipes/s. No achieved rate is asserted.

4. **Recirculating output producers.** `swing-counts.test.ts:165` and the iron-bacteria sample have two machines at +150% productivity: each craft makes 10 bacteria and needs 1 from its neighbor. For 48 exported per machine/cycle, symmetry solves `x = 48 + x/10`, so each must produce `160/3 ≈ 53.3333` gross, including `16/3` passed to the other. Sample terminal target is 380/s: equal export is 190/s, but planned gross is `1900/9 ≈ 211.1111` bacteria/s per machine; maximum is `90.375 / 4 × 10 = 225.9375`/s. Displaying 190/s as this machine's whole planned production would lose the recirculation obligation.

5. **Productivity/by-product boundary.** Data for jellynut processing has 1 jellynut → 4 jelly plus seed with probability 0.02. At +150%, engine main yield is 10 jelly/craft and expected by-product is 0.05 seed/craft. Hypothetical assigned main demand 10 jelly/s means 1 modeled craft/s, hence expected seed creation 0.05/s; it is not a separately assigned seed goal. Existing sample speed 56.122 gives intrinsic maxima 561.22 jelly/s and expected 2.8061 seed/s, so maximum seed output would dramatically overstate seed output at that assigned demand. Main facts serialize only jelly; seed production uses carried deterministic expectations in simulation.

6. **Fuel and a solvable ingredient loop.** Existing agricultural source assertions (`swing-counts.test.ts:114`) plan 112 science packs/cycle (+150%, 44.8 crafts), 22.4 eggs from each egg producer for science, and 8.96 eggs from each to seed its neighbor. Each egg producer therefore makes 31.36 eggs/cycle, not 22.4; an egg craft makes 3.5 after `ignored_by_productivity`. Mixed nutrient/fuel loaders are rounded to `43/5` hands each. The production-demand solution must come from the solver, not from rounding those hands back into a new output goal.

7. **Authoritative delivered count and below-target reporting.** `output-count.test.ts` expects 96 bricks dropped in 144 ticks for one modeled unit (40/s); the stone-brick sample has Copies 3 and target 120/s. Its commentary explains that only two full-return transfers can be recorded in a span where three hands have dropped. That 120/s all-Copies terminal delivery does not by itself prove 40/s machine creation in the same finite interval. For a selected clock whose observed per-machine creation is below planned, show that actual observation unchanged; never fill achieved with target, maximum, or whole-build rate divided evenly. No concrete below-target machine-production number is available from current serialized evidence.

## Implementation options for owner decision

| Option | Scope | Estimated focused engineering effort / risk |
|---|---|---|
| A — existing-data display only | Present existing maximum more clearly; planned and achieved unavailable. No new demand arithmetic. | Under 1 day; low risk. Does **not** deliver per-machine planned demand. |
| B — recommended bounded first delivery | Expose solver demand as exact main-product item/s in Check and each generated snapshot, carry snapshot maximum, add supported/unknown reason, implement keyed/stale UI. Main product only; attained production unavailable. Unsupported allocations above stay explicit. | Roughly 2–4 days including integration and focused review; moderate risk, primarily provenance, compatibility and unsupported-topology classification. No schedule/ranking changes. |
| C — all three figures | B plus main-product creation counters captured with each reported clock-only observation; propagate failed-phase/long-run/repeat provenance; observe rounded variants or explicitly leave them unknown. | Roughly 3–6 additional days; medium/high risk at candidate/export/run boundaries. Not a three-field UI change. By-product demand solver, fluid model and fuel-source planning fixes are excluded. |

These are source-only estimates, not commitments or authorization. A per-product planner/all-topology repair is outside these bounds and needs a separate proposal after a concrete unsupported case is chosen.

### Precise affected files if implementation is approved

Engine B: `clock-generator/src/crafting/sequence/cycle/swing-counts.ts` (return/carry existing solution and scope reason); `.../cycle/crafting-cycle.ts` (exact duration + machine plan); `clock-generator/src/crafting/plan/validate-config.ts` (`ConfigValidation`); `clock-generator/src/crafting/plan/plan-run.ts` (result snapshots/export); `clock-generator/src/data-types/machine-facts.ts` only if shared serialized rate types are placed there. Check engine barrel `clock-generator/src/browser.ts` and its exported modules when exposing any new types. No recipe/schema input or editable-goal change.

Additional engine C: `clock-generator/src/crafting/plan/plan-run.ts` (`simulate`, recorded span, `TrialRun`, export); `clock-generator/src/crafting/trial.ts` (reported phase and judged long-run span); `clock-generator/src/crafting/alternatives.ts` (selected exact/rounded variant provenance); `clock-generator/src/crafting/long-run.ts` / `machine-stock.ts` only if reusing their judged observation span. Existing `MachineState.totalCrafted` and `MachineWorkingMode.addOutput` are the authority; their behavior need not change for main output.

Worker/UI B/C: `clock-generator-ui/src/worker/types.ts`, `simulation.worker.ts` (`toRunView`); `src/hooks/useSimulationWorker.ts` (selected snapshot), `src/hooks/useMachineFacts.ts` (key availability); `src/components/MachineFactsAccordion.tsx` and its two callers `MachinesForm.tsx` / `EntityEditDialog.tsx`; `src/components/CheckPlanSection.tsx` if demand is also shown in the Check summary. `src/utils/resultsCache.ts` needs required schema-version update and lean preservation; `resultsStore.ts` only if its validation/cap handling needs adjustment. Reuse `resultsStaleness.ts` and `checkThenGenerate.ts` freshness contracts. Final placement must coordinate with approved D1; this proposal does not prescribe a new screen.

Verification remains current checks, independent code/UX review and **three fresh phase-end personas**. Reuse existing exact-fraction/Copies, swing-plan, output-count, worker/cache and stale-results coverage. If implementing, add or adapt only a concrete missing regression for solution exposure or observation provenance; no new suite, arbitrary permutation/coverage expansion, dependency, or CI change. D9 independently audits and implements justified cleanup only of UX-rework-added UI tests before feature→master; it does not waive existing checks.

## Owner decisions still required

1. Approve A, B or C (or defer); investigation approval does not authorize any of them.
2. Confirm **gross main-product production** for machine rows, with terminal export/all-Copies totals separately labeled. This resolves loops without changing goals.
3. Confirm the initial supported scope: main output, existing allocation policy, unavailable with reason for by-product dependencies, ambiguous chest splits and internally produced dedicated fuel; no automatic planner repairs.
4. For C, confirm actual output-entering-inventory over the engine's reported observation as achieved; unavailable for an unobserved rounded schedule. A terminal-delivery alternative would need different wording and would still require authoritative per-source counters.

## Source reference index for independent inspection

All paths below are within `/tmp/ux-phase3-final-verifier-2d31cc5/`; line numbers identify current source starts, not run results.

| Authority | File and lines |
|---|---|
| One-unit target and exact fractional Copies | `clock-generator/src/crafting/target-production-rate.ts:14`; `config/copies-validator.ts:6`; `crafting/fractional-copies.test.ts:45` |
| Exact cycle and equal terminal split | `clock-generator/src/crafting/sequence/cycle/crafting-cycle.ts:58`, `:69`, `:106` |
| Machine demand, fuel solution, exact simultaneous equations | `clock-generator/src/crafting/sequence/cycle/swing-counts.ts:81`, `:158`, `:280`, `:301`, `:321`, `:361`, `:404` |
| Belt extra consumption; chest assumption; upstream scalar; belt per-item split | same `swing-counts.ts:120`, `:543`, `:608`, `:649` |
| Check payload and preparation | `clock-generator/src/crafting/plan/validate-config.ts:12`, `:31` |
| Aggregate terminal capacity and serialized transfer plan | `clock-generator/src/crafting/plan/plan-run.ts:1316`, `:1377` |
| Intrinsic exact capacity; main/by-product yield | `clock-generator/src/entities/machine/machine.ts:140`, `:183`, `:250`; `data-types/machine-facts.ts:18` |
| Main item, probability, fluids | `clock-generator/src/entities/machine/recipe/recipe-metadata.ts:39`, `:65`; `data/factorio-data-service.ts:124` |
| Creation counter and actual payouts | `clock-generator/src/state/machine-state.ts:40`; `control-logic/machine/modes/machine-working-mode.ts:88`, `:267`, `:295` |
| Dropped-counter measurement vs transformed histories | `clock-generator/src/crafting/plan/plan-run.ts:715`, `:781`, `:826`; `crafting/output-count.test.ts:41` |
| Reported failed phase / long-run replacement | `clock-generator/src/crafting/trial.ts:146`, `:288` |
| All-Copies assessment; rounded schedule caveat | `clock-generator/src/crafting/alternatives.ts:429`, `:454`, `:480`, `:492` |
| Existing planned-share is capacity-clamped (not suitable demand authority) | `clock-generator/src/crafting/plan/plan-run.ts:1692` |
| Fuel-only/by-product clocks outside demand plan | `clock-generator/src/crafting/sequence/unplanned-inserter-clock.ts:33`, `:108` |
| Worker loses machine plan/facts | `clock-generator-ui/src/worker/simulation.worker.ts:110`; `worker/types.ts:113` |
| Current fact request can temporarily show previous facts | `clock-generator-ui/src/hooks/useMachineFacts.ts:64` |
| Freshness and retained config identities | `clock-generator-ui/src/hooks/useSimulationWorker.ts:20`, `:456`; `utils/checkThenGenerate.ts:34`; `utils/resultsStaleness.ts:34` |
| Cache schema and lean stripping | `clock-generator-ui/src/utils/resultsCache.ts:11`, `:105` |
| Existing arithmetic/loop/productivity fixtures | `clock-generator/src/crafting/sequence/cycle/swing-counts.test.ts:25`, `:98`, `:114`, `:165`; `resources/config-samples/science/chemical-science/chemical-science-shared-foundry.json:1`; `resources/data-filtered.json` recipe keys named in examples |

The root reviewer must independently inspect these sources and reconcile this proposal before presenting an implementation decision. No approval or PASS is inferred from this document.
