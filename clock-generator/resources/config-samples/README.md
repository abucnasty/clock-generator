# Sample configurations and scaffolds

One folder per build, grouped by what it makes: `science/`, `intermediates/`, `gleba/`, `smelting/`. A folder holds
the build's config(s) as JSON and, where one exists, its scaffold. `src/config/config-paths.ts` names every config.

A **scaffold** is a blueprint string of exactly one copy of the build without a clock: the machines and inserters the
config describes, fed from infinity chests and drained into a void chest, with infinity pipes for fluids. The harness
(`npm run record`) builds it in a headless Factorio, wires a generated clock to it and records it; `npm run test:game`
does that for the builds listed in `src/harness/scaffold-recordings.game.test.ts` and checks that the selected clock
moves the expected output every period. A recording is the only thing that settles a disagreement between the
simulator and the game: on 2026-10-08 the agricultural science recordings found two inserter rules the simulator was
missing, and the automation science ones found that the generator was selecting a clock that over-produces.

Conventions:
- `<build>.json` is the config; variants get a suffix that says what differs (`-chain-always-on`, `-belt-fed`).
- `<build>-scaffold.txt` is the one-copy scaffold; `-scaffold-full-build.txt` is kept only for reference.
- Belts in a scaffold are fed by enough stack inserters from infinity chests to hold the rate, with no drained end:
  gaps on a belt confound the inserter timing (the first agricultural scaffold drained its belt and showed that).
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
| everything else | no | | |

## TODO: scaffold backfill

Builds without a scaffold have labels and selections that only the simulator vouches for. Most of them moved on
2026-10-08 when the belt pickup rules and the long-run stability check changed, so each needs a recording before its
label is trusted. One copy each, in the build's folder, named `<build>-scaffold.txt`; then add it to
`src/harness/scaffold-recordings.game.test.ts` with its seeds, if any, and the warm-up and settle it needs.

In the order they would settle the most:
1. **gleba/iron-bacteria-cultivation**: no alternative is stable in the simulator any more (the nutrient inserters'
   windows come out a tick tight under the new pickup rules) and its tests are skipped until a recording says which
   side is right. This is also the build that would test the planner follow-up for belt-fed windows.
2. **science/logistic-science** (shared-inserter, sample, direct-insert): the 1-swing label of the shared-inserter
   and sample configs flipped from unstable to stable; direct-insert's selection changed.
3. **science/production-science** (shared): its rate changed in the sweep.
4. **science/chemical-science** (advanced circuit, engines): selections changed.
5. **science/metallurgic-science**: the selected clock changed and rates moved.
6. **intermediates/processing-units** (belt export): rates moved slightly.
7. **gleba/rocket-fuel** and **gleba/jellynut-processing**: 3-swing rates swapped between the two jelly stack configs.
8. **science/electromagnetic-science**, **science/military-science**, **intermediates/flying-robot-frame**,
   **intermediates/lithium-plates**, **intermediates/electric-engine-unit**, **intermediates/productivity-module**,
   **gleba/biochamber-fuel**, **smelting/stone-bricks**, **smelting/electric-furnace**: never recorded.

The `accumulator-bad-config.json` sample is a deliberately invalid config for the validator and needs no scaffold.

## Open divergence: utility science

All three utility science builds under-produce in the game under clocks the simulator calls stable, by a constant
amount every period, with the machine idling in ingredient shortage in between. The config's speed and productivity
match the sidecar, so the cause is in how the clock's windows drive the two inserters that each take two items from a
shared belt. It needs the tick-by-tick comparison that found the agricultural rules: hands per period and their
timing in the recording against the simulator's stock export (`simulateClockOnly`). Deferred on 2026-10-08.
