# Containers as chests

`containers.game.test.ts` records nine builds in the game, unclocked, and compares each with the simulator inserter by
inserter: the hand each inserter carried at its fullest, what it holds at the end, the container's slots, or the
silo's rocket inventory and input slots. The probe ([probe.lua](probe.lua)) puts a container's starting contents in.

| Build | What it checks |
| --- | --- |
| `silo-sink-normal` | processing units and low density structures stop at one whole hand (16) in the input slots; iron plates fill the rocket inventory to 1,000, and the inserter waits holding 8 |
| `silo-sink-rare` | with a rare rocket part recipe, the normal ingredients and the plates share the rocket inventory to its lift weight |
| `silo-source` | an inserter takes from the rocket inventory, the last slot first; one filtered to processing units takes none from the input slots |
| `wagon-sink` | a wagon with five slots filtered to copper filled by two feeders to the last slot |
| `car-source` | a car of mixed items emptied by an unfiltered inserter: the last slot's item first, a hand across stacks |
| `drill-into-car` | a big mining drill on iron ore fills a car (the owner's car build's geometry) to its 80 stacks and waits for room |
| `drill-into-filtered-car` | the same with five car slots filtered to copper plates: the ore fills the 75 free slots only |
| `drill-into-chest` | the drill fills a steel chest (the config's buffer chest) to its 48 stacks; recorded from 60 ticks in, as an empty chest is not exported |
| `drill-into-silo` | the drill fills a rocket silo's rocket inventory by weight (500 ore), nothing into its input slots |

The harness puts the drill's ore under it (`drill_resource`, from the config's drill), as the save has none. The
drill builds also compare the container's total in each of their first 30 ticks: the game's drill drops first 2 ticks
after the recording starts, and from there the totals may part by a few items a tick (at most 11 recorded, 16
allowed), as the game mines by a progress bar and the simulator by the rate a tick. Each has one inserter emptying the
container, as the recorder records only a build with an inserter or a machine.

No silo crafts: its sinks lack rocket fuel or have a recipe of another quality, and its source holds no fuel. The
blueprint builds the inserters in descending config id, so the game serves inserter 1 first in a tick, as the
simulator does. `CONTAINERS_BUILD_ORDER=ascending` builds them the other way and `CONTAINERS_POSITION=x,y` moves the
build; the ascending order is recorded but not asserted. `CONTAINERS_CAPTURE_DIR` keeps each run's comparison.

Recorded in Factorio 2.1.21: 9 of 9 equal the simulator, in place and moved (the drill builds since 0.20.0). Built ascending, the three builds without
two inserters on one container in a tick are unchanged, and `silo-sink-rare` and `wagon-sink` split the container the
other way (see [the simulator page](../../../../docs/simulator.md#cars-wagons-and-rocket-silos-as-chests)).

```bash
CONTAINERS_CAPTURE_DIR=.scratch/containers-run \
  npm run test:game -- tests/game/mechanics/containers/containers.game.test.ts -t 'silo-sink-normal'
```
