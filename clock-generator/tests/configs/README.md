# Configs kept for tests

Configs that tests generate from and that are not samples (`resources/config-samples/`): the blast and the sweeps do not
take them. `paths.ts` names the ones unit tests load by sample-style keys (`TestConfigPaths`).

- `issue-100-electromagnetic-science-buffer-chest.json`: the config attached to
  [issue #100](https://github.com/abucnasty/clock-generator/issues/100) as
  `clock-config-electromagnetic-science-pack-1791649778665.json`, unchanged. Its output goes into a buffer chest that
  nothing empties, which fills up: no clock holds. `src/crafting/why-not-stable.generation.test.ts` checks that the
  result names the chest.
- `accumulator-bad-config.json` (`BAD_ACCUMULATOR_CONFIG`): the coverage check's deliberately invalid config (PR #53): an
  accumulator machine with no inserters. Generating from it fails with "Missing inserter coverage"
  (`src/config/inserter-coverage-validator.test.ts`, `feasibility-order`, `feasibility-samples`, `generate-blueprint` and
  `graph/graph-samples` tests).
- `electromagnetic-science-240-recycler-belt-fed-no-buffers.json` (`ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED_NO_BUFFERS`): the original electromagnetic
  science scaffold of #100 (`resources/config-samples/science/electromagnetic/`) with its buffer chests replaced
  by infinity chests that remove all and its final takers removed, so the science plants' drains are terminal outputs into
  sinks that never fill. `src/crafting/terminal-rate.test.ts` takes its sink detection from it.
- `nutrients-from-yumako-mash-fuel-bonus.json` (`BIOCHAMBER_FUEL`): one biochamber making nutrients from yumako mash at a
  utilization of exactly 1 (0.5 of the 0.5 crafts a second it makes), with its fuel inserters and a burn bonus. Twelve unit
  tests take their utilization-1, fuel-inserter, burner-inventory and fuel-view cases from it (`feasibility/utilization`,
  `feasibility-samples`, `alternative-tasks`, `always-enabled-override`, `always-on-reasons`, `main-clock-phase`,
  `plan/run-memo`, `rocket-fuel`, `sequence/unplanned-inserter-clock`, `timeline-recording`, `verification-signature`,
  `verification/compare-unplanned`).
- `agricultural-science-50-fuel-on-near-lane.json` (`AGRICULTURAL_SCIENCE_50_FUEL_ON_NEAR_LANE`): one copy of the
  agricultural science sample (`resources/config-samples/science/agricultural/agricultural-250.json`, 50 a second) with
  the nutrients on the lane nearest to inserter 11 as well as to inserters 1 and 2: each takes a hand of fuel whenever its
  biochamber's fuel slot has room, ahead of its bioflux. `src/rules-of-the-game.test.ts` sizes the room for the hand the
  fuel delays on it, and `src/crafting/fuel-on-near-lane.generation.test.ts` makes a clock again with that room.
- `agricultural-science-250-bioflux-on-near-lane.json` (`AGRICULTURAL_SCIENCE_250_BIOFLUX_ON_NEAR_LANE`): the agricultural
  science sample's config as it was before it stated abucnasty's build of five copies (2026-11-11), unchanged: inserter 11
  has the bioflux on its near lane and inserters 1 and 2 the nutrients, no copy spacing and no lane ends. The rules that
  showed on the sample and no longer show on its five-copy config are kept on it: the room for the hand a hand of fuel
  delays, none where the ingredient is on the near lane (`src/rules-of-the-game.test.ts`, `src/crafting/fuel-on-near-lane.generation.test.ts`),
  and the windows of the egg loop on its 5-swing clock (`src/crafting/agricultural-science-loop-windows.generation.test.ts`,
  `src/crafting/agricultural-science-loop-windows-ranking.generation.test.ts`).
- `military-science-120-coal-lane-per-copy.json` (`MILITARY_SCIENCE_120_COAL_LANE_PER_COPY`): the military science
  sample's config as it was before it stated abucnasty's build of five mirrored pairs (2026-11-10; one science
  assembler, one grenade assembler and one foundry a copy, 120 a second over 5 copies), with one change: its coal lane is
  stated as per copy (`sharing: "per_copy"`). As the sample had it, the 5 copies took 300 coal a second from one
  lane that supplies 120, which generation refuses. On it the shared windows of the takers keep the rate where the separate
  ones lose it (`src/crafting/shared-windows.generation.test.ts`), and the fractional swings task is left out as it would
  make the primary clock again (`src/crafting/alternative-tasks.test.ts`).
- `automation-row.ts` (`automationRow`): a row of the automation science sample's assemblers on its two turbo belts, each
  with its input inserter at its own place along the input belt, a given number of tiles apart, and, as asked, four
  inserters that put gears and copper onto the input belt from infinity chests upstream (supply from outside the build).
  `src/config/outside-supply.test.ts` and `src/crafting/outside-supply.generation.test.ts` check that the supply is not
  clocked and that the input lanes are checked. With `input`, the input belt is an express belt that moves on past the
  row: `src/crafting/loss-trial-budget.generation.test.ts` tries the losses of such rows from many lane phases.
- `gear-row.ts` (`gearRow`): a row of gear assemblers on one dead-end turbo belt of iron plate that four chest feeders keep full,
  as the scaffolds of `tests/game/mechanics/input-lane-gap/fixtures/` hold it and the Sidecar exports it. The game test of
  that family builds its clock from it, and `src/crafting/lane-check-from-positions.test.ts` checks the input lane of the row from the
  inserters' places.
