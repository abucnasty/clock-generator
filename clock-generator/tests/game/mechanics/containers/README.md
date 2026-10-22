# Containers as chests

`containers.game.test.ts` records six builds in the game, unclocked, and compares each with the simulator inserter by
inserter: the hand each inserter carried at its fullest, what it holds at the end, the container's slots, or the
silo's rocket inventory and input slots. The probe ([probe.lua](probe.lua)) puts a container's starting contents in.

| Build | What it checks |
| --- | --- |
| `silo-sink-normal` | processing units and low density structures stop at one whole hand (16) in the input slots; iron plates fill the rocket inventory to 1,000, and the inserter waits holding 8 |
| `silo-sink-rare` | with a rare rocket part recipe, the normal ingredients and the plates share the rocket inventory to its lift weight |
| `silo-source` | an inserter takes from the rocket inventory, the last slot first; one filtered to processing units takes none from the input slots |
| `wagon-sink` | a wagon with five slots filtered to copper filled by two feeders to the last slot |
| `wagon-blocked-slots` | a wagon with 39 slots blocked by No item or Deconstruction planner fills its one free slot; Sidecar exports both blocking filters as blocked slots and the full wagon empty |
| `car-source` | a car of mixed items emptied by an unfiltered inserter: the last slot's item first, a hand across stacks |

No silo crafts: its sinks lack rocket fuel or have a recipe of another quality, and its source holds no fuel. The
blueprint builds the inserters in descending config id, so the game serves inserter 1 first in a tick, as the
simulator does. `CONTAINERS_BUILD_ORDER=ascending` builds them the other way and `CONTAINERS_POSITION=x,y` moves the
build; the ascending order is recorded but not asserted. `CONTAINERS_CAPTURE_DIR` keeps each run's comparison.

`wagon-blocked-slots` was also recorded in Factorio 2.1.23: the game and simulator agree on every hand and slot,
with 100 iron plates in the free slot and no items in the 39 blocked slots. The recording's config uses the real
Sidecar extraction/export path: it exports the 20 Deconstruction planner filters and 19 No item filters as 39 blocked
slots, and the wagon with no starting contents.

Recorded in Factorio 2.1.21: 5 of 5 equal the simulator, in place and moved. Built ascending, the three builds without
two inserters on one container in a tick are unchanged, and `silo-sink-rare` and `wagon-sink` split the container the
other way (see [the simulator page](../../../../docs/simulator.md#cars-wagons-and-rocket-silos-as-chests)).

```bash
CONTAINERS_CAPTURE_DIR=.scratch/containers-run \
  npm run test:game -- tests/game/mechanics/containers/containers.game.test.ts -t 'silo-sink-normal'
```
