# Belt drop lane

Which lane of a straight belt an inserter drops on, from each side of the belt and from each end of it, in each direction
the belt can run, with a basic and a stack inserter, recorded in the game and read against the simulator's two lane
choices for a belt drop with no named spot.

`lane.game.test.ts` runs two game runs (see [cases.ts](cases.ts)); [probe.lua](probe.lua) builds each inserter with a chest of
items beside a belt of six tiles and logs every tick the items on the left and on the right lane (the game's lanes 1 and 2
in the direction of travel), the hand and the status. Sides are in the belt's own frame: `left` and `right` of the
travel, `back` (behind the first tile, dropping along the belt) and `front` (ahead of the last tile, dropping against it).

| Run | Force bonuses | Basic hand | Stack hand | Belt stack |
| --- | --- | --- | --- | --- |
| `default` | the save's | 4 | 16 | 4 |
| `plain` | none | 1 | 5 | 1 |

Each combination of direction, side and inserter is recorded with iron plates and with copper plates (64 scenarios a run).
The drop position of these inserters cannot be named (`allow_custom_vectors` is false), so no scenario sets one.

`recordings/` keeps the logs as gzip. `recordings.test.ts` reads them without Factorio, asserts the lane, the size of the
groups the items arrive in and the drop positions, and shows the simulator's two choices. A game run writes a new log with
`LANE_CAPTURE_DIR`, an empty directory:

```bash
LANE_CAPTURE_DIR=.scratch/lane-run \
  npm run test:game -- tests/game/mechanics/belt-drop-lane/lane.game.test.ts
```

Copy `<run>/<run>.json.gz` from the capture into `recordings/` to replace a log. Measured conditions: Factorio 2.1.21,
the staging save's surface, a yellow belt, plain `inserter` and `stack-inserter` of normal quality from a steel chest.
Not recorded: belts that turn, belts that move into another belt, underground belts, splitters, a belt with items on it.
