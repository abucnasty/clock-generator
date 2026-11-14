# The gap in an input lane

Several input inserters of one build can take from one belt lane, one after the other along the belt. A hand that the
first one takes leaves a gap in the lane. The gap moves down the belt at the belt's speed, 8 ticks a tile on a turbo belt,
and reaches the next pickup after the ticks that the distance takes. If the lane has no room to spare, and the next
inserter is open when the gap comes, it finds fewer items than a full hand. The engine checks this from the places of the
inserters (the lane check, [stability](../../../../docs/stability.md)); this family records the miss in the game and sets
the check against it. Recorded in Factorio 2.1.24 ([test](input-lane-gap.game.test.ts), [script](input-lane-gap.lua)).

## The build

A row of gear assemblers on one dead-end belt of iron plate. Four infinity chests of iron plate, each with a legendary stack
inserter, put plate on the belt from outside the row, and the belt has no other lane in use. Each assembler (a legendary
assembling machine 3 with four legendary speed modules, a crafting speed of 18.75) has an input inserter that takes from the belt
and an output inserter that puts the gears in an infinity chest that removes all it is given. The belt is a turbo belt with
stacks of 4: a lane carries 120 plate a second, and a gear takes 2 plate. So the lane is full when the row asks for 120 plate a
second: 2 assemblers at 30 gears a second each, or 3 at 20. Only then has a gap no room to be filled.

```text
tile row  -5   C C C C                            C = infinity chest of iron plate (the four feeders)
          -4   f f f f                            f = feeder, a stack inserter
          -3   > > > > > > > > > > > > > > > |    belt, to the east; the last tile is the end
          -2               i         i           i = input inserter, at the middle column of its assembler
          -1,0,1          [A A A]   [A A A]      A = assembler, 3 tiles wide
           2               o         o           o = output inserter
           3               C         C           C = infinity chest that removes all
                           <-pitch->             the tiles from one input inserter to the next
```

The [scaffolds](fixtures/) differ in the count of assemblers and the pitch only: `gear-row-<assemblers>-at-<pitch>.scaffold`.
A pitch of 3 puts the assemblers side by side. Every assembler has the same crafting speed, which the Lua script reads from the
game. The scaffolds are blueprints made with factorio-draftsman; the [config](../../../configs/gear-row.ts) is the one the
Sidecar exports from them, with the setpoint added.

## The clocks

The generator weighs several clocks for each row (`generateClockAlternatives`). The test wires two of them to the row in the
game, by their ids:

- `euclidean_swings`, a clock that the engine says does not fit the closer pitch: outputs open in ticks 1-24 and inputs in
  29-92 of a window cycle of 96 ticks for 2 assemblers and of 144 ticks for 3. It has the same windows at the further pitch,
  where the engine says it fits.
- the clock that the generator selects, the recommended clock: 32 ticks for 2 assemblers, 96 for 3.

## The script

After the harness has built the row and run it for 600 ticks, the script runs trials one after the other in the same game. A
trial locks the clock, empties every belt, machine and inserter hand, and unlocks the clock a number of ticks later: the
*phase*, counted from the empty build (a phase of 0 unlocks the clock the tick after). The feeders are not on the clock, so
they refill the belt while it is locked. The script records each assembler's finished crafts every 48 ticks from the unlock, and
every hand of every input inserter. A trial in a sequence records the same as the same trial in a game of its own (measured
for phase 48 on 2 assemblers 3 tiles apart: the counts every 48 ticks and the hands are equal).

## Results

The window is whole window cycles after the lane has settled: ticks 1,440 to 3,552 from the unlock for the clocks of 96 and 32
ticks, 1,440 to 3,600 for the clock of 144. `First`, `second` and `third` are the finished crafts of the assemblers in the
window, counted along the belt; the test pins them at two phases for each row.

| Assemblers | Pitch | Clock | First | Second | Third |
| --- | --- | --- | --- | --- | --- |
| 2 | 3 | euclidean_swings, 96 ticks | 1,056 | **880** | |
| 2 | 6 | euclidean_swings, 96 ticks | 1,056 | 1,056 | |
| 3 | 6 | euclidean_swings, 144 ticks | 720 | **600** | 720 |
| 3 | 9 | euclidean_swings, 144 ticks | 720 | 720 | 720 |
| 2 | 3 | selected, 32 ticks | 1,056 | 1,056 | |
| 3 | 6 | selected, 96 ticks | 704 | 704 | 704 |

- **The second assembler makes 5 crafts in every 6** where the clock does not fit the pitch (880 of 1,056, 600 of 720), and the
  other assemblers make their full number. At the further pitch, or with the selected clock, it makes the first's.
- **No start phase held.** The phases measured in the window above all gave the table's numbers: 0 to 17 (every tick) for 2
  assemblers 3 tiles apart; 4, 13, 22, 31, 40, 49, 58 and 67 for 3 assemblers at 6 and at 9 tiles. In trials of 7,200 ticks
  the second minute (ticks 3,600 to 7,200, not whole window cycles) gave the same shortfall at 0, 12, 24, 36, 48, 60, 72 and
  84 for 2 assemblers at 3 tiles (1,507 or 1,510 of 1,806 crafts, and 1,806 of 1,806 at 6 tiles), and for 3 assemblers at 6 tiles
  at 0, 24, 48, 72, 96 and 120 (600 of 720 in the window). The test pins the miss at two phases and the row without a miss at the
  same two. The harness's own start (no lock and no clear, 600 ticks after the build, run with a variant of the script) gives the
  same: 880 and 1,056 for 2 assemblers 3 tiles apart.
- **The first minute differs by phase**, as the lane fills: the second assembler of the 2-at-3 row makes 1,453 to 1,485
  crafts in it for phases 0 to 84, and 1,725 to 1,781 at 6 tiles, against 1,806 once the lane has settled. The window leaves
  it out.
- **The recommended clock holds** on the rows that the first clock fails on: exactly the target, 1,800 and 1,200 crafts a
  minute for each assembler (1,056 and 704 in the window), at the four phases measured (0, 24, 48 and 72).

## The engine

The engine's lane check makes the same finding from the config alone: the unit test in
`src/crafting/lane-check-from-positions.test.ts`, "the input-lane check on a row of one copy", gives `euclidean_swings` the
config of each row and finds the second assembler's input inserter (inserter 7) keeping 305 of 366 swings at 3 tiles for 2
assemblers and at 6 for 3, and losing none at 6 and at 9. 61 lost of 366 is 1 in 6: the game's 880 of 1,056. The clock is
unstable for it where it is flagged. The unit test fails if the check is skipped for a build of one copy.

The swings kept by the input inserter that keeps the fewest, for `euclidean_swings` on each row, by pitch (a generation of each
row in the engine; the game was run on the rows of the table above only):

| Assemblers | 3 | 4 | 5 | 6 | 7 | 8 and more |
| --- | --- | --- | --- | --- | --- | --- |
| 2, 30 gears a second each | 305 | 335 | holds | holds | holds | holds |
| 3, 20 a second each | 244 | 244 | 274 | 305 | 335 | holds |
| 4, 15 a second each | 183 | 244 | 274 | 305 | 335 | holds |

Each cell is out of 366. The flagged pitches end at 7 tiles. The clock opens the input inserters for 64 ticks at once, which
is 8 tiles of belt at 8 ticks a tile: the match is noted, not tried in the game.

## Limits

- **The same clock, not the same build.** In other builds the miss has shown at some start phases only. The row here shows it at
  every phase, with its clock. Why a phase matters in those builds is not established here.
- **One lane, one item.** The row has one lane of plate. A build with two lanes on one belt is not measured here.
- **The smallest row** that can show it has 2 assemblers: one inserter makes the gap and another finds it. In the engine a row
  of 2 shows it at a pitch of 3 and 4; the game was run at 3 only.
- **One crafting speed, one belt tier.** The numbers are for turbo belts and an assembler with a crafting speed of 18.75.
