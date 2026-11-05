# Belt drop capture

[Belt drop documentation](README.md)

How the drops were recorded and how to repeat a run. The fixture is
[`tests/game/mechanics/belt-drop-timing/`](../../tests/game/mechanics/belt-drop-timing/README.md).

## The probe

`probe.lua` builds every scenario of a run side by side on the staging save's surface (the cells are cleared, the ground is made refined
concrete, the chunks are generated first) and logs each one every tick from two before the chest is filled:

- the hand (`held_stack.count`) and the inserter's status;
- every stack on every transport line of the pieces around the drop (the slot of the drop and one before to three after), as four numbers:
  the piece and line, a number for the stack's unique id (in order of first sight), its position along the line in 1/256 tile (the game's
  `get_detailed_contents` position, the distance to the end of the piece) and its count with its item;
- the facts of the scenario once the game has settled it: the targets, the drop position in the line's frame, the pieces and their line
  lengths, and the research before and after (unchanged).

Everything judged is computed on the host from this log (`analysis.ts`): the pickup is the tick the hand grows, a stack of the hand is an
iron stack whose id was not there before, its lane is the line it stands on. Nothing is read from a setting, and no hand or belt is edited
after the start.

## Scenarios

A scenario is a `DropCase` ([cases.ts](../../tests/game/mechanics/belt-drop-timing/cases.ts)): approach, direction, inserter kind and quality,
an optional forced hand (16 for the stack inserter of the calibration), an optional stream (`traffic`) or queue. A run sets the force's belt
stack size bonus and checks that no technology changed.

The stream is put on both lanes of the first piece of the line by `insert_at` at the line's start (the game places a stack one step in), from
tick 1; the chest is empty until tick 40 so the stream has reached the drop point by the time the hand arrives. The full-lane stream stops at
tick 60. A queue is put on each lane at the end of the last piece before the chest is filled. A line that flows ends in a sink (its last
piece's lanes are emptied each tick); a dead end is not drained.

## Run and repeat

```bash
cd clock-generator
# every run; the harness reuses a recording whose probe, build and game are unchanged
npm run test:game -- tests/game/mechanics/belt-drop-timing/timing.game.test.ts
# one run, with a new recording kept
DROP_TIMING_RUNS=stack-4 DROP_TIMING_CAPTURE_DIR=.scratch/drop-run \
  npm run test:game -- tests/game/mechanics/belt-drop-timing/timing.game.test.ts
# the offline checks, no Factorio
npm test -- tests/game/mechanics/belt-drop-timing/recordings.test.ts
```

A run takes under half a minute for 160 to 240 scenarios. The game test compares the fresh figures of every scenario with the kept
recording, so a change in the game, or in the probe, fails there. The recordings are gzip, 3 to 10 MB of JSON each when read.

## What is out of scope

Side-loading onto the line, splitters, lines that turn, other belt speeds, and drop positions named in the config (the inserters measured
do not allow them). Publishing remains on hold.
