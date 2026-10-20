# Stability: backpressure loss and active inserter windows

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals.

## Backpressure Loss

A clock must always recover. When any item of a build stops arriving for a while, or its output stops being taken, the machines run dry or fill up, and when the item comes back the build has to return to its target rate under the same clock by itself. Nobody should have to restart a build because one input ran out.

A clock that does this survives backpressure loss, and one that does not cannot survive backpressure loss. This is what "stable" has meant in this project: a stable clock is one that survives backpressure loss. A clock that only makes its target rate from a clean start, with every machine full of ingredients and emptied of products, does not meet goal 1.

Builds are classified the same way. Some builds cannot survive backpressure loss whatever the clock, such as a loop of machines that does not start again once it has run dry. That is a limit of the build, and it is fine to say so and to give such a build the clocks it can have, as long as they are named for what they are.

Decided on 2026-10-10, after a clock for the advanced circuit build that makes its 704 a period from a clean start made 608 and 624 in the game: one of its two plants held products when the clock started, and never caught up.

### How a clock is started

The default trial models the staged scaffold start: full input supplies, empty machines, buffers and inserters' hands, and clock phase 0 with no earlier run. The simulator's belts and infinity chests are supplies that are always full. A machine that makes its own ingredient (pentapod eggs) receives a one-time seed: `overrides.loop_seed_items` sets the amount (default 200). Model warm-up follows, up to 10 periods with an earlier stop when the state repeats, before output is judged; longer checks assess the settled output where available. This does not promise the target in the first period or convergence from an arbitrary live build state. The crafting cycle is still planned on a separate prepared build filled until its output is blocked (the prepare step). Where the belts move, the whole output swings a cycle can have are counted on that build with its belts backed up: a cold moving belt brings the first hands slower, and on the express moving half-tile pickups the plant got half the hands before its output blocked (2.75 hands against 5.5), which planned 2 output swings, a period of part ticks no moving clock can be made for, where observed windows hold at 3 (A4, 2026-10-20). Fractional swings keep the build's own count: it is their swings per cycle, not a cap.

Before, a clock started on that filled build with its output machines emptied, and no scaffold has that. A clock could hold from it and not from the scaffold's: the advanced circuit clock tightened by hand holds 704 a period from the filled build and, from the staged start, falls short of it from some start phases (544 from the start phase 88), as the game's plant fell to 608 and 624.

Where several inserters take a product from one machine in the same tick, the order they are updated in decides who gets it, and the turn rule (the one that took last is passed over) only decides when the machine holds less than a hand and someone has taken before. Where it cannot decide (the machine holds a hand or more, or nobody has taken yet) the inserters are updated in descending config ids, the one built last first, as the thaeln scaffold was recorded (`clock-generator/src/control-logic/inserter/competing-takers.ts`). The order is a parameter of a run (`competing_takers_order`: descending, ascending or a seed).

### Start dependence

By default every clock is selected and judged from the cold start alone, one run for each, and the generator says that start dependence was not checked (`start_dependence_note` of the result, and a line in the output of the scripts). A clock can reach its target from the cold start and settle elsewhere from another start: the same windows made 3,072 packs a period from one start and 2,560 from another on the thaeln-cell09 sample.

`overrides.check_start_dependence` in the config asks for it to be checked (the scripts in `clock-generator/scripts` take `START_DEPENDENCE=1`; the UI has no setting for it). Every clock is then also run, as its long run is, from:
- the cold start with the clock standing 30, 300, 700 and 1,000 ticks into its period at the first tick (`cold+N`; the cold start itself is the 0; a clock whose period is not a whole number of ticks is tried unshifted only),
- the cold start with the competing inserters served in ascending config ids (`ascending`),
- the cold start with the competing inserters of each machine served in a random order, drawn from a fixed seed for the whole run, twice (`random-1`, `random-2`).

The ordinary clock checks include 12 clock offsets and independent moving-lane phases. A start reaches the target when the clock holds its expected output in every period of the judged part of the long run (for the cold start: all the checks of the generator). A clock that fails one of the checks that are not about the start (the one-period check, the sampled offsets or lane phases) fails from every start, even if each long run keeps up, so it is unstable and not start-dependent. The verdict of the clock from the starts:
- **stable**: it reaches its target from every start;
- **start-dependent**: it reaches it from some start and not from another, judged on the same checks;
- **unstable**: it reaches it from none, which is the verdict it would get with the check off.

A start-dependent clock is listed as unstable in the one word of the clock (`verdict`) and named by `assessment.start_dependence.verdict`; it is not selected as holding. The result says where it reaches the target and, for each start that settles elsewhere, the rate and the cycle it repeats in (items per period, in the order they come), as one line: "start-dependent: reaches 480/s from cold, cold+300; settles at 2880 a period (128.6/s, cycle 2784/2944/2912) from ascending." The numbers of every start are in `assessment.start_dependence.starts`.

The requested override alone is not evidence that a check completed. A null `assessment.start_dependence` can mean not requested or unavailable; the UI preserves the request and generation completion separately and counts actual returned starts. Fractional periods omit shifted-phase samples. Holding from the modeled cold start, numerical rate, sampled-start verdict and evaluated recovery are separate facts: a start-dependent clock can hold its requested rate and have usable loss-trial results while its overall verdict is unstable.

### How a clock is tried for it

Ordinary moving pickups are checked with independent phases on their two lanes, for both settled output and
loss recovery. An interruption can shift one lane relative to the other even when a shared clock shift passes.
The checks advance each lane through one stack-spacing cycle at its belt speed: 2 phase positions on turbo,
8 on express, 4 on fast and 8 on normal. Both matching lanes are combined for one pickup at a time; other
pickups keep their default phases. This bounded check does not enumerate joint phases across a conveyor
network or combine every lane phase with every clock offset. Backed-up pickups retain their finite
stationary-stock initialization. These are verification starts, not new config settings or a change to the
pickup timing rule.

The generator tries every clock that holds its expected output, in the simulator. A loss is one item that stops arriving from the belts and infinity chests of the build, or one output that is no longer taken away. Each loss is cut at four places in the clock period, and at each it lasts a quarter, a half, three quarters and all of the time the build takes to stop. The build has stopped when nothing was moved, crafted or burned for a whole period; a loss ends after 200 periods at the latest. When the item is back the build has 40 periods to be at exactly its expected output again, and has to stay there. The slowest clock of the samples that gets back takes 19. The trials are the same for every build and every clock, and are defined in `clock-generator/src/crafting/backpressure-loss.ts`.

A clock that holds its expected output and does not get back from a loss is not stable. It is listed as a clock with no recovery, with the losses that break it, and it is only selected when no clock of the build survives. On the samples the selection changed for two builds: agricultural science, whose selected clock did not get back from a loss of nutrients, and military science, where from the staged start no clock is stable: two (the selected one is among them) hold their output and are broken by a loss, and the others fall short of it from some starts, because the machine that makes the grenades can stop with its output full and too little iron left to craft again, and then makes half of its grenades and packs in a period. No clock of the metallurgic science sample gets back from a loss of tungsten ore, so that build keeps its clocks under that name; its selected clock holds its output and does not get back from that loss, and comes before the plain 1-swing clock at the same rate, which does not hold at all (see "Wake-ups", two clocks equally near the target).

The saved 336-tick Thaeln lean-coal clock illustrates the exact per-period requirement. With an unused belt
pickup counter removed from repeat keys, the coal-loss trials can settle into a proven repeating output cycle
`764,772,764,772` after a partial loss. That averages 768 items per period but does not produce 768 in every
period, so the existing rule calls it **no recovery**. The regression records this outcome rather than changing
the trial policy or restoring a counter that does not affect pickup behavior.

One kind of build is left out of this. Where a build has a deadlock risk (see "Two inserters that bring the same item"), its clocks are tried and their verdicts shown, and the verdict does not decide which is selected.

This can cost wake-ups: goal 1 comes first. The clock selected for agricultural science then had 3,950 a minute where the one before had 2,543. Since the rules of issue 152 (2026-10-14, "When a waiting inserter acts") batched swings gets back from every loss on that build and is selected again, at 3,651. That is under review under the staged start: batched swings and fractional swings no longer get back from a loss of nutrients there (a hand short in a late period), and the 2-swing clock is selected; the owner is reviewing the recovery rule.

Fluids are not cut, as the simulator leaves them out. The harness has no setting that cuts a supply, but it runs Lua it is given, and the belt-pickup clock tests in `clock-generator/tests/game/builds` use this to cut supplies in the game: twice, at fixed periods of the run, an ingredient is taken off every belt of the build (a different one each time where the build has two), the output is blocked once between those cuts, and the output of every period before and after is counted. Those builds have one machine each, and these cuts are not the trials above: the trials have not been run in the game, and no sample build has had a supply cut there.

The trials do not catch the clock that led to this rule. The advanced circuit clock with windows of 4 ticks gets back from all 48 of its trials in the simulator, and made 608 and 624 of 704 in the game. That is a known gap. From the staged start the check of 12 start phases does fail that clock, at the start phase 88 (544 of 704), so the clock is no longer taken for one that meets goal 1; the loss trials are only run on clocks that hold, and still do not see it. The trials are not to be changed until they fail that one clock: a check that is tuned to a build is no longer a check for any build.

## Active Inserter Windows

An active inserter window is defined as a period where an inserter receives a signal from a decider combinator telling it to be enabled. During that window it has the ability to actively do work and transfer materials from a source to a sink.


### Active Inserter Windows Definition of Good

A good clock output reduces an active inserter window to run just in time to transfer the items the machine needs to keep on crafting to meet the target production rate. This means that many times the inserter will transfer multiple times back to back to meet the transfer goal. Reducing the duration of an active window can lead to instability. The measure for a good active inserter window is when the inserter can pick up the items it needs in the least number of ticks. The output from a machine has also another special consideration which is that it should attempt to pick up the full stack size whenever possible. If it cannot do this, it should minimize the amount of time sitting idle over the machine, picking up the output one craft at a time.

