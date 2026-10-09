# Sample configurations and scaffolds

One folder per build, grouped by what it makes: `science/`, `intermediates/`, `gleba/`, `smelting/`. A folder holds
the build's config(s) as JSON and, where one exists, its scaffold. `src/config/config-paths.ts` names every config.

A **scaffold** is a blueprint string of exactly one copy of the build without a clock: the machines and inserters the
config describes, in the ideal environment for a clock to be added to them. That environment is the scaffold's own:
infinity chests that feed it and void chests that drain it, infinity pipes for fluids, and whatever circuitry it needs,
for example a belt end limited by combinators so that items do not spoil on it while the belt in front of the
inserters stays full and moving. The harness (`npm run record`) builds the scaffold in a headless Factorio, adds a
generated clock, wires it to the inserters of the config, and leaves everything else in place: it removes only a
clock the generator made (the combinator described as "Clock for ..." and the combinators wired to it). It refuses a
build with something on a machine of the config that the config does not have, since no clock would hold it: an
inserter, whatever is at its other end, a further machine of one of the config's recipes, or a loader.
`npm run test:game` does this for the builds listed in `src/harness/scaffold-recordings.game.test.ts` and checks
that the selected clock moves the expected output every period. One run records at most 72,000 ticks, 20 minutes of
game time. A clocked recording is whole periods of its clock, at least the ticks asked for, so a request whose whole
periods pass the limit is refused with the most that fits (warm-up and settle do not count). A recording is the only thing that settles a
disagreement between the simulator and the game: on 2026-10-08 the agricultural science recordings found two inserter
rules the simulator was missing, and the automation science ones found that the generator was selecting a clock that
over-produces.

Conventions:
- `<build>.json` is the config; variants get a suffix that says what differs (`-chain-always-on`, `-belt-fed`).
- `<build>-scaffold.txt` is the one-copy scaffold; `-scaffold-full-build.txt` is kept only for reference.
- The clocked inserters see a steadily supplied belt: full of whole stacks at the rate the build takes them, whenever
  they reach for it. How is the scaffold's business. Enough stack inserters from infinity chests and a closed end do
  it; so does an end that lets a little through on a timer, as the iron bacteria scaffold has to keep its nutrients
  fresh (32 items in every 61 ticks, and every hand there still fills a stack a tick). An end that drains freely
  does not: it leaves gaps that confound the inserter timing, which the first agricultural scaffold showed.
- Crafting speeds and productivity come from the sidecar mod in the Factorio version the scaffold is for (2.1 rounds
  beacon bonuses differently from 2.0).

## Status

| Build | Scaffold | Recorded | Note |
|---|---|---|---|
| science/agriculture-science | yes | selected and 5-swing clocks exact over 300 periods | in `test:game` |
| science/automation-science | yes | selected clock exact | in `test:game` |
| science/automation-science, belted buffer | yes | selected clock exact | in `test:game` |
| intermediates/low-density-structure | yes | selected clock exact | in `test:game` |
| science/utility-science | yes | 144 of 192 a period, every period | simulator says stable: open divergence, see below |
| science/utility-science, belted blue and LDS | yes | 64 or 80 of 96 | same family |
| science/utility-science, direct-insert LDS | yes | 32 or 160 of 192; simulator finds no stable clock | same family |
| intermediates/advanced-circuit | yes | not recorded since the config folders were reorganised | |
| gleba/iron-bacteria-cultivation | yes | selected clock exact over 42 repeats of its 1728 ticks (20 minutes) | in `test:game`; see below |
| everything else | no | | |

## TODO: scaffold backfill

Builds without a scaffold have labels and selections that only the simulator vouches for. Most of them moved on
2026-10-08 when the belt pickup rules and the long-run stability check changed, so each needs a recording before its
label is trusted. One copy each, in the build's folder, named `<build>-scaffold.txt`; then add it to
`src/harness/scaffold-recordings.game.test.ts` with its seeds, if any, and the warm-up and settle it needs.

In the order they would settle the most:
1. **science/logistic-science** (shared-inserter, sample, direct-insert): the 1-swing label of the shared-inserter
   and sample configs flipped from unstable to stable; direct-insert's selection changed.
2. **science/production-science** (shared): its rate changed in the sweep.
3. **science/chemical-science** (advanced circuit, engines): selections changed.
4. **science/metallurgic-science**: the selected clock changed and rates moved, and changed again on 2026-10-09 from the
   planned 1-swing clock to the full-hand one (both 45 a second). The planned clock only passed the long run because
   that run under-counted a fractional period; counted right, the simulator moves 32 too many in periods 40 to 120,
   the tail of a start-up surplus of 48 that is gone by period 160. Simulator only, and in the simulator both clocks
   stop for good around period 1160 (34 minutes) once the carbon machine runs out of coal: this build needs a
   recording more than any other.
5. **intermediates/processing-units** (belt export): rates moved slightly.
6. **gleba/rocket-fuel** and **gleba/jellynut-processing**: 3-swing rates swapped between the two jelly stack configs.
7. **science/electromagnetic-science**, **science/military-science**, **intermediates/flying-robot-frame**,
   **intermediates/lithium-plates**, **intermediates/electric-engine-unit**, **intermediates/productivity-module**,
   **gleba/biochamber-fuel**, **smelting/stone-bricks**, **smelting/electric-furnace**: never recorded.

The `accumulator-bad-config.json` sample is a deliberately invalid config for the validator and needs no scaffold.

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

## Open divergence: utility science

All three utility science builds under-produce in the game under clocks the simulator calls stable, by a constant
amount every period, with the machine idling in ingredient shortage in between. The config's speed and productivity
match the sidecar, so the cause is in how the clock's windows drive the two inserters that each take two items from a
shared belt. It needs the tick-by-tick comparison that found the agricultural rules: hands per period and their
timing in the recording against the simulator's stock export (`simulateClockOnly`). Deferred on 2026-10-08.
