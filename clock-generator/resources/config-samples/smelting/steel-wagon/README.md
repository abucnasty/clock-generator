# Steel plates around one cargo wagon

The owner's build: one cargo wagon is a hub. A big mining drill with 4 legendary speed modules 3 drops iron ore into it.
A stack inserter takes the ore into a legendary electric furnace making iron plates (2 legendary productivity modules 3,
6 legendary beacons), and another puts the plates back into the wagon. A stack inserter takes plates into a second
legendary electric furnace making steel (2 legendary speed modules 3, 8 legendary beacons), and another puts the steel
back. One stack inserter takes the steel out of the wagon onto a turbo belt that a loader empties into a disposal chest.
Every inserter is filtered to its item. The wagon's slots are filtered too: 20 to iron ore, 5 to iron plates, 5 to steel,
and 10 blocked (a deconstruction planner in the game). The target is 26 steel plates a second from one copy.

- `steel-wagon-scaffold.txt`: the owner's blueprint as given. The loader and disposal chest are part of it.
- `steel-wagon.sidecar-export.json`: what Sidecar 0.12.0 exports from the blueprint built in the harness game, taken again on
  2026-10-22 with the released mod, which also exports each machine's `prototype` and quality and each entity's position
  (and an inserter's or drill's direction).
- `steel-wagon.json`: an earlier export of the same build as the paste reads it (each list through its schema), with the
  target added. It is the export above without the qualities, positions and directions, and with the drill's
  productivity 79990 where the game writes 79990.00000001134; each machine's `prototype` (`electric-furnace` for both
  machines) was taken from the scaffold and is the one the export names. No other field was edited.

The harness game has no ore, so the harness puts iron ore under the drill before it builds it, and it builds the wagon
after its rails. The export was taken after a warm-up of 3600 ticks without a clock. The sidecar exports a wagon empty,
with its slot filters and blocked slots.

The rate is within the machines: the steel furnace makes 105.875 / 16 × 4 = 26.47 steel a second at most (its
productivity of 300% is the harness's steel research), so 26 uses 98.2% of it; that takes 32.5 plates a second, of the
plate furnace's 80.0375 / 3.2 × 1.5 = 37.52. The drill mines 2.5 × (1 + 15.8244) = 42.06 ore a second before mining
productivity; at the harness's research it makes about 33,700, against the 21.7 the plates take.

The steel leaves the build through the wagon, so the inserter that takes it out of the wagon is the build's output
inserter: it has the output swings and windows, and the steel furnace's inserter into the wagon is planned through it.

## In the game

The selected clock (planned with belt slack, a subtick clock of 886.15 ticks, 11,520 for 13 periods) moves 4,992 steel
in each of 63 periods of 11,520 ticks in the game, and the clock planned without iron ore in its period (295.38 ticks,
3,840 for 13) 1,664 in each of 63 periods of 3,840. Both get back to it after the drill is stopped until the wagon has run
dry of steel (9 and 10 periods), the output is blocked for 4 and the drill is stopped again
(`tests/game/builds/steel-wagon-clock-controls.json`). Building the two inserters that put plates and steel into the wagon
after the other entities changed nothing in any period: the steel moved, the wagon's contents at each period's start and
the furnaces' ticks with a full output are equal in all 210 periods.

The wagon's 5 plate and 5 steel slots do fill, and stop a furnace for a few ticks a period, with no steel lost. On the
selected clock the wagon holds 1,000 ore and 240 plates at each period's start (16 plates once the drill is restarted),
and no furnace waits for room. Once the output has been blocked, its plate and steel slots stay full (500 each) until the
drill is stopped again, and the plate furnace waits for room 13 ticks a period. On the clock planned without iron ore the
plate slots are full at each period's start and the plate furnace waits 425 to 440 ticks of each 3,840; once the output
has been blocked the steel slots are full too and the steel furnace waits 18 ticks a period. Every one of these periods
moves the clock's full count.

The simulator counts 81.6 wake-ups a minute for the selected clock; the game's states give 83.1.
