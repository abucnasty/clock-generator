# Generated clocks in the game

These tests check throughput, startup and/or recovery of generated clocks. They use general samples from
`resources/config-samples/` or the isolated pickup fixtures, without moving a general sample merely because a test
uses it. Setup, selective execution and artifact retention are in the [game verification guide](../README.md).

- `scaffold-recordings.game.test.ts`: the catalog of complete sample builds, including wakeup/recording comparisons. A build of
  several copies (`copies`) is judged in every window cycle checked over the whole build, over each row of output inserters and over each
  copy by itself, the copies found as the harness finds them to wire the clock. See "Builds of several copies" below for what such a
  case needs.
- `moving-pickup.game.test.ts`: different-item pickup geometry, moving/backed-up supply and recovery.
- `same-item-pickup-clock.game.test.ts`: same-item lane fallback, throughput and recovery.
- `over-hood-pickup-clock.game.test.ts`, `front-pickup-clock.game.test.ts`: the over-the-hood exit and the front
  underground entrance and exit, throughput and recovery.
- `blocked-output-clock.game.test.ts`: a chest-fed machine whose output belt is blocked, at belt stack sizes 1–4.
- `container-clock.game.test.ts`: a car, a tank or a cargo wagon between its supplies and a machine, with cuts that last until the container is empty.
- `lithium-plate-80-silo-chest-clock.game.test.ts`: the lithium plate build, a rocket silo taken as a chest between two cryogenic plants and six furnaces.
- `iron-plate-80-car-chest-clock.game.test.ts`: the iron plate build, a car taken as a chest between a big mining drill and two furnaces.
- `steel-plate-26-wagon-chest-clock.game.test.ts`: the steel build, a cargo wagon taken as a chest that a big mining drill and two furnaces fill and empty, the steel leaving through it.
- `inserter-crafting-240-shared-signal-clock.game.test.ts`: the inserter build on three copies, once with the hand-made clock and once with the generated clock, and the sample's scaffold of one copy under the generator's Round-Robin Polling clock with 6 output swings for the config with backpressure on its belts (a dead end on each lane; `round_robin_polling_swings_6`, 72 ticks), with the ore and the circuits cut and the output blocked (#442).
- `logistic-science-240-direct-insert-clock.game.test.ts`: the logistic science build with direct insertion, the sample's scaffold of one copy, under the generated clock for the config as it is (fractional swings, 96 ticks), with the inserters cut from the belts and the output blocked (#442). The scaffold's inserter belts end closed, so in the game their lanes have backpressure. The config states those lanes as dead ends, so the clock is made for belts with backpressure.
- `grenade-clock.game.test.ts`: the grenade build on one copy and on its full build of seven, each with the hand-made clock and with the generated clock.
- `processing-unit-80-circuit-export-clock.game.test.ts`: the circuit export build (processing units from two circuit machines and two advanced circuit machines, an export belt) on its throttled scaffold with the generated clock, as it is and with the belts backed up.
- `utility-science-480-lds-foundry-chain-clock.game.test.ts`: the utility science 480 build (a chain of machines with a coal inserter that moves 15/8 hands a cycle) with the generated clock.
- `productivity-module-80-chest-chain-clock.game.test.ts`: the productivity module chain (nine machines and three chests, 80 a second over 6 copies) with the generated clock.
- `electromagnetic-science-240-recycler-belt-fed-clock.game.test.ts`: the whole 211-entity blueprint of #100, both cells, under the clock the generator selects for the sample's automatic config (240/s over five copies): 3,600 window cycles at 96 science/s, nine losses with recovery, and two cold starts, with the science of each plant and its buffer closed at every window cycle.
- `iron-ore-voider-400-clock.game.test.ts`: the ore voider's recycler build, at exact speed and overbeaconed, 400 iron ore a second destroyed, an hour on the generated clock: what comes back is random, so the hour's mean is judged against the binomial's range, with the car never full, the target back after the ore is cut and after a backlog in the car, and the recycler's input watched while a stack of its result waits.
- `electromagnetic-science-330-drained-end-clock.game.test.ts`: the electromagnetic science build (330 a second over 11 copies) on abucnasty's drained-end scaffold of one plant (`electromagnetic-science-330-drained-end.scaffold`, #458): the input line of accumulators and supercapacitors runs past the plant into a loader and a void chest, so it moves. The generated clock for the config as it is (Takt Batches with 3 output swings, 2,112 ticks, made for the dead-ended lanes the config states), steady state and a baseline, with no disturbance.

From `clock-generator/`, select a file or case:

```bash
npm run test:game -- tests/game/builds/scaffold-recordings.game.test.ts -t 'automation science'
npm run test:game -- tests/game/builds/moving-pickup.game.test.ts -t 'straight-belt holds'
```

The original turbo moving/different-item matrix has 12 cases; the original same-item clock matrix has six. Their recovery trials run many
window cycles and are deliberately separate from the short mechanic probes. Do not run them for prose or a probe-only
refactor that does not change clock behavior. `npm run test:game:watch` currently watches the scaffold-recordings
suite; it is not a generic visual mode for every mechanic test.

## Builds of several copies

A build that holds the config more than once names the copies it holds (`copies`). The harness finds them by their inserters: the
machines that inserters move items between are one group, and belts, which the copies share, join none. A group with a machine
for every machine of the config is a full copy; the count has to be the one named, and the generated clock is wired to the
inserters of each copy. A machine of the config's recipes in no copy is refused.

`copies` may have a fraction, the fraction the config's own `copies` has (5.5 for a config of 5.5): that many full copies and
one partial copy. The partial copy is the one the generator lays out on the lanes the copies share (`partCopiesOf`): on each shared
lane the takers furthest upstream, the fraction of the copy's takers there rounded up, with the machines they feed, the inserters
that feed those machines and the inserters that take their results. A group of the build with every machine and inserter of it
and no machine more is the partial copy; the clock is wired to its inserters as to the same inserters of a full copy. The partial
copy is held to its share of a copy's output, the generator's rule for a partial copy's machine (a machine is held to its whole
target times the share of the inserters that take from it that the partial copy holds) counted over the final machines; the
harness counts each such inserter as one, where the generator weighs it by what it moves, the same where a final machine has
one output inserter. Refused: a group that is neither a full copy nor the partial copy (the message lists the groups), two partial
copies, another fraction than the config's, and a partial copy where the count is a whole number (its machines are beyond the
config). The harness takes what the build is: a partial copy's machines may differ from a full copy's (other beacons, another
crafting speed) and are judged by what they make.

Each copy is judged by itself: in the scaffold recordings, what its output inserters move in every window cycle checked against
its target (the partial copy against its share); in the families with a protocol (`pickup-clock-capture.ts`), each copy's final
machines over the baseline's whole clock cycles. The simulator's entity-by-entity comparison and the wake-ups are of one copy and
are not made for a build of copies.

### The chemical science build of #725

`chemical-science-240-shared-foundry-full-build.blueprint` is abucnasty's whole chemical science build as he gave it (#725, 869
entities, the clock it came with in it): both mirrored sides, 22 science and 22 engine machines and 6 pipe foundries on the centre
line 18 tiles apart, so 5 whole blocks of `CHEMICAL_SCIENCE_240_SHARED_FOUNDRY` and a half block at the east end, and two foundries at
the west end that cast the gears and the steel of both engine lines. Every input line ends in an underground entrance with nothing
beyond. The sample is one block, one copy at 480/11 a second; the two cases state the whole build's own setpoint (240 a second from 5.5 copies, 18 tiles apart) over it, and its partial copy is the half block (machines 1, 3, 5, 7 and 9), held to
half a block's packs. The half block's pipe foundry has 5 beacons where the others have 8 (199.75 against 236.78, computed from the
blueprint), and engine line 3 holds gears on the lane taken first where the config states steel (not confirmed); neither is in
the config. Two cases in the scaffold recordings, each recorded twice on 2026-11-11 at Factorio 2.1.24:

- **The generated clock** (Coordinated Sources, 1 output swing, 352 ticks): every full copy moved 256 packs and the partial copy 128
  in each of the window cycles checked, 704 in each row and 1,408 over the build.
- **The clock it came with** (made by the generator of 0.28.1 for one side of the build): it opens the advanced circuit takers of
  every copy of a side together, and the dead-ended circuit lane refills too late for the third science machine of each side from
  the west (#725). That machine moved 464 of 704 over the recording, and its copy, the second, 224, 192 and 224 of its 256 in turn;
  every other copy, and the partial copy, made its target. The case expects that copy short and no other: it shows that the check of
  each copy sees a copy the others starve, where the build's total (1,376 or 1,344 of 1,408) only says the build is short.

## How a clock run is timed

A clock run is timed in game minutes and never in window cycles; the rule, in full, is in the [game verification
guide](../README.md#how-a-run-is-timed) and is coded once, in `helpers/lua/steady.lua`. For the clock families here:

- **Steady state:** the first moment the machines that make the target item have made the target amount (the setpoint times
  60 seconds) over the last minute. The run waits for it up to ten minutes.
- **Baseline:** one minute (3,600 ticks) after it, judged by the rate between returns to the target: the clock holds when the last
  minute never falls below the target amount, or, where the output comes in bursts and does, when the products from steady state to
  the last return to the target make at least the setpoint over those ticks. A family may ask for a longer baseline with a
  stated reason, never over ten minutes (36,000 ticks).
- **Disturbances:** the ingredient cuts and the output block follow, each until the output falls below the baseline's lowest
  minute, then released; the clock has to be back at steady state within ten minutes of each release.
- **Turbo only:** the clock families run the turbo belt tier. Their controls files keep each run's summary: the tick of steady
  state, the baseline's total against the target, and each disturbance's start, release and recovery.
- **Mechanics probes** (`../mechanics/`) are recorded again only when the game binary changes.

The sections below that count window cycles (60 untouched window cycles, cuts at window cycles 66-68, 63 baseline window cycles, 33 judged recovery window cycles)
record how a family was measured when it was recorded in window cycles. The controls files of the families already moved to this rule
(pickup, front, over the hood, blocked output) carry the new summary; the rest keep the window cycle counts until they are moved.

## Pickup speed backfill

The paragraphs of this section describe the original backfill (#245), which counted window cycles; its summaries are history.

The `speed coverage:` runner covers all four belt speeds, all three ordinary pickup geometries, both
moving/backed-up supplies and the electromagnetic/gear families: 48 configurations. Its original backfill
covered 39 of these; turbo is now included in the same uninterrupted capture procedure as the slower tiers.
Electromagnetic targets scale with speed: 30/s turbo, 22.5/s express, 15/s fast and 7.5/s normal; gear remains 6/s.
The original pickup and machine positions stay fixed. Slower underground runs are split where needed
to remain within native connection range; backed-up variants remove only the ingredient drain.

Each new case measures one continuous clock run. After ten settling window cycles, at least 60 untouched
window cycles precede the ingredient/output disturbances. Ingredient cuts are at window cycles 66–68 and 104–106;
output disposal is blocked at 84–88. Machine inventories and clock state remain untouched. Recovery is
assessed after six additional window cycles for moving supply and ten for backed-up supply.
Each disturbance must reduce output below the lowest baseline window cycle before its recovery is assessed.

Long default clocks can exceed the recorder's 72,000 detailed-tick limit even for 60 window cycles. The shared
Lua probe therefore aggregates actual output-inserter held-count decreases at native clock wraps during
settling, retaining complete-window-cycle counts through all interventions. The recorder then captures only
two detailed window cycles, which must match overlapping compact aggregates exactly. This preserves the limit
and avoids resetting the build or retaining millions of redundant samples.

The original backfill's native window cycle summaries (#245) are kept in
[pickup-clock-history-controls.json](pickup-clock-history-controls.json), separately from the generator's verdict. A measured throughput/recovery counterexample is not a claim that the recommended clock is safe.
Express moving half-tile generation already reports `no recovery`; the backfill preserves that verdict.
Unsupported sources are not overridden to generate clocks.

The backfill retained 39 native runs, each with 63 baseline window cycles and three recovery windows.
All 21 gear clocks meet their 16-item target in every baseline/recovery window cycle. Eight of the 18
lower-speed electromagnetic clocks meet both; ten preserve counterexamples. Two of those already
receive the generator verdict `no recovery` (express moving half-tile pickups). Eight receive `stable`
but miss native baseline or recovery window cycles. Exact counts are in the committed summaries; the
[experiment report](../../../docs/belt-pickup/experiments.md) compares the scenarios.

These are complete-clock observations. Finite input refill, clock/input phase, machine wake timing,
and occupied output-belt history remain possible contributors; this capture does not isolate a cause.
In particular, normal moving half-tile clocks meet their baseline target but alternate after the
**output blockage** at window cycle 84, while both ingredient-cut recoveries meet target.

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

Native runs also capture recommended clocks whose simulated rate is below the requested rate. Keep those
shortfalls explicit: collecting their output does not certify the clock. Check the selected clock's
required supply as well as its verdict; a backed-up fallback selected for moving input is a different
operating condition. Cache entries keep underground entrances and exits separate because their layout can
affect arm travel.

`BELT_CLOCK_EXPECTATIONS` selects other summaries when verifying a later simulator revision: a family's controls
file, or a history file and the PR of the recording, `<file>#<pr>` ([clock-controls.ts](clock-controls.ts)). The
history files keep the superseded recordings as experiment evidence; do not overwrite their observations with new clock
results. Always pair a replay with the summaries of the same retained run: the committed summaries are the durable
record, and a replay needs captures made locally.

## Post-fix ordinary clock verification

The current default expectations are [pickup-clock-controls.json](pickup-clock-controls.json): 12 entries, all on the
turbo tier (the electromagnetic and same-item side pickup fixtures at a straight belt, an underground entrance and an
underground exit, each with moving supply and with backpressure), recorded on Factorio 2.1.24 under the protocol in game
ticks. Each entry names the frozen head its clock was generated on. The other three tiers left the controls when the
game tests kept only the turbo tier (2026-11-03). The recordings that later recordings replaced stay in
[pickup-clock-history-controls.json](pickup-clock-history-controls.json) as the historical evidence of the clocks they
recorded.

Six turbo entries were recorded again on 2026-11-11 in Factorio 2.1.24 (frozen head `bb1598e8`), on the clocks the
selection makes for them now. The three `-backed` electromagnetic entries run `takt_batches_swings_1` (352 ticks,
`c9c84d5975c4`) in place of `takt_batches_observed` at 1056 ticks (`0d084222cf32`). The three moving same-item entries
run `takt_batches_observed` (160 ticks, `67586738fd72`) in place of `takt_batches` (`4f119c4e514f`), which the generator
no longer makes. All six hold their target and have recovery after each of the three disturbances.

| Result | Cases | Interpretation |
| --- | --- | --- |
| Stable, exact baseline and recovery | 12 | The recorded clock works under its configured supply: the game holds the target over the baseline and after each of the three disturbances, the output stock guard holds, and the generator calls the clock stable. The cold-start controls below check the simulator against the measured starts with fixed windows |

No failing captured ordinary default is marked stable for its actual supply. These checks do not close broader
startup timing or over-the-hood operating clocks.

[lane-phase-controls.json](lane-phase-controls.json) holds one pin: the bounded turbo trace of the over-the-hood
mixed-item case (`over_hood_turbo_trace`, below).

The record (`pickup-*` jobs, checked against these controls by `clock-controls.test.ts`) holds the selected window cycle times, verdicts and supply, and the per-job checks (`job-checks/fixtures.ts`) set them against
these native controls for the three fixtures of `belt-pickup-clock-cases.ts` (`BELT_PICKUP_GENERATED`), each the only one
to take its path through the generator. `belt-pickup-clock-mechanics.test.ts` checks the other 9 of the 12 without
generating: the recorded controls against the fixture configs, and the simulator's first hands against the game's. A build whose steady-state recording holds while the generator finds a failing cold lane phase has
to fail at the pinned phase (the pin's `as_built`; none of the 12 pins has one now). The loss trials run from the cold start
alone, so a "no recovery" verdict is not set against a lane phase. A measured shortfall on any build still fails, and where a clock was recorded under
its own supply, a baseline miss has to make the generator's own holds verdict false. Fresh generation also
saves the selected rate, required supply and clock id in `generation-selection.json` when that metadata
is available in its cache.

To replay against the original 39 controls, set
`BELT_CLOCK_EXPECTATIONS=tests/game/builds/pickup-clock-history-controls.json#245` with a recording directory of
those clocks made locally; the original recordings were not kept. Current captures use pickup-clock-controls.json by
default. Always retain failed captures for diagnosis;
the passing measurement test alone does not certify a clock that a control records below target.


### Fully backed-up cold starts

[pickup-clock-start-controls.json](pickup-clock-start-controls.json) (`backed_up_start`, #253) records the normal underground
entrance/exit with new empty machines/hands and verified stationary `[0,64]` stock on both half-tile lanes.
At offset 0, all 16 window cycles produce 176 items. Rotating the same windows by 1287 ticks makes both game and
simulator alternate 144/208 for all 16 window cycles. The mean is 176, but exact per-window-cycle output fails. The
windows are the old swings-1 selection, kept as fixed-window checks of the simulator against the game's
measured cold starts: both tests build them as given, independent of the selection, which since the window
trim is fractional for these two builds and is judged on its own recording like any other default.

The staged harness's default saturation check establishes fullness, which can still occur while stock moves.
These fixtures wait for 1,200 saturation ticks and additionally assert stationary stock before the first grab;
that wait is a fixture setup, not a general timing rule. Earlier short-saturation pilots are not used as evidence
for a fully backed-up start. Counts begin at cold placement and include the first window cycle; no observed arm arrivals
or later stock are fed back into the simulator.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/belt-clock-startup-new \
  npm run test:game -- tests/game/builds/pickup-clock-startup.game.test.ts
```

### Clocked cold starts

[pickup-clock-start-controls.json](pickup-clock-start-controls.json) (`cold_start`) records 57 clocked cold starts in
Factorio 2.1.21 (#273, 2026-10-20, frozen head `98f362ce`), each 16 window cycles from the harness's staged start, with nothing written to a
belt: the game's own lane phase at placement, read off the pickup tile. The four normal backed-up side underground runs (entrance and
exit, near lanes 1 and 2) were recorded again on the clock #456 selects for them (#479, frozen head `99fb9812`: swings-1,
every belt-fed window as long as a hand takes from the lanes at rest); the game follows the simulator tick for tick from
placement on it, as it did on the two clocks before (the subtick clock, then the one planned with the belts moving).
The six turbo `-backed` side runs started at the window cycle's beginning (straight belt, underground entrance and exit,
near lanes 1 and 2) were recorded again on 2026-11-11 in Factorio 2.1.24 (frozen head `bb1598e8`) on the clock the
selection makes for them now (`takt_batches_swings_1`, 352 ticks, `c9c84d5975c4`), in place of `0d084222cf32`; the
simulator follows the game tick for tick on it from placement.

- **The matrix, 48:** every electromagnetic side pickup fixture at 4 tiers × straight belt, underground entrance and
  exit × moving and backed-up supply, on the generator's recommended clock, at near lane 1 and at near lane 2. Near lane 2
  is the build reflected (`reflectOrdinaryPickup`) with its machine mirrored as well, without which its fluid inputs miss
  the reflected pipes and nothing is made; the config names lane 2 near and keeps the near lane's item.
- **The deciding cases, 9,** of the rule that a clock's first two ticks are dark: the express entrance started 30 ticks
  into an input window, the backed turbo entrance 10 ticks in, and two over-the-hood clocks 123 and 174 ticks in, near
  lane 1 and 2 (the windows rotated, `rotate`); the express entrance with the clock's deciders built in the mirror order
  (`decider_order`), with the inserters built in reverse (`build_order`), and moved (`position`); and the two over-hood
  clocks unrotated.

Each run keeps its clock (windows, window cycle time, terminal swings and the hash of the exported clock), the lane phases at
placement and in the model's frame (native - 4 × the tier's speed), and what the game's output and input inserters
moved in each window cycle and held in each tick of the model's frame (model `held[i]` = sample `i + 4`), as sha256.
`pickup-clock-cold-start.game.test.ts` records them again: the same clock, a build at a cold start, the clock a tick behind the
probe, every window cycle on the placement lattice, and both series as kept. Its probe
(`pickup-clock-cold-start-probe.lua`) only observes. The raw runs, the scratch fixture they came from and their
analyses were not kept in the repository.

`pickup-clock-cold-start-mechanics.test.ts` runs the simulator from each cold start and holds both clocked inserters'
counts in every tick and their items in every window cycle: 57 of 57, the input of one held only by its output (a hand back
from its swing as the output block is lifted, a tick early in the simulator, once). On the engine before the clock's
start rule the 11 runs where a window the latency carries over the window cycle's end reaches ticks 0-1 fail, and the
other 46 pass.

The same test builds each run's clock from its stored windows and requires the hash the run was recorded on (the four
fractional-clock runs of the fast tier cannot be rebuilt from windows, and the test says so). `clock-controls.test.ts` checks the clock of each run started at the window cycle's
beginning (a side pickup fixture on near lane 1, and the over-the-hood run) against the record's recommended clock of its fixture, with no generation.

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
`clock-controls.test.ts` against the record's clock of the same id, for a build that is a job of the record (`clock-generator/record/`), or the family's `*.generation.test.ts` (ready pull requests) for one that is not.

- `clock-controls.test.ts` runs with the unit tests and reads the files only: it fails where the pin and the recording
  name different clocks, which is what editing a pin to follow a moved selection leaves behind: record the entry
  again in the game and set `recorded.clock_sha256` (a pin that moves is recorded again; nothing is carried over).
  It also checks every generation pin against the record (`clock-generator/record/`, one file per blast job): the pin is the
  clock hash, window cycle time, verdict, holds, rate and supply of the record job's clock with the pin's id, and the game's run agrees
  with that clock's verdict. A pin of a build that is a sample with an option set (belts backed up, an ingredient left out of the
  window cycle time) is of a job of the variants group (`variant-jobs.ts`), which lists the recording or test that qualifies each.
- A game test checks the hash of the clock it generated against the recorded one before it starts Factorio
  (`pickup-clock-capture.ts`; `BELT_CLOCK_CALIBRATE=1` skips the check to record a new summary).
- The cold starts (`pickup-clock-start-controls.json`, `cold_start`) keep the same pair per clock:
  `clock_sha256` (checked by `pickup-clock-cold-start-mechanics.test.ts` against the clock the stored windows build and the fixture's
  pin, and for the runs started at the window cycle's beginning by `clock-controls.test.ts` against the record's selection)
  and `recorded_clock_sha256` (checked by the game test).
- Nine scaffold-recordings builds expect values that belong to one clock (agricultural science having the dips of its five copies
  after its staged start and no difference, agricultural science with backpressure on the belts the same (it is recorded from the
  staged start too), what each of the
  nine copies of automation science moves, the moved inserters of chemical science with a shared foundry, what each of
  the 11 copies of electromagnetic science moves, what each row of military science with grenades moves, what the one copy of
  production science with a drill into the rail assembler moves, what each of the two copies of utility science with
  processing units and low density structures on one belt moves, and the output of iron bacteria cultivation):
  `scaffold-recordings-clock-pins.json`.
- The agricultural science scaffold's control on the 2-swing clock keeps one line: inserter 11 moves 371.33 a window cycle in the
  game and 370.16 in the simulator. Since #333 the simulator runs a clock of whole ticks by its own window cycle time (960 ticks for
  this one, where the plan has 480), so the run the test compares is twice as long, and its two one-hand dips fall before
  the compared part (#364, #401). The backed-up case needs no allowance.

## Over-the-hood operating clocks

`over-hood-pickup-clock.game.test.ts` enumerates 32 controls: electronic circuits with different lane
ingredients and gears with identical lane ingredients, at four speeds, both mirroring states, and
moving/backed-up supply. Every variant uses the same compact assembler layout and 6/s target. Backed-up
variants remove only the ingredient drain; the product's infinite end stays open until the output intervention.
Sidecar must capture supported belt model 2, the over-the-hood layout and the correct preferred lane.

[over-hood-clock-history-controls.json](over-hood-clock-history-controls.json) retains all 32 native summaries of #254,
using clocks generated on engine `4f2d4e35` and Factorio 2.1.21. Twenty-one pass exact baseline and recovery output,
including all 16 same-item cases. Eight already receive unstable/no-recovery verdicts. Three are marked stable
but fail recovery: turbo moving in both mirroring states, and express moving when mirrored. Each capture has
63 untouched baseline window cycles and overlapping detailed-recorder checks. These controls are historical evidence;
changed recommended clocks need fresh game verification rather than replacement of the old counts.

The current default expectations are [over-hood-clock-controls.json](over-hood-clock-controls.json), each entry with
the PR that recorded it and its frozen head. The two express moving mixed-item variants whose recommended clock #272
changed (observed windows judge each lane-phase start over its repeating cycle) were re-recorded from the generator on
Factorio 2.1.21 (frozen head `4162ddfe`, the PR's source commit before its last amend), both exact in baseline and
recovery:
the mirrored one, whose old clock repeated six 112-item window cycles and one 96-item window cycle after each disturbance, holds
112 throughout with its input window 3 ticks longer, and the unmirrored one keeps 96 with its input window a tick
longer. The nine mixed-item variants whose recommended clock #269 changed to observed windows (an observed-windows clock
holds when its own windows hold) were re-recorded on Factorio 2.1.21 (frozen head `959c08d5`), all exact in baseline and
recovery, the normal mirrored moving one after two short window cycles following its last disturbance; among them fast
unmirrored backed, recorded for the first time. #265 re-recorded 28 variants with the clocks of the belt window-end
trim on Factorio 2.1.21 (frozen head `77f11ce6`), and kept #254's recordings of the three whose exported clock the trim
leaves byte-identical (its express-mirrored-moving copy corrected a stale `generationVerdict` to the generator's "no
recovery", said since the lane-phase audit; the history entry's note keeps it). Of #265's 31 entries, 25 pass their baseline and recoveries exactly — the mirrored moving
turbo's third recovery overshoots one window cycle and pauses four before holding target for its last 14 window cycles —
five are correctly rejected, with native baseline misses behind each holds-false pick (fast mirrored at both
supplies, fast unmirrored moving, normal mirrored at both supplies), and the copied mirrored moving express
keeps its no-recovery counterexample.
Three turbo `-backed` entries were recorded again on 2026-11-11 in Factorio 2.1.24 (frozen head `bb1598e8`), on the
clocks the selection makes for them now. Mirrored mixed-item runs `takt_batches_observed_swings_6` (960 ticks,
`4a0f87000064`) in place of `takt_batches_observed` at 1120 ticks (`81526c4c472c`), which the generator no longer
makes. Both same-item entries run `takt_batches_observed` again, with a new clock (`c87993796a6a` in place of
`67c0b278f860`). All three hold their target and have recovery after each of the three disturbances.

These compact builds can keep producing through the ordinary runner's short outages using stored stock.
Their three successive disturbances therefore last 24 window cycles, with machine inventories and clock state
untouched. A disturbance must reduce output below the baseline before recovery is assessed. If the baseline
already contains zero-output window cycles, the summary retains all counts and marks recovery `not_assessed`;
that clock has already failed its undisturbed throughput check.

The [bounded turbo trace](lane-phase-controls.json) (`over_hood_turbo_trace`, #254) preserves a separate, shorter ingredient-loss
counterexample. Before the interruption, both lanes share a phase. Afterwards, only the interrupted lane
shifts by half a stack interval. The clock was marked stable, but native output repeats a 48-item window cycle
among four 64-item window cycles instead of 64 every 640 ticks. The existing pickup kernel reproduces this pattern
with different initial lane phases. A common clock shift alone does not check that state.

The matching express trace (#255) is no longer kept: the controls hold the turbo tier only.
The old mirrored express clock repeats six 112-item window cycles and one 96-item window cycle after recovery. Separate
lane phases reproduce that cycle of seven window cycles in the existing simulator too, under its own loss protocol: from 9 of
its 64 lane-phase starts the clock repeats it with nothing lost, while the clock-only check judged one window cycle of each
start and passed them all. Observed windows now judge each start over its repeating cycle, and the new default holds
112 in the game after every disturbance.
Native observer ticks have a different origin from the exported clock, so the comparison uses relative lane
phase and cycle rotation; it does not claim the same initial inventory, first failing window cycle or loss transient.

Clock verification now varies ordinary moving lanes independently in both steady-output and recovery checks.
The historical summaries preserve the original clocks and verdicts. A passing capture/replay means the recorded
observations match expectations, including any shortfalls recorded there; it does not certify a failing clock.

The `generation` field of each entry of [over-hood-clock-controls.json](over-hood-clock-controls.json) pins its
audited selection and hashes its exact exported blueprint/schedule, regenerated after the window-end trim, beside the
native recording of that clock. The lane-phase audit's three changed clocks keep their native counts from that time
(#255) in [over-hood-clock-history-controls.json](over-hood-clock-history-controls.json). Until #269
fast-unmirrored-backed-different-items had no recording: its fractional selection repeated every 16,160 ticks, more
than a 63-window-cycle recording fits under the harness's 72,000-tick cap, and moved 6.95 a second against 6 with holds
false. Its observed windows at 800 ticks hold 80 a window cycle, in the game too.
The portable record (`overhood-*` jobs, checked against these controls by `clock-controls.test.ts`) holds these selections, exact clock hashes and the final
untouched final native recovery windows for clocks marked stable (at least eight window cycles for moving supply,
five for backed-up supply, whose assessment starts later), for the nine fixtures of `over-hood-clock-cases.ts`, each the
only one to take its path through the generator. `over-hood-clock-mechanics.test.ts` checks the recorded first hands and
the controls of all 32 against the simulator and the fixture configs without generating (the recovery windows
included).

The raw recordings of #254 and of the bounded shorter-loss trace were not kept in the repository; their summaries
above are the record. Earlier short-outage pilots are separate; an outage hidden by buffers does not add recovery
coverage.

Since the long run is judged by state repetition (proof-verification, 2026-10-19), two entries changed:
`over-hood-{express,turbo}-unmirrored-backed-different-items`. Their old 800-tick `planned-belt-slack` picks never
held 80 a window cycle: the simulation repeats a cycle of 16 window cycles in which one window cycle moves 96 (one extra hand), an
eternal average of 81.04. The old 45-window-cycle long run judged 30 bins that held exactly one such spike, which one
hand of tolerance absorbed; the proven cycle does not. The game agrees: the retained native baselines of #254 in
[over-hood-clock-history-controls.json](over-hood-clock-history-controls.json) run 63 window cycles per variant and move 96 at window cycles
15, 31, 47 and 63, which nothing compared before because the old test read the baseline only for "stable"
verdicts and these two were "no recovery". Fresh 64-window-cycle headless runs of the old clocks reproduce it (96 at
window cycles 8, 24, 40 and 56; #258, not kept in the repository), and the express run was watched in game.
The mechanism, read off those recordings: the belt input inserter picks 324 items a window cycle against the planned
320 - after its last planned return swing its window still holds one pickup tick, which on a backed-up belt
always grabs one 4-item stack - and the carried partial hand becomes an extra full hand every 4th window cycle, in
recipe proportion; the assembler has the spare speed to craft them, and the output inserter drops the extra
96-item hand every 16th window cycle. Every clock of those two variants carried the same cycle, so both pinned
an unstable selection until the belt window-end trim (`b654e895`) removed the extra pickup at its source: a
belt-fed inserter's input window now ends one rotation before its last return swing. Both variants again select
planned-belt-slack, at a window cycle time of 960, and #265's recordings show their baselines and recoveries exact in the game;
the old recordings stand as the in-game confirmation that the old picks fail.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/over-hood-clock-new \
  npm run test:game -- tests/game/builds/over-hood-pickup-clock.game.test.ts \
  -t '^operating clock: over-hood-turbo-unmirrored-moving-different-items$'
```

Use the generation cache and replay variables above with a fresh capture directory. Optional
`BELT_CLOCK_TRACE_PICKUPS=1` retains 64 ticks of native held/stock and machine-inventory snapshots before the first disturbance
and after each restoration; it does not feed observations into the simulator.

## The over-the-hood operating clocks, from ruling 60's start

The 8 jobs of `over-hood-pickup-clock.game.test.ts` (`overhood-over-hood-turbo-*` in the record; the one input inserter picks over a hood from a belt, moving or under backpressure) now start from ruling 60's state, the
harness's backpressure start (`staged: true, backpressure: true` in `overHoodClockScenario`, as `pickup-clock-capture.ts` reads them), on Factorio 2.1.24. Each run is repeated once with the
recording cache off and gives the same run, tick for tick (steady state, every loss, the baseline and the stock guard); the game's report of the opening is kept in `opening.json` beside each run:
the one machine is empty and fed by windowed inserters only, and no inserter has moved. The clock of each job is the one its entry pinned (`clock_sha256` unchanged); no probe text changed.

| Case | Clock (window cycle, hash) | Steady state | Losses recovered at | Baseline net output | Start before (steady state; losses recovered at) |
| --- | --- | --- | --- | --- | --- |
| `mirrored-backed-different-items` | takt_batches_observed_swings_6 (960, `4a0f8700`) | 6,480 | 14,668 (cut iron-plate), 21,421 (block output), 26,199 (cut copper-cable) | 288 of 288 | free warm-up: 6,480; 14,669, 21,422, 26,200 |
| `mirrored-backed-same-item` | takt_batches_observed (960, `c8799379`) | 7,846 | 15,528 (cut iron-plate), 16,488 (block output), 17,478 (cut iron-plate) | 288 of 288 | free warm-up: 6,482; 14,569, 15,529, 16,519 |
| `mirrored-moving-different-items` | takt_batches_observed (320, `71884f6c`) | 7,120 | 14,765 (cut iron-plate), 21,201 (block output), 21,569 (cut copper-cable) | 352 of 352 | free warm-up: 7,120; 14,766, 21,202, 21,568 |
| `mirrored-moving-same-item` | takt_batches_observed (960, `c8799379`) | 7,846 | 15,528 (cut iron-plate), 16,488 (block output), 17,478 (cut iron-plate) | 288 of 288 | free warm-up: 6,482; 14,569, 15,529, 16,519 |
| `unmirrored-backed-different-items` | euclidean_swings (800, `8e8ac597`) | 6,800 | 12,137 (cut iron-plate), 15,322 (block output), 19,387 (cut copper-cable) | 320 of 320 | free warm-up: 6,803; 12,138, 15,323, 19,388 |
| `unmirrored-backed-same-item` | takt_batches_observed (960, `c8799379`) | 7,846 | 15,528 (cut iron-plate), 16,488 (block output), 17,478 (cut iron-plate) | 288 of 288 | free warm-up: 6,482; 14,569, 15,529, 16,519 |
| `unmirrored-moving-different-items` | takt_batches_observed (320, `d56fbdb9`) | 7,120 | 12,235 (cut iron-plate), 13,171 (block output), 15,735 (cut copper-cable) | 352 of 352 | free warm-up: 7,128; 10,920, 11,242, 15,096 |
| `unmirrored-moving-same-item` | takt_batches_observed (960, `c8799379`) | 7,846 | 15,528 (cut iron-plate), 16,488 (block output), 17,478 (cut iron-plate) | 288 of 288 | free warm-up: 6,482; 14,569, 15,529, 16,519 |

All hold: the net output over the baseline's whole window cycles is the target, every loss falls and is recovered, and the output stock guard holds. Four cases differ from their free warm-up run by a tick or two only
(`mirrored-backed-different-items`, `mirrored-moving-different-items`, `unmirrored-backed-different-items`: steady state 0 to 3 ticks earlier, losses recovered 0 to 1 ticks earlier). The four same-item cases (mirrored or not, moving or
under backpressure) pin one clock and make the same run in every case, as before (the two lanes carry the same item); from this start the machine reaches steady state later (7,846 against 6,482) and the first loss is recovered
959 ticks later. `unmirrored-moving-different-items` reaches steady state 8 ticks earlier and recovers its losses 639 to 1,929 ticks later.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/judged-start-9 npm run test:game -- tests/game/builds/over-hood-pickup-clock.game.test.ts -t '^operating clock: over-hood-turbo-unmirrored-moving-different-items$'
```

## Front pickup operating clocks

`front-pickup-clock.game.test.ts` enumerates 48 controls ([front-clock-fixtures.ts](front-clock-fixtures.ts)):

- **Front entrance, 32:** the [compact scaffold](../mechanics/belt-pickup/fixtures/front-underground-entrance/compact-normal.scaffold)
  at four speeds, both mirroring states, moving/backed-up supply, electronic circuits from iron plate and copper
  cable and gears from iron on both lanes, at 6/s. Its assembler runs at crafting speed 50 (two legendary speed
  modules and four legendary beacons), productivity 0. Like the over-the-hood builds it keeps producing through the
  ordinary short outages on its stock, so its three disturbances last 24 window cycles.
- **Front exit, backed up, 8:** the electromagnetic-plant [fixture](../mechanics/belt-pickup/fixtures/front-underground-exit/README.md)
  at four speeds and both mirroring states, with the ordinary electromagnetic targets (30/s turbo to 7.5/s normal)
  and the ordinary disturbances.
- **Front exit on a moving config, 8:** the same eight builds generated with an infinite end on each lane. The input
  stands on the exit's output tile, so the belt is backed up in the game whatever the config says; recovery is
  assessed as for backed-up supply.

[front-clock-controls.json](front-clock-controls.json) holds the 48 native summaries, recorded on Factorio 2.1.21
from clocks generated on `5cb7c83b` (#274), each with 63 untouched baseline window cycles and three disturbances that cut
output; the two normal backed-up exits were recorded again on #456's clock (#479, `99fb9812`). **All 48 meet exact baseline and
recovery output.** All 32 entrance clocks are stable and exact. All eight backed-up exit clocks are stable and exact.
At normal, in both mirroring states, every clock planned for backed-up supply fails (the subtick clock selected
before, holds false at 5.45 of 7.5/s, missed natively, 128, 128, 96 repeating against 176, the generator's own
as-built repeat); the selection since #456 is a stable clock for backed-up belts, every belt-fed window as long as a hand
takes from the lanes at rest, which moves 176 in every window cycle (the clock planned with the belts moving, which #275 recorded, is no
longer made; it is the moving config's). All eight moving-config exit clocks hold exactly and have recovery on the backed-up exit, including
the express ones the generator calls "no recovery" and the normal ones it calls "unstable": both verdicts come
from moving lane-phase starts ([1,5] or [5,1]; [0,3]) that this exit cannot have.

Five turbo `-backed` entries were recorded again on 2026-11-11 in Factorio 2.1.24 (frozen head `bb1598e8`), on the
clocks the selection makes for them now. The mirrored mixed-item entrance runs `takt_batches_observed_swings_6` (960
ticks, `4a0f87000064`) in place of `takt_batches_observed` at 1120 ticks (`81526c4c472c`), which the generator no longer
makes. Both same-item entrances run `takt_batches_observed` again, with a new clock (`c87993796a6a` in place of
`67c0b278f860`). Both exits run `takt_batches_swings_1` (352 ticks; mirrored `fbc4f307ca61`, unmirrored `c9c84d5975c4`)
in place of `takt_batches_observed` at 1056 ticks (`3baa1bc39202`, `0d084222cf32`). All five hold their target and
have recovery after each of the three disturbances.

The portable record (`front-*` jobs, checked by `clock-controls.test.ts`, with the per-job checks of `job-checks/fixtures.ts`) pins each selection and its exact exported clock (each entry's
`generation`) for the nine fixtures of `front-clock-cases.ts`, each the only one to take its path through the generator,
and checks it against its native summary beside it: a baseline miss under the selection's own supply needs holds false;
a stable clock needs an exact baseline and its last recovery window cycles at target. `front-clock-mechanics.test.ts` checks the
recorded figures of all 48 against the simulator without generating: the first hands of each tier, and the controls
(exact baseline and recovery, the verdicts of the moving-config exits, the rate over the pinned window cycle). 29 of the 32
entrance clocks are byte-identical to the over-the-hood pins of the same speed, mirroring, supply and family;
the builds differ in the game, so each has its own control.

### The twelve turbo controls, from ruling 60's start

The twelve turbo entries of [front-clock-controls.json](front-clock-controls.json) (the record's `front-*` jobs) were recorded again on Factorio 2.1.24 from ruling 60's start, the
harness's backpressure start (`staged: true, backpressure: true` in `frontClockScenario`, as `pickup-clock-capture.ts` reads them); before, they started from a free warm-up.
Each ran twice with the recording cache off and the two runs are the same tick for tick (a third run, of the pinned file, matches it too). All 12 hold: the net output over the
baseline's whole window cycles is the target, every loss falls and is recovered, and the output stock guard holds. Each job is one copy (the build holds one).

| Job | Clock (window cycle) | Steady state | Losses recovered at | Free warm-up before (steady state; losses recovered at) |
| --- | --- | --- | --- | --- |
| `front-entrance-turbo-mirrored-backed-different-items` | Takt Batches Observed, 6 swings (960, `4a0f8700`) | 6,480 | 14,669 / 21,422 / 26,222 | 6,492; 14,670 / 21,423 / 26,223 |
| `front-entrance-turbo-mirrored-moving-different-items` | Takt Batches Observed (320, `3b13c3ad`) | 7,122 | 14,765 / 21,203 / 21,567 | 7,120; 14,763 / 21,202 / 21,570 |
| `front-entrance-turbo-unmirrored-backed-different-items` | Euclidean Swings (800, `8e8ac597`) | 6,800 | 12,139 / 15,322 / 19,388 | 6,804; 15,323 / 17,822 / 21,035 |
| `front-entrance-turbo-unmirrored-moving-different-items` | Takt Batches Observed (320, `d56fbdb9`) | 7,120 | 12,222 / 15,464 / 19,323 | 7,120; 14,789 / 15,109 / 15,491 |
| the four `front-entrance-turbo-*-same-item` (mirrored and unmirrored, backed and moving) | Takt Batches Observed (960, `c8799379`) | 7,847 | 15,529 / 16,489 / 17,478 | 6,888; 14,570 / 15,530 / 16,519 |
| `front-exit-turbo-mirrored-backed-different-items` and `...-moving-config-...` | Takt Batches Swings 1 (352, `fbc4f307`) | 7,120 | 14,429 / 18,525 / 22,397 | 7,120; 14,430 / 18,526 / 22,526 |
| `front-exit-turbo-unmirrored-backed-different-items` and `...-moving-config-...` | Takt Batches Swings 1 (352, `c9c84d59`) | 7,120 | 14,653 / 19,005 / 22,877 | 7,120; 14,654 / 18,878 / 22,750 |

- **The fill moves nothing.** Every inserter of these builds has a window (the game's report of the opening, `opening.json`, says so), so the fill holds nothing back and no inserter moves in it:
  the start equals a plain staged start in effect, as for the grenade build below. The four same-item entrances give one run (same clock, same steady state, same recoveries), and so do the two exits of each mirroring state (backpressure and moving config:
  the exit's belt has backpressure in the game whatever the config says). Why the four same-item runs agree to the tick was not isolated.
- **A waiver goes.** `front-entrance-turbo-unmirrored-moving-different-items` carried a stock-guard waiver (#691: output stock 30 against the baseline's lowest 32 at the last recovery). From this start
  the stock guard holds (lowest 5, last 75), so the entry has no `known_differences` any more.
- No probe text changed. `scripts/recording_count.py` now reads `staged: true, backpressure: true` in a case, or in the scenario builder for every case, as ruling 60's start (before, only the missing-recordings fixtures read so).

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
disturbance is the output alone: the loader is removed at window cycle 66 and rebuilt at window cycle 90, and recovery is judged
from window cycle 96 to 130. The capture runner takes the scenario's own probe, intervention and hardware check
(a chest-fed input, crafting speed 3.125, every drop the case's stack size, hands of 15 at stack size 3 and 16 otherwise).

[blocked-output-clock-controls.json](blocked-output-clock-controls.json) holds the 16 native summaries, recorded on
Factorio 2.1.21 on `b9fd341b` (#277); express stack 3 again on `6367fc83`, for the shifted swings clock of 1,440 ticks it selects
now. **All 16 recommended clocks are stable and meet exact baseline (63 window cycles) and recovery output (33 window cycles).** Output stops one to ten window cycles into the block, once the belt behind the drop is full (about 39
stacks), where the simulator holds the output inserter at once; the window cycles judged after the release are the same in
both ([experiments](../../../docs/belt-pickup/experiments.md#generated-clocks-and-drops)). The portable
`blocked-output-clock-mechanics.test.ts` checks all 16 controls against the fixture config, the documentation and the
belt-drop calibration's drop figures, and runs a plain clock built from those figures through the block and release in
the simulator, without generating a clock. The selection and exported clock (each entry's `generation`) of the three cases in
[blocked-output-clock-cases.ts](blocked-output-clock-cases.ts) (the even-hands and shifted-swings paths, and the longest drop) are
checked against the record's `blocked-` jobs by `clock-controls.test.ts`, which also checks them against the native summary beside them.

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
([container-clock-probe.lua](container-clock-probe.lua)) counts the output inserter's drops per window cycle.

**Cuts that empty the container.** A container between two inserters is a buffer: a 2-window-cycle cut, as the belt-fed
families have, does not disturb it. So each supply cut lasts until the container's stock of the cut input is gone (its
slots and stack sizes from the game data, plus 8 window cycles; up to 321 window cycles for the legendary wagon), the output block
lasts 4 window cycles (the disposal chest is filled), and recovery is judged over 40 window cycles after each disturbance, the first
6 after the release left out. Do not compare these recordings window cycle for window cycle with the 2-window-cycle families.

[container-clock-controls.json](container-clock-controls.json) holds the 6 native summaries, recorded on Factorio 2.1.24 from
ruling 60's start (see "The container outputs and the steel wagon builds, from ruling 60's start" below). **All 6 recommended clocks are stable, meet exact baseline output (63 window cycles), drop to 0 in every
disturbance and are exact in all 33 judged window cycles after each.** `container-clock-mechanics.test.ts` checks all 6 without
generating: each container's slots and stock in the simulator, the cut lengths against the stock, the window cycles the game
took to run dry under each cut, and the controls against the fixture configs. `clock-controls.test.ts` checks
the selection and exported clock of the 2 cases in [container-clock-cases.ts](container-clock-cases.ts) (one a recipe: the
clock depends on the recipe, and the 3 fixtures of each recipe record one clock hash) against the record's `containers-` jobs and each against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/container-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/container-clock.game.test.ts -t '^container clock: container-car-mixed$'
```

## A rocket silo between two machines and six

`lithium-plate-80-silo-chest-clock.game.test.ts` enumerates 4 controls ([lithium-plate-80-silo-chest-clock-fixtures.ts](lithium-plate-80-silo-chest-clock-fixtures.ts))
on the lithium plate build (`LITHIUM_PLATE_80_SILO_CHEST`, its README in the sample's folder): two cryogenic plants put
lithium into a rocket silo, six furnaces take it out, 80 plates a second. The clock with 3 output swings (1080 ticks),
which the generator still makes, is recorded as built and with the two inserters that fill the silo built after
the six that empty it; the clock with 1 output swing is a second check, and the clock with 7 output swings (7560 ticks)
is the known limit below. The record selects Coordinated Sources for this build (2160 ticks), and no control records
that clock. The
probe ([lithium-plate-80-silo-chest-clock-probe.lua](lithium-plate-80-silo-chest-clock-probe.lua)) counts the drops of the six output inserters per
window cycle. The protocol is the standard one: the holmium plates cut for 2 window cycles, the output blocked for 4, the holmium plates
cut again. The silo holds at most 250 lithium, so each cut empties it. The warm-up of 3600 ticks without a clock fills the
silo before the clock starts, though the config exports it empty.

[lithium-plate-80-silo-chest-clock-controls.json](lithium-plate-80-silo-chest-clock-controls.json) holds the 4 native summaries, trailing-minute runs
recorded on Factorio 2.1.24 on engine `57c76634`. **The clock with 3 output swings, in both build orders, and the clock with 1
output swing hold their target over the baseline and recover after each disturbance, and the output stock guard holds.** The clock
with 7 output swings (recorded again on #837, as the generation moved it) reaches no steady state within 36,000 ticks in the game, and the simulator, which runs the output belt in the run of one copy, does not hold it either:
the output inserters of two furnaces drop onto underground entrances whose exits
side-load onto the shared output belt, which the config describes as one belt with room for every drop
([scope](../../../docs/game-data-and-scope.md)). `clock-controls.test.ts` pins each clock against the record and `game-runs-hold.test.ts` checks it
against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/lithium-silo-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/lithium-plate-80-silo-chest-clock.game.test.ts -t '^lithium silo clock: lithium-silo-swings-3$'
```

## A car between a mining drill and two furnaces

`iron-plate-80-car-chest-clock.game.test.ts` enumerates 7 controls ([iron-plate-80-car-chest-clock-fixtures.ts](iron-plate-80-car-chest-clock-fixtures.ts)) on the iron plate
build (`IRON_PLATE_80_CAR_CHEST`, its README in the sample's folder): a big mining drill drops iron ore into a car, two furnaces take
it out, 80 plates a second. The harness puts the ore under the drill. The clock with 3 output swings (72 ticks),
which the generator still makes, is recorded as built and with the two inserters that take from the car built after the
output inserters; the clocks with 1 and with 2 output swings (72 and 144 ticks) and the time-study windows (288 ticks) are
the other controls. The record selects Coordinated Sources for this build (144 ticks), and no control records that clock. Each clock enables the drill one tick a window cycle, the tick before the two inserters that take
from the car; the harness wires it with its resource reading off. The probe ([iron-plate-80-car-chest-clock-probe.lua](iron-plate-80-car-chest-clock-probe.lua)) counts the drops of the two output
inserters per window cycle. The car holds 4,000 ore, so the cuts are those of the container family: the drill is stopped
(disabled by script) until the car has run dry (71 window cycles), the output blocked for 4, the drill stopped again, each
followed for 40 window cycles, the first 6 after a release not judged. A drill is no supply that stops in the generator's
checks; here it is stopped as the supply cut. Do not compare these recordings window cycle for window cycle with the 2-window-cycle
families.

[iron-plate-80-car-chest-clock-controls.json](iron-plate-80-car-chest-clock-controls.json) holds the 7 native summaries, 7 trailing-minute runs
recorded on Factorio 2.1.24. In all 7 the net output is exact and the machines reach a steady state; the three recoveries are recorded (the
second and the third disturbance last one tick each: the trailing minute is still below the baseline's lowest when they start), and in the
288-tick control the trailing minute falls to 4,722 against 4,800 at tick 15,300, 480 ticks after the last recorded recovery, while the stock is lowest, and is no lower than 4,796 from tick 22,000 (a window of 3,600 ticks is not a whole number of 288-tick cycles). The
run goes on for 14,400 ticks after its last recovery (the `tail` of `helpers/lua/steady.lua`) and the output stock guard reads the stock
after it has settled, at each whole window cycle of the last half of the tail ([#587](https://github.com/abucnasty/clock-generator/issues/587)):
it must be no lower than the baseline's lowest and not falling. The last drill stop empties the car, and what the furnaces keep in their output
afterwards is not what the run showed at the tick of the recovery: it falls first, then climbs back.
**The 4 controls of the clocks of 288 and 144 ticks hold the guard**: the stock falls to 0 (288 ticks) or 50 (144 ticks) at its lowest tick after the
recovery, and settles at 128 and at 194 (122 and 152 at the lowest tick) after about 9,200 and 7,900 ticks, against baseline lowest stocks of 88 and 90.
The half of the tail the guard reads can start before the stock has settled (the 288-tick clock is still climbing at its start, and its lowest tick
there is 100): the guard asks only that the stock is never below the baseline's lowest and does not fall. **The 3 controls of the clocks of 72 ticks keep it as a
`known_differences` entry**: the stock is at 48 (43 at its lowest tick) at every whole window cycle from the recovery on, for the 14,400 ticks of the
tail, against 80 (70 at its lowest tick) in the baseline. It is a lower, steady level, not a drain; why the level is lower is not found.
`iron-plate-80-car-chest-clock.generation.test.ts` pins each clock and checks it against its native summary.

The second difference of #587 is a count, not the stock, and it is kept as it was: the scaffold recordings' "iron plates through a car"
(`scaffold-recordings.game.test.ts`, `crafts_open`) shows the two furnaces finishing 193.17 crafts and productivity bars a window cycle in the game
under the minute-long recording against 194.00 in the simulator, while the build moves 96 plates in every window cycle; over the 36,000 ticks recorded
before, the two agreed. The 0.83 crafts (0.4%) are named and not explained here: that recording was not made again for the stock guard.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/car-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/iron-plate-80-car-chest-clock.game.test.ts -t '^car clock: car-swings-3$'
```

A test-only option keeps the series that the summary drops (`CAR_SERIES=1`, off by default; [iron-plate-80-car-chest-series-prelude.lua](iron-plate-80-car-chest-series-prelude.lua),
composed in before the probe, so no recording made without it changes key): `series.json` in the capture directory holds, a tick, both furnaces'
output stock, the car's ore, the drill's status, the clock's counter and the stack in each taker's hand from 10 window cycles before each drill stop to 40
after it, and at each whole window cycle from steady state on both furnaces' products finished and productivity bars. The run and its summary are as
without the option.

## Drill-fed builds, the ore voider and the blocked output, from ruling 60's start

Eight record jobs record the clock the record selects from ruling 60's state, the harness's backpressure start (`staged: true, backpressure: true` in the case, as `pickup-clock-capture.ts` reads
them; the ore voider's own capture asks for `staged_start: {backpressure: {}}` and keeps the game's report of the opening in `opening.json`), on Factorio 2.1.24. Each run was repeated once with
the recording cache off and gives the same summary, tick for tick. The car and silo cases were recorded from a plain staged start before, the ore voider and blocked output cases from a free warm-up.

| Job (case) | Clock (window cycle) | Copies built | Steady state | Losses recovered at | Start before (steady state; losses recovered at) |
| --- | --- | --- | --- | --- | --- |
| `IRON_PLATE_80_CAR_CHEST` (`car-selected-staged`) | `coordinated_sources` (144, `8a739e59`) | 1 of 1 | 7,201 | 14,509 (drill stopped), 14,511 (output block), 14,513 (drill stopped) | plain staged start: the same run |
| `LITHIUM_PLATE_80_SILO_CHEST` (`lithium-silo-selected-staged`) | `coordinated_sources` (2,160, `2b115eb8`) | 1 of 1 | 5,760 | 13,853 (holmium cut), 18,497 (output block), 23,033 (holmium cut) | plain staged start: the same run |
| `IRON_ORE_VOIDER_400_EXACT_SPEED` (`ore-voider-exact-speed`) | `time_division_windows` (144, `719cfc48`) | 1 of 1 | 7,200 | 10,815 (ore cut), 10,823 (output block) | free warm-up: 7,200; 10,816, 10,824 |
| `IRON_ORE_VOIDER_400_OVERBEACONED` (`ore-voider-overbeaconed`) | `takt_batches_observed` (144, `d540d9e1`) | 1 of 1 | 7,200 | 10,816, 10,824 | free warm-up: 7,200; 10,817, 10,825 |
| blocked output, stack size 1 (`blocked-output-turbo-stack-1`) | `takt_batches` (192, `21ebc2b1`) | 1 of 1 | 7,056 | 14,910 | free warm-up: 7,071; 15,103 |
| blocked output, stack size 2 (`blocked-output-turbo-stack-2`) | `takt_batches_observed` (192, `1b12f1e0`) | 1 of 1 | 7,060 | 15,508 | free warm-up: 7,071; 15,509 |
| blocked output, stack size 3 (`blocked-output-turbo-stack-3`) | `phase_shifted_batch` (1,440, `aed3a5df`) | 1 of 1 | 6,802 | 15,622 | free warm-up: 6,803; 15,623 |
| blocked output, stack size 4 (`blocked-output-turbo-stack-4`) | `takt_batches_observed` (192, `d6f9260c`) | 1 of 1 | 7,056 | 16,460 | free warm-up: 7,071; 16,461 |

All hold: the net output over the baseline's whole window cycles is the target (car 4,800 of 4,800, silo 2,880 of 2,880, ore voider 24,000 of 24,000, blocked output 288 of 288 at stack sizes 1, 2 and 4 and 240 of
240 at stack size 3), every loss falls and is recovered, and the output stock guard holds (the ore voider is judged by a count, as before: the ore destroyed and the share of crafts that gave ore back
stay inside the binomial range, the car is never full). The car and silo runs are the same as from the plain staged start in every value that is pinned.

- **Every inserter of these builds has a window.** The opening reports (`opening.json`) hold every inserter of each build as windowed (4 of the car build, 6 of the ore voider, 2 of the blocked output), no machine fed by an
  inserter with no window, and no windowed inserter moved in the fill. The start equals a plain staged start in effect, as for the grenade and logistic builds above; the car's drill and the supply chests are the part no clock holds.
- **The ore voider's exact-speed job holds.** The guess that the recycler's random returns could leave it short did not show: the destroyed ore is 23,997 of 24,000 over the baseline, within 232.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/judged-start-7 BELT_CLOCK_CALIBRATE=1 npm run test:game -- tests/game/builds/blocked-output-clock.game.test.ts -t '^blocked output clock: blocked-output-turbo-stack-1$'
ORE_VOIDER_CAPTURE_DIR=.scratch/judged-start-7-voider npm run test:game -- tests/game/builds/iron-ore-voider-400-clock.game.test.ts -t '^ore voider clock: ore-voider-exact-speed$'
```

## A cargo wagon as the hub of a steel build

`steel-plate-26-wagon-chest-clock.game.test.ts` enumerates 3 controls ([steel-plate-26-wagon-chest-clock-fixtures.ts](steel-plate-26-wagon-chest-clock-fixtures.ts)) on
the steel build (`STEEL_PLATE_26_WAGON_CHEST`, its README in the sample's folder): one cargo wagon is a hub that a big
mining drill fills with iron ore, a furnace takes the ore from and puts plates back into, a second takes the plates from
and puts steel back into, and one inserter empties of steel onto the output belt, 26 steel a second. The harness puts the
ore under the drill and builds the wagon after its rails. The recommended clock (planned with belt slack, a subtick clock of
11,520 ticks for 13 window cycles) is recorded as built and with the two inserters that put into the wagon built after every
other entity; the clock the config makes with iron ore out of its window cycle time (`ignored_lcm_ingredients`) is a second check,
recorded as its subtick clock (3,840 ticks for 13 window cycles): the capture exports a clock as its subtick clock where it has one, so the clock rounded to 295
ticks is not recorded. Each clock enables the drill a window of two positions a window cycle, 1.08 ticks on average, before
the inserter that takes the ore; the harness wires it with its resource reading off. The probe ([steel-plate-26-wagon-chest-clock-probe.lua](steel-plate-26-wagon-chest-clock-probe.lua)) counts the drops of the
inserter from the wagon to the belt per window cycle, and also keeps the wagon's contents at each window cycle's start and each
furnace's ticks with a full output. The wagon holds 1,000 ore, 500 plates and 500 steel, so the cuts are those of the
container family: the drill is stopped (disabled by script) until the wagon has run dry of steel (9 and 10 window cycles), the
output blocked for 4, the drill stopped again, each followed for 40 window cycles, the first 6 after a release not judged. A
drill is no supply that stops in the generator's checks; here it is stopped as the supply cut. Do not compare these
recordings window cycle for window cycle with the 2-window-cycle families.

[steel-plate-26-wagon-chest-clock-controls.json](steel-plate-26-wagon-chest-clock-controls.json) holds the 3 native summaries, recorded on Factorio
2.1.21 at commit `1571a1be`. **All 3 meet exact baseline output (63 window cycles), drop in every disturbance (to 0 with the
drill stopped) and are exact in all 33 judged window cycles after each; the two build orders are equal in every window cycle.** A
full plate or steel filter stops a furnace a few ticks a window cycle in some states, with no steel lost (the sample's README).
`clock-controls.test.ts` pins each clock against the record and checks it against its native summary.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/steel-wagon-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/steel-plate-26-wagon-chest-clock.game.test.ts -t '^steel wagon clock: steel-wagon-belt-slack$'
```

## A clock the build came with: the inserter build on three copies

`inserter-crafting-240-shared-signal-clock.game.test.ts` records the inserter build (`INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK`, 240 a second over three
copies of 80, [inserter-crafting-240-shared-signal-clock-three-copies.scaffold](inserter-crafting-240-shared-signal-clock-three-copies.scaffold)) twice, with the protocol of the
families above: 63 untouched window cycles, the ore cut at window cycles 66-68, the output blocked at 84-88, the circuits cut at
104-106, the first 6 window cycles after a release not judged. The three copies stand in a row; the ore lines end as the build's
do: past the last copy each side-loads into an underground exit, the near lane stops there and the far lane goes on to two
furnaces of the build's transport belt foundry (with one more gear assembler), whose drain is held to one belt (240 a second),
so the furnaces take 53 1/3 ore a second off each far lane (the config states the ore lanes as dead ends past the third copy); the product leaves on two lines into loaders and
void chests, and the output block removes both. The copies are not alike (the first two have a gear assembler at 44.92, the
first a fourth furnace at 91.875), and the config is the first.

- `hand-made-clock-three-copies`: the hand-made clock, kept. It is one clock for the three copies: a counter of the clock signal
  that counts 0 to 215 (a window cycle time of 216 ticks), an iron plate window on ticks 1-33 and 109-138 for the 12 ore and 12 plate
  inserters, an iron gear wheel window on ticks 1-65 and 109-173 for the 3 gear inserters; the circuit and output inserters
  are not wired. abucnasty wired 9 of the foundry part's 12 inserters to it: 8 on the iron plate window through the poles,
  and the one from its gear assembler into the foundry on the gear window, through an empty constant combinator to the third
  copy's gear inserter; the foundry's three output inserters are not wired. The test names the clock to the harness (`built_clock`: the counter's entity number in the blueprint, its
  wraparound value and the value it starts at), and the harness records it as it records a generated one, cut at its wraps. The
  recorder schema reads a clock that counts from 0 only when the recording names its wraparound value (the harness writes it), and then
  checks every sample against the clock's count, so a missing signal is still refused.
- `generated-three-copies`: the same blueprint with the hand-made clock's three combinators taken out and the generator's clock
  for the config (`coordinated_sources`, 72 ticks) wired to the inserters of each copy. The test says the build holds 3
  copies (`copies: 3`; without it a build is one copy and a machine beyond the config is refused), and the harness finds them
  from the build's machines and inserters (machines that inserters move items between are one copy; belts, which the copies
  share, do not join them) and matches each to the config by itself. The inserters the hand-made clock held run free while
  the build warms up, as an unclocked build's do, so the furnaces have their recipes when the build is matched. The foundry
  part's machines are in no copy and no inserter joins them to a machine of the config, so they are the build's own.

Both runs also judge each copy by itself: the final machine of each copy, found as the harness finds the copies, makes its 80 a
second over the baseline's whole clock cycles (its products less the change in its output stock), a copy that the others starve
on the ore lines they share falls short there even where the build's total does not. Each copy's baseline is kept in
`per-copy.json` beside the run's summary; it is not part of the native summary. In the game (2026-11-11, Factorio 2.1.24) every
copy made 4,800 over 3,600 ticks with the generated clock and 4,608 over 3,456 ticks with the hand-made clock.

[inserter-crafting-240-shared-signal-clock-controls.json](inserter-crafting-240-shared-signal-clock-controls.json) holds the 2 native summaries, recorded on Factorio 2.1.21 at commit
`e1c0aadb`. **The hand-made clock gives 864 (288 a copy) in each of 63 window cycles, as a separate probe measured it, and the
same recoveries: the ore cut 528, 0, 96 then 864 from the first judged window cycle; the output block 80, 0, 0, 232,
808 then 864; the circuit cut 184, 0, 356 then 864. The generated clock gives 288 in each of 63 window cycles of 72 ticks and is
back at 288 in every judged window cycle after the ore cut and the block, and after the circuit cut in all but the first judged
window cycle (284).** The cuts are in window cycles of each clock, so they last 432 ticks for the hand-made clock and 144 for the
generated one: do not compare the two recoveries tick for tick. Both builds are the three copies on drained lines,
not the one-copy scaffold of `scaffold-recordings.game.test.ts`. A drop in the first tick of a recording is not seen by it, so
the compact count of its first window cycle is checked less that drop (the probe counts it).
`clock-controls.test.ts` pins the generated clock against the record, and `game-runs-hold.test.ts` checks it against its native summary. The hand-made
clock is tied to its recording by the hash of the clock in the blueprint (`recorded.clock_basis` `built`), and the generated
one by its pin, as in the other families.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/inserter-crafting-240-shared-signal-clock-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/inserter-crafting-240-shared-signal-clock.game.test.ts
```

## The grenade build

`grenade-clock.game.test.ts` records the grenade build (`GRENADE_240_FILLS_BELT_EXACTLY`, 240 a second over 7 copies, the sample's
README) four times: on one copy (`grenade-240-fills-belt-exactly-hand-clock.blueprint`: the scaffold with the hand-made clock) and on the full build
of seven (`grenade-240-fills-belt-exactly-full-build.blueprint`), each with the hand-made clock, kept (`built_clock`), and with the generator's recommended clock
(`planned-belt-slack`, 112 ticks), wired to the inserters and drills of every copy (`copies`) with the hand-made clock's deciders taken
out. The protocol is the family's with three losses the build has: the foundries stopped for 2 window cycles, the output loader taken
away for 30 window cycles and rebuilt (a copy's belt takes 6 window cycles of grenades before it is full, so the family's 4 would change
nothing), and the drills stopped for 2. The probe counts the drops of the output inserters per window cycle and per inserter and the
ticks each waits for room on the belt.

[grenade-clock-controls.json](grenade-clock-controls.json) holds the 4 native summaries; `clock-controls.test.ts`
pins the generated clock, `game-runs-hold.test.ts` checks the runs, and `src/crafting/grenade-clock.generation.test.ts` checks the hand-made clock in the simulator. All four hold their target in every baseline window cycle
(64 on a copy, 448 on seven) with no wait for the belt, and go back to it after every disturbance.
On the full build each copy is judged by itself as well, as on the inserter build's three copies: each copy's four final machines
make its 2,048 over the baseline's 3,584 ticks of whole clock cycles, with both clocks (2026-11-11, Factorio 2.1.24).

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/grenade-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/grenade-clock.game.test.ts
```

## the utility science 480 build

`utility-science-480-lds-foundry-chain-clock.game.test.ts` records the generator's recommended clock for `UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN` (480 utility science packs a second
over 3.5 copies; the scaffold is one copy, 137.14 a second, 384 packs in a window cycle of 168 ticks) on the sample's scaffold. The clock is
the per-branch clock (`coordinated_sources`, 168 ticks, 450.34 wakeups a minute): the windows of Round-Robin Polling
(`src/crafting/candidates/round-robin-polling.ts`: hands rounded up where they are fractional, the order of the chain of machines),
with the coal inserter's windows taken from a part one source at a time. The harness wires it to the inserters of the build. The protocol is the
family's, timed in game ticks (`tests/game/helpers/lua/steady.lua`): steady state, then a baseline of 3,600 ticks, judged by the net
output of its whole clock cycles. Then the build has three losses in turn: the coal taken off every belt, the two output loaders taken
away and rebuilt, and the processing units taken off every belt. Each loss lasts until the trailing minute falls below the baseline's
lowest; recovery is the steady-state test met again after it. The probe records the packs that each of the eight assembling machines
finishes and its output stock.

[utility-science-480-lds-foundry-chain-clock-controls.json](utility-science-480-lds-foundry-chain-clock-controls.json) holds the native summary and the pin of the clock
(`clock-controls.test.ts` checks the pin, `game-runs-hold.test.ts` the run). Recorded on 2026-11-11 in Factorio 2.1.24 on the
per-branch clock: steady at tick 7,131; over the baseline's 21 whole window cycles (3,528 ticks) the eight machines made 8,064 packs
net, the target; the trailing minute stayed between 8,208 and 8,256 against 8,228.57; the run is back at the target after the coal
cut, the output block and the units cut, and ends with an output stock of 240 against the baseline's lowest of 0. The entry's
`previous` names Round-Robin Polling (493.22 wakeups a minute), which the generator still makes and which was selected before; its
recording, made in the same way, is in the git history of the controls file.

Thaeln's own clock for the build, given on 2026-10-23, was recorded on the same scaffold while the rule was written (it is a
blueprint of five combinators with no wires to inserters, so the harness wired it): a counter of 0 to 335 (336 ticks, two cycles) and four
window combinators, each outputting the signal of the item the inserters it switches move (utility science pack for the 8 output
inserters, processing unit for the 8 that take units and frames off the belts, low density structure for the 8 between foundries
and machines, plastic bar for the 4 between the cryogenic plant and the foundries). **The coal inserter has no signal and is not
on the clock: it runs all the time.** The game run with it wired like that makes 768 packs in every turn of its counter (336 ticks) and
gets back from a cut of the coal, the output and the units too; after the coal returns it swings between
384 and 704 packs for 7 turns before it makes 768 again, at 246.4 wakeups a minute by the series' method. The 107 turns of 768
packs, with 184.8 wakeups a minute in the game and 211.8 in the simulator, are from another run that wired the coal inserter on
the plastic bar signal instead. It is evidence and a benchmark for the rule, not a control of this family.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/utility-science-480-lds-foundry-chain-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/utility-science-480-lds-foundry-chain-clock.game.test.ts
```

## The productivity module chain

`productivity-module-80-chest-chain-clock.game.test.ts` records the clock Round-Robin Polling (`round_robin_polling`) makes for `PRODUCTIVITY_MODULE_80_CHEST_CHAIN` (80 productivity
modules a second over 6 copies; the scaffold is one copy, 13.33 a second, 16 modules in a window cycle of 72 ticks) on the sample's scaffold.
The clock is the one the generator selected before Coordinated Sources: the windows of `src/crafting/candidates/round-robin-polling.ts` (hands rounded up where they are fractional,
the order of the chain of machines), made without a search. The record now selects `coordinated_sources` for this build (72
ticks, 620 wakeups a minute); a recording of that clock is owed ([#702](https://github.com/abucnasty/clock-generator/issues/702), open). The harness wires it to the 14 inserters of the build. The protocol is the
family's with the losses the build has, each long enough to be felt, since the build holds stock: 63 whole window cycles, then the coal
cut for 40 window cycles (the inserter that puts the coal on the belt is switched off and the belt emptied; the output first falls short
about 33 window cycles in), the output loader taken away for 24 (the output belt takes about 11 window cycles of modules before it is full) and
rebuilt, and the two foundries casting iron stopped for 26 (the output falls short after about 13). The probe counts the drops of
the output inserter per window cycle.

[productivity-module-80-chest-chain-clock-controls.json](productivity-module-80-chest-chain-clock-controls.json) holds the native summary and the pin of the clock
(`clock-controls.test.ts` checks the pin, `game-runs-hold.test.ts` the run): 16 in all 63 baseline window cycles, and 16 again after each loss.
Recorded for 36,000 ticks after the warm-up and settle with `scripts/record-clock.js`, the same clock made 16 in all 499 window cycles,
with 602.8 wakeups a minute against the simulator's 575.6, and the simulator laid against the game entity by entity had no issues;
the clock made for "Backed-up belts" did the same. The clock before the rule ranked its placements (staged, the first that held)
had 858.5 in the game and 843.8 in the simulator.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/productivity-module-80-chest-chain-clock-new BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/productivity-module-80-chest-chain-clock.game.test.ts
```

## Utility science 120: the selected clock from the staged start

[utility-science-120-selected-clock.game.test.ts](utility-science-120-selected-clock.game.test.ts) records the clock the generator selects for
`UTILITY_SCIENCE_120` (Takt Batches, window cycle 672 ticks, pinned in `scaffold-recordings-clock-pins.json` as "utility science") on the
sample's scaffold of one copy (17.14 a second), as the config is and with backpressure on the belts, from the staged start to steady state, a baseline of
21 whole window cycles (the run is past 21,600 ticks before the loss), then the loss the disturbance trial names: low density structure stops arriving
(lasting until no craft finishes for a window cycle, restored at the place in the window cycle it was cut at). Recorded at Factorio 2.1.24, both cases the same:
steady state at tick 7,136, 192 in each of the 21 window cycles, and after the loss the output comes back (recovered at tick 27,632). The simulator's
verdict for the clock is "no recovery", from the loss on the copies that share a lane; the scaffold holds one copy, so that join is not in this run.
On the seven-copy scaffold the game agrees with the simulator's "no recovery" (copy 7 stayed at 0 for 45 window cycles after the same stop, the build's known deadlock risk), so the one-copy difference comes from the one-copy scaffold having no shared lane.

```bash
UTILITY_120_CAPTURE_DIR=.scratch/utility-120 npm run test:game -- tests/game/builds/utility-science-120-selected-clock.game.test.ts
```

## The missing recordings: the picks of eight record jobs from the staged start

[missing-recordings-clock.game.test.ts](missing-recordings-clock.game.test.ts) records the clock the record selects for each job of
[missing-recordings-clock-fixtures.ts](missing-recordings-clock-fixtures.ts) on the sample's scaffold, from the staged start (every inserter of these
builds has a window, so the staged start is the judged start), with the probe [missing-recordings-clock-probe.lua](missing-recordings-clock-probe.lua):
steady state, a baseline of whole window cycles, then the losses of the case one after the other (each until the output falls, then released),
then 7,200 ticks more. The losses are the standard cuts of the families above (an ingredient cut of each input line, the output block, an ingredient cut)
where the build has input lines, the productivity module chain's own (coal, output, iron foundries stopped), and the output block alone for a build that takes
every ingredient from fluids or machines (accumulator). A build of copies is judged on each copy by itself: every whole window cycle from steady state to the first
loss, and every whole window cycle of the last minute after the last loss. Where what a copy puts out in a window cycle repeats every r > 1 cycles (its output inserters take 67 and 65 hands in turn, so a cycle reads 1,072 and 1,040), and the judged part holds the repeat twice, the last whole repeats are judged against r cycles of target ([run-judgement.js](../helpers/run-judgement.js) `judgeAfterLoss`, as the baseline's `wholeRepeats`); a case lengthens its tail and the judged part with `tail_ticks` and `tail_judged_ticks`. The controls are in
[missing-recordings-clock-controls.json](missing-recordings-clock-controls.json); the test keeps each run, its verdict and its controls entry in `MISSING_RECORDINGS_CAPTURE_DIR`.
Recorded at Factorio 2.1.24, all six holding their target on every copy and recovering from every loss (`AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING` was the seventh: it is recorded again from ruling 60's start, see "Scaffold builds from ruling 60's start" below):

| Job | Clock (window cycle) | Copies built | Window cycles per copy before / after the losses | Steady state | Last loss recovered |
| --- | --- | --- | --- | --- | --- |
| `AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING` | Pitch Pickups (72) | 9 of 9 | 50 / 50 | 7,292 | 17,736 |
| `FLYING_ROBOT_FRAME_80` | Moved Output Swing (288) | 12 of 12 | 12 / 12 | 7,056 | 25,260 |
| `PRODUCTIVITY_MODULE_80_CHEST_CHAIN` | Coordinated Sources (72) | 1 of 6 | 50 / 50 | 7,436 | 27,145 |
| `ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED` | Coordinated Sources (40) | 2 of 5 | 90 / 90 | 7,200 | 32,427 |
| `PROCESSING_UNIT_15_CHEST_FED` | Euclidean Swings (384) | 1 of 1 | 9 / 9 | 7,074 | 19,010 |
| `LOGISTIC_SCIENCE_240` | Takt Batches (176) | 22 of 11 (two rows) | 20 / 20 | 7,193 | 20,041 |
| `ACCUMULATOR_320` | Coordinated Sources (972) | 9 of 9 | 3 / 3 | 6,518 | 15,173 |

- **Start.** The first pick (`AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING`) and the processing unit 15 job start from the plain staged start. The five other rows
  (flying robot frame 80, productivity module chain, electromagnetic recycler build, logistic science 240, accumulator 320) are recorded from ruling 60's start
  (`start: "backpressure"`, see "Loop builds and ruling 60's start" below): the lock holds the clocked inserters off, the unclocked part fills and runs until every
  machine made the same in two windows of 3,600 ticks, and the lock opens at the clock's first tick. The values in the table for those five are the runs from that
  start (Factorio 2.1.24, 2026-11-19, each repeated on a second run with the same result on every copy, window cycle and loss); the runs from the plain staged start
  before it differed by at most two ticks in steady state and in the last recovery. Every copy built holds its share in every whole window cycle checked, before and after the losses.
- The first pick is "no recovery" in the simulator (copper plate stops arriving on the copies that share a lane). In the game all nine copies keep their rate and
  the output comes back after that loss, so the game and the simulator differ, as for utility science 120 above.
- Named limits: the scaffold of the productivity module chain holds one copy of the job's six, and that of the electromagnetic science recycler build two of five (it is recorded on five copies below, "The stamped scaffolds of the job's copies"); the
  joins of the other copies are not in these runs. The harness builds the copies the scaffold blueprint holds and no more: asked for the job's copies (2026-11-19, Factorio 2.1.24,
  ruling 60's start) it refuses before the run, "The test says the build holds the config 6 times, and the build holds it 1: a copy is a group of machines that inserters move items
  between, with a machine for every machine of the config" (the recycler build: 5 times, holds it 2). The same holds for the automation science 120 build (9 times, holds it 1) and the
  electric furnace 20 build (2 times, holds it 1) below. The recycler build's output is random: each copy made 2,907 and 2,890 of 2,880 over its 90 window cycles before the
  losses (2,900 and 2,892 of 2,880 after), 12 to 15 of its window cycles short of 32 by a few items, so it is judged on the stretch and not on each window cycle. The
  recording starts before the recyclers have a recipe, so its copies are the final machines taken from the west, two to a copy.
- `AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER` (one copy of the job's nine) is recorded from ruling 60's start, not from the plain staged start (see "Loop builds and ruling 60's start"
  below). Its belt is filled only by the foundries' output inserters, which the staged start places with the clock, so no lane under a pickup ever carried anything before them. The staged start
  counted such a lane as not saturated and failed ("The belts did not saturate", 2026-11-17, Factorio 2.1.24); it now counts a lane that only the build's machine inserters fill as saturated.

```bash
MISSING_RECORDINGS_CAPTURE_DIR=.scratch/missing-recordings npm run test:game -- tests/game/builds/missing-recordings-clock.game.test.ts -t flying-robot-frame
```

### Six more picks, two named as waiting

The same test and probe record six more jobs (Factorio 2.1.24, one copy of the scaffold each, the losses the build has: an ingredient of each belt line, the output block,
an ingredient). Each holds its share of the target on its copy in every whole clock cycle before the first loss and in the cycle or cycles after the last loss, and recovers from every loss:

| Job | Clock (window cycle) | Copies built | Clock cycles before / after the losses | Steady state | Last loss recovered |
| --- | --- | --- | --- | --- | --- |
| `LOGISTIC_SCIENCE_240_DIRECT_INSERT` | Coordinated Sources (576) | 1 of 6 | 6 / 6 | 7,056 | 19,016 |
| `ADVANCED_CIRCUIT_230` | Pitch Pickups Subtick (12,672 a clock cycle) | 1 of 3 | 1 / 1 | 16,357 | 46,660 |
| `ADVANCED_CIRCUIT_240` | Takt Batches Observed (528) | 1 of 3 | 6 / 6 | 6,768 | 22,765 |
| `ADVANCED_CIRCUIT_240_BACKED_UP` (variant) | Takt Batches Observed (528, the same clock) | 1 of 3 | 6 / 6 | 6,768 | 22,765 |
| `LDS_240` | Takt Batches Observed, 6 swings (288) | 1 of 1 | 12 / 12 | 7,056 | 18,549 |
| `METALLURGIC_SCIENCE_45` | Time Study Windows Subtick (640) | 1 of 1 | 5 / 5 | 6,800 | 22,542 |

- The logistic science build with direct insertion was recorded before only on the clock that was then selected (Euclidean Swings); this is its selected clock. Its losses are
  the inserters cut from the belts and the loaders removed; the molten iron comes from infinity pipes and has no loss.
- The clock cycle of the 230 pick is 12,672 ticks, so a minute holds none: its baseline is one whole clock cycle (the protocol allows a longer baseline with a reason) and
  the run goes on 12,700 ticks after its last loss, so that the cycle after the losses is whole. It is judged on one cycle before and one after.
- The two advanced circuit 240 jobs have the same clock; one scaffold and one run each, with the same result. The scaffold's lanes end closed, so the sample builds backpressure
  on those belts in both.
- The scaffolds hold one copy of the advanced circuit and logistic science jobs' three and six copies; the joins of the other copies are not in these runs.
- The figures of this table and of the one above for `PROCESSING_UNIT_15_CHEST_FED` are of the plain staged start; the controls now hold the runs from ruling 60's start, in "Seven of these picks again, from ruling 60's start" below.
- `ROCKET_FUEL_60` and `ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP` were not pinned here: they are recorded from ruling 60's start under "Loop builds and ruling 60's start" below.

## Seven of these picks again, from ruling 60's start

The plain staged start is not the judged start. Seven jobs of the two tables above and of the stone brick note below are recorded again by the same test and probe, with
`start: "backpressure"` in their cases (Factorio 2.1.24, one copy of the scaffold each, the same losses, `CLOCK_RECORDING_CACHE=off`): the build is placed with the
clock's lock on, runs until every machine made the same in two windows of 3,600 ticks, and the lock opens at the clock's first tick. A second run of each, with
no change, gave the same verdict, summary and controls entry (only the tick the lock opens at differs, by 1 to 6 ticks). The entries in
[missing-recordings-clock-controls.json](missing-recordings-clock-controls.json) are these runs, and replace the ones of the plain staged start. Every job holds: the baseline's
net output is the target over whole clock cycles, the stock guard holds, and the copy makes its share in every whole clock cycle before the first loss and in the cycles after the last one.

| Job | Clock (window cycle) | Opening: machines at the lock | Clock cycles before / after the losses | Steady state | Last loss recovered |
| --- | --- | --- | --- | --- | --- |
| `PROCESSING_UNIT_15_CHEST_FED` | Euclidean Swings (384, `887d21be`) | the plant empty, its two inserters windowed | 9 / 9 | 7,073 | 19,009 |
| `LDS_240` | Takt Batches Observed, 6 swings (288, `f857f0f4`) | four foundries and the plastic plant empty | 12 / 12 | 7,056 | 18,548 |
| `METALLURGIC_SCIENCE_45` | Time Study Windows Subtick (640, `6475d726`) | empty | 5 / 5 | 6,800 | 22,541 |
| `ADVANCED_CIRCUIT_230` | Pitch Pickups Subtick (12,672 a clock cycle, `9cdc8d06`) | two cable foundries full (200 cables), the circuit plants and the plastic plant empty | 1 / 1 | 16,356 | 46,659 |
| `ADVANCED_CIRCUIT_240` | Takt Batches Observed (528, `e45bff6b`) | as the 230 | 6 / 6 | 6,768 | 22,764 |
| `ADVANCED_CIRCUIT_240_BACKED_UP` (variant) | the same clock (528, `e45bff6b`) | as the 230 | 6 / 6 | 6,768 | 22,764 |
| `STONE_BRICK_120_DRILL_DIRECT_INSERT` | Batched Swings observed (144, `ecc4d93e`) | the furnace empty (the drill is held until the fill's opening) | 25 / 25 | 8,343 | 12,230 |

- The lock opened 7,200 ticks after the build was placed.
- **Named limit, copies.** The four jobs of three copies (the two advanced circuit 240 jobs, 230 and stone brick 120) are recorded on one copy: the harness builds the blueprint it is
  given, the sample's scaffold is one copy, and no scaffold of three copies of these builds exists, so the joins of the other two copies are not in these runs.
- The baseline of the 230 pick is its one whole clock cycle of 12,672 ticks (16,192 of 16,192), as before; the run goes on 12,700 ticks after its last loss.
- The stone brick build's only loss is the output block (the stone comes from a drill that drops into the furnace); it recovers at tick 12,230, 287 ticks after it starts.

## The container outputs and the steel wagon builds, from ruling 60's start

**Steel wagon builds (three jobs).** The three staged cases that carry the selected clock (`steel-wagon-selected-staged`, `steel-wagon-iron-ore-out-of-period-selected-staged`, `steel-hub-selected-staged`)
now say `staged: true, backpressure: true`, so the run starts from ruling 60's state (Factorio 2.1.24, `CLOCK_RECORDING_CACHE=off`). Each is repeated once and gives the same summary, tick for tick.
They hold. All five inserters and the drill have a window (the game's report of the clock's wires), so the lock holds everything back and
nothing fills before the clock: the lock opened 7,200 ticks after the build was placed (tick 55,525 to 55,528 in the game), both furnaces were empty, and no windowed inserter moved in the fill.

| Job (case) | Clock (window cycle) | Steady state | Baseline (net, whole window cycle) | Losses recovered at |
| --- | --- | --- | --- | --- |
| `STEEL_PLATE_26_WAGON_CHEST` (`steel-wagon-selected-staged`) | Batched Swings, 1 output swing, subtick (11,520, `394630ea`) | 15,120 | 4,992 of 4,992 | 32,646 (drill), 38,163 (output block), 43,280 (drill) |
| `STEEL_HUB_26_CONTAINER_OUTPUT` (`steel-hub-selected-staged`) | the same clock (11,520, `394630ea`) | 15,120 | 4,992 of 4,992 | the same run |
| `STEEL_PLATE_26_WAGON_CHEST_IRON_ORE_OUT_OF_PERIOD` (`steel-wagon-iron-ore-out-of-period-selected-staged`) | Batched Swings, 1 output swing, subtick (3,840, `507cc570`) | 7,440 | 1,683 of 1,664 | 15,818 (drill), 15,820 (output block), 15,822 (drill) |

- The stock guard holds in all three. The second and third loss of the iron-ore case last one tick each: the drill had emptied the wagon already.

**Container outputs (six jobs): recorded from ruling 60's start.** The six cases of `container-clock-fixtures.ts` now say `staged: true, backpressure: true` (Factorio 2.1.24, 2026-11-19,
`CLOCK_RECORDING_CACHE=off`). They first stopped in the fill, before the run: "Windowed inserters held items during the fill with the lock on" (unit 99, config id 1; ids 1 and 2 in the car, tank and
legendary mixed-wagon cases). The supply inserter takes from an infinity chest that is full from the first tick, and its hand held an item (16 iron plates or copper cable) in the tick it was built,
before the circuit disabled it, and in no later tick. The harness counted that tick (`moved`), where the leak check of the same fill starts two ticks after the build. Both checks now start from one
constant (`FILL_CHECKS_FROM_TICKS` in `factorio-harness.ts`, passed to the game in the job): the game reports the first and the last tick of each hand and the host judges them from that tick. A hand in the
build tick is no move; a hand in any tick from the third on is still refused (`factorio-harness.test.ts`).

Each case was run twice and gives the same summary, tick for tick (the tick the lock opens at differs by up to 5, as elsewhere). Every job holds, and the controls carry these runs:

| Job (case) | Clock (window cycle) | Steady state | Baseline (net, whole window cycle) | Losses recovered at |
| --- | --- | --- | --- | --- |
| `containers-container-car-mixed`, `-tank-mixed`, `-wagon-legendary-mixed` | Takt Batches Observed (384, `3834ac13`) | 7,144 | 288 of 288 | 14,542 (iron plate cut), 18,382 (output block), 22,312 (copper cable cut) |
| `containers-container-wagon-filtered`, `-wagon-legendary`, `-wagon-normal` | Takt Batches Observed (192, `8f2876cb`) | 7,056 | 288 of 288 | 14,536 (iron plate cut), 18,376 (output block), 22,216 (iron plate cut) |

- The lock opened about 7,200 ticks after the build was placed, and the stock guard holds in all six. Only the supply inserters from the infinity chests hold anything in the build tick; the inserter into the machine and the one out of it hold nothing.
- `PROCESSING_UNIT_15_CHEST_FED` passes the same fill with a stack inserter at a full infinity chest as well; by reading the cases (no new run) the two things that differ are the sink (a machine, where the container builds drop into a chest) and the inserter's item filter (the container supplies name one, the plant's does not). Which of the two decides was not run.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/judged-start-6 npm run test:game -- tests/game/builds/steel-plate-26-wagon-chest-clock.game.test.ts -t '^steel wagon clock: steel-wagon-selected-staged$'
```

## Container and drill builds: the record's picks from the staged start

The car, silo and wagon families above recorded clocks the record no longer selects, from a warm-up and a settle. Five more cases record the
clock the record selects for each job, from the harness's staged start (every inserter of the build placed with the clock in one tick, the car,
silo and wagon empty at the start), under the family's own probe and protocol: `car-selected-staged` (`IRON_PLATE_80_CAR_CHEST`, Coordinated
Sources, 144 ticks), `lithium-silo-selected-staged` (`LITHIUM_PLATE_80_SILO_CHEST`, Coordinated Sources, 2,160 ticks),
`steel-wagon-selected-staged`, `steel-wagon-iron-ore-out-of-period-selected-staged` and `steel-hub-selected-staged` (the three steel jobs, Batched
Swings with 1 output swing as a subtick clock, 11,520, 3,840 and 11,520 ticks). Their entries are in the three families' controls files, and
`clock-controls.test.ts` pins each against its record job (`variants-STEEL_HUB_26_CONTAINER_OUTPUT` is the steel build in small, `steelHub`, on the
sample's scaffold: it is the same clock and the same run as the sample's).

- **How it runs.** `staged: true` in the scenario (`pickup-clock-capture.ts`). The run is the settle, as in the other families, and the recording of
  the audit follows it: the recorder does not start on machines with no recipe, and a furnace takes its recipe from its first ingredient, so it
  cannot start at the placement on these builds (the harness's `settle_ticks` is allowed in a staged start for this). The probes count the run from the first tick
  every final machine has a recipe (`steady.after_finals`: 27 ticks for the car, 340 for the silo, 133 for the sample's wagon, 61 for the wagon with iron ore out of
  the window cycle); the probes' own check of the inserters' ends is left to the host's audit, as the inserters do not know their ends in the placement tick.
- **Result, Factorio 2.1.24, all five hold:** steady state at tick 7,201 (car), 5,760 (silo), 15,120 (wagon, hub) and 7,440 (iron ore out of the window cycle);
  the baseline's net output is the target over whole clock cycles; the three losses (the drill stopped or the holmium plates cut, the output blocked, the same again)
  each reduce the output and are recovered, the last at tick 14,513, 23,033, 36,728 and 15,778. As in the families above the second and third loss of the car and
  wagon builds last one tick each, the drill having emptied the container already. The stock guard holds in all five; for the car it is read after the last recovery has
  settled (#587, #803): lowest 98 in the baseline, 168 once settled, 196 at the end. The 72-tick car clock and its waiver are not involved: the record selects 144 ticks.
- **Stone brick** (the figures here are of the plain staged start; the controls now hold the run from ruling 60's start, in "Seven of these picks again" above): the generic test of the missing recordings records `STONE_BRICK_120_DRILL_DIRECT_INSERT` (Batched Swings observed, 144 ticks): steady state at
  8,207, 2,400 over the baseline's 3,600 ticks, the output block recovered at 12,097, 25 whole clock cycles judged before and after the loss with none short. Its final
  machine is a furnace, so it has a late recording (`late_recording`, the same reason). Its loss is the output block alone: the stone comes from a drill that drops into the
  furnace, and the generic probe has no drill stop; the supply was not cut. The scaffold holds one copy of the job's three.
- **`ELECTRIC_FURNACE_20`:** recorded from ruling 60's start (see "Loop builds and ruling 60's start" below). Its three drills (one for each stone brick furnace) were not wired by the staged
  start, which wired a drill only in a build with one drill ("the clock enables drill 1, which was not matched to a drill of the build (3 mining drills)", 2026-11-17); the harness now matches the
  drills of its trial build to the config's and the mod wires the clock to the drills that stand where those stood.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/car-staged BELT_CLOCK_CALIBRATE=1 \
  npm run test:game -- tests/game/builds/iron-plate-80-car-chest-clock.game.test.ts -t '^car clock: car-selected-staged$'
```

## Loop builds and ruling 60's start

The generic test of the missing recordings (`missing-recordings-clock.game.test.ts`) records five more jobs on Factorio 2.1.24, one copy of the scaffold each. A case
whose pick leaves a part of the build to run before the clock does is started from ruling 60's state, the harness's backpressure start (`start: "backpressure"`:
the whole build is placed with the clock's lock on, the build runs until every machine made the same in two windows of 3,600 ticks, and the lock opens at the clock's first
tick; the probe runs there). A case with a Lua file of its own (`prelude`) puts the hardware the scaffold lacks in at that tick, before the probe.

| Job (case) | Clock | Start | Window cycles before / after the losses | Steady state | Last loss recovered |
| --- | --- | --- | --- | --- | --- |
| `IRON_BACTERIA_380_CULTIVATION` (`iron-bacteria-380`, `-block`, `-nutrients`: one loss each) | Time Study Windows Subtick (1,728, `3f820d74`) | ruling 60's | 2 / 2 each | 7,056 | 14,348 (bioflux cut), 14,131 (output block), 14,621 (nutrients cut) |
| `ROCKET_FUEL_60` | Takt Batches Observed (`482a9448`) | ruling 60's | 28 / 28 | 7,193 | 22,726 |
| `ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP` (variant; `rocket-fuel-60-jelly-hands-15-backed-up` and `-nutrients`) | the variant's clock (`d978b5fd`) | ruling 60's | 56 / 56 each | 7,184 | 18,586 (all three in a row), 14,971 (nutrients cut alone) |
| `AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER` | Takt Batches Observed (144, `782c7427`) | ruling 60's | 25 / 25 | 7,200 | 23,630 (cut copper plate 14,990, output block 19,310, cut gear wheels 23,630) |
| `ELECTRIC_FURNACE_20` | Takt Batches Observed (864, `c7c3a86f`) | ruling 60's, `settle_ticks` | 4 / 4 | 7,074 | 23,798 (cut advanced circuits 14,946, output block 20,034, cut advanced circuits 23,798) |

All hold: every copy of the build makes its share of the target in every whole window cycle checked, and the output stock guard holds.

- **Iron bacteria.** The build makes 111 % of its target (24,320 of 21,888 over the baseline's 3,456 ticks). The probe ends a loss when the output has fallen below the baseline's lowest minute and
  counts it recovered when the output is over the target again, so after the first loss the output is over the target but under the baseline's lowest minute, and the next loss "falls" and is
  released within a tick or two. Three losses in a row therefore test the first one only; each of the three has a case of its own, from the baseline. The output block of the probe takes the loaders off
  the build, and this scaffold's two loaders drain the bioflux and nutrient belts, so the block case sets `block_sinks`: the probe fills the four void chests the output goes into (the chests the
  loaders drain into are left). Recorded from ruling 60's start since 2026-11-19 (the three cases were first recorded from the plain staged start, 2026-11-18, with the same results to a tick or two). Not run: the other copy (the job has one).
- **Rocket fuel.** Its inserters 10, 12 and 13 (the nutrient pickups) have no window in `clock_windows`, but they are fuel clocks and the schedule wires them to the clock: in the harness's fill
  all 13 inserters of the build are windowed (held off by the lock) and none runs, so the fill held nothing to run before the clock. The three machines are empty at the opening (the
  lock opened at tick 55,818, 7,200 ticks after the build; the fill ended steady, no inserter was enabled in it). The simulator's fill keeps fuel inserters on (#804); the game's
  start here does not, and the recommended clock holds from it all the same. This is the run of the plain job from the staged start of 2026-11-18, repeated from ruling 60's start.
- **Jelly hands 15, backed up.** `rocket-fuel-jelly-hands-15-prelude.lua` sets the four inserters between the machines to a hand of 15 (the scaffold's hold 16) and fills the chest at the loader that
  drains the bioflux and jellynut belt, so that belt backs up. The loader at the end of the nutrient belt stays: the build puts the jellynut seeds it makes onto that belt (inserter 11), and with it
  blocked the build makes nothing (36,000 ticks, no steady state). So the nutrient belt's drain is as the sample has it, not under backpressure. The probe's output block then removes the two loaders
  of the product. The nutrient cut after the output block lasts 3 ticks in the run of three, so the cut also has a case of its own.
- **Automation science 120, foundries feeding a belt to an assembler** (one copy of the job's nine). The belt under the assembler's pickup is filled by the foundries' output inserters only, which the
  harness places with the clock: its first stage counts a lane that only the build's machine inserters fill as saturated, so the build is placed on empty belts and the fill (the lock on) fills the belt from the
  foundries (the lock opened at tick 59,128, the fill ended steady 10,800 ticks after it began). Both pickup lanes of the belt carried nothing in the first stage ("The belts did not saturate" before, 2026-11-18).
- **Electric furnace 20** (one copy of the job's two). The clock enables three drills; the harness matches the drills of its trial build to the config's by what each drops into, the mod finds them where
  they stand in the build that is made again, and the clock is wired to each. The case keeps `late_recording` (the recording, which the test uses for the build's hardware, starts where the run ends: `settle_ticks`, which the backpressure
  start now honours, so the recording starts that many ticks after the lock opens, as a staged start's does) and the probe counts from `steady.after_finals`.
  The build makes exactly its target in the baseline (576 of 576 over 3,456 ticks).
- **Retaken in `scaffold-recordings.game.test.ts`** (agricultural science 250 and iron bacteria 380, on the clocks of #818): every copy of the five-copy build makes 656, 784 and 736 of 800 in its first three window
  cycles (the start-up) and 800 in each of the 7 after; both agricultural builds are judged by the standing rule (per copy, every window cycle from the first third of the samples on: cycles 5 to 10, all 800), now both from the staged start (the one with belts under backpressure started from a warm-up before, and on this clock left
  copy 2 short in each of the 3 cycles checked and copy 5 in the first); iron bacteria 10,944 in each window cycle checked, 1,043.3 wake-ups a minute in the game against 358.2 in the simulator.

## Scaffold builds from ruling 60's start

Six record jobs of the multi-copy scaffold builds and the two biochamber loop builds, each recorded from ruling 60's start (`start: "backpressure"`, 2026-11-19, Factorio 2.1.24) on every copy of its
scaffold, by the generic test of the missing recordings, and each recorded twice: both runs give the same summary and the same per-copy result, to the tick. Each case judges every copy by itself: its whole window cycles from steady
state to the first loss, and the whole window cycles of the last minute after the last loss. The scaffold pins of `scaffold-recordings.game.test.ts` stay as they are.

| Job (case) | Clock (window cycle) | Copies built | Window cycles per copy before / after the losses | Steady state | Last loss recovered | Result |
| --- | --- | --- | --- | --- | --- | --- |
| `AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING` (`automation-science-240-one-output-swing`) | Coordinated Sources (72, `37805909`) | 9 of 9 | 50 / 50 | 7,701 | 28,403 (gear wheel cut 18,159, output block 22,574, copper plate cut 28,403) | holds |
| `AGRICULTURAL_SCIENCE_250` (`agricultural-science-250`) | Takt Batches Observed, 2 swings (960, `997b3c3c`) | 5 of 5 | 3 / 3 | 6,524 | 24,959 (bioflux cut 15,841, output block 19,572, nutrients cut 24,959) | holds |
| `AGRICULTURAL_SCIENCE_250` (`agricultural-science-250-backed-up`) | the same clock | 5 of 5 | 3 / 3 | 6,524 | 24,959 | holds |
| `IRON_BACTERIA_380_CULTIVATION` | see "Loop builds and ruling 60's start" above | 1 of 1 | 2 / 2 each | 7,056 | 14,348 / 14,131 / 14,621 | holds |
| `AUTOMATION_SCIENCE_240` (`automation-science-240`) | Coordinated Sources (72, `0bc638ab`) | 9 of 9 | 50 / 50 | 7,200 | 16,823 | holds: every copy, copy 2 over whole repeats; pinned |
| `ELECTROMAGNETIC_SCIENCE_330` (`electromagnetic-science-330`) | Takt Batches Observed (2,112, `c3b310df`) | 11 of 11 | 1 / 1 | 5,712 | 37,644 | holds: every copy, copies 1 and 3 over whole repeats; pinned |

- **Agricultural science.** The sample states a dead end on each of its lanes, so its build with belts under backpressure is the sample itself, one record job: the same clock, the same result to the tick (as their scaffold pins say). The scaffold's four loaders
  drain the bioflux and nutrients belts and the packs go into infinity chests, so the case sets `block_sinks` (the output block fills those chests). All five copies make 800 in every window cycle judged.
- **Automation science 240, copy 2.** In the case with three losses in a row the output block and the copper plate cut last 5 and 4 ticks (the gear wheel cut recovers over the target before it is over the baseline's lowest minute), and after them
  copy 2 settles into a cycle of five window cycles that makes 30 of 32 once and 34 once (a hand of 2 moves from one window cycle to the next); it makes 1,600 of 1,600 over the 50 window cycles of the last minute,
  and is short by 2 in 10 of them. Each loss alone (`automation-science-240-gear`, `-block`, `-copper`, from the baseline) holds on all nine copies in every window cycle. A copy after a loss is judged over whole repeats (see the paragraph on `judgeAfterLoss` above): copy 2 makes 1,600 of 1,600 over the last 10 window cycles (two repeats of five), so the case with the three losses holds and is pinned (clock `0bc638ab`, run ends at tick 16,823).
- **Electromagnetic science 330.** A window cycle is 2,112 ticks (one whole window cycle judged before the first loss: steady state 5,712, first loss 9,312). After the supercapacitor cut, one copy is short by one hand (16 of 1,056) in the
  last judged window cycle: copies 1 and 3 in the run of three losses (their window cycles alternate 1,040 and 1,072, and make 2,112 of 2,112 in two), copy 10 in the case of the cut alone (`electromagnetic-science-330-supercapacitors`).
  The accumulator cut (`-accumulators`) and the output block (`-block`) alone hold on all eleven copies. In the run of three the output block lasted 22 ticks. A copy after a loss is judged over whole repeats: copies 1 and 3 make 4,224 of 4,224 over the last two window cycles (one repeat of two) and the other nine copies 5,280 of 5,280 over five, so the case with the three losses holds and is pinned (clock `c3b310df`, run ends at tick 37,644, with a tail of 18,000 ticks after the last recovery).
- The cases `automation-science-240-gear`, `-block`, `-copper` and `electromagnetic-science-330-accumulators`, `-block`, `-supercapacitors` have no entry in the controls file: they stand beside the case with the three losses, to say which loss each is.

```
MISSING_RECORDINGS_CAPTURE_DIR=.scratch/judged-start npm run test:game -- tests/game/builds/missing-recordings-clock.game.test.ts -t 'agricultural-science-250: '
```

## The builds with a case file of their own, from ruling 60's start

Five families record the clock the record selects for their jobs under their own probe and protocol. Their cases that carry the selected clock (not the hand-made clocks, the
alternatives the record offers, or the one-copy case of the inserter build with backpressure on its belts) now start from ruling 60's state, the harness's backpressure start
(`staged: true, backpressure: true` in the case, as `pickup-clock-capture.ts` reads them), on Factorio 2.1.24. Each run is repeated once with the recording cache off and gives the same
run, tick for tick, and the same judgement of each copy. `pickup-clock-capture.ts` keeps the game's report of the opening in `opening.json` beside the run. The generic case of the
logistic science build with direct insertion (`start: "backpressure"` in `missing-recordings-clock-fixtures.ts`) is run the same way.

| Job (case) | Clock (window cycle) | Copies built | Steady state | Losses recovered at | Start before (steady state; losses recovered at) |
| --- | --- | --- | --- | --- | --- |
| `PROCESSING_UNIT_80_CIRCUIT_EXPORT` and `..._BACKED_UP` (`generated-as-is`, `generated-backed-up`) | Coordinated Sources (24, `5259f325`) | 1 of 1 | 7,200 | 15,145 (plastic bar cut), 18,823 (output block) | free warm-up: 7,208; 15,218, 18,898 |
| `UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN` (`generated-one-copy`) | Coordinated Sources (168, `53fb2eed`) | 1 of 3.5 | 7,130 | 16,102 (coal cut), 21,142 (output block), 26,350 (units cut) | free warm-up: 7,131; 16,439, 21,479, 26,687 |
| `INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK` and `..._BACKED_UP` (`generated-three-copies`) | Coordinated Sources (72, `ba4e269d`) | 3 of 3 | 7,200 | 15,772 (ore cut), 15,909 (output block), 15,945 (circuits cut) | free warm-up: 7,200; 15,586, 15,763, 15,835 |
| `GRENADE_240_FILLS_BELT_EXACTLY` (`generated-full-build`) | Round-Robin Polling (112, `a0b0cff9`) | 7 of 7 | 7,353 | 14,906 (foundries stopped), 19,678 (output block), 23,646 (drills stopped) | free warm-up: 7,354; 14,907, 19,679, 23,647 |
| `LOGISTIC_SCIENCE_240_DIRECT_INSERT` (generic case `logistic-science-240-direct-insert`) | Coordinated Sources (576, `539e717d`) | 1 of 6 | 7,056 | 14,599 (inserters cut), 19,015 (output block) | plain staged start: 7,056; 14,600, 19,016 |
| `LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS` (`generated-one-copy`) | Euclidean Swings (96, `fdfe060f`) | 1 of 6 | 7,152 | 14,567 (inserters cut), 18,791 (output block) | free warm-up: 8,155; 15,624, 19,848 |

All hold: the net output over the baseline's whole window cycles is the target (processing unit 4,800 of 4,800, utility 8,064 of 8,064, inserter 14,400 of 14,400, grenade 14,336 of 14,336,
logistic 2,304 of 2,304 and 2,368 of 2,368), every loss falls and is recovered, and the output stock guard holds. On the inserter build each of the three copies makes its 4,800 over the
baseline, and on the grenade build each of the seven its 2,048.

- **Processing unit 80 (the pick the triage marks at risk).** The start differs from the free warm-up's by a few ticks (steady state 8 ticks earlier, the plastic cut recovered 73 ticks and
  the output block 75 ticks earlier) and the run holds the same. The fill ends steady 7,200 ticks after the build is placed; two machines are filled by inserters with no window, four only by windowed ones and three by no inserter;
  no windowed inserter moved in the fill.
- **Inserter crafting.** Six machines are filled by inserters with no window, the fill ends steady after 14,400 ticks (two windows), and 12 inserters with no window moved in it.
- **Grenade, utility science 480, logistic science with direct insertion.** Every inserter of these builds has a window, so the fill holds nothing back
  and no inserter moves in it (no machine is filled by an inserter with no window): their start is the plain staged start in effect, as for rocket fuel above.
- **Named limits (copies).** The sample's scaffold of the utility science 480 build holds one copy of the job's 3.5 (137.14 packs a second of 480), and that of the logistic science build with direct insertion one of the job's six (40 of 240);
  the joins of the other copies (the lanes they share) are not in these runs, and the harness builds the copies a blueprint holds, not more. The jobs are judged on the one copy. This holds for `LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS` (Euclidean Swings, 96 ticks) too: it runs on the same one-copy scaffold of the job's six, and the chemical science jobs below (`CHEMICAL_SCIENCE_240_SHARED_FOUNDRY` and its `_BACKED_UP` variant) are judged on their one copy, one block of the 5.5 that make 240/s.
- **The two processing unit 80 cases the record offers and does not select** (`per-hand-as-is`, `per-hand-backed-up`, the 24-tick clock of the hands in groups) and the hand-made clocks stay as they were recorded, from a free warm-up.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/judged-start-5 npm run test:game -- tests/game/builds/grenade-clock.game.test.ts -t '^grenade clock: generated-full-build$'
```

## The search from every stable clock, from ruling 60's start

`CLOCK_SEARCH_FROM_EVERY_START=1` starts the local choice of Coordinated Sources from every stable clock, not only from those that tie the recommended clock
([Coordinated Sources](../../../docs/clock-candidates.md#coordinated-sources)). It is off by default, so the record does not select what it picks. Each pick it moves
is recorded here from ruling 60's start (`staged_start.backpressure`) on the sample's scaffold, in Factorio 2.1.24, and pinned in
[filled-start-search-clock-controls.json](filled-start-search-clock-controls.json). The generic protocol records the advanced circuit and production science cases
(`from_every_start` in [missing-recordings-clock-fixtures.ts](missing-recordings-clock-fixtures.ts)); the builds' own probes record the processing unit, car and silo cases
([filled-start-search-clock.game.test.ts](filled-start-search-clock.game.test.ts), [filled-start-search-clock-fixtures.ts](filled-start-search-clock-fixtures.ts)). Each test makes the clock with the
switch on (`helpers/search-switch.ts`) and finds it is not the record's. `src/crafting/filled-start-search.generation.test.ts` finds each pin made with the switch on.

| Job (case) | Pick | Steady state | Last loss recovered | Result |
| --- | --- | --- | --- | --- |
| `ADVANCED_CIRCUIT_240` and `..._BACKED_UP` (one copy of three) | Coordinated Sources (528, `11c668b4`) | 6,768 | 22,764 | holds: 6 of 6 window cycles before and after the losses |
| `PROCESSING_UNIT_80_CIRCUIT_EXPORT` and `..._BACKED_UP` | Coordinated Sources (24, `0bdd8324`) | 7,204 | 18,847 | holds: 4,800 of 4,800 in the baseline |
| `IRON_PLATE_80_CAR_CHEST` | Coordinated Sources (144, `dc5394b0`) | 7,200 | 18,498 | holds: 4,800 of 4,800 in the baseline; the third drill stop lasts one tick |
| `LITHIUM_PLATE_80_SILO_CHEST` | Coordinated Sources (4,320, `660fda31`) | 9,262 | 34,937 | falls short: 11,456 of 11,520 over the baseline's two whole clock cycles (99.4 %); no entry |
| `PRODUCTION_SCIENCE_120_TWO_BELTS` and `..._SHARED_PICKUP` | Coordinated Sources (336, `e87ab62b`) | not recorded | | the harness refuses ruling 60's start for this build (`no_staged_start`); no entry |

- **Production science.** A drill drops stone straight into the rail assembler, so a machine that only windowed inserters feed holds items at the opening, which the harness refuses
  ("Machines that only windowed inserters fill hold items at the opening: assembling-machine-3 (unit 376): 164 in, 0 out, 0 made"). The `..._SHARED_PICKUP` job is a variant with no scaffold of its own.
- **Lithium silo.** The baseline is two whole clock cycles (8,640 ticks), as the protocol allows for a clock cycle longer than a minute. The fifth furnace ends each cycle 24 to 48 plates short of its 960.

```
MISSING_RECORDINGS_CAPTURE_DIR=.scratch/search npm run test:game -- tests/game/builds/missing-recordings-clock.game.test.ts -t from-every-start
BELT_SPEED_CAPTURE_DIR=.scratch/search-family npm run test:game -- tests/game/builds/filled-start-search-clock.game.test.ts
```

## The scaffold builds of four science packs, from ruling 60's start

The generic test of the missing recordings (`missing-recordings-clock.game.test.ts`) records the selected clock of these jobs from ruling 60's start (`start: "backpressure"`) on the
sample's scaffold, on every copy the scaffold holds, with the standard losses (an ingredient cut, the output block, an ingredient cut), in Factorio 2.1.24. Each run was made twice
with equal summaries. They are pinned in [missing-recordings-clock-controls.json](missing-recordings-clock-controls.json); the scaffold pins of the same builds stay in `scaffold-recordings.game.test.ts`.

| Job (case) | Clock | Copies built | Steady state | Last loss recovered | Result |
| --- | --- | --- | --- | --- | --- |
| `UTILITY_SCIENCE_120` (`utility-science-120`) | Takt Batches Observed (672, `8c6d44c1`) | 1 of 7 | 7,135 | 25,951 (cut low density structure 15,871, output block 20,575, cut processing unit 25,951) | holds and recovers from all three; the record says "no recovery" |
| `UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT` | Coordinated Sources (336, `4d76e238`) | 2 of 7 | 6,960 | 23,312 | holds: both copies 960 of 960 in each of 10 window cycles before and after the losses |
| `MILITARY_SCIENCE_240` | Coordinated Sources (80, `4c0ccc46`) | 5 of 5 | 7,200 | 23,713 | holds: each copy 2,880 of 2,880 |
| `CHEMICAL_SCIENCE_240_SHARED_FOUNDRY` and `CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP` | Coordinated Sources (352, `1fa2ce23`) | 1 block (the job's one copy, 480/11 a second; 5.5 of them make 240/s) | 7,120 | 23,895 (cut sulfur 10,720, output block 15,095, cut advanced circuit 19,671) | holds: 2,560 of 2,560; the two jobs have the same clock and the same run |
| `PRODUCTION_SCIENCE_120_TWO_BELTS` and `..._SHARED_PICKUP` | Euclidean Swings (336, `fdadf120`) | 1 of 7 | 6,960 | 21,697 (cut electric furnace 15,985, output block 16,070, cut productivity module 21,697) | holds: 960 of 960 in each of 10 window cycles before and after the losses; both jobs have the same clock and the same run |

- **Utility science 120.** The record's verdict for the clock is "no recovery", from the loss of low density structures on the copies that share a lane. The scaffold holds one copy, so no lane is shared
  and the game recovers from the loss (as in "Utility science 120: the selected clock from the staged start" above, now from ruling 60's start). The seven-copy scaffold of the jobs is recorded below, "The stamped scaffolds of the job's copies".
- **Chemical science.** abucnasty's whole build (5.5 copies, `chemical-science-240-shared-foundry-full-build.blueprint`) is refused by the staged start: "The clock names inserters 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
  of the config, which match no inserter of the build in copy 6 of 6". The partial copy holds some of the config's inserters. The warm-up path of the harness takes that into account when it wires the clock, and the staged path does not (read from `src/harness/factorio-harness.ts`; not changed here).
- **Production science.** The clock gives the drill that drops stone into the rail assembler a window, so the drill depends on a clocked entity. Before, it ran in the first stage and put 164 stone into the rail assembler
  before the lock was on, and the harness refused the start ("Machines that only windowed inserters fill hold items at the opening: assembling-machine-3 (unit 376): 164 in, 0 out, 0 made", both jobs, twice each).
  The first stage now builds a drill with a window disabled by script, and the fill sets it free once the clock is wired with its lock on: the rail assembler is empty at the opening, as a machine only windowed inserters fill is.
  A drill with no window runs in the fill, and a machine it fills counts as unclocked. The build holds one copy of the job's seven. On the seven-copy stamp it holds on all seven (below, "The stamped scaffolds of the job's copies").
- **Military science.** The scaffold holds the job's five copies, 9 tiles apart.

```
MISSING_RECORDINGS_CAPTURE_DIR=.scratch/scaffold-builds npm run test:game -- tests/game/builds/missing-recordings-clock.game.test.ts -t 'utility-science-120|military-science-240|chemical-science-240'
```

`scripts/recording_count.py <commit> <out.md>` counts which record jobs have a recording that holds from ruling 60's start (usage in its docstring). A job built on fewer copies than the job has reads
"ruling 60's start: N of M copies built" there, whatever its `limit` says.

## The stamped scaffolds of the job's copies, from ruling 60's start

A scaffold of one or two copies leaves the joins of the other copies out of a run, so these builds have a scaffold of all the job's copies beside the one-copy scaffold, in the item's folder of `resources/config-samples/`
as `<stem>-<N>-copies.blueprint` (`<stem>-<role>.blueprint`, a blueprint string that is not the one-copy scaffold). Each repeats the scaffold's copy along its belts at the build's spacing, so the copies share the input belts and
each copy has its own output belt and void chest. They are used by the game tests only (`missing-recordings-clock.game.test.ts`, the case's `scaffold`); `npm run record` still builds the one-copy scaffolds.
The belts of each were traced with the pinned belt tracer (`trace.py`, which agrees with the game on 596 of 596 reads of the automation science 240 scaffold's output side; its input side and three side-load cases are not pinned,
and it sizes only 3x3 assemblers) and compared with the scaffold: no overlap, the same unpaired undergrounds, the same last tiles of the shared lines, one line to a loader for each copy, and every belt tile of the stamp has a
tile of the scaffold of the same kind at a whole pitch (the belt that stops at the scaffold's last copy runs on through the others).

The selected clock of each job, from ruling 60's start, every copy, the standard losses (Factorio 2.1.24, `CLOCK_RECORDING_CACHE=off`, each run twice with equal summaries and equal per-copy verdicts), pinned in
[missing-recordings-clock-controls.json](missing-recordings-clock-controls.json):

| Job (case) | Clock | Copies built | Steady state | Last loss recovered | Result |
| --- | --- | --- | --- | --- | --- |
| `UTILITY_SCIENCE_120` (`utility-science-120`) | Takt Batches Observed (672, `8c6d44c1`) | 7 of 7 | 7,135 | 21,919 (cut low density structure 16,225, output block 16,543, cut processing unit 21,919) | holds: each copy 960 of 960 in each of 5 window cycles before and after the losses; recovers from the low density structure stop, where the record says "no recovery" |
| `UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT` (`utility-science-120-processing-unit-and-lds-on-one-belt`) | Coordinated Sources (336, `4d76e238`) | 7 of 7 | 6,960 | 19,576 | holds: each copy 960 of 960 in each of 10 window cycles before and after the losses |
| the same, the flying robot frame cut from the baseline (`...-frames`) | the same | 7 of 7 | 6,960 | 14,892 | holds, same result |
| `PRODUCTION_SCIENCE_120_TWO_BELTS` (`production-science-120-two-belts`) and `..._SHARED_PICKUP` (`production-science-120-two-belts-shared-pickup`) | Euclidean Swings (336, `fdadf120`) | 7 of 7 | 6,960 | 16,682 (cut electric furnace 16,617, output block 16,637, cut productivity module 16,682) | holds: each copy 960 of 960 in each of 10 window cycles before and after the losses; the two jobs have the same clock and the same run |
| `ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED` (`electromagnetic-science-240-recycler-belt-fed`) | Coordinated Sources (40, `3202663f`) | 5 of 5 | 7,200 | 15,175 | holds on each copy's stretch (2,880 to 2,907 of 2,880 before the losses, 2,885 to 2,899 after); the recyclers' returns are random, so a copy's window cycles fall short of 32 by a few items (12 to 19 of 90) |
| the same, the output block from the baseline (`...-block`) | the same | 5 of 5 | 7,200 | 23,579 | holds on the stretch, each copy |
| the same, the superconductor cut from the baseline (`...-superconductors`) | the same | 5 of 5 | 7,200 | 15,472 | **not pinned**: copy 5 makes 2,877 of 2,880 in the last minute after the cut (both runs); the other four make 2,881 to 2,909 |

- **Why the split cases.** After a loss that recovers, the output is back over the target before it is back over the baseline's lowest minute, so the next loss in the same run falls and is released within a few ticks: the
  output block and the superconductor cut of the electromagnetic run lasted 4 and 2 ticks, and the flying robot frame cut of the utility run 20 ticks. Each such loss has a case of its own, from the baseline, as the cases of the other builds in this file.
- **Utility science 120** is the record's "no recovery" pick (copy 7 stays at 0 after an LDS stop in an earlier game run on a seven-copy build, read in "Utility science 120: the selected clock from the staged start" above). On this scaffold every copy recovers and
  the run holds. That differs from the record's "no recovery", which is pessimistic against the game on seven copies (a simulator gap); the entry is pinned with what the game does. The earlier game run on a seven-copy build kept copy 7 at 0; why this one differs is not established (untested: the start, which was not ruling 60's).
- **Electromagnetic 240, the superconductor cut.** The recyclers give back what the game rolls, so a copy's last minute can fall a few items short of 2,880 with nothing wrong with the clock; copy 5's 2,877 is 0.1% short.
  The case is kept in the fixtures with no pin, and the job's other cases hold.
- **Production science 120** (both jobs) needs the harness of the drill-fed start (the section "Scaffold builds of four science packs" above: a drill that drops into the rail assembler is held until the clock is wired); the first runs of the stamp, before it, were refused at the opening on all seven rail assemblers. The block lasted 11 ticks and the productivity module cut 45 ticks, as in the one-copy run.

```
MISSING_RECORDINGS_CAPTURE_DIR=.scratch/stamped BELT_CLOCK_CALIBRATE=1 CLOCK_RECORDING_CACHE=off npm run test:game -- tests/game/builds/missing-recordings-clock.game.test.ts -t 'utility-science-120|electromagnetic-science-240-recycler'
```

## The side pickup builds, from ruling 60's start

The twelve turbo side pickup builds of the speed coverage (`moving-pickup.game.test.ts`, the different-items fixture with the electromagnetic plant; `same-item-pickup-clock.game.test.ts`, the
same-item fixture with the gear assembler; each on the straight belt, the underground entrance and the exit, belt moving or under backpressure (the cases' `backed`)) record the selected clock of their record job from ruling 60's start
(`staged: true, backpressure: true` in `capturePickupClockSpeed`) on Factorio 2.1.24, with the standard losses (an ingredient cut, the output block, the other ingredient cut). Each case was run twice with
the recording cache off, with equal summaries, and is pinned in [pickup-clock-controls.json](pickup-clock-controls.json) (the entry, its clock hash and the game version).

| Job (case) | Clock (window cycle) | Steady state | Losses recovered at | Start before (steady state; losses recovered at) |
| --- | --- | --- | --- | --- |
| electromagnetic, straight belt, backed and moving | Takt Batches Swings 1 (352, `c9c84d59`) | 7,120 | 14,653, 19,005, 22,877 | free warm-up: 7,120; 14,654, 18,878, 22,750 |
| electromagnetic, underground entrance, backed | same | 7,120 | 14,653, 19,005, 22,877 | free warm-up: 7,120; 14,782, 18,878, 23,230 |
| electromagnetic, underground entrance, moving | same | 7,120 | 16,190, 20,414, 24,991 | free warm-up: 7,121; 16,192, 21,824, 25,695 |
| electromagnetic, underground exit, backed | same | 7,120 | 14,653, 19,005, 23,101 | free warm-up: 7,120; 14,782, 18,878, 22,878 |
| electromagnetic, underground exit, moving | same | 7,120 | 16,191, 21,823, 27,455 | free warm-up: 7,121; 16,192, 21,824, 26,112 |
| same-item, all six | Takt Batches Observed (160, `67586738`) | 7,122 | 14,501, 18,341, 22,181 | free warm-up: 7,123; 14,502, 18,342, 22,182 |

All twelve hold: the net output over the baseline's whole window cycles is the target (1,760 of 1,760 for the electromagnetic builds, 352 of 352 for the same-item builds), every loss falls and is recovered,
and the output stock guard holds. The one machine of each build is filled only by inserters with a window, so no inserter moves in the fill (`opening.json` beside each run): the start equals a plain staged start in effect, as for the grenade build above,
and the runs differ from the free warm-up's by a tick or a few hundred ticks of recovery only. The straight belt and the same-item builds give one run whatever the belt supply; the electromagnetic underground builds
recover later when the belt moves, as before.

```bash
BELT_SPEED_CAPTURE_DIR=.scratch/judged-start-10 npm run test:game -- tests/game/builds/moving-pickup.game.test.ts -t '^speed coverage: electromagnetic-turbo-underground-exit-moving$'
```

`recording_count.py` reads the start of these cases from `staged: true, backpressure: true` in the code that builds their scenario (`capture_scenario_start`). The two front exit jobs of the electromagnetic clock
(`front-exit-turbo-unmirrored-backed-different-items`, `front-exit-turbo-unmirrored-moving-config-different-items`) share the clock hash `c9c84d59` and read as holding from these recordings; their own cases in
`front-clock-controls.json` stay as they were recorded.

## The belt to steel chest to machine sample, from ruling 60's start

The sample `ELECTRONIC_CIRCUIT_2_BELT_CHEST` (one assembling machine 3 makes 2 electronic circuits a second; a turbo belt of iron plates, both lanes in stacks of 4, passes an inserter that drops into a steel chest of 4 slots,
and a second inserter takes the plates from the chest into the machine; every inserter a legendary stack inserter) records the clock its record job selects, `coordinated_sources` (window cycle 480, `bcbbac7e`, stable, 82.5 wake-ups a minute),
with `missing-recordings-clock.game.test.ts` and `start: "backpressure"` in its case, on Factorio 2.1.24, with `CLOCK_RECORDING_CACHE=off`. The first run (with `BELT_CLOCK_CALIBRATE=1`) wrote the entry in
[missing-recordings-clock-controls.json](missing-recordings-clock-controls.json); the second run, with no change, gave the same summary. The clock windows all four inserters, the belt inserter among them, and the recorder lists all four.

| Job | Clock (window cycle) | Opening: machines at the lock | Clock cycles before / after the losses | Steady state | Losses fell at | Losses recovered at |
| --- | --- | --- | --- | --- | --- | --- |
| `ELECTRONIC_CIRCUIT_2_BELT_CHEST` | Coordinated Sources (480, `bcbbac7e`) | empty (no ingredient, no output), all four inserters windowed | 7 / 7 | 6,960 | 13,483 (iron plate cut), 18,283 (block), 22,507 (copper cable cut) | 17,971, 22,291, 23,291 |

- The lock opened 7,200 ticks after the build was placed. The run holds: the baseline's net output over its 7 whole clock cycles is 112 of 112, the stock guard holds, and the copy makes its share (2 x 480 / 60 = 16 circuits) in every whole clock cycle before the first loss and in the cycles after the last one.
- The run recorded 30,522 ticks: the last recovery at 23,291, the tail of 7,200 and 31 more.
- The iron plate cut came first, so that the chest's stock is the baseline's. The chest was empty when the lock opened; while nothing was cut or blocked, the belt inserter put 16 plates more into it than the chest inserter took every 4 clock cycles, so it held 64 plates at the steady state, 96 when the cut began and 176 when the run stopped, never near its slot limit of 4 (400 plates). The output fell 2,923 ticks after the cut began, when those 96 plates were used (30 ticks a plate). At that rise the chest would reach 400 plates about 48,000 ticks after the lock opened, past this run: the clock with a full chest is not recorded in the game.
- The copper cable cut bit: the machine started its last craft with its last cable at tick 22,363 and stood without cable from 22,387 to 22,571; the output fell below the baseline's lowest minute 216 ticks after the cut began, and it recovered 784 ticks after the release.
- A chest of the full 48 slots is not recorded in the game; its clock is the same (`bcbbac7e`) and its generation is checked in the simulator only.

```bash
MISSING_RECORDINGS_CAPTURE_DIR=.scratch/belt-chest npm run test:game -- tests/game/builds/missing-recordings-clock.game.test.ts -t 'electronic-circuit-2-belt-chest: config-'
```
