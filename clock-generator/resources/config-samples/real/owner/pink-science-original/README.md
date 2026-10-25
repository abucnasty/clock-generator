# Original electromagnetic science scaffold

The blueprint supplied in [#100](https://github.com/abucnasty/clock-generator/issues/100) is unchanged: 211 entities,
two recyclers inserting electronic circuits directly into their supercapacitor plants, four electromagnetic
science plants, two curved holmium/superconductor pickups, original source feeders, steel output buffers,
and advanced-circuit outlet belts leading to the existing disposal loader and infinity chest.

`pink-science-original-scaffold.txt` is the byte-identical full blueprint. Its target is 96 science packs a
second, equivalent to 240/s across 2.5 full-scaffold copies.

The generator describes one repeated cell at 48/s and sets Copies to 5, following the existing one-unit config
rule. Wire its output-window decider to both science-output takers in each cell of this blueprint. The native
test matches both copies explicitly. The config comes from a fresh Sidecar 0.15.0 export of the whole original,
retaining the left unit and its real pickup captures. No source or outlet is replaced with a chest. Empty unused
belt lanes remain in the config so lane numbers still identify the same physical lane.

The 40-tick clock controls the two final output takers of a unit; other inserters remain enabled. The curved
input has the measured `bend-right-upstream` layout with version 3 capture. Existing files marked unsupported
bend must be captured again; changing a saved warning is not a capture.

`tests/game/builds/recycler-original-clock.game.test.ts` checks final deliveries and recovery after each solid
supply stops, science is not removed, and the original advanced-circuit disposal route blocks. Its baseline is
3,600 periods at 96/s; all seven interruptions recover under the same clock, with partially filled hands at
restoration and 726 exact output periods after each recovery. Two cold starts (ascending build order and
reversed order with a 13-tick clock shift) each hold 600 periods. The physical blueprint remains unchanged;
interruptions use script disable flags and restore the original supplies and outlets.
