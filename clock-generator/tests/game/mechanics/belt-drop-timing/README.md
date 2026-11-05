# Belt drop timing

When each stack of a hand lands on a turbo belt, on which lane and where on it, from each side and end of a straight line and from each
end of an underground pair, with the receiving lane empty, moving with stacks on it, full, or at the end of a line, and for every inserter
kind the engine runs. Recorded in the game at Factorio 2.1.24. The write-up, the tables and what differs from the simulator are in
[docs/belt-drop/](../../../../docs/belt-drop/README.md). The older single-case calibration is in [belt-drop](../belt-drop/README.md)
and the lane choice of a basic and a stack inserter in [belt-drop-lane](../belt-drop-lane/README.md).

`timing.game.test.ts` makes the runs of [cases.ts](cases.ts); [probe.lua](probe.lua) builds every scenario of a run side by side on
the staging save's surface and logs, every tick from two before the chest is filled, the hand, the inserter's status and every stack on
the transport lines of the pieces around the drop (position, count, item, a number for its unique id). Nothing is read from a setting.

| Run | Belt stack | Inserter | Scenarios |
| --- | --- | --- | --- |
| `validation-1` to `-4` | 1 to 4 | legendary stack inserter, hand 16: the calibrated case alone | 1 each |
| `stack-1` to `-4` | 1 to 4 | legendary stack inserter, hand 16: 12 approaches, lane states, directions | 240 each |
| `kinds-1`, `-3`, `-4` | 1, 3, 4 | the five electric prototypes at normal and legendary quality, the save's research | 160 each |

A scenario is an inserter and a chest on a line of eight slots (turbo belts, or an entrance, two tunnel slots, an exit and belts for the
underground approaches), a pole and a power source. The chest is empty until tick 40; a scripted stream of copper stacks may run on the
line from tick 1 (25%, 50% and 75% of the lane's room, in every phase it has, or a full lane that stops at tick 60) or a queue may stand at
the end of a dead-end line. Then 64 iron plates go into the chest and the inserter picks up in the next tick. A line that flows ends in a
sink: its last piece is emptied after every sample. Only the belt stack size, a force setting of the run, differs between runs; the
research is checked unchanged.

`recordings/` keeps the logs as gzip. `recordings.test.ts` reads them without Factorio: it checks the probe against the calibrated case first
(`Belt.amountToDropAtTick` and `belt-drop/fixtures/turbo-stacks/speed-expectations.json`), then asserts the tables of the write-up and sets the
simulator's lane rule (`LaneTraffic`) against the game, case by case. A game run compares its figures with the kept recording
(`npm run test:game` makes every run; the harness reuses a recording whose probe, build and game are unchanged):

```bash
npm run test:game -- tests/game/mechanics/belt-drop-timing/timing.game.test.ts
# one run, and a new recording to copy into recordings/ (an empty directory)
DROP_TIMING_RUNS=stack-4 DROP_TIMING_CAPTURE_DIR=.scratch/drop-run \
  npm run test:game -- tests/game/mechanics/belt-drop-timing/timing.game.test.ts
```

Copy `<run>/<run>.json.gz` from the capture into `recordings/` to replace a log. Not recorded: side-loading, splitters, bends, other belt speeds
(game tests keep the turbo tier), a belt with traffic from outside the line other than the scripted stream, and inserters with a named drop
position (none of these inserters allows one).
