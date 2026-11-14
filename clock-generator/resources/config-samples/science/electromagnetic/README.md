# Electromagnetic science

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `electromagnetic-240-recycler-belt-fed` | warbaque | the blueprint of #100 (211 entities); config from a Sidecar 0.15.0 export of its left copy | #100 | See "The config is automatic" below: 3,600 window cycles after settling, nine losses and two cold starts in the game |
| `electromagnetic-330` | none recorded | none recorded | #388 | Scaffold: yes (2026-11-11, abucnasty's 11 copies 10 tiles apart, 12 legendary beacons). `electromagnetic-330.json`, a config without overrides (until 2026-11-04 a second config forced 2 terminal swings and lcm 11 and latched both output inserters by a hand-written condition). The config states the copies 10 tiles apart (`copy_offset`) and the one input belt running east with both lanes ending in a dead end, as abucnasty's build has them; each lane carries exactly what the 11 copies take (120 a second, no margin). Recommended clock exact (2026-11-10): Takt Batches, 3 output swings per cycle, a window cycle of 2,112 ticks, 196.1 wakeups a minute, stable with no loss on the shared lanes and back after every disturbance trial on the copies; 1,056 in every window cycle on the scaffold of one copy it had then (30.0 a second, 330 over 11 copies). The scaffold is now abucnasty's two-copy blueprint at 10 tiles, tiled to all 11 copies, and each copy is held to 1,056 packs a window cycle. On the scaffold, abucnasty's 11 copies 10 tiles apart, the same clock made 30.000 a second on every copy in each of 19 window cycles, and earlier recordings of it held every copy in the game from the game test's start (the copies run unclocked, then the clock wired), from a backpressure start made with the Clock lock and after a Clock-lock stop (in the simulator also after a supply stop at the lane's entry and an output blockage). Known: the clock depends on the spacing. At 9 and 11 tiles the generator finds no clock that holds every copy, although a hand-searched clock that holds was recorded in the game at each; that is a gap in the generator's search, not in this build. At 10 tiles some copies lost on this clock in the game when the plants' productivity bars were set by script. Not established: a cold start of the 11 copies in the game at 10 tiles, and whether anything a user does sets the bars as that script did. Until 2026-11-10 the config stated no spacing and no lane end, and the recommended clock was 704 ticks (2 output swings, 92.2 wakeups a minute), which does not hold all 11 copies on these dead-ended lanes in the game. Unclocked, the scaffold of one copy made 30.1 a second (not measured on the 11 copies). The config's crafting speed is 109.475, what 12 beacons give in the game. Drained-end scaffold (2026-11-05, #458, abucnasty's build of one plant, `tests/game/builds/electromagnetic-science-330-drained-end.scaffold`; the input line ends in a loader and a void chest, so it moves): the recommended clock (2,112 ticks, made for the dead-ended lanes the config states; 2026-11-10) made 1,056 of the 1,056 packs of the baseline's whole cycle (30 a second, 100%). Note: in `test:game`; fluids from infinity pipes, the belt's accumulators and supercapacitors from infinity chests. |

`electromagnetic-330` is one plant that takes accumulators and supercapacitors from one belt, 330 science packs a
second over 11 copies, with 12 legendary beacons; its config has no overrides.

## electromagnetic-240-recycler-belt-fed (warbaque's #100 blueprint)

The blueprint supplied by warbaque in [#100](https://github.com/abucnasty/clock-generator/issues/100) is unchanged: 211 entities,
two recyclers inserting electronic circuits directly into their supercapacitor plants, four electromagnetic
science plants, two curved holmium/superconductor pickups, original source feeders, steel output buffers,
and the advanced-circuit belts that lead out to the existing disposal loader and infinity chest.

`electromagnetic-240-recycler-belt-fed.scaffold` is the byte-identical full blueprint. Its target is 96 science packs a
second, equivalent to 240/s across 2.5 full-scaffold copies.

The config describes one build at 48/s and sets Copies to 5, following the existing one-unit config rule.
Its clock's blueprint and schedule wire both copies in this blueprint, one set of controls for each. The config
comes from a fresh Sidecar 0.15.0 export of the left copy in the original blueprint, with its real pickup captures.
No source, and no belt that leads out, is replaced with a chest. Empty unused belt lanes remain in the config so lane numbers still identify
the same physical lane. The curved input has the measured `bend-right-upstream` layout with version 3 capture; existing
files marked unsupported bend must be captured again, since changing a saved warning is not a capture.

## The config is automatic

`electromagnetic-240-recycler-belt-fed.json` is what the clock generator's own import makes of a fresh Sidecar export of the left copy
of this blueprint, with only the setpoint's rate and copies set and the copies' lanes stated (13 tiles from one copy to the
next, the four input belts moving east, each lane they take from ending in a dead end): no inserter is set to Always enabled, and no
swing count or LCM is fixed. Generate picks the clock for all twelve inserters. It is a 40-tick clock in which the two
arms that carry supercapacitors to the science plants take turns (each science plant's drain into its steel buffer moves
with that plant's turn), 2,004.8 wakeups a minute, no inserter left always on, and it has recovery after every disturbance
trial that the check tries.

The supercapacitor plants run at 99.56% of their capacity at this rate, so the margin is thin: the clock keeps both
plants filled and emptied at the same points of their turns, which is what the game run below checks.

`tests/game/builds/electromagnetic-science-240-recycler-belt-fed-clock.game.test.ts` generates that clock from this config and runs it on the
whole blueprint, both copies, in the game, with the clock's blueprint and schedule wiring both copies. The physical
blueprint is unchanged; losses use script disable flags and restore the original supplies and the belts that lead out.

- 3,600 window cycles after settling: every final taker delivers exactly 16 in every window cycle (96 science/s), and the science
  held in each plant, its steel buffer and the arms between them grows rather than drains.
- Nine losses, each recovered within its allowance and held for 726 exact window cycles: each of five solid supplies
  (accumulator, processing unit, battery, holmium plate, superconductor) cut at a different phase, science not removed,
  the advanced-circuit disposal blocked, and the battery supply cut at the first tick after each supercapacitor turn.
  At least one restoration resumes a partly filled hand.
- Two cold starts, 600 window cycles each: the clock is placed first and its counter read, then the arms of both copies are
  built in ascending order at phase 0, and in descending order at phase 13, and wired to that same clock.

The test also checks that the clock selected for this config holds and has recovery in the simulator, is stable, takes turns,
and leaves no inserter always on.
