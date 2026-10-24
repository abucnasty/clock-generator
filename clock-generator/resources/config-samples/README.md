# Sample configurations and scaffolds

One folder per build, grouped by what it makes: `science/`, `intermediates/`, `gleba/`, `smelting/`. A folder holds
the build's config(s) as JSON and, where one exists, its scaffold. `src/config/config-paths.ts` names the general samples used by sweeps;
two of them exist to be refused ([below](#samples-that-are-refused)).

A **scaffold** is a blueprint string of exactly one copy of the build without a clock: the machines and inserters the
config describes, in the ideal environment for a clock to be added to them. That environment is the scaffold's own:
infinity chests that feed it and void chests that drain it, infinity pipes for fluids, and whatever circuitry it needs,
for example a belt end limited by combinators so that items do not spoil on it while the belt in front of the
inserters stays full and moving. The harness (`npm run record`) builds the scaffold in a headless Factorio, adds a
generated clock, wires it to the inserters of the config, and leaves everything else in place: it removes only a
clock the generator made (the combinator described as "Clock for ..." and the combinators wired to it). It refuses a
build with something on a machine of the config that the config does not have, since no clock would hold it: an
inserter, whatever is at its other end, a further machine of one of the config's recipes, or a loader.
`npm run test:game` does this for the builds listed in `tests/game/builds/scaffold-recordings.game.test.ts` and checks
that the selected clock moves the expected output every period. One run records at most 72,000 ticks, 20 minutes of
game time. A clocked recording is whole periods of its clock, at least the ticks asked for, so a request whose whole
periods pass the limit is refused with the most that fits (warm-up and settle do not count). A recording is the only thing that settles a
disagreement between the simulator and the game: on 2026-10-08 the agricultural science recordings found two inserter
rules the simulator was missing, and the automation science ones found that the generator was selecting a clock that
over-produces.

Conventions:
- `<build>.json` is the config; variants get a suffix that says what differs (`-chain-always-on`, `-belt-fed`).
- `<build>-scaffold.txt` is the one-copy scaffold; `-scaffold-full-build.txt` is kept only for reference.
- Every config is in the current shape: each machine names its `prototype` (the one its scaffold shows) or none, never a
  `type`. `src/config/current-samples.test.ts` fails on a sample that a load-time migration would change; the former
  shapes live only in `src/config/fixtures/legacy/`, one per migration.
- Most scaffolds have belts closed at the end, so supply backs up once full. Iron bacteria's creeps (below).
  Isolated moving/underground and same-item pickup experiments live under
  [game mechanic fixtures](../../tests/game/mechanics/belt-pickup/README.md), with their own catalog and probes.
- The clocked inserters see a steadily supplied belt: full of whole stacks at the rate the build takes them, whenever
  they reach for it. How is the scaffold's business. Enough stack inserters from infinity chests and a closed end do
  it; so does an end that lets a little through on a timer, as the iron bacteria scaffold has to keep its nutrients
  fresh (32 items in every 61 ticks, and every hand there still fills a stack a tick). An end that drains freely
  can expose slower pickups and gaps, as the moving electromagnetic science samples demonstrate; those differences
  must be measured and represented rather than assumed away.
- The scaffold is the build its config describes, inserter for inserter. Every recording is checked for it: the stack
  size of each inserter, and which of two items on its belt an inserter takes first (`near_lane` in the config, the
  lane nearest to it in the build). A config that differs is reported before anything else, since a clock made for
  it is not a clock for the build.
- Crafting speeds and productivity come from the sidecar mod in the Factorio version the scaffold is for (2.1 rounds
  beacon bonuses differently from 2.0).

## Status

| Build | Scaffold | Recorded | Note |
|---|---|---|---|
| science/agriculture-science | yes | selected and 5-swing clocks exact over 300 periods before the idle-window rules of 2026-10-09; with them, recorded again that day: the 5-, 1- and 2-swing clocks with the same output in every period of 150, 150 and 75 (the 2-swing clock twice). The 2-swing clock was the one selected from 2026-10-10; since 2026-10-14 (issue 152) batched swings gets back from every loss and is selected again, and the game tests recorded it that day both ways, 400 in every period; the 2-swing clock again while batched swings' nutrients trials dipped a hand late in their 40 periods, and batched swings since such a trial runs on (2026-10-24), recorded that day both ways, 400 in every period, and with the three family cuts (bioflux 2 periods, output 4, nutrients 2): back at 400 from the first or second period after each and for the 62 periods after the last | in `test:game`, both ways; with "Backed-up belts" on the simulator is off the game by an item a period on four inserters, see "Backpressure loss" |
| science/automation-science | yes | selected clock exact | in `test:game` |
| science/automation-science, belted buffer | yes | selected clock exact | in `test:game` |
| science/logistic-science, direct-insert | yes (2026-10-21) | selected clock exact, with "Backed-up belts" off and on: 64 in each of 374 periods of 96 ticks (fractional swings, 2 output swings per cycle; 40 a second a copy, 240 over 6 copies), 200.0 wake-ups a minute in the game against 175.0 in the simulator (2026-10-24). The config is the build on turbo belts, each science assembler with an input belt of its own; it replaced a yellow-belt config whose transport belt machine could not be built. The transport belt foundry's productivity of 50 is what the game records. With the ingredients cut twice and the outputs blocked once, the clocks selected on 2026-10-21 (288 ticks) made 192 again from the first period after each | in `test:game`, both ways |
| intermediates/low-density-structure | yes | selected clock exact. Since 2026-10-11 the selected clock is batched swings with 6 output swings per cycle, 703 wake-ups a minute, where full-hand output swings (1,528) was selected while the ranking put it first on a machine with spare speed; recorded exact the same day, 36,000 ticks | in `test:game` |
| science/chemical-science, shared foundry | yes | selected clock exact: 256 in each of 102 periods of 352 ticks (1 output swing per cycle, 5.5 copies of 240 a second); the runner-up (2 output swings, 122.1 wake-ups) recorded too, 122.7 in the game; the selected clock's wake-ups are not held (see below) | in `test:game`, wake-ups open |
| science/utility-science | yes | selected clock exact, with "Backed-up belts" off and on: 192 in each of 53 periods | in `test:game`, both ways; a build with a deadlock risk, see "Backpressure loss" and below |
| science/utility-science, belted blue and LDS | yes | selected clock exact, off and on: 96 in each of 107 periods. Since 2026-10-12 the selected clock is the one with 2 output swings per cycle, which is stable without a search, so the searches are left out; uneven output swings was selected while they ran for every build, at the same 10.7 wake-ups a minute with 5 windows against 7. Recorded that day both ways: 96 in each of 107 periods, 10.7 wake-ups a minute in the game as in the simulator | in `test:game`, both ways |
| science/utility-science, direct-insert LDS | yes | 32 and 160 of 192 in turn, in the game and in the simulator alike | no clock holds the rate: the generator's to solve, see below |
| intermediates/advanced-circuit | yes | selected clock exact: 1056 in each of 45 periods of 792 ticks, and 704 in each of 68 of 528 with "Backed-up belts" on | in `test:game` with the switch off; see below |
| intermediates/advanced-circuit, 230 a second | the same scaffold | selected clock exact: 16,192 in each of 2 repeats of 12,672 ticks (23 periods of 550.957), the first clock of this sample that holds, found by the one search of 2026-10-11 | in `test:game`; see below |
| intermediates/accumulator, 640 a second | yes | the clock 0.9.0 selected made 512 to 544 of 576 a period; the observed windows clock 0.9.1 selected made 576 in each of 58 periods after 3 at 544 while it settled (60,264 ticks). Since even hands (2026-10-14) the selected clock is that: 576 in each of 46 periods after the game test's settling of 7,200 ticks, no difference from the simulator | in `test:game`; see below |
| gleba/iron-bacteria-cultivation | yes | selected clock exact over 42 repeats of its 1728 ticks (20 minutes) | in `test:game`; see below |
| science/electromagnetic-science | yes (2026-10-16, 12 legendary beacons) | selected clock exact: 352 in every period of 704 ticks (batched swings, 2 output swings per cycle; 30.0 a second a copy, 330 over 11 copies). Unclocked the scaffold makes 30.1 a second a copy. The config's crafting speed is 109.475, what 12 beacons give in the game | in `test:game`; fluids from infinity pipes, the belt's accumulators and supercapacitors from infinity chests |
| science/electromagnetic-science-auto | the same scaffold | the same build with the enable control of both output inserters on `AUTO` (`electromagnetic-science-auto.json`); `terminal_swing_count` and `lcm` have no `AUTO` value and are kept. Selected clock exact: 352 in every period after the first; from a staged start (empty machines) the first period makes 288 | in `test:game` |
| science/metallurgic-science | yes (2026-10-21) | the build: a cryogenic plant, an assembler 3 and two foundries, all legendary, with 5, 4, 8 and 9 legendary beacons. The config's speeds are the game's, 68.875, 40.3125, 180.75 and 191.481, where the tooltip's 68.9, 180.8 and 191.5 had been, and its packs go into a chest that removes them, where a chest of 480 had filled up. The science foundry has 1 tick to spare a period of 320. As is, the selected clock (observed windows, 3 output swings) recorded on the scaffold with the ore belt drained: 240 a period, and 240 again within a period or two after the tungsten ore was cut for two periods, the output blocked for four and the coal cut for two. The simulator calls it "no recovery" from the loss of ore, so here it is more pessimistic than the game. With "Backed-up belts" on the selected clock (observed windows, 2 output swings, a subtick clock of 640 ticks) is stable, and recorded 480 in 51 of 56 periods and 496 in the other 5: in the game the science foundry runs at its full speed, 481.5 a period, where the simulator holds it to 480 | not in `test:game`: that test asks for the same output in every period, and the game moves a hand more in about 1 period in 11 |
| real/composite04/cell07 | yes (the cell's, #189) | selected clock exact, with "Backed-up belts" off and on: 2112 in each of 25 periods of 1408 ticks (2 output swings per cycle, a subtick clock; 90 a second), 500.7 wake-ups a minute in the game, 520.0 in the simulator. With the coal cut for two periods, the output blocked for four and the electronic circuits cut for two, it made 2112 again from the first period after each, the coal line drained or backed up. The target is 90, the rate the cell is built for: the extraction had set the demand of its consumers, 2161/24 = 90.0417 a second, at which no clock held. The coal belt carries coal on both lanes, and the output chests remove what they get, as in the scaffold | in `test:game`, both ways |
| real/stupidfathobbit/cell02 | yes (given 2026-10-23, 111 entities) | a clock holds 80 a second, as it is and with "Backed-up belts" on. The build makes 82.86 a second with no clock (the cell in the save made 79.96, its output backing up). The generator's clock is 24 ticks, one hand cycle, 32 processing units a period: the hands in groups, with the inserters whose hands take the whole cycle (the circuits into the processing unit machines, the iron and the cable into the circuit machines) enabled all the time and the others in windows (11,295 wake-ups a minute in the simulator as it is, 11,186 backed up; any group of windows can move 4 ticks either way and still hold). It makes 32 in each of the 63 untouched periods in the game and is back at 32 after the plastic is cut for 100 periods and after the output is blocked and the export stopped for 100 periods. Stopping the export alone does not reduce the output, so it is cut with the output block. Before, no clock held: the best, 3 output swings, was unstable at 65.19 in the simulator and made 66.4 in the game. The circuits leave on belt 2, an export belt at 40 a second a lane, measured from the save the cell came from (#189); the scaffold throttles that export to 80 a second with a constant combinator's signal S, and its four throttle inserters, their infinity chests and combinators are environment, not in the config. The simulator has no consumers on that belt, so with every inserter enabled the export inserters put 141 a second on it where the scaffold lets 80 through, and its unclocked baseline is 71.4 against the game's 82.86 (#376); no clock's verdict depends on it | selection and verdict pinned in `stupidfathobbit-cell02.generation.test.ts`; recorded in the game by `test:game` (`tests/game/builds/stupidfathobbit-cell02-clock.game.test.ts`)
| science/logistic-science, inserter crafting | yes (2026-10-21) | one of the three copies of the inserter build (240 a second over the three): an inserter assembler with 4 speed modules and 8 beacons (73.984375), fed plates by two furnaces and gears by a gear assembler (40.3125), which two more furnaces feed (86.1655 and 91.875), all legendary. Each pair of furnaces takes its ore from a line of its own; the ore, so every product, is uncommon. The output inserter runs all the time at 80 a second. With no overrides, the selected clock (2 output swings, 72 ticks) recorded 96 in every period, the ore lines drained or backed up, and 476.4 wake-ups a minute in the game against 648.8 in the simulator; with "Backed-up belts" on, the clock then selected (3 output swings, 36 ticks) made 48 in every period. Both got back to their rate after the ore and the circuits were cut for 20 periods and the output blocked for 20. With "Backed-up belts" on the selected clock is now 6 output swings in 72 ticks: 96 in each of 499 periods, 741.1 wake-ups a minute in the game against 550.0 in the simulator from its start and 647.5 to 716.3 by where the clock starts (2026-10-24; no losses recorded on it). The hand-made clock on all three copies, 216 ticks, held 80 a second each on the ore lines drained, and got back too; the harness records it as it records a generated clock, and the selected clock (72 ticks) wired to each copy of the same build held 80 a second each and got back too, with a one-period shortfall after the circuits were cut ([the build and the runs](../../tests/game/builds/README.md)) | in `test:game`, both ways |
| real/owner/lithium-silo | yes (a blueprint given 2026-10-21) | two cryogenic plants fill a rocket silo taken as a chest and six furnaces empty it, all legendary, 80 plates a second. The selected clock (3 output swings, 1080 ticks) recorded 1440 in every period, both build orders, and got back to it after the holmium plates were cut twice and the output blocked; the clock with 1 output swing too. The clock with 7 output swings is short in the game (a side-loaded output belt, the sample's README). 0.0 wake-ups a minute in the simulator, 20.0 in the game: a chest end wakes no one in the simulator | in `test:game` |
| real/owner/car | yes (a blueprint given 2026-10-22) | a big mining drill drops iron ore into a car taken as a chest and two furnaces empty it, all legendary, 80 plates a second; the harness puts the ore under the drill. The selected clock (3 output swings, 72 ticks) recorded 96 in every period, both build orders, and got back to it after the drill was stopped until the car ran dry, twice, and the output blocked; the clock with 1 output swing too. 200.0 wake-ups a minute in the simulator, 3.8 in the game, not yet explained | in `test:game` |
| real/owner/grenade | yes (blueprints given 2026-10-23: the scaffold, the wiring guide, the full build of seven copies) | four assemblers on grenades, a foundry casting iron and four drills dropping coal into the assemblers, all legendary, 240 grenades a second over 7 copies on one turbo belt whose two lanes are exactly full. The hand-made clock (112 ticks) and the selected clock, the 112-tick clock with its windows made from the hands and the sources ("Hands in groups", `docs/stability.md`), made 64 in each of 63 periods on one copy and 448 on the full build, with no output inserter waiting for the belt, and got back after the foundry was stopped, the output blocked until the belt was full and the drills stopped. Wake-ups a minute: 118 simulated and 226 in the game for the hand-made clock, 119 and 258 for the selected one (not yet explained) | in `test:game` |
| real/owner/productivity-chain | yes (given with its config, 2026-10-23, 95 entities) | a chain of nine legendary machines (plastic, copper cable and iron casting, electronic circuits, advanced circuits, productivity modules) with three steel chests between them, a coal belt and an output belt, 80 modules a second over 6 copies (16 a period of 72 ticks for one copy). Unclocked the scaffold makes 13.52 a second a copy (81.1 over 6, 101.4% of the target). No clock observed from the plan holds; the selected clock, the 72-tick clock with windows made from the hands and the order of the chain ("Hands in groups", `docs/stability.md`), made 16 in each of 63 periods and 499 of 499 in the longer recording, and got back to 16 after the coal was cut for 40 periods, the output blocked for 24 and the iron foundries stopped for 26. Wake-ups a minute: 575.6 simulated and 602.8 in the game, with "Backed-up belts" off and on (the clock kept before the rule ranked its placements: 843.8 and 858.5) | in `test:game` |
| smelting/steel-wagon | yes (a blueprint given 2026-10-22) | one cargo wagon is a hub: a big mining drill fills it with iron ore, a furnace makes plates from the ore and puts them back, a second makes steel from the plates and puts it back, and one inserter takes the steel out onto the output belt, all legendary, 26 steel a second; the wagon's slots are filtered (20 ore, 5 plates, 5 steel, 10 blocked), and the harness puts the ore under the drill. The steel leaves through the wagon, so the inserter that takes it out is the output inserter. The selected clock (planned with belt slack, a subtick clock of 886.15 ticks) recorded 4,992 in every period of 11,520 ticks, both build orders, and got back to it after the drill was stopped until the wagon ran dry, twice, and the output blocked; the clock planned without iron ore in its period too. A full plate or steel filter stops a furnace a few ticks a period with no steel lost. 81.6 wake-ups a minute in the simulator, 83.1 in the game | in `test:game` |
| everything else | no | | |

## TODO: scaffold backfill

Builds without a scaffold have labels and selections that only the simulator vouches for. Most of them moved on
2026-10-08 when the belt pickup rules and the long-run stability check changed, so each needs a recording before its
label is trusted. One copy each, in the build's folder, named `<build>-scaffold.txt`; then add it to
`tests/game/builds/scaffold-recordings.game.test.ts` with its seeds, if any, and the warm-up and settle it needs.

In the order they would settle the most:
1. **science/logistic-science** (shared-inserter, sample): the 1-swing label of the shared-inserter and sample configs
   flipped from unstable to stable. Direct-insert has its scaffold (Status above).
2. **science/production-science** (shared): its rate changed in the sweep.
3. **intermediates/processing-units** (belt export): rates moved slightly.
4. **gleba/rocket-fuel** and **gleba/jellynut-processing**: 3-swing rates swapped between the two jelly stack configs.
5. **science/military-science**, **intermediates/flying-robot-frame**,
   **intermediates/lithium-plates**, **intermediates/electric-engine-unit**,
   **gleba/biochamber-fuel**, **smelting/stone-bricks**, **smelting/electric-furnace**: never recorded.

## Samples that are refused

One sample exists to be refused, not to generate a clock from, and needs no scaffold. `ExpectedRefusals` in
`src/config/config-paths.ts` lists it with the reason it is kept and the error generating it must fail with;
`src/config/expected-refusals.test.ts` checks it, and the sweeps leave it out.

- `intermediates/accumulator/accumulator-bad-config.json` (`BAD_ACCUMULATOR_CONFIG`) is the coverage check's
  deliberately invalid config (PR #53): its machine has no inserters. It fails with "Missing inserter coverage".

## Backpressure loss

Since 2026-10-10 a clock is stable when it holds its expected output and gets back to it after every backpressure
loss of its build (GOALS.md, "Backpressure Loss"). Every clock that holds is tried for it, in the simulator only.
`scripts/sweep.sh` writes the verdict of every clock, and `scripts/backpressure-sweep.sh` every trial.

What it changed on the samples, against the sweep before it (`gates-off` and `gates-on`):

| Sample | Before | Now |
|---|---|---|
| Military science | full-hand output swings, 67.5 wake-ups a minute | batched swings without belt pickup slack, 0 wake-ups: the only clock of seven that gets back from a loss of coal. With "Backed-up belts" on, batched swings too |
| Agricultural science | batched swings, 5 output swings per cycle, 2,543 wake-ups a minute | 2 output swings per cycle, 3,950 (4,127 with the switch on): the 5-swing clock does not get back from a loss of nutrients; the 2- and the 1-swing clock do |
| Utility science, "Backed-up belts" on | batched swings, 0 wake-ups | batched swings, as before: by the trials alone it was uneven output swings (5.4), which deadlocks in the game; the build has a deadlock risk, so the verdict does not decide (below) |
| Metallurgic science | full-hand output swings on a subtick clock | the same clock, as one with no recovery: it does not get back from a loss of tungsten ore, and it is the only clock of the build that holds |

Clocks that were not selected and are no longer stable: observed windows on jellynut processing with rocket fuel
(bioflux), observed windows and uneven output swings on shared production science (packs not taken away), and
observed windows (low density structures) and batched swings without the slack (packs not taken away) on utility
science. No other sample changes: 33 of 39 are the same both ways. Generating all samples took 6% longer with the
switch off and 23% longer with it on, on a machine that was busy with other work.

Recorded in the game on 2026-10-10 after the change, 12 builds, 10 as before:

- **Utility science with "Backed-up belts" on moved nothing under uneven output swings**, the clock the trials had
  moved its selection to: 0 of 192 in each of 53 periods, where the simulator has it stable at 192 from every start
  and back from every loss. It is the deadlock of two inserters that bring the same item (GOALS.md, a rule of the
  game from the user's own testing), and a risk of the build, not of that clock alone. The generator now reads the
  risk off the config: inserters 1 and 2 both bring low density structures to machine 1, and each brings another
  item too. No other sample has it. On a build with the risk the verdict of the trials is shown and does not decide
  the selection, so utility science selects batched swings again with the switch on, as before the trials. When the recording starts the
  machine holds 16 processing units, 16 low density structures and no flying robot frames, and the inserter that
  brings the frames holds 12 low density structures and waits for more: it cannot put them into a machine that is
  full of them, and it brings no frame while it holds them. Started in that state the simulator stays in it for the
  2,016 ticks tried, as the game does, so the simulator has the deadlock; neither the start the generator gives a
  clock nor any trial for backpressure loss gets the build into it. Under batched swings the game made 192 in each
  of 53 periods. How the build gets there under uneven output swings is not traced, by decision: it is a known risk
  of the build. The recording is `.scratch/recordings/utility-science-backpressure-uneven-output-on.json`.
- **Agricultural science with "Backed-up belts" on**: the 2-swing clock moved its 800 packs in every period. The
  four inserters that bring nutrients to the egg biochambers moved 979.89 nutrients a period in the game and 980.85
  in the simulator, a difference the game test of the build left open; the game test of 2026-10-24 found none in any
  inserter or machine. Since a loss trial short only late in its 40 periods runs on, batched swings is selected with
  or without the switch, and the game test of 2026-10-24 on it finds 400 in every period and no difference. With the
  inserters that take eggs out of the loop on windows (later that day) it finds the same, 400 in every one of 74
  periods with and without the switch, and the game test leaves the wake-ups open: the game counts 134.3 a minute for
  each inserter that brings nutrients to an egg biochamber, the simulator 36.6 (a wake in the tick after the window
  opens, where the nutrient biochamber puts out the products it holds), 1,791.4 a minute in all against 1,257.8.

Known gaps of the trials:

- They do not catch the clock that led to the rule: the advanced circuit clock with evenly spaced windows of 4 ticks
  gets back from all 48 trials in the simulator and made 608 and 624 of 704 in the game. Nor do they find anything
  on the clock its reporter tightened by hand (48 of 48), which holds in the game.
- They do not catch the utility science deadlock above, which is why a build with that risk is named by its shape.
- Both are states a build is in when a clock is put on it while it runs, and no loss of the trials leads to them.

## Margin: windows a tick shorter

A diagnostic of 2026-10-10, not a check the generator makes (GOALS.md, "Working Rules": margin comes before
precision). `scripts/margin-sweep.sh` tries every stable clock with every window a tick shorter at its start, and
again with every window a tick shorter at its end, each as the generator checks its own clocks; `margin-table.py`
prints the table. A window of one tick is left as it is. With "Backed-up belts" off, without the processing unit
sample with a belt export:

- 132 stable clocks on 34 samples; one could not be built again from its windows (fractional swings on biochamber
  fuel). Of the other 131, 81 hold both ways and 50 hold neither way. No clock holds one way only.
- The selected clock holds both ways on 21 samples and neither way on 12: advanced circuit, chemical science with
  direct-insert engines, chemical science engines, electric furnace, flying robot frame, logistic science with a
  shared inserter, the four production science samples, the sample config, and utility science with direct-insert
  low density structures and its chain always on. On 7 of them no stable clock holds both ways.
- It does catch the advanced circuit clock with evenly spaced windows of 4 ticks (352 of 704 either way), which the
  trials for backpressure loss do not. It also fails the clock its reporter tightened by hand (608 of 704 either
  way) and the clock selected for that build (864 of 1056), and both of those were recorded in the game at their
  full output in every period. A clock whose windows are as long as its hands loses a hand with a tick less, whether
  it is a good clock or not.
- The trials cost a tenth of the time generating takes.

It is not wired into anything.

## A clock started on a build that runs without one

A second diagnostic of 2026-10-10, not a check the generator makes, tried and removed. `clockStartOf` let the build run
for 3,600 ticks with every inserter always enabled, the warm-up a scaffold gets in the game, then started the clock at
each of the four places in its period the loss trials use, each on a run of its own, and wanted exactly the expected
output within 40 periods, and for good. The clock was cut off from what it enables through a switch in the enable
controls (`GameClockWires`), as an "unclocked" kind of loss. `scripts/clock-start-sweep.sh` tried every stable clock
that way and `clock-start-table.py` printed the table below. Without its clock a build does run faster in the
simulator: advanced circuit makes 1,210 where its clock expects 1,056, utility science 224 for 192.

Removed on 2026-10-11 (the function, the loss kind, the switch and the three scripts are in the git history up to
v0.6.0): it changed no verdict, and it does not probe the gap it was aimed at. The short state of the advanced circuit
build comes from a start short of ingredients or from the state the game was recorded in, which an unclocked warm-up
does not reach; what that gap needs is a start state handed to the run (`start_stock`), which stays.

- It fails no clock. With "Backed-up belts" off 131 of 132 stable clocks get to their output, the slowest within
  19 periods, and with it on 106 of 107; the one left over is fractional swings on biochamber fuel, which cannot be
  built again from its windows. The trials cost 3% of the time generating takes.
- It catches none of the three cases it was held against. The utility science clock that deadlocks in the game
  (uneven output swings, backed-up belts) is at 192 within 2 periods from all four places. The advanced
  circuit clock with windows of 4 ticks is at 704 within 3, and the clock tightened by hand within 6. The nearest
  clock of the sample at 230 a second, which the generator's own check has at 216.9, makes its full 16,192 in the
  second of two repeats of 23 periods from all four places; that is judged on one repeat, and it is not known here
  what the game made of that clock.

It was never wired into anything.

## Iron bacteria

Recorded on 2026-10-09 in Factorio 2.1.21, with 50 bacteria seeded into each machine (the recipe makes bacteria from
bacteria) and 3,600 ticks to settle. The selected clock is 6 output swings per cycle on a subtick clock of 90.947
ticks, with the belt inserters enabled 17 ticks in every 30.3. Over 72,576 ticks it moves 10,944 bacteria in each of
the 42 repeats of 1728 ticks its clock counts, and 576 in each of their 798 periods when a repeat is cut into its 19:
380 a second for 20 minutes. Without a clock the build makes 406.7 a second, all its machines can.

What kept the generator from selecting any clock for this build on 2026-10-08 was its own long run, which counted a
period of 90.947 ticks in bins of 90: neither the belt pickup rules nor the nutrient inserters' windows. The simulator
and the game agree on this build hand for hand (3,384, 752 and 869 hands in 376 periods of the clock rounded to 90
ticks), and within a thousandth on the long-run rate of every alternative but the 5-swing one, which makes more than
the target in both: 402.7 a second in game, 394.4 in the simulator.

Open, and harmless for the selected clock: after a belt inserter has waited for the machine to take bioflux again,
the game has the first stack in its hand one tick after the machine's bioflux falls to 27, the simulator two ticks
after (352 and 349 waits measured). Whether that is the deciding tick after a wait or the order in which machines and
inserters are updated was not settled.

Open in the long run itself, reached by no sample: a fractional period whose repeat is more than half the judged
periods (41 to 79 of them in the usual run) is judged as that one repeat; and where not even one repeat fits, the
judged periods are compared as one span, which can pass a clock that is short by just under two hands of every
output inserter over it.

Open, fitted: `MACHINE_HANDS_SURPLUS` (1.43, the windows of an inserter between machines) is a number found with the
game on the agricultural science build on 2026-10-09; the simulator passes 1.30, which starved two of its clocks in the
game. To be replaced by a value derived per build, or by a setting the user controls. Neither is done.

## Utility science

Closed on 2026-10-10. The three builds had been recorded short of their target under clocks the simulator calls
stable (144 of 192 a period, 64 or 80 of 96, 32 or 160 of 192), which read as a rule of the game the simulator was
missing. There were two causes, and one of them was not in the simulator:

- The scaffolds were not the builds the configs describe. In both belt-fed scaffolds the inserter that brings
  processing units and low density structures was set to a stack size of 12, and the configs say 16. With 12 in the
  config the simulator made what the game made (80 and 64 in turn on the belted build), and with 16 in the scaffold the
  belted build made its 96 in every period. The scaffolds now have 16. With 12 the generator finds no clock for the
  plain build at all.
- An inserter takes from the lane of its belt nearest to it first (GOALS.md, "What an inserter takes off a belt
  first"). The simulator took the first of its filters, which on the plain build was the processing units where the
  game takes the low density structures. Under batched swings with slack both made 192 a period, with 64 and 128
  items through the two inserters in the game and 96 and 96 in the simulator; under the clock that was selected for
  backed-up belts the game made 96 where the simulator made 192. With the lanes of that belt swapped in a copy
  of the scaffold the game took the processing units first, and the simulator matched it as it was. The configs of
  every scaffolded build now name the nearest lane.

With both, the selected clocks of the plain and the belted build hold their rate in the game with "Belts do not
move" off and on, and the simulator moves what the game moved through every inserter.

Open:
- **Direct-insert LDS** has no clock that holds 240 a second: the selected one alternates 32 and 160 of 192 a period
  in the game and in the simulator alike. The simulator is right about it; a clock for the build is still to be found.
- Batched swings on the plain build has three steady states at 192 a period, with 10.7, 26.8 and 32.1 wake-ups a
  minute by where the clock starts. The generator's run counts 10.7; the game settled into 26.8. The potential clocks
  list the figure of the generator's own run.
- With 2 and with 1 output swings per cycle the plain build only holds its rate with belt pickup slack (the 2-swing
  clock was recorded with it at 192 in each of 53 periods). With "Backed-up belts" on they are listed as unstable:
  they were the last two clocks of any sample that were made again with the slack there, neither was selected, and
  that fallback was removed on 2026-10-10.

## Accumulator

The build of [issue 152](https://github.com/abucnasty/clock-generator/issues/152), 640 accumulators a second over 18
copies: two electromagnetic plants make accumulators (50% productivity), two cryogenic plants batteries (200%), and two
foundries cast the iron and the copper (150%), all from infinity pipes. The config is `accumulator-640.json`
(`ACCUMULATOR_640`) and the scaffold `accumulator-640-scaffold.txt`, both as the issue gives them; the issue's config
also has "Search for fewer wake-ups" on, which selects the same clock, since no clock made without a search is stable.

The clock 0.9.0 selected (observed windows, 2 output swings per cycle) was stable in the simulator and made 528, 544,
544, 544, 544, 528 and 512 of its 576 a period in the game, that cycle over and over. Started in the state the game
was in (`.scratch/issue-152/` on the machine the work was done on), the simulator parted from the game at two rules,
now in GOALS.md, "When a waiting inserter acts": an inserter whose window opens in the tick another inserter takes the
products of the machine it puts into takes its first items a tick later, unless that other inserter's window opened in
that tick too; and a hand from a machine does not fill while the machine it puts into is at its output block. With
them the simulator has that clock at 512 and selects another observed windows clock, which the game held at 576.

Since 2026-10-14 the generator selects even hands for it (GOALS.md, "Wake-up Lists"): every inserter one window a
hand, spread evenly over the period of 972, so the two halves open and close together on 5 window deciders
(accumulators, iron into the accumulator plants, iron and copper into the battery plants, batteries), at 601.9
wake-ups a minute in the simulator against 2,906.7 for the observed windows clock. Recorded on the scaffold: 576 in
each of 46 periods, no difference from the simulator, 972 wake-ups a minute in the game (the simulator counts 278.5 to
940.7 by where the clock starts). The generator shows 601.9: the count of the steady
state its own start settles into, as for every clock (GOALS.md, "Wake-up Lists"). The scaffold starts the clock on a
build that ran free for its warm-up, and settles into another state, which the simulator counts at 940.7 when it
starts the clock elsewhere in the period; the game test accepts that figure. Under the same clock with all its windows starting at 0 and a period of 486, the
iron and battery inserters whose windows opened with the output inserter's took their first items a tick later at 4
places in the period (300 cases), where the simulator takes them in the tick: a fourth item for the list below.

What is left between the simulator and the game on this build, a tick at a time, and changes no verdict found:
- at one place of the seven-period cycle that the old clock settled into, the iron and copper inserters of a battery
  plant whose window opened with that of the output inserter took their hands a tick later in the game (36 cases), where
  the same window a period earlier took them in the tick, as the simulator does;
- an inserter that waited 6 ticks or more for the battery plant took its first items a tick later in the game where the
  plant finished a craft the tick before (16 of 16), against the rule recorded on the scaffolds (3,696 there); on the
  scaffolds the inserter that took the products had been waiting at the machine, here it was on its way back;
- a battery plant whose craft ends on a whole tick starts the next one in that tick in the game, with no progress, and
  in the next tick in the simulator: its ingredients go a tick earlier in the game.

## Chemical science with a shared foundry

The block given on 2026-10-15: four chemical science assemblers and four engine assemblers sharing one foundry that casts the pipes, 5.5 copies of it making 240 a second. The selected clock counts 82.2 wake-ups a minute in the simulator and 122.7 in the game; the runner-up counts 122.1 and 122.7. The whole difference is 40.9 in four inserters, the belt inserters of the science machines (10.2 each, one wake-up a period in the game, none in the simulator): in the game the machine starts its next craft one tick after the inserter began to wait for space, in the simulator on the same tick, and a wake-up needs the inserter to have waited the tick before. Moving every machine start one tick earlier gives the simulator's figure in the game's recording; one tick later gives 204.8 in the simulator. What the build moves, and what every inserter and machine does, is held; the clock's wake-ups are not, and in the game the two stable clocks tie at 122.7, so no selection is shown to be wrong. Open: which side of the tick is off (the restart of a machine after its short wait for ingredients, or the order of the start and the inserter's state change inside a tick). The recording merges the block's north and south supply belts into one belt each, so a comparison reports the near lane of four inserters (config 6, 8, 14, 16) as wrong although the config matches the scaffold.

## Advanced circuit

The build of [issue 98](https://github.com/abucnasty/clock-generator/issues/98), 240 a second over three copies. The
sample is the copy whose plastic plant is reached by 4 beacons (crafting speed 61.5), as two of the three copies of
the design are; the third has 5 (68.875), which is what the config attached to the issue says. The whole design is
kept as `advanced-circuit-scaffold-full-design.txt`. Until 2026-10-10 the sample had a
target of 230 a second, for which no clock holds.

That one is kept as a second sample, `advanced-circuit-230.json` (`ADVANCED_CIRCUIT_230`), with the subtick clock
that was exported for it then. It is the same build as the one at 240 and uses the same scaffold: the same five
machines, nine inserters and five belts, numbered differently. Its config differs in three things only: the target
rate, the coal inserter set to always enabled, and `ignored_lcm_ingredients` for coal. Both samples give each plant its
own input belt and its own output belt, as the scaffold does: each input line has its own feeders, and the two output
lines meet only past both plants. Splitting them changed none of either sample's clocks. So the same machines hold 240
a second under a stable clock, and until 2026-10-11 no clock held 230: the nearest made 217.3 on a clock rounded to
550 ticks. At 230 the clock period is not a whole number of ticks (550.957), and that is where the gap was thought to
be: in planning a clock whose period is not whole, not in the build
([issue 102](https://github.com/abucnasty/clock-generator/issues/102)). The one search of the windows of a clock
(2026-10-11) finds full-hand output swings that hold it in the simulator, stable from every start and through every
loss, at 600 wake-ups a minute: the old search confirmed the first timing without a wait and gave up after a few, the
new one ranks a timing whose neighbours pass first and confirms up to five. Recorded the same day on this scaffold
(`CONFIG=ADVANCED_CIRCUIT_230 TAG=230` on `scripts/record-clock.js`): the game moved 16,192 items in each of the 2
repeats of 12,672 ticks that fit the recording, exactly what the clock asks for, at 769 wake-ups a minute against the
simulator's 600. The build is in `test:game` since. The simulator had called a clock of this build stable before that
made 90% in the game, so the recording, not the simulator, settles it.

Recorded on 2026-10-10, 36,000 ticks each, wake-ups a minute for one copy:

| Clock | Output | Game | Simulator |
|---|---|---|---|
| The reporter's, tightened by hand | 704 in each of 68 periods | 355 | 395 (355 or 395 by where the clock starts) |
| Made by version 0.5.0 | 704 in each of 68 | 464 | 757 (757 to 1,268) |
| Selected now, batched swings with 3 output swings | 1056 in each of 45 | 400 | 510 |
| Selected with "Backed-up belts" on, 2 output swings | 704 in each of 68 | 389 | 627 |
| Evenly spaced windows of one hand (4 ticks) for the belt inserters | 608 and 624 in turn, of 704 | - | 704, at 545 |

The two selected clocks are those the generator makes since the simulator has the tick an inserter takes to wake
(GOALS.md, "When a waiting inserter acts"): their windows moved by a few ticks, and they were recorded again. With
510 against 400 the build is over the quarter the game tests allow, so its wake-ups are not held there yet
(`wake_ups_open` in the test); what it moves is.

The rule's count (GOALS.md, "The rule's count and the clock-or-unwired advice"), recorded on 2026-10-14 unclocked and on
the selected clock, 15,840 ticks each after the first period (`scripts/rule-count-game-check.js`), w a minute for each
inserter, game against simulator:

| Group | Unclocked | Clocked | w removed |
|---|---|---|---|
| electronic circuit from the belt | 1,164 / 1,075 | 68 / 78 | 1,096 / 998 |
| copper cable from the foundries | 1,414 / 1,325 | 236 / 236 | 1,178 / 1,089 |
| plastic from the cryogenic plant | 1,289 / 1,200 | 109 / 109 | 1,180 / 1,091 |
| coal from the belt | 469 / 438 | 27 / 27 | 441 / 410 |
| advanced circuit output | 902 / 1,119 | 159 / 168 | 743 / 951 |

Every group is called "clock" in both. The machines craft at the same rate in both (2,752 products a minute an
advanced circuit plant). The output's difference is the one in the table above: the simulator shows the output as
waiting on its plant where the game shows it working, so the simulator counts a craft (742 a minute) where the game
counts a pickup (760). The inputs into the plants count about 8% more sink wake-ups in the game, unclocked; why was
not looked into. No call changes, so both are left (working rule 2).

In true starts (the call since 0.12.0), the same recordings and those of the accumulator, low density structure and
agricultural science scaffolds (2026-10-15, the same way: warmup, settle and seed as in the game tests, the first period
left out), the game read by the series' method as every recording is, w removed a minute for each inserter, game
against simulator, with the original count after it:

| Build | Group | True starts | Original count |
|---|---|---|---|
| Advanced circuit | electronic circuit from the belt | 589 / 584 | 1,096 / 998 |
| | copper cable from the foundries | 653 / 653 | 1,178 / 1,089 |
| | plastic from the cryogenic plant | 641 / 641 | 1,180 / 1,091 |
| | coal from the belt | 232 / 325 | 441 / 410 |
| | advanced circuit output | 743 / 951 | 743 / 951 |
| | pooled | 609 / 665 | 982 / 963 |
| Accumulator | accumulator output | 567 / 563 | 567 / 563 |
| | battery into the accumulators | 462 / 499 | 462 / 499 |
| | iron into the accumulators | 774 / 804 | 774 / 804 |
| | copper into the batteries | 1,111 / 1,141 | 1,520 / 1,559 |
| | iron into the batteries | 1,101 / 1,141 | 1,511 / 1,559 |
| | pooled | 803 / 830 | 967 / 997 |
| Low density structure | plastic from the chest | 695 / 859 | 1,450 / 1,800 |
| | plastic from the cryogenic plant | 702 / 893 | 1,457 / 1,834 |
| | low density structure output | 251 / 579 | 251 / 579 |
| | pooled | 568 / 809 | 1,088 / 1,439 |
| Agricultural science | bioflux and nutrients into the nutrient biochambers | 127 / 70 | 159 / 117 |
| | nutrients into the egg biochambers | 116 / 129 | 202 / 266 |
| | bioflux and nutrients into the science biochamber | **-184 / 218** | **-240 / 257** |
| | science output | 721 / 945 | 721 / 945 |
| | pooled | **106 / 213** | **98 / 283** |

On the first three builds every call is "clock", firm, in both counts and in both the game and the simulator. The
output of a part-hand machine differs most (the simulator counts craft wake-ups where the game counts pickups), and the
low density structure inputs, on sinks where the method is exact, count about 25% more in the simulator. On
agricultural science, whose input sinks are all biochambers, where the method is a known miss, two calls differ in both
counts (in bold): in the game the input into the science biochamber wakes more on the clock than without it, and it
waits for space with part of a hand on 431 samples on the clock against none without. Why is not known. No selection
depends on these calls, so they are left (working rule 2). The comparisons are in `.scratch/geppetto/recordings-0.12/`
on the machine they were made on.

The last row is the clock that rule was read from (`src/crafting/wake-after-output-block.test.ts`). One plant made its
352 a period and the other 264, from the first period the clock ran on the build. That plant held 14 advanced circuits
when the clock started and 9 after its first output window, so it was over its output block of 21 before every
output window from then on, and no window of that clock takes more than is made. The simulator has that state: a run
started in it holds what the game held, tick for tick, as it does for the clock tightened by hand and, with
`.scratch/belt-first-stack-after-a-limit-lifts.patch`, for the 0.5.0 clock and the clock selected before. Started as
the generator starts a clock, the plants filled with ingredients and emptied of products, it holds 704, and so the
generator takes the clock for one that holds. `.scratch/tools/sim-from-recording.js` starts the simulator in the
state of a recording and names the first tick where the two part.

The clock tightened by hand is the one to beat: no clock the generator offers comes near it. Its gains in the game
are the coal inserter, 95 wake-ups a minute down to none with windows of one hand (6 ticks), and the two output
inserters, 48 each down to 14 and 20 with two short windows in every crafting cycle that take what has piled up.
`clockFromWindows` builds and checks a clock from windows like these, and `scripts/record-clock.js` records one
(`WINDOWS=`); the windows are in `src/crafting/clock-from-windows.test.ts`.

Open:
- A clock is checked from the start the generator gives it and, since 2026-10-10, after each backpressure loss
  (above). A build that gets its clock while it runs starts elsewhere: with ingredients below their limits and
  products in the plants. The evenly spaced clock is the case, and the trials for backpressure loss do not catch it. In the simulator the clock selected now also ends up short (495 of 528 products a plant) when the plants
  start with 10 to 26 plastic, which the game was not seen to do.
- The simulator counts far more wake-ups than the game on the output inserters (50 a minute each against 4.5 under
  the clock selected now), from every start of the clock, also in a run that holds what the game held. It is in the
  status shown, not in what the inserters do. Two differences are found. An inserter that holds part of a hand from a
  machine shows as working, not as waiting for more items, in a tick in which that machine finishes a product (18,871
  cases of 18,871 over the recordings); with that the 50 would be 36. And with part of a hand carried over from the
  window before, the game shows the inserter as working in its first enabled tick. They do not account for all of it.
- An inserter that takes off a belt for a machine at its insertion limit lands its first stack in the tick after the
  craft that takes the ingredient down (844 cases of 844 on five builds), and a tick later in the simulator. The
  patch named above has it; it moves the windows of several samples by a tick and is not applied.
- On the other scaffolds a run started in the state of a recording parts from the game within 100 to 550 ticks, as
  it did before the rule above. On the utility science builds it is the first stack of a belt inserter whose window
  opens on a machine at its output block: it lands in the tick the output inserter takes the products in some cases
  and a tick later in others, and the simulator has the first for all.
