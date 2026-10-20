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
| Stable, exact baseline and recovery | 42 | The selected clock works under its configured supply |
| Warm target and recovery pass, generator says unstable | 2 | Normal backed-up underground entrance/exit fail a fully jammed cold start at offset 1287; the rejection is correct |
| Warm target and recovery pass, additional modeled lane phases fail | 2 | Normal moving underground entrance/exit alternate 192/160 at another modeled cold start; that failing start is not yet native-verified |
| Moving target missed, selected clock requires backed-up supply | 2 | Express moving underground entrance/exit; no verified moving default |

The six historical false-stable counterexamples involving fast undergrounds, normal straight pickups and
normal moving underground recovery now pass with regenerated clocks. Both normal backed-up underground
defaults pass the warm run, but the cold-start controls below confirm their startup sensitivity. No failing captured
ordinary default is marked stable for its actual supply. These checks do not close broader startup timing
or over-the-hood operating clocks.

The lane-phase audit leaves all 48 exported clocks unchanged. Two additional normal moving underground
verdicts become unstable, with the modeled failing starts retained separately in
[pickup-clock-moving-phase-controls.json](pickup-clock-moving-phase-controls.json). The measured warm
runs still hold 176, including a separate two-tick ingredient-restoration perturbation; those observations
do not establish the modeled failing cold phase. Keep this distinction from a native counterexample explicit.

The portable `belt-pickup-clock.generation.test.ts` checks the selected periods, verdicts and supply against
these native controls. Four additional comparisons reproduce the cold-start counts below, including the correct
unstable rejections. Fresh generation also saves the selected rate, required supply
and alternative id in `generation-selection.json` when that metadata is available in its cache.

To replay the original 39 controls, set
`BELT_CLOCK_EXPECTATIONS=tests/game/builds/pickup-clock-speed-controls.json` with their retained recording
directory. Current captures use the parity controls by default. Always retain failed captures for diagnosis;
the passing measurement test alone does not certify a clock that a control records below target.


### Fully backed-up cold starts

[pickup-clock-startup-controls.json](pickup-clock-startup-controls.json) records the normal underground
entrance/exit with new empty machines/hands and verified stationary `[0,64]` stock on both half-tile lanes.
At offset 0, all 16 periods produce 176 items. Rotating the same windows by 1287 ticks makes both game and
simulator alternate 144/208 for all 16 periods. The mean is 176, but exact per-period output fails, so the
unstable verdict is justified.

The staged harness's default saturation check establishes fullness, which can still occur while stock moves.
These fixtures wait for 1,200 saturation ticks and additionally assert stationary stock before the first grab;
that wait is a fixture setup, not a general timing rule. Earlier short-saturation pilots are not used as evidence
for a fully backed-up start. Counts begin at cold placement and include the first period; no observed arm arrivals
or later stock are fed back into the simulator.

```bash
BELT_SPEED_CAPTURE_DIR=../work/belt-clock-startup-new \
  npm run test:game -- tests/game/builds/pickup-clock-startup.game.test.ts
```

## Over-the-hood operating clocks

`over-hood-pickup-clock.game.test.ts` enumerates 32 controls: electronic circuits with different lane
ingredients and gears with identical lane ingredients, at four speeds, both mirroring states, and
moving/backed-up supply. Every variant uses the same compact assembler layout and 6/s target. Backed-up
variants remove only the ingredient drain; the product outlet stays open until the output intervention.
Sidecar must capture supported belt model 2, the over-the-hood layout and the correct preferred lane.

[over-hood-clock-controls.json](over-hood-clock-controls.json) retains all 32 native summaries using clocks
generated on engine `4f2d4e35` and Factorio 2.1.21. Twenty-one pass exact baseline and recovery output,
including all 16 same-item cases. Eight already receive unstable/no-recovery verdicts. Three are marked stable
but fail recovery: turbo moving in both mirroring states, and express moving when mirrored. Each capture has
63 untouched baseline periods and overlapping detailed-recorder checks. These controls are historical evidence;
changed selected clocks need fresh game verification rather than replacement of the old counts.

These compact builds can keep producing through the ordinary runner's short outages using stored stock.
Their three successive disturbances therefore last 24 periods, with machine inventories and clock state
untouched. A disturbance must reduce output below the baseline before recovery is assessed. If the baseline
already contains zero-output periods, the summary retains all counts and marks recovery `not_assessed`;
that clock has already failed its undisturbed throughput check.

The [bounded turbo trace](over-hood-lane-phase-control.json) preserves a separate, shorter ingredient-loss
counterexample. Before the interruption, both lanes share a phase. Afterwards, only the interrupted lane
shifts by half a stack interval. The clock was marked stable, but native output repeats a 48-item period
among four 64-item periods instead of 64 every 640 ticks. The existing pickup kernel reproduces this pattern
with different initial lane phases. A common clock shift alone does not check that state.

The matching express trace is retained in [over-hood-express-lane-phase-control.json](over-hood-express-lane-phase-control.json).
The old mirrored express clock repeats six 112-item periods and one 96-item period after recovery. Separate
lane phases reproduce that seven-period cycle in the existing simulator too, under its own loss protocol.
Native observer ticks have a different origin from the exported clock, so the comparison uses relative lane
phase and cycle rotation; it does not claim the same initial inventory, first failing period or loss transient.

Clock verification now varies ordinary moving lanes independently in both steady-output and recovery checks.
The historical summaries preserve the original clocks and verdicts. A passing capture/replay means the recorded
observations match expectations, including any shortfalls recorded there; it does not certify a failing clock.

[over-hood-phase-generation-controls.json](over-hood-phase-generation-controls.json) pins all 32 audited
selections and hashes their exact exported blueprint/schedule. Only three clocks change; their fresh native
counts are in [over-hood-phase-clock-controls.json](over-hood-phase-clock-controls.json). The turbo replacements
produce 32 / 320 ticks at both mirroring states. The mirrored replacement has one short period six periods
after the final restoration, then 18 uninterrupted target periods: it recovers after seven periods, within the
40-period simulator recovery limit. The changed fast candidate remains unstable and misses target natively.
Express keeps the same exported clock and native evidence but now receives the correct no-recovery verdict.
The portable `over-hood-clock.generation.test.ts` checks these selections, exact clock hashes and the final
untouched final native recovery windows for clocks marked stable (at least eight periods for moving supply,
five for backed-up supply, whose assessment starts later).

Raw evidence is retained locally under `work/belt-pickup-parity/over-hood-different-native-02-{unmirrored,mirrored}/`
and `over-hood-same-native-01-{unmirrored,mirrored}/`. The bounded shorter-loss trace is in
`work/belt-pickup-parity/over-hood-phase-native-01/`. Earlier short-outage pilots are separate; an outage hidden
by buffers does not add recovery coverage.

Since the long run is judged by state repetition (proof-verification, 2026-10-19), two entries changed:
`over-hood-{express,turbo}-unmirrored-backed-different-items`. Their old 800-tick `planned-belt-slack` picks never
held 80 a period: the simulation repeats a 16-period cycle in which one period moves 96 (one extra hand), an
eternal average of 81.04. The old 45-period long run judged 30 bins that held exactly one such spike, which one
hand of tolerance absorbed; the proven cycle does not. The game agrees: the retained native baselines in
[over-hood-clock-controls.json](over-hood-clock-controls.json) run 63 periods per variant and move 96 at periods
15, 31, 47 and 63, which nothing compared before because the old test read the baseline only for "stable"
verdicts and these two were "no recovery". Fresh 64-period headless runs of the old clocks reproduce it (96 at
periods 8, 24, 40 and 56; `work/belt-pickup-parity/over-hood-watch/`), and the express run was watched in game.
The mechanism, read off those recordings: the belt input inserter picks 324 items a period against the planned
320 - after its last planned return swing its window still holds one pickup tick, which on a backed-up belt
always grabs one 4-item stack - and the carried partial hand becomes an extra full hand every 4th period, in
recipe proportion; the assembler has the spare speed to craft them, and the output inserter drops the extra
96-item hand every 16th period. Every alternative of these two variants carries the same cycle, so both now pin
an unstable selection. Their `native_control` is dropped only because the pinned selection changed (swings-7 has
no recording of its own); the old recordings stand as the in-game confirmation that the old picks fail.

```bash
BELT_SPEED_CAPTURE_DIR=../work/over-hood-clock-new \
  npm run test:game -- tests/game/builds/over-hood-pickup-clock.game.test.ts \
  -t '^operating clock: over-hood-turbo-unmirrored-moving-different-items$'
```

Use the generation cache and replay variables above with a fresh capture directory. Optional
`BELT_CLOCK_TRACE_PICKUPS=1` retains 64 ticks of native held/stock and machine-inventory snapshots before the first disturbance
and after each restoration; it does not feed observations into the simulator.
