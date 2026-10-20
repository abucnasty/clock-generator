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

The current default expectations are [pickup-clock-a2-controls.json](pickup-clock-a2-controls.json): all 48
configurations re-recorded after the belt window-end trim (`b654e895`) on Factorio 2.1.21, each with 63
untouched baseline periods and three effective disturbances. The trim changes every exported ordinary clock,
so none of the old recordings describes a clock the generator still makes. The previous defaults,
[pickup-clock-parity-controls.json](pickup-clock-parity-controls.json), captured after the finite-stock,
collection-reach and occupied-output changes on engine commit `4f2d4e35`, stay as the historical evidence of
the clocks they recorded.

| Result | Cases | Interpretation |
| --- | --- | --- |
| Stable, exact baseline and recovery | 41 | The selected clock works under its configured supply |
| Stable, over-target start transient only | 1 | Turbo straight moving: the coverage protocol's clock-speed calibration leaves a belt state from which periods 9 and 11 over-produce (188 and 180 against 176), byte-identically across runs; every period from 12 on and every recovery is exact, and two 204-period runs without the calibration phase are clean (`work/belt-pickup-parity/a2-item2-turbo-straight.md`). Start-state fidelity is roadmap C1 |
| Exact baseline and recovery, generator says no recovery | 2 | Normal moving underground entrance/exit: the model's sampled cold lane-phase starts fail where the game got back to target after every loss. The verdict promises less than the game delivers, erring on the safe side; A3 (moving lane phases) is to model those starts |
| Moving target missed, selected clock requires backed-up supply | 2 | Express moving underground entrance/exit; no verified moving default |
| Baseline missed, generator says unstable | 2 | Normal backed-up underground entrance/exit: the fractional selection (holds false, 5.45 a second against 7.5) misses natively, and the cold-start controls below check the simulator against the measured starts |

No failing captured ordinary default is marked stable for its actual supply. These checks do not close broader
startup timing or over-the-hood operating clocks.

The two modeled failing cold lane-phase starts that the lane-phase audit had retained in
[pickup-clock-moving-phase-controls.json](pickup-clock-moving-phase-controls.json) are removed: since the
window trim, the generator itself gives the normal moving underground selections the "no recovery" verdict,
so there is no separate modeled-phase pin to carry. The file keeps only its meaning note.

The portable `belt-pickup-clock.generation.test.ts` checks the selected periods, verdicts and supply against
these native controls, with two explicit, commented exception lists: the builds whose recording recovers
beyond the model (expecting "no recovery" with a holding baseline), and the one start-transient over-producer
above, where only over-target misses followed by exact periods to the end, with exact recoveries, are
accepted. A measured shortfall on any build, listed or not, still fails, and where a clock was recorded under
its own supply, a baseline miss has to make the generator's own holds verdict false. Fresh generation also
saves the selected rate, required supply and alternative id in `generation-selection.json` when that metadata
is available in its cache.

To replay the original 39 controls, set
`BELT_CLOCK_EXPECTATIONS=tests/game/builds/pickup-clock-speed-controls.json` with their retained recording
directory. Current captures use the a2 controls by default. Always retain failed captures for diagnosis;
the passing measurement test alone does not certify a clock that a control records below target.


### Fully backed-up cold starts

[pickup-clock-startup-controls.json](pickup-clock-startup-controls.json) records the normal underground
entrance/exit with new empty machines/hands and verified stationary `[0,64]` stock on both half-tile lanes.
At offset 0, all 16 periods produce 176 items. Rotating the same windows by 1287 ticks makes both game and
simulator alternate 144/208 for all 16 periods. The mean is 176, but exact per-period output fails. The
windows are the old swings-1 selection, kept as fixed-window checks of the simulator against the game's
measured cold starts: both tests build them as given, independent of the selection, which since the window
trim is fractional for these two builds and is judged on its own a2 recording like any other default.

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

The current default expectations are [over-hood-a2-clock-controls.json](over-hood-a2-clock-controls.json):
28 variants re-recorded with the clocks of the belt window-end trim (`b654e895`) on Factorio 2.1.21, plus the
three whose exported clock the trim leaves byte-identical, copied from the historical file (the
express-mirrored-moving copy corrects a stale `generationVerdict` to the generator's "no recovery", said since
the lane-phase audit). Of the 31 entries, 25 pass their baseline and recoveries exactly — the mirrored moving
turbo's third recovery overshoots one period and pauses four before holding target for its last 14 periods —
five are correctly rejected, with native baseline misses behind each holds-false pick (fast mirrored at both
supplies, fast unmirrored moving, normal mirrored at both supplies), and the copied mirrored moving express
keeps its no-recovery counterexample.

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
selections and hashes their exact exported blueprint/schedule, regenerated after the window-end trim. The
lane-phase audit's three changed clocks keep their native counts from that time in
[over-hood-phase-clock-controls.json](over-hood-phase-clock-controls.json); since the trim, every recorded
pin's `native_control` points at the a2 controls above. The one unrecorded pin is
fast-unmirrored-backed-different-items, whose fractional selection repeats every 16,160 ticks: a 63-period
recording would overrun the harness's 72,000-tick cap many times over, so its `native_control` is dropped
rather than its timeout raised. That selection moves 6.95 a second against a target of 6 with holds false;
it goes to A5 (over-the-hood mixed-item builds without a stable default) as a lead, not to this change.
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
96-item hand every 16th period. Every alternative of those two variants carried the same cycle, so both pinned
an unstable selection until the belt window-end trim (`b654e895`) removed the extra pickup at its source: a
belt-fed inserter's input window now ends one rotation before its last return swing. Both variants again select
planned-belt-slack, at period 960, and the a2 controls record their baselines and recoveries exact in the game;
the old recordings stand as the in-game confirmation that the old picks fail.

```bash
BELT_SPEED_CAPTURE_DIR=../work/over-hood-clock-new \
  npm run test:game -- tests/game/builds/over-hood-pickup-clock.game.test.ts \
  -t '^operating clock: over-hood-turbo-unmirrored-moving-different-items$'
```

Use the generation cache and replay variables above with a fresh capture directory. Optional
`BELT_CLOCK_TRACE_PICKUPS=1` retains 64 ticks of native held/stock and machine-inventory snapshots before the first disturbance
and after each restoration; it does not feed observations into the simulator.
