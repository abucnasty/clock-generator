# Original electromagnetic science scaffold

The blueprint supplied in [#100](https://github.com/abucnasty/clock-generator/issues/100) is unchanged: 211 entities,
two recyclers inserting electronic circuits directly into their supercapacitor plants, four electromagnetic
science plants, two curved holmium/superconductor pickups, original source feeders, steel output buffers,
and advanced-circuit outlet belts leading to the existing disposal loader and infinity chest.

`pink-science-original-scaffold.txt` is the byte-identical full blueprint. Its target is 96 science packs a
second, equivalent to 240/s across 2.5 full-scaffold copies.

The config describes one repeated cell at 48/s and sets Copies to 5, following the existing one-unit config rule.
Its clock's blueprint and schedule wire both science cells of this blueprint, one set of controls for each. The config
comes from a fresh Sidecar 0.15.0 export of the left cell of the original blueprint, with its real pickup captures.
No source or outlet is replaced with a chest. Empty unused belt lanes remain in the config so lane numbers still identify
the same physical lane. The curved input has the measured `bend-right-upstream` layout with version 3 capture; existing
files marked unsupported bend must be captured again, since changing a saved warning is not a capture.

## The config is automatic

`pink-science-original.json` is what the clock generator's own import makes of a fresh Sidecar export of the left cell
of this blueprint, with only Target Output's rate and copies set: no inserter is set to Always enabled, and no
swing count or LCM is fixed. Generate picks the clock for all twelve inserters. It is a 40-tick clock in which the two
arms that carry supercapacitors to the science plants take turns (each science plant's drain into its steel buffer moves
with that plant's turn), 1,040.6 wake-ups a minute, no inserter left always on, and every loss the check tries is
survived.

The supercapacitor plants run at 99.56% of their capacity at this rate, so the margin is thin: the clock keeps both
plants filled and emptied at the same points of their turns, which is what the game run below checks.

`tests/game/builds/recycler-original-clock.game.test.ts` generates that clock from this config and runs it on the
whole blueprint, both cells, in the game, with the clock's blueprint and schedule wiring both copies. The physical
blueprint is unchanged; losses use script disable flags and restore the original supplies and outlets.

- 3,600 periods after settling: every final taker delivers exactly 16 in every period (96 science/s), and the science
  held in each plant, its steel buffer and the arms between them grows rather than drains.
- Nine losses, each recovered within its allowance and held for 726 exact periods: each of five solid supplies
  (accumulator, processing unit, battery, holmium plate, superconductor) cut at a different phase, science not removed,
  the advanced-circuit disposal blocked, and the battery supply cut at the first tick after each supercapacitor turn.
  At least one restoration resumes a partly filled hand.
- Two cold starts, 600 periods each: the clock is placed first and its counter read, then the arms of both copies are
  built in ascending order at phase 0, and in descending order at phase 13, and wired to that same clock.

The test also checks that the clock selected for this config holds and recovers in the simulator, is stable, takes turns,
and leaves no inserter always on.
