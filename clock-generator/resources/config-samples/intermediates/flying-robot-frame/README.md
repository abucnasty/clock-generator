# Flying robot frames

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `flying-robot-frame-80` | abucnasty (blueprint) | abucnasty's build, given 2026-11-09. One row of 12 copies makes 80 a second. The full build is two mirrored halves that make 160 a second. Each copy is one assembler (legendary, 68.8906). The copies stand in two rows of 6, 6 tiles apart. Each input belt is one folded line with a dead end: it runs past one row, turns and runs back past the other row. One line carries steel and engine units, the other circuits and batteries. Stack inserters from infinity chests feed both lines. 8 of 12 copies pick steel and engines from an underground belt's half tile. The config cannot state that. Each row puts its frames onto a belt of its own into a void chest, and the config states both belts (see "The output belt"). The config states one row of 12 copies, 6 tiles apart. Both lanes of both input belts end in a dead end | none recorded | Scaffold: yes (2026-11-09), the whole build of 12 copies and not one copy. In the game (Factorio 2.1.24, turbo belts, cache off): the recommended clock is moved output swing, 1 output swing a cycle, 288 ticks. The build gets to steady state after 7,056 ticks. Then each copy moves 32 frames in each of 13 window cycles. That is 100% of 6.67 a second on each of the 12 copies, and 80 a second in all. Before this build, the sample was 24 copies at 160 a second on a one-copy scaffold (FLYING_ROBOT_FRAME_160) |

## The output belt

The config states the output belt of the scaffold (`output_belt`): one line a row, each with an infinite end of its own
(`stretch_groups`). The simulator moves the frames on both lines, so an output inserter that cannot put its frames down
waits, as in the game.
- Each row has two stretches. The first three copies of a row drop onto the first stretch: the first at its start, the
  second 6 tiles on and the third 5 tiles on, onto an underground exit. The stretch runs 21 tiles (a left and a right
  curve, two underground pairs) to a straight belt that takes a side load. The other three copies drop onto the second
  stretch, 5 and 6 tiles apart. It runs 3 tiles (one curve) and side-loads onto that straight belt, from the side the
  hands drop from. From there the line runs 8 tiles (two curves) to the loader.
- Copies 1 to 6 are the upper row, from the west; copies 7 to 12 are the lower row, from the east, as the belt with
  circuits and batteries passes them. Every output inserter drops from the side of its belt: the upper row on the right
  lane, the lower row on the left lane, and each stretch side-loads onto the same lane that its copies drop on. The
  lanes were read from the scaffold with the belt tracer and are the lanes the Sidecar exports in the game for all 12
  inserters. The Sidecar exports the three copies of each second stretch as side-loaded drops 14, 9 and 3 tiles
  before the side load, which is where the config's tiles put them.
- The numbering of the copies does not change the result: the other ways to number the two rows (both from the west,
  or the rows the other way round) select the same clock and give the same verdict for every clock.

The simulator selects the same clock as before the lines were stated (Moved Output Swing, 288 ticks), and every
other clock keeps its verdict. In the game (Factorio 2.1.24, warm-up 3,600 ticks, 10,944 ticks recorded, steady state
at tick 7,056) every one of the 12 copies makes its 32 frames in each of 37 whole window cycles judged, 384 in all
(80 a second), and the build holds the game's steady-state protocol.
