# Containers as chests

`containers.game.test.ts` records ten builds in the game, unclocked, and compares each with the simulator inserter by
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
| `drill-into-car` | a big mining drill on iron ore fills a car (the owner's car build's geometry) to its 80 stacks and waits for room |
| `drill-into-filtered-car` | the same with five car slots filtered to copper plates: the ore fills the 75 free slots only |
| `drill-into-chest` | the drill fills a steel chest (the config's buffer chest) to its 48 stacks; recorded from 60 ticks in, as an empty chest is not exported |
| `drill-into-silo` | the drill fills a rocket silo's rocket inventory by weight (500 ore), nothing into its input slots |

The harness puts the drill's ore under it (`drill_resource`, from the config's drill), as the save has none. Each drill
build has one inserter emptying the container, as the recorder records only a build with an inserter or a machine. The
configs give the drill the harness save's research, 7,999 levels of mining productivity, +79,990%. The drill builds
also compare the container's total at the end of each of their first 30 ticks, from the tick the drill first drops: equal
in every tick. The game's drill has no mining target in the recording's first tick, so its first drop is a tick after
the simulator's; not modelled. When the full filtered car gets room (the inserter takes 16), the drill puts in the 5 it
held in that tick and 11 of what it mines then in the next, as the simulator's does ([drills](../drills/README.md)).

No silo crafts: its sinks lack rocket fuel or have a recipe of another quality, and its source holds no fuel. The
blueprint builds the inserters in descending config id, so the game serves inserter 1 first in a tick, as the
simulator does. `CONTAINERS_BUILD_ORDER=ascending` builds them the other way and `CONTAINERS_POSITION=x,y` moves the
build; the ascending order is recorded but not asserted. `CONTAINERS_CAPTURE_DIR` keeps each run's comparison.

`wagon-blocked-slots` was also recorded in Factorio 2.1.23: the game and simulator agree on every hand and slot,
with 100 iron plates in the free slot and no items in the 39 blocked slots. The recording's config uses the real
Sidecar extraction/export path: it exports the 20 Deconstruction planner filters and 19 No item filters as 39 blocked
slots, and the wagon with no starting contents.

Recorded in Factorio 2.1.21: 5 of 5 equal the simulator, in place and moved, and the four drill builds 4 of 4 (since 0.20.0). Built ascending, the three builds without
two inserters on one container in a tick are unchanged, and `silo-sink-rare` and `wagon-sink` split the container the
other way (see [the simulator page](../../../../docs/simulator.md#cars-wagons-and-rocket-silos-as-chests)).

```bash
CONTAINERS_CAPTURE_DIR=.scratch/containers-run \
  npm run test:game -- tests/game/mechanics/containers/containers.game.test.ts -t 'silo-sink-normal'
```
