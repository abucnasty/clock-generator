# Steel plates around one cargo wagon

The owner's build: one cargo wagon is a hub. A big mining drill with 4 legendary speed modules 3 drops iron ore into it.
A stack inserter takes the ore into a legendary electric furnace making iron plates (2 legendary productivity modules 3,
6 legendary beacons), and another puts the plates back into the wagon. A stack inserter takes plates into a second
legendary electric furnace making steel (2 legendary speed modules 3, 8 legendary beacons), and another puts the steel
back. One stack inserter takes the steel out of the wagon onto a turbo belt that a loader empties into a disposal chest.
Every inserter is filtered to its item. The wagon's slots are filtered too: 20 to iron ore, 5 to iron plates, 5 to steel,
and 10 blocked (a deconstruction planner in the game). The target is 26 steel plates a second from one copy.

- `steel-wagon-scaffold.txt`: the owner's blueprint as given. The loader and disposal chest are part of it.
- `steel-wagon.sidecar-export.json`: what Sidecar 0.12.0 exported from the blueprint built in the harness game.
- `steel-wagon.json`: that export as the paste reads it (each list through its schema), with the target added. No field
  was edited.

The harness game has no ore, so the harness puts iron ore under the drill before it builds it, and it builds the wagon
after its rails. The export was taken after a warm-up of 3600 ticks without a clock. The sidecar exports a wagon empty,
with its slot filters and blocked slots.

The rate is within the machines: the steel furnace makes 105.875 / 16 × 4 = 26.47 steel a second at most (its
productivity of 300% is the harness's steel research), so 26 uses 98.2% of it; that takes 32.5 plates a second, of the
plate furnace's 80.0375 / 3.2 × 1.5 = 37.52. The drill mines 2.5 × (1 + 15.8244) = 42.06 ore a second before mining
productivity; at the harness's research it makes about 33,700, against the 21.7 the plates take.

The steel leaves the build through the wagon, so the inserter that takes it out of the wagon is the build's output
inserter: it has the output swings and windows, and the steel furnace's inserter into the wagon is planned through it.
