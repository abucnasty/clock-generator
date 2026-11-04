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
- `pink-science-original-no-buffers.json` (`REAL_OWNER_PINK_SCIENCE_ORIGINAL_NO_BUFFERS`): the original electromagnetic
  science scaffold of #100 (`resources/config-samples/real/owner/pink-science-original/`) with its buffer chests replaced
  by infinity chests that remove all and its final takers removed, so the science plants' drains are terminal outputs into
  sinks that never fill. `src/crafting/terminal-rate.test.ts` takes its sink detection from it.
- `nutrients-from-yumako-mash-fuel-bonus.json` (`BIOCHAMBER_FUEL`): one biochamber making nutrients from yumako mash at a
  duty of exactly 1 (0.5 of the 0.5 crafts a second it makes), with its fuel inserters and a burn bonus. Twelve unit
  tests take their duty-1, fuel-inserter, burner-inventory and fuel-view cases from it (`feasibility/duty`,
  `feasibility-samples`, `alternative-tasks`, `always-enabled-override`, `always-on-reasons`, `main-clock-phase`,
  `plan/run-memo`, `rocket-fuel`, `sequence/unplanned-inserter-clock`, `timeline-recording`, `verification-signature`,
  `verification/compare-unplanned`).
