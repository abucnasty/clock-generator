# Generated clocks in the game

These tests check throughput, startup and/or recovery of generated clocks. They use general samples from
`resources/config-samples/` or the isolated pickup fixtures, without moving a general sample merely because a test
uses it. Setup, selective execution and artifact retention are in the [game verification guide](../README.md).

- `scaffold-recordings.game.test.ts`: the catalog of complete sample builds, including wake-up/recording comparisons.
- `moving-pickup.game.test.ts`: different-item pickup geometry, moving/backed-up supply and recovery.
- `same-item-pickup-clock.game.test.ts`: same-item lane fallback, throughput and recovery.
- `over-hood-pickup-clock.game.test.ts`, `front-pickup-clock.game.test.ts`: the over-the-hood exit and the front
  underground entrance and exit, throughput and recovery.
- `blocked-output-clock.game.test.ts`: a chest-fed machine whose output belt is blocked, at belt stack sizes 1–4.
- `container-clock.game.test.ts`: a car, a tank or a cargo wagon between its supplies and a machine, with cuts that last until the container is empty.
- `lithium-silo-clock.game.test.ts`: the lithium plate build, a rocket silo taken as a chest between two cryogenic plants and six furnaces.
- `car-clock.game.test.ts`: the iron plate build, a car taken as a chest between a big mining drill and two furnaces.
- `steel-wagon-clock.game.test.ts`: the steel build, a cargo wagon taken as a chest that a big mining drill and two furnaces fill and empty, the steel leaving through it.
- `own-clock.game.test.ts`: the inserter build on three copies, once with the hand-made clock and once with the generated clock.
- `grenade-clock.game.test.ts`: the grenade build on one copy and on its full build of seven, each with the hand-made clock and with the generated clock.
- `stupidfathobbit-cell02-clock.game.test.ts`: cell 02 (processing units from two circuit machines and two advanced circuit machines, an export belt) on its throttled scaffold with the generated clock, as it is and with the belts backed up.
- `thaeln-cell09-clock.game.test.ts`: Thaeln's cell 09 (a chain of machines with a coal inserter that moves 15/8 hands a cycle) with the generated clock.
- `productivity-chain-clock.game.test.ts`: the productivity module chain (nine machines and three chests, 80 a second over 6 copies) with the generated clock.

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

The original backfill's native period summaries (#245) are kept in
[pickup-clock-history-controls.json](pickup-clock-history-controls.json), separately from the generator's verdict. A measured throughput/recovery counterexample is not a claim that the selected clock is safe.
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
BELT_SPEED_CAPTURE_DIR=.scratch/belt-speed-coverage/build-new \
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

`BELT_CLOCK_EXPECTATIONS` selects other summaries when verifying a later simulator revision: a family's controls
file, or a history file and the PR of the recording, `<file>#<pr>` ([clock-controls.ts](clock-controls.ts)). The
history files keep the superseded recordings as experiment evidence; do not overwrite their observations with new clock
results. Always pair a replay with the summaries of the same retained run: the committed summaries are the durable
record, and a replay needs captures made locally.

## Post-fix ordinary clock verification

The current default expectations are [pickup-clock-controls.json](pickup-clock-controls.json), recorded on
Factorio 2.1.21; each entry names the PR that recorded it and the frozen head its clock was generated on. All 48 were
recorded after the belt window-end trim (#265, frozen head `77f11ce6`; turbo straight moving again at `9d8f7089`); 20
again after the belt hand's resume after a craft start was fixed (#266, `aae515e9`); the fast straight moving
electromagnetic configuration again after a belt-fed window's first stack was tied to where its machine's products go
(#267, `7950f77c`: the only clock of the 48 whose exported blueprint and schedule changed, one output swing per cycle
at 704 ticks again, in place of planned belt slack at 3520); the two express moving underground configurations on
their first clock made for moving supply (#269, `959c08d5`: observed windows at 3 output swings, in place of a clock
for backed-up belts); and the two normal backed-up underground configurations on the clock the generator now makes for
them last, when no other clock can be selected as stable (#275, `6588a59b`: planned with the belts moving, given belt
pickup slack and checked on the backed-up belts, in place of a fractional clock that missed), each with 63 untouched
baseline periods and three effective disturbances. The two normal moving underground entries keep their #265
recording with the generator's "unstable" verdict for the same clock (#266). The recordings these replaced, and the
#253 recapture on engine `4f2d4e35` before them, stay in
[pickup-clock-history-controls.json](pickup-clock-history-controls.json) as the historical evidence of the clocks they
recorded.

| Result | Cases | Interpretation |
| --- | --- | --- |
| Stable, exact baseline and recovery | 44 | The selected clock works under its configured supply. This includes turbo straight moving, whose earlier clock over-produced in two early periods from the coverage protocol's calibration state; the clock since #266 runs exact from the first period. It also includes the normal backed-up underground entrance/exit (#275): their backed-up belts refill the pickup slower than a stack a tick, every clock planned for backed-up supply misses (the fractional clock before moved 96, 128, 128 against 176 natively, matching its holds false), and the clock planned with the belts moving and checked on the backed-up belts holds; the cold-start controls below still check the simulator against the measured starts with fixed windows |
| Exact baseline and recovery in these warm recordings, generator says unstable | 2 | Normal moving underground entrance/exit: the generator finds the clock failing from cold lane phase [3,0], and the game never settles from it either, nor from four other phases, among them the exit's natural one, where it cycles at 143 a period against 176 ("Normal underground lane phases" below). The warm runs started at a phase that holds |
| Exact baseline and recovery, generator says no recovery | 2 | Express moving underground entrance/exit (#269): every loss the generator tries fails from lane phase [1,5] alone, which the capture cannot set up ([lane-phase-controls.json](lane-phase-controls.json), `recovery_phase`). Their clocks before, made for backed-up belts, moved 352 a period against 528 under moving supply; with every inserter always enabled the game moves 704 to 716 through this pickup |

No failing captured ordinary default is marked stable for its actual supply. These checks do not close broader
startup timing or over-the-hood operating clocks.

[lane-phase-controls.json](lane-phase-controls.json) (`moving_phase`) pins the cold lane-phase start
the generator's verifier fails the two normal moving underground clocks from, [3,0], with the game's output from
that start.

The portable `belt-pickup-clock.generation.test.ts` checks the selected periods, verdicts and supply against
these native controls. A build whose warm recording holds while the generator finds a failing cold lane phase has
to fail at the pinned phase, and one whose recording holds and recovers while the generator says "no recovery" has to
fail every loss it fails from its pinned lane phase. A measured shortfall on any build still fails, and where a clock was recorded under
its own supply, a baseline miss has to make the generator's own holds verdict false. Fresh generation also
saves the selected rate, required supply and alternative id in `generation-selection.json` when that metadata
is available in its cache.

To replay against the original 39 controls, set
`BELT_CLOCK_EXPECTATIONS=tests/game/builds/pickup-clock-history-controls.json#245` with a recording directory of
those clocks made locally; the original recordings were not kept. Current captures use pickup-clock-controls.json by
default. Always retain failed captures for diagnosis;
the passing measurement test alone does not certify a clock that a control records below target.


### Fully backed-up cold starts

[pickup-clock-start-controls.json](pickup-clock-start-controls.json) (`backed_up_start`, #253) records the normal underground
entrance/exit with new empty machines/hands and verified stationary `[0,64]` stock on both half-tile lanes.
At offset 0, all 16 periods produce 176 items. Rotating the same windows by 1287 ticks makes both game and
simulator alternate 144/208 for all 16 periods. The mean is 176, but exact per-period output fails. The
windows are the old swings-1 selection, kept as fixed-window checks of the simulator against the game's
measured cold starts: both tests build them as given, independent of the selection, which since the window
trim is fractional for these two builds and is judged on its own recording like any other default.

The staged harness's default saturation check establishes fullness, which can still occur while stock moves.
These fixtures wait for 1,200 saturation ticks and additionally assert stationary stock before the first grab;
that wait is a fixture setup, not a general timing rule. Earlier short-saturation pilots are not used as evidence
for a fully backed-up start. Counts begin at cold placement and include the first period; no observed arm arrivals
or later stock are fed back into the simulator.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/belt-clock-startup-new \
  npm run test:game -- tests/game/builds/pickup-clock-startup.game.test.ts
```

### Normal underground lane phases

[lane-phase-controls.json](lane-phase-controls.json) (`normal_underground`) records cold starts of the
normal moving underground entrance and exit at all 64 pairs of input lane phases, 128 runs in Factorio 2.1.21
(#266, 2026-10-20, on master `f6c598c8`), under the fixed windows of their swings-1 clock. The fixture clears every
supply-chain line of both lanes, seeds it on the requested lattice and checks the lanes before the first grab and in
every period; its probe, test and runs were not kept in the repository. Entrance and exit recorded the
same counts on both clocked inserters in every cell. Five cells never settle: [3,0], [3,1] and [3,7] repeat 176, 160,
144, 128, 128, 144, and [3,3] and [3,4] repeat 128, 144, 160, 128, 144, 176, 143 a period against 176. [3,3] is the
exit's natural phase: a staged start of the build without seeding lands there.

`normal-underground-lane-phase.generation.test.ts` runs the simulator from each cell. In every cell of both builds it
moves the game's output and pickups in every period, and its output inserter holds the game's count in every tick.
Since #267 that includes the 13 cells per build where the input and the output window open in the same tick on a
machine at its output block: the output inserter puts the products onto a belt, so the game's belt-fed input takes its
first stack a tick after they are taken, and the simulator does too. `known_differences` is empty; a cell listed there
would be held only on its last eight periods.

### Clocked cold starts

[pickup-clock-start-controls.json](pickup-clock-start-controls.json) (`cold_start`) records 57 clocked cold starts in
Factorio 2.1.21 (#273, 2026-10-20, frozen head `98f362ce`), each 16 periods from the harness's staged start, with nothing written to a
belt: the game's own lane phase at placement, read off the pickup tile. The four normal backed-up side underground runs (entrance and
exit, near lanes 1 and 2) were recorded again on the clock #275 selects for them, planned with the belts moving; the
game follows the simulator tick for tick from placement on it, as it did on the fractional clock before.

- **The matrix, 48:** every electromagnetic side pickup fixture at 4 tiers × straight belt, underground entrance and
  exit × moving and backed-up supply, on the generator's selected clock, at near lane 1 and at near lane 2. Near lane 2
  is the cell reflected (`reflectOrdinaryPickup`) with its plant mirrored as well, without which its fluid inputs miss
  the reflected pipes and nothing is made; the config names lane 2 near and keeps the near lane's item.
- **The deciding cases, 9,** of the rule that a clock's first two ticks are dark: the express entrance started 30 ticks
  into an input window, the backed turbo entrance 10 ticks in, and two over-the-hood clocks 123 and 174 ticks in, near
  lane 1 and 2 (the windows rotated, `rotate`); the express entrance with the clock's deciders built in the mirror order
  (`decider_order`), with the inserters built in reverse (`build_order`), and moved (`position`); and the two over-hood
  clocks unrotated.

Each run keeps its clock (windows, period, terminal swings and the hash of the exported clock), the lane phases at
placement and in the model's frame (native - 4 × the tier's speed), and what the game's output and input inserters
moved in each period and held in each tick of the model's frame (model `held[i]` = sample `i + 4`), as sha256.
`pickup-clock-cold-start.game.test.ts` records them again: the same clock, a cold cell, the clock a tick behind the
probe, every period on the placement lattice, and both series as kept. Its probe
(`pickup-clock-cold-start-probe.lua`) only observes. The raw runs, the scratch fixture they came from and their
analyses were not kept in the repository.

`pickup-clock-cold-start.generation.test.ts` runs the simulator from each cold start and holds both clocked inserters'
counts in every tick and their items in every period: 57 of 57, the input of one held only by its output (a hand back
from its swing as the output block is lifted, a tick early in the simulator, once). On the engine before the clock's
start rule the 11 runs where a window the latency carries over the period's end reaches ticks 0-1 fail, and the
other 46 pass.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/belt-clock-cold-start-new \
  npm run test:game -- tests/game/builds/pickup-clock-cold-start.game.test.ts -t 'express-underground-entrance-moving-l1'
```

## A recording belongs to one clock

A game test does not store its clock: it generates the clock the generator selects and compares what the game does with
a `native` summary in a `*-clock-controls.json` file. That summary was recorded on one clock, so every entry names it:
`recorded.clock_sha256` is the sha256 of the clock's identity (`clockIdentity`: the exported blueprint without its text
and metadata, and the schedule), `recorded.clock_basis` says how it is known (`capture`: a retained capture whose summary
equals `native`; `history`: the pin has not changed since the commit that recorded `native`; `regenerated`: the clock
generated on the engine of that commit; `built`: a hand-made clock, which no selection makes, so it has no pin and the
hash is `builtClockIdentity` of the build's blueprint, recomputed by `clock-controls.test.ts`), and `generation.clock_sha256` is the clock the selection makes today, checked by
the family's `*.generation.test.ts` (pull requests to master).

- `clock-controls.test.ts` runs with the unit tests and reads the files only: it fails where the pin and the recording
  name different clocks, which is what editing a pin to follow a moved selection leaves behind. Either record the entry
  again in the game and set `recorded.clock_sha256`, or write in `recorded.carried` the commit or PR and why the
  recording still holds (a re-pin with the same windows, verdicts and game result). The game test then runs on the
  pinned clock, which shows whether it does.
- A game test checks the hash of the clock it generated against the recorded one before it starts Factorio
  (`pickup-clock-capture.ts`; `BELT_CLOCK_CALIBRATE=1` skips the check to record a new summary).
- The cold starts (`pickup-clock-start-controls.json`, `cold_start`) keep the same pair per clock:
  `clock_sha256` (checked by `pickup-clock-cold-start.generation.test.ts` against the selection or the pinned windows)
  and `recorded_clock_sha256` (checked by the game test).
- Three scaffold-recordings builds expect values that belong to one clock (agricultural science having no dip and no
  difference after its staged start, agricultural science with backed-up belts having no difference, and the moved
  inserters of chemical science with a shared foundry): `scaffold-recordings-clock-pins.json`.

## Over-the-hood operating clocks

`over-hood-pickup-clock.game.test.ts` enumerates 32 controls: electronic circuits with different lane
ingredients and gears with identical lane ingredients, at four speeds, both mirroring states, and
moving/backed-up supply. Every variant uses the same compact assembler layout and 6/s target. Backed-up
variants remove only the ingredient drain; the product outlet stays open until the output intervention.
Sidecar must capture supported belt model 2, the over-the-hood layout and the correct preferred lane.

[over-hood-clock-history-controls.json](over-hood-clock-history-controls.json) retains all 32 native summaries of #254,
using clocks generated on engine `4f2d4e35` and Factorio 2.1.21. Twenty-one pass exact baseline and recovery output,
including all 16 same-item cases. Eight already receive unstable/no-recovery verdicts. Three are marked stable
but fail recovery: turbo moving in both mirroring states, and express moving when mirrored. Each capture has
63 untouched baseline periods and overlapping detailed-recorder checks. These controls are historical evidence;
changed selected clocks need fresh game verification rather than replacement of the old counts.

The current default expectations are [over-hood-clock-controls.json](over-hood-clock-controls.json), each entry with
the PR that recorded it and its frozen head. The two express moving mixed-item variants whose selected clock #272
changed (observed windows judge each lane-phase start over its repeating cycle) were re-recorded from the generator on
Factorio 2.1.21 (frozen head `4162ddfe`, the PR's source commit before its last amend), both exact in baseline and
recovery:
the mirrored one, whose old clock repeated six 112-item periods and one 96-item period after each disturbance, holds
112 throughout with its input window 3 ticks longer, and the unmirrored one keeps 96 with its input window a tick
longer. The nine mixed-item variants whose selected clock #269 changed to observed windows (an observed-windows clock
holds when its own windows hold) were re-recorded on Factorio 2.1.21 (frozen head `959c08d5`), all exact in baseline and
recovery, the normal mirrored moving one after two short periods following its last disturbance; among them fast
unmirrored backed, recorded for the first time. #265 re-recorded 28 variants with the clocks of the belt window-end
trim on Factorio 2.1.21 (frozen head `77f11ce6`), and kept #254's recordings of the three whose exported clock the trim
leaves byte-identical (its express-mirrored-moving copy corrected a stale `generationVerdict` to the generator's "no
recovery", said since the lane-phase audit; the history entry's note keeps it). Of #265's 31 entries, 25 pass their baseline and recoveries exactly — the mirrored moving
turbo's third recovery overshoots one period and pauses four before holding target for its last 14 periods —
five are correctly rejected, with native baseline misses behind each holds-false pick (fast mirrored at both
supplies, fast unmirrored moving, normal mirrored at both supplies), and the copied mirrored moving express
keeps its no-recovery counterexample.

These compact builds can keep producing through the ordinary runner's short outages using stored stock.
Their three successive disturbances therefore last 24 periods, with machine inventories and clock state
untouched. A disturbance must reduce output below the baseline before recovery is assessed. If the baseline
already contains zero-output periods, the summary retains all counts and marks recovery `not_assessed`;
that clock has already failed its undisturbed throughput check.

The [bounded turbo trace](lane-phase-controls.json) (`over_hood_turbo_trace`, #254) preserves a separate, shorter ingredient-loss
counterexample. Before the interruption, both lanes share a phase. Afterwards, only the interrupted lane
shifts by half a stack interval. The clock was marked stable, but native output repeats a 48-item period
among four 64-item periods instead of 64 every 640 ticks. The existing pickup kernel reproduces this pattern
with different initial lane phases. A common clock shift alone does not check that state.

The matching express trace is retained in [lane-phase-controls.json](lane-phase-controls.json) (`over_hood_express_trace`, #255).
The old mirrored express clock repeats six 112-item periods and one 96-item period after recovery. Separate
lane phases reproduce that seven-period cycle in the existing simulator too, under its own loss protocol: from 9 of
its 64 lane-phase starts the clock repeats it with nothing lost, while the clock-only check judged one period of each
start and passed them all. Observed windows now judge each start over its repeating cycle, and the new default holds
112 in the game after every disturbance.
Native observer ticks have a different origin from the exported clock, so the comparison uses relative lane
phase and cycle rotation; it does not claim the same initial inventory, first failing period or loss transient.

Clock verification now varies ordinary moving lanes independently in both steady-output and recovery checks.
The historical summaries preserve the original clocks and verdicts. A passing capture/replay means the recorded
observations match expectations, including any shortfalls recorded there; it does not certify a failing clock.

The `generation` field of each entry of [over-hood-clock-controls.json](over-hood-clock-controls.json) pins its
audited selection and hashes its exact exported blueprint/schedule, regenerated after the window-end trim, beside the
native recording of that clock. The lane-phase audit's three changed clocks keep their native counts from that time
(#255) in [over-hood-clock-history-controls.json](over-hood-clock-history-controls.json). Until #269
fast-unmirrored-backed-different-items had no recording: its fractional selection repeated every 16,160 ticks, more
than a 63-period recording fits under the harness's 72,000-tick cap, and moved 6.95 a second against 6 with holds
false. Its observed windows at 800 ticks hold 80 a period, in the game too.
The portable `over-hood-clock.generation.test.ts` checks these selections, exact clock hashes and the final
untouched final native recovery windows for clocks marked stable (at least eight periods for moving supply,
five for backed-up supply, whose assessment starts later).

The raw recordings of #254 and of the bounded shorter-loss trace were not kept in the repository; their summaries
above are the record. Earlier short-outage pilots are separate; an outage hidden by buffers does not add recovery
coverage.

Since the long run is judged by state repetition (proof-verification, 2026-10-19), two entries changed:
`over-hood-{express,turbo}-unmirrored-backed-different-items`. Their old 800-tick `planned-belt-slack` picks never
held 80 a period: the simulation repeats a 16-period cycle in which one period moves 96 (one extra hand), an
eternal average of 81.04. The old 45-period long run judged 30 bins that held exactly one such spike, which one
hand of tolerance absorbed; the proven cycle does not. The game agrees: the retained native baselines of #254 in
[over-hood-clock-history-controls.json](over-hood-clock-history-controls.json) run 63 periods per variant and move 96 at periods
15, 31, 47 and 63, which nothing compared before because the old test read the baseline only for "stable"
verdicts and these two were "no recovery". Fresh 64-period headless runs of the old clocks reproduce it (96 at
periods 8, 24, 40 and 56; #258, not kept in the repository), and the express run was watched in game.
The mechanism, read off those recordings: the belt input inserter picks 324 items a period against the planned
320 - after its last planned return swing its window still holds one pickup tick, which on a backed-up belt
always grabs one 4-item stack - and the carried partial hand becomes an extra full hand every 4th period, in
recipe proportion; the assembler has the spare speed to craft them, and the output inserter drops the extra
96-item hand every 16th period. Every alternative of those two variants carried the same cycle, so both pinned
an unstable selection until the belt window-end trim (`b654e895`) removed the extra pickup at its source: a
belt-fed inserter's input window now ends one rotation before its last return swing. Both variants again select
planned-belt-slack, at period 960, and #265's recordings show their baselines and recoveries exact in the game;
the old recordings stand as the in-game confirmation that the old picks fail.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/over-hood-clock-new \
  npm run test:game -- tests/game/builds/over-hood-pickup-clock.game.test.ts \
  -t '^operating clock: over-hood-turbo-unmirrored-moving-different-items$'
```

Use the generation cache and replay variables above with a fresh capture directory. Optional
`BELT_CLOCK_TRACE_PICKUPS=1` retains 64 ticks of native held/stock and machine-inventory snapshots before the first disturbance
and after each restoration; it does not feed observations into the simulator.

## Front pickup operating clocks

`front-pickup-clock.game.test.ts` enumerates 48 controls ([front-clock-fixtures.ts](front-clock-fixtures.ts)):

- **Front entrance, 32:** the [compact scaffold](../mechanics/belt-pickup/fixtures/front-underground-entrance/compact-normal-scaffold.txt)
  at four speeds, both mirroring states, moving/backed-up supply, electronic circuits from iron plate and copper
  cable and gears from iron on both lanes, at 6/s. Its assembler runs at crafting speed 50 (two legendary speed
  modules and four legendary beacons), productivity 0. Like the over-the-hood builds it keeps producing through the
  ordinary short outages on its stock, so its three disturbances last 24 periods.
- **Front exit, backed up, 8:** the electromagnetic-plant [fixture](../mechanics/belt-pickup/fixtures/front-underground-exit/README.md)
  at four speeds and both mirroring states, with the ordinary electromagnetic targets (30/s turbo to 7.5/s normal)
  and the ordinary disturbances.
- **Front exit on a moving config, 8:** the same eight builds generated with `backed_up_belts: false`. The input
  stands on the exit's output tile, so the belt is backed up in the game whatever the config says; recovery is
  assessed as for backed-up supply.

[front-clock-controls.json](front-clock-controls.json) holds the 48 native summaries, recorded on Factorio 2.1.21
from clocks generated on `5cb7c83b` (#274), each with 63 untouched baseline periods and three disturbances that cut
output; the two normal backed-up exits were recorded again on #275's clock (`6588a59b`). **All 48 meet exact baseline and
recovery output.** All 32 entrance clocks are stable and exact. All eight backed-up exit clocks are stable and exact.
At normal, in both mirroring states, every clock planned for backed-up supply fails (the fractional clock selected
before, holds false at 5.45 of 7.5/s, missed natively, 128, 128, 96 repeating against 176, the generator's own
as-built repeat); the selection is the clock planned with the belts moving and checked on the backed-up belts, which
the generator makes last, only when no other clock can be selected as stable (#275), the same clock as the
moving config's. All eight moving-config exit clocks hold and recover exactly on the backed-up exit, including
the express ones the generator calls "no recovery" and the normal ones it calls "unstable": both verdicts come
from moving lane-phase starts ([1,5] or [5,1]; [0,3]) that this exit cannot have.

The portable `front-pickup-clock.generation.test.ts` pins each selection and its exact exported clock (each entry's
`generation`), and checks it against its native summary beside it: a baseline miss under the selection's own supply needs holds false; a stable clock, or a moving-config
clock on the backed-up exit, needs an exact baseline and its last recovery periods at target. 29 of the 32
entrance clocks are byte-identical to the over-the-hood pins of the same speed, mirroring, supply and family;
the builds differ in the game, so each has its own control.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/front-clock-new \
  npm run test:game -- tests/game/builds/front-pickup-clock.game.test.ts \
  -t '^operating clock: front-exit-normal-unmirrored-backed-different-items$'
```

## Blocked output at belt stack sizes 1–4

`blocked-output-clock.game.test.ts` enumerates 16 controls ([blocked-output-clock-fixtures.ts](blocked-output-clock-fixtures.ts)):
iron gears at 5/s in a legendary assembler 3 (crafting speed 3.125, no modules or beacons), fed by a legendary stack
inserter from an infinity chest of iron plates; the output stack inserter drops onto a belt of the case's tier that
runs ten tiles to a loader into an infinity chest. The probe ([blocked-output-clock-probe.lua](blocked-output-clock-probe.lua))
sets the belt stack size with `force.belt_stack_size_bonus`, as the [belt-drop calibration](../mechanics/belt-drop/README.md)
does, and checks research unchanged; the input is chest-fed, so the stack size reaches the drop only. Its one
disturbance is the output alone: the loader is removed at period 66 and rebuilt at period 90, and recovery is judged
from period 96 to 130. The capture runner takes the scenario's own probe, intervention and hardware check
(a chest-fed input, crafting speed 3.125, every drop the case's stack size, hands of 15 at stack size 3 and 16 otherwise).

[blocked-output-clock-controls.json](blocked-output-clock-controls.json) holds the 16 native summaries, recorded on
Factorio 2.1.21 on `b9fd341b` (#277); express stack 3 again on `6367fc83`, for the shifted swings clock of 1,440 ticks it selects
now. **All 16 selected clocks are stable and meet exact baseline (63 periods) and recovery output (33 periods).** Output stops one to ten periods into the block, once the belt behind the drop is full (about 39
stacks), where the simulator holds the output inserter at once; the periods judged after the release are the same in
both ([experiments](../../../docs/belt-pickup/experiments.md#generated-clocks-and-drops)). The portable
`blocked-output-clock.generation.test.ts` pins each selection and its exported clock (each entry's `generation`) and
checks it against its native summary beside it.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/blocked-output-new \
  npm run test:game -- tests/game/builds/blocked-output-clock.game.test.ts \
  -t '^blocked output clock: blocked-output-express-stack-3$'
```

## Containers between two inserters

`container-clock.game.test.ts` enumerates 6 controls ([container-clock-fixtures.ts](container-clock-fixtures.ts)): a
cargo wagon of normal and of legendary quality (40 and 100 slots) and one with 10 slots filtered to iron plates and 30
to copper plates, making iron gears; a legendary wagon, a car and a tank whose slots are split by filters between iron
plates and copper cable, making electronic circuits. Infinity chests feed the container, one legendary stack inserter
takes from it into a legendary assembler 3 (crafting speed 3.125) and the output inserter drops into a disposal chest,
at 5 a second. The slot filters and the wagon's quality come with the blueprint; the wagon stands on rails. The probe
([container-clock-probe.lua](container-clock-probe.lua)) counts the output inserter's drops per period.

**Cuts that empty the container.** A container between two inserters is a buffer: a 2-period cut, as the belt-fed
families have, does not disturb it. So each supply cut lasts until the container's stock of the cut input is gone (its
slots and stack sizes from the game data, plus 8 periods; up to 321 periods for the legendary wagon), the output block
lasts 4 periods (the disposal chest is filled), and recovery is judged over 40 periods after each disturbance, the first
6 after the release left out. Do not compare these recordings period for period with the 2-period families.

[container-clock-controls.json](container-clock-controls.json) holds the 6 native summaries, recorded on Factorio 2.1.21
at commit `000ad913`. **All 6 selected clocks are stable, meet exact baseline output (63 periods), drop to 0 in every
disturbance and are exact in all 33 judged periods after each.** `container-clock.generation.test.ts` pins each
selection and its exported clock and checks it against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/container-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/container-clock.game.test.ts -t '^container clock: container-car-mixed$'
```

## A rocket silo between two machines and six

`lithium-silo-clock.game.test.ts` enumerates 4 controls ([lithium-silo-clock-fixtures.ts](lithium-silo-clock-fixtures.ts))
on the lithium plate build (`REAL_OWNER_LITHIUM_SILO`, its README in the sample's folder): two cryogenic plants put
lithium into a rocket silo, six furnaces take it out, 80 plates a second. The selected clock (3 output swings, 1080
ticks) is recorded as built and with the two inserters that fill the silo built after the six that empty it; the clock
with 1 output swing is a second check, and the clock with 7 output swings (7560 ticks) is the known limit below. The
probe ([lithium-silo-clock-probe.lua](lithium-silo-clock-probe.lua)) counts the drops of the six output inserters per
period. The protocol is the standard one: the holmium plates cut for 2 periods, the output blocked for 4, the holmium plates
cut again. The silo holds at most 250 lithium, so each cut empties it. The warm-up of 3600 ticks without a clock fills the
silo before the clock starts, though the config exports it empty.

[lithium-silo-clock-controls.json](lithium-silo-clock-controls.json) holds the 4 native summaries, recorded on Factorio
2.1.21 at commit `759e9a50`. **The selected clock, in both build orders, and the clock with 1 output swing meet exact
baseline output (63 periods), drop to 0 in every disturbance and are exact in every judged period after each; the two
build orders are equal in every period.** The clock with 7 output swings is stable in the simulator and short in the game,
9,440 to 9,600 of 10,080 in every period: the output inserters of two furnaces drop onto underground entrances whose exits
side-load onto the shared output belt, which the config describes as one belt with room for every drop
([scope](../../../docs/game-data-and-scope.md)). `lithium-silo-clock.generation.test.ts` pins each clock and checks it
against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/lithium-silo-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/lithium-silo-clock.game.test.ts -t '^lithium silo clock: lithium-silo-swings-3$'
```

## A car between a mining drill and two furnaces

`car-clock.game.test.ts` enumerates 3 controls ([car-clock-fixtures.ts](car-clock-fixtures.ts)) on the iron plate
build (`REAL_OWNER_CAR`, its README in the sample's folder): a big mining drill drops iron ore into a car, two furnaces take
it out, 80 plates a second. The harness puts the ore under the drill. The selected clock (3 output swings, 72 ticks) is
recorded as built and with the two inserters that take from the car built after the output inserters; the clock with 1
output swing is a second check. Each clock enables the drill one tick a period, the tick before the two inserters that take
from the car; the harness wires it with its resource reading off. The probe ([car-clock-probe.lua](car-clock-probe.lua)) counts the drops of the two output
inserters per period. The car holds 4,000 ore, so the cuts are those of the container family: the drill is stopped
(disabled by script) until the car has run dry (71 periods), the output blocked for 4, the drill stopped again, each
followed for 40 periods, the first 6 after a release not judged. A drill is no supply that stops in the generator's
checks; here it is stopped as the supply cut. Do not compare these recordings period for period with the 2-period
families.

[car-clock-controls.json](car-clock-controls.json) holds the 3 native summaries, recorded on Factorio 2.1.21 at commit
`1571a1be`. **All 3 meet exact baseline output (63 periods), drop in every disturbance (to 0 with the drill stopped) and are
exact in all 33 judged periods after each; the two build orders are equal in every period.**
`car-clock.generation.test.ts` pins each clock and checks it against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/car-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/car-clock.game.test.ts -t '^car clock: car-swings-3$'
```

## A cargo wagon as the hub of a steel build

`steel-wagon-clock.game.test.ts` enumerates 3 controls ([steel-wagon-clock-fixtures.ts](steel-wagon-clock-fixtures.ts)) on
the steel build (`STEEL_CARGO_WAGON`, its README in the sample's folder): one cargo wagon is a hub that a big
mining drill fills with iron ore, a furnace takes the ore from and puts plates back into, a second takes the plates from
and puts steel back into, and one inserter empties of steel onto the output belt, 26 steel a second. The harness puts the
ore under the drill and builds the wagon after its rails. The selected clock (planned with belt slack, a subtick clock of
11,520 ticks for 13 periods) is recorded as built and with the two inserters that put into the wagon built after every
other entity; the clock the config makes with iron ore out of its period (`ignored_lcm_ingredients`) is a second check,
recorded as its subtick clock (3,840 ticks for 13 periods): the capture exports an alternative's subtick clock where it has one, so the clock rounded to 295
ticks is not recorded. Each clock enables the drill a window of two positions a period, 1.08 ticks on average, before
the inserter that takes the ore; the harness wires it with its resource reading off. The probe ([steel-wagon-clock-probe.lua](steel-wagon-clock-probe.lua)) counts the drops of the
inserter from the wagon to the belt per period, and also keeps the wagon's contents at each period's start and each
furnace's ticks with a full output. The wagon holds 1,000 ore, 500 plates and 500 steel, so the cuts are those of the
container family: the drill is stopped (disabled by script) until the wagon has run dry of steel (9 and 10 periods), the
output blocked for 4, the drill stopped again, each followed for 40 periods, the first 6 after a release not judged. A
drill is no supply that stops in the generator's checks; here it is stopped as the supply cut. Do not compare these
recordings period for period with the 2-period families.

[steel-wagon-clock-controls.json](steel-wagon-clock-controls.json) holds the 3 native summaries, recorded on Factorio
2.1.21 at commit `1571a1be`. **All 3 meet exact baseline output (63 periods), drop in every disturbance (to 0 with the
drill stopped) and are exact in all 33 judged periods after each; the two build orders are equal in every period.** A
full plate or steel filter stops a furnace a few ticks a period in some states, with no steel lost (the sample's README).
`steel-wagon-clock.generation.test.ts` pins each clock and checks it against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/steel-wagon-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/steel-wagon-clock.game.test.ts -t '^steel wagon clock: steel-wagon-belt-slack$'
```

## A clock the build came with: the inserter build on three copies

`own-clock.game.test.ts` records the inserter build (`LOGISTIC_SCIENCE_INSERTER_CRAFTING`, 240 a second over three
copies of 80, [own-clock-three-copies-scaffold.txt](own-clock-three-copies-scaffold.txt)) twice, with the protocol of the
families above: 63 untouched periods, the ore cut at periods 66-68, the output blocked at 84-88, the circuits cut at
104-106, the first 6 periods after a release not judged. The three copies stand in a row; the ore lines run on past the last
copy into loaders and void chests (drained and moving); the copies are not alike (the first two have a gear assembler at
44.92, the first a fourth furnace at 91.875), and the config is the third.

- `own-clock-three-copies`: the hand-made clock, kept. It is one clock for the three copies: a counter of the clock signal
  that counts 0 to 215 (a period of 216 ticks), an iron plate window on ticks 1-33 and 109-138 for the 12 ore and 12 plate
  inserters, an iron gear wheel window on ticks 1-65 and 109-173 for the 3 gear inserters; the circuit and output inserters
  are not wired. The test names the clock to the harness (`built_clock`: the counter's entity number in the blueprint, its
  period and the value it starts at), and the harness records it as it records a generated one, cut at its wraps. The
  recorder schema reads a clock that counts from 0 only when the recording names its period (the harness writes it), and then
  checks every sample against the clock's count, so a missing signal is still refused.
- `generated-three-copies`: the same blueprint with the hand-made clock's three combinators taken out and the generator's selected clock
  for the config (`swings-2`, 72 ticks, 2 output swings) wired to the inserters of each copy. The test says the build holds 3
  copies (`copies: 3`; without it a build is one copy and a machine beyond the config is refused), and the harness finds them
  from the build's machines and inserters (machines that inserters move items between are one copy; belts, which the copies
  share, do not join them) and matches each to the config by itself. The inserters the hand-made clock held run free while
  the build warms up, as an unclocked build's do, so the furnaces have their recipes when the build is matched.

[own-clock-controls.json](own-clock-controls.json) holds the 2 native summaries, recorded on Factorio 2.1.21 at commit
`e1c0aadb`. **The hand-made clock gives 864 (288 a copy) in each of 63 periods, as a separate probe measured it, and the
same recoveries: the ore cut 528, 0, 96 then 864 from the first judged period; the output block 80, 0, 0, 232,
808 then 864; the circuit cut 184, 0, 356 then 864. The generated clock gives 288 in each of 63 periods of 72 ticks and is
back at 288 in every judged period after the ore cut and the block, and after the circuit cut in all but the first judged
period (284).** The cuts are in periods of each clock, so they last 432 ticks for the hand-made clock and 144 for the
generated one: do not compare the two recoveries tick for tick. Both builds are the three copies on drained lines,
not the one-copy scaffold of `scaffold-recordings.game.test.ts`. A drop in the first tick of a recording is not seen by it, so
the compact count of its first period is checked less that drop (the probe counts it).
`src/crafting/own-clock.generation.test.ts` pins the generated clock and checks it against its native summary. The hand-made
clock is tied to its recording by the hash of the clock in the blueprint (`recorded.clock_basis` `built`), and the generated
one by its pin, as in the other families.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/own-clock-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/own-clock.game.test.ts
```

## The grenade build

`grenade-clock.game.test.ts` records the grenade build (`REAL_OWNER_GRENADE`, 240 a second over 7 copies, the sample's
README) four times: on one copy (`grenade-hand-clock-scaffold.txt`: the scaffold with the hand-made clock) and on the full build
of seven (`grenade-full-build.txt`), each with the hand-made clock, kept (`built_clock`), and with the generator's selected clock
(`planned-belt-slack`, 112 ticks), wired to the inserters and drills of every copy (`copies`) with the hand-made clock's deciders taken
out. The protocol is the family's with three losses the build has: the foundries stopped for 2 periods, the output loader taken
away for 30 periods and rebuilt (a copy's belt takes 6 periods of grenades before it is full, so the family's 4 would change
nothing), and the drills stopped for 2. The probe counts the drops of the output inserters per period and per inserter and the
ticks each waits for room on the belt.

[grenade-clock-controls.json](grenade-clock-controls.json) holds the 4 native summaries; `src/crafting/grenade-clock.generation.test.ts`
pins the generated clock and checks the hand-made clock in the simulator. All four hold their target in every baseline period
(64 on a copy, 448 on seven) with no wait for the belt, and get back after every loss.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/grenade-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/grenade-clock.game.test.ts
```

## Thaeln's cell 09

`thaeln-cell09-clock.game.test.ts` records the generator's selected clock for `REAL_THAELN_CELL09` (480 utility science packs a second
over 3.5 copies; the scaffold is one copy, 137.14 a second, 384 packs in a period of 168 ticks) on the sample's scaffold. The clock is
`planned-belt-slack`: the windows of `src/crafting/candidates/grouped-hands.ts` (hands rounded up where they are fractional, the
order of the chain of machines), made without a search. The harness wires it to the inserters of the cell. The protocol is the
family's with the losses the cell has: 63 whole periods, then the coal cut for 6 periods (the cell holds about two periods of it),
the two output loaders taken away for 4 periods and rebuilt, and the processing units cut for 2. The probe counts the drops of the
eight output inserters per period.

[thaeln-cell09-clock-controls.json](thaeln-cell09-clock-controls.json) holds the native summary and the pin of the clock
(`src/crafting/thaeln-cell09.generation.test.ts` checks the pin): 384 in all 63 baseline periods, and 384 again after each loss.

Thaeln's own clock for the build, given on 2026-10-23, was recorded on the same scaffold while the rule was written (it is a
blueprint of five combinators with no wires to inserters, so the harness wired it): a counter of 0 to 335 (336 ticks, two cycles) and four
window combinators, each outputting the signal of the item the inserters it switches move (utility science pack for the 8 output
inserters, processing unit for the 8 that take units and frames off the belts, low density structure for the 8 between foundries
and machines, plastic bar for the 4 between the cryogenic plant and the foundries). **The coal inserter has no signal and is not
on the clock: it runs all the time.** It makes 768 packs in every one of 107 periods and gets back from a cut of the coal, the output
and the units (184.8 wake-ups a minute by the series' method, 211.8 in the simulator). It is evidence and a benchmark for the rule, not
a control of this family.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/thaeln-cell09-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/thaeln-cell09-clock.game.test.ts
```

## The productivity module chain

`productivity-chain-clock.game.test.ts` records the generator's selected clock for `REAL_OWNER_PRODUCTIVITY_CHAIN` (80 productivity
modules a second over 6 copies; the scaffold is one copy, 13.33 a second, 16 modules in a period of 72 ticks) on the sample's scaffold.
The clock is `planned-belt-slack`: the windows of `src/crafting/candidates/grouped-hands.ts` (hands rounded up where they are fractional,
the order of the chain of machines), made without a search. The harness wires it to the 14 inserters of the build. The protocol is the
family's with the losses the build has, each long enough to be felt, since the build holds stock: 63 whole periods, then the coal
cut for 40 periods (the inserter that puts the coal on the belt is switched off and the belt emptied; the output first falls short
about 33 periods in), the output loader taken away for 24 (the output belt takes about 11 periods of modules before it is full) and
rebuilt, and the two foundries casting iron stopped for 26 (the output falls short after about 13). The probe counts the drops of
the output inserter per period.

[productivity-chain-clock-controls.json](productivity-chain-clock-controls.json) holds the native summary and the pin of the clock
(`src/crafting/productivity-chain.generation.test.ts` checks the pin): 16 in all 63 baseline periods, and 16 again after each loss.
Recorded for 36,000 ticks after the warm-up and settle with `scripts/record-clock.js`, the same clock made 16 in all 499 periods,
with 602.8 wake-ups a minute against the simulator's 575.6, and the simulator laid against the game entity by entity had no issues;
the clock made for "Backed-up belts" did the same. The clock before the rule ranked its placements (staged, the first that held)
had 858.5 in the game and 843.8 in the simulator.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/productivity-chain-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/productivity-chain-clock.game.test.ts
```
