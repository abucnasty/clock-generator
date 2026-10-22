# Mining drills at a low research level

`drills.game.test.ts` records 17 builds of a big mining drill in the game, unclocked, at a research level the probe
([probe.lua](probe.lua)) sets by script in the harness's copy of the save: mining productivity 1 and 2 researched and 3
at level 8, 28 or 45 (7, 27 or 44 levels, +70% to +440%), or none of them (+0%). With 4 legendary speed modules 3 its bar
moves 0.25 a tick, with 3 0.198, so the drill makes 0.25 to 1.35 items a tick. The probe puts both bars at 0 and logs
every tick the bars, whether the drill is disabled, its sink's count and the taker's hand.

| Build | What it checks |
| --- | --- |
| `car-l8`, `car-l28`, `car-l45`, `car-none` | iron ore into a car with 100 ore of room (78 of its 80 slots filtered to copper plates), emptied by a yellow (`l8`) or stack inserter: the drill waits while the full car has no room for what it holds |
| `car-l8-3m` | a bar of 0.198 a tick, which does not divide 1: the bars are doubles summed tick by tick |
| `landfill-l8`, `landfill-l45` | stone into an assembling machine on landfill (50 a craft, 0.83 a tick); a stack inserter takes the landfill |
| `rail-l28`, `rail-l45` | stone into one on rail, which never crafts: the drill fills it to its stop |
| `*-drill-last` | the drill built after the others (the game updates the last built first) |
| `*-moved` | the build at (203, -141), another chunk |
| `*-gated` | the drill disabled by a constant combinator on its circuit condition, several times, while it holds items |

Each build checks three things:

- **The level.** Sidecar, through the recorder, exports the force's mining productivity bonus in 10% steps, and the
  engine gives the drill's bonus in the game for that number.
- **The drill against the game's, every tick.** The simulator's drill is driven by the game's sink: in each tick the sink
  first loses what the game's taker took (its hand's growth) or what a craft took (the machine's count falls), and the
  drill is disabled where the game's was. Its sink's count and both bars equal the game's in every tick. Into a machine
  this holds until the game's machine reaches the drill's stop, the larger of the stack and the automated insertion
  limit + 64 (`src/rules-of-the-game.ts` rule 3, its own check, not this family's): 114 for rail and 214 for landfill.
- **The whole build in the simulator**, every entity simulated, for the builds whose other entities the simulator has as
  the game does (`simulated`: the car emptied by a stack inserter, `landfill-l8`): the sink's count in every tick. A yellow
  inserter taking from a car leaves with what is there where the simulator's waits to fill its hand, and an assembler
  starts its next craft a tick later in the simulator than in the game, so those builds are compared through the drill
  alone.

The game's drill has no mining target in the recording's first tick: game row k is the simulator's k-th tick.

`DRILLS_CAPTURE_DIR` keeps each run's recording and `comparison.json` (the game's rows, the replay, the simulator's run).

```bash
DRILLS_CAPTURE_DIR=.scratch/drills-run \
  npm run test:game -- tests/game/mechanics/drills/drills.game.test.ts -t 'car-l8$'
```
