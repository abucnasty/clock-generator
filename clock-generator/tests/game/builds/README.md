# Generated clocks in the game

These tests check throughput, startup and/or recovery of generated clocks. They use general samples from
`resources/config-samples/` or the isolated pickup fixtures, without moving a general sample merely because a test
uses it. Setup, selective execution and artifact retention are in the [game verification guide](../README.md).

- `scaffold-recordings.game.test.ts`: the catalog of complete sample builds, including wake-up/recording comparisons.
- `moving-pickup.game.test.ts`: different-item pickup geometry, moving/backed-up supply and recovery.
- `same-item-pickup-clock.game.test.ts`: same-item lane fallback, throughput and recovery.

From `clock-generator/`, select a file or case:

```bash
npm run test:game -- tests/game/builds/scaffold-recordings.game.test.ts -t 'automation science'
npm run test:game -- tests/game/builds/moving-pickup.game.test.ts -t 'straight-belt holds'
```

The original turbo moving/different-item matrix has 12 cases; the original same-item clock matrix has six. Their recovery trials run many
periods and are deliberately separate from the short mechanic probes. Do not run them for prose or a probe-only
refactor that does not change clock behavior. `npm run test:game:watch` currently watches the scaffold-recordings
suite; it is not a generic visual mode for every mechanic test.

## Pickup speed backfill

The `speed coverage:` runner covers all four belt speeds, all three ordinary pickup geometries, both
moving/backed-up supplies and the electromagnetic/gear families: 48 configurations. Its original backfill
covered 39 of these; turbo is now included in the same uninterrupted capture procedure as the slower tiers.
Electromagnetic targets scale with speed: 30/s turbo, 22.5/s express, 15/s fast and 7.5/s normal; gear remains 6/s.
The original pickup and machine positions stay fixed. Slower underground runs are split where needed
to remain within native connection range; backed-up variants remove only the ingredient drain.

Each new case measures one continuous clock run. After ten settling periods, at least 60 untouched
periods precede the ingredient/output disturbances. Ingredient cuts are at periods 66–68 and 104–106;
output disposal is blocked at 84–88. Machine inventories and clock state remain untouched. Recovery is
assessed after six additional periods for moving supply and ten for backed-up supply.
Each disturbance must reduce output below the lowest baseline period before its recovery is assessed.

Long default clocks can exceed the recorder's 72,000 detailed-tick limit even for 60 periods. The shared
Lua probe therefore aggregates actual output-inserter held-count decreases at native clock wraps during
settling, retaining complete-period counts through all interventions. The recorder then captures only
two detailed periods, which must match overlapping compact aggregates exactly. This preserves the limit
and avoids resetting the build or retaining millions of redundant samples.

The historical `pickup-clock-speed-controls.json` records native period summaries separately from the generator's
verdict. A measured throughput/recovery counterexample is not a claim that the selected clock is safe.
Express moving half-tile generation already reports `no recovery`; the backfill preserves that verdict.
Unsupported sources are not overridden to generate clocks.

The backfill retained 39 native runs, each with 63 baseline periods and three recovery windows.
All 21 gear clocks meet their 16-item target in every baseline/recovery period. Eight of the 18
lower-speed electromagnetic clocks meet both; ten preserve counterexamples. Two of those already
receive the generator verdict `no recovery` (express moving half-tile pickups). Eight receive `stable`
but miss native baseline or recovery periods. Exact counts are in the committed summaries; the
[experiment report](../../../docs/belt-pickup/experiments.md) compares the scenarios.

These are complete-clock observations. Finite input refill, clock/input phase, machine wake timing,
and occupied output-belt history remain possible contributors; this capture does not isolate a cause.
In particular, normal moving half-tile clocks meet their baseline target but alternate after the
**output blockage** at period 84, while both ingredient-cut recoveries meet target.

Retained replay also checks native machine recipe/speed/productivity, machine connections, hand
capacities, input belt tier/ingredients/stack sizes, output product and observed four-item belt drops,
and the transformed scaffold's transport tiers. Sidecar can omit an empty output belt and assign
its inserter sink the fallback id 1, which can alias the input belt. Output lane metadata is checked
when exported; native drop geometry and observed transfers remain checked when it is absent.
These assertions do not establish that such an incomplete captured config can be reimported unchanged.

From `clock-generator/`, select a bounded case and retain its artifacts:

```bash
BELT_SPEED_CAPTURE_DIR=../work/belt-speed-coverage/build-new \
  npm run test:game -- tests/game/builds/moving-pickup.game.test.ts \
  -t '^speed coverage: electromagnetic-express-underground-entrance-moving$'
```

`BELT_CLOCK_GENERATION_DIR` optionally caches the generated clock/config for each named case; use one
fresh directory for a fixed code revision. `BELT_CLOCK_GENERATION_ONLY=1` prepares clocks without
Factorio and checks the selected rate against the target, unless calibration is enabled.
`BELT_CLOCK_CALIBRATE=1` records candidate native summaries rather than comparing committed
measurements; review the actual reports before updating expectations. `BELT_CLOCK_REPLAY_DIR` can
validate retained recordings and compact reports offline, without another native run.

Native runs also capture selected clocks whose simulated rate is below the requested rate. Keep those
shortfalls explicit: collecting their output does not certify the clock. Check the selected alternative's
required supply as well as its verdict; a backed-up fallback selected for moving input is a different
operating condition. Cache entries keep underground entrances and exits separate because their layout can
affect arm travel.

`BELT_CLOCK_EXPECTATIONS` selects another summary JSON file when verifying a later simulator revision.
The original `pickup-clock-speed-controls.json` remains the historical experiment evidence; do not overwrite
its observations with new clock results. Always pair a replay with the summaries of the same retained run.

## Post-fix ordinary clock verification

The current default expectations are [pickup-clock-parity-controls.json](pickup-clock-parity-controls.json),
captured after the finite-stock, collection-reach and occupied-output changes on engine commit `4f2d4e35`.
All 48 configurations have 63 untouched baseline periods and three effective disturbances; their compact
counts match overlapping detailed recordings and the native hardware assertions.

| Result | Cases | Interpretation |
| --- | --- | --- |
| Stable, exact baseline and recovery | 44 | The selected clock works under its configured supply |
| Native target and recovery pass, generator says unstable | 2 | Normal backed-up underground entrance/exit; a conservative simulator mismatch remains |
| Moving target missed, selected clock requires backed-up supply | 2 | Express moving underground entrance/exit; no verified moving default |

The six historical false-stable counterexamples involving fast undergrounds, normal straight pickups and
normal moving underground recovery now pass with regenerated clocks. Both normal backed-up underground
defaults also work natively, but their simulated rejection still needs a separate fix. No failing captured
default is marked stable for its actual supply. These checks do not close independent startup timing,
over-the-hood operating clocks or slower two-stream support.

The portable `belt-pickup-clock.generation.test.ts` checks the selected periods, verdicts and supply against
these native controls. It explicitly retains both conservative rejections; those assertions are not a claim
that their simulator discrepancy is fixed. Fresh generation also saves the selected rate, required supply
and alternative id in `generation-selection.json` when that metadata is available in its cache.

To replay the original 39 controls, set
`BELT_CLOCK_EXPECTATIONS=tests/game/builds/pickup-clock-speed-controls.json` with their retained recording
directory. Current captures use the parity controls by default. Always retain failed captures for diagnosis;
the passing measurement test alone does not certify a clock that a control records below target.
