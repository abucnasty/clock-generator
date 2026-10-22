# Lithium plates through a rocket silo

The owner's build: two legendary cryogenic plants make lithium from holmium plates (infinity chests) and fluids
(infinity pipes), and two stack inserters put it into a rocket silo, which is used as a chest. Six stack inserters take
the lithium out of the silo into six legendary electric furnaces making lithium plates, each furnace with 4 legendary
beacons. Their output inserters put the plates onto a turbo belt that a loader empties into a disposal chest. The target
is 80 plates a second from one copy.

- `lithium-silo-scaffold.txt`: the owner's blueprint as given. The infinity chests, infinity pipes, loader and disposal
  chest are part of it.
- `lithium-silo.sidecar-export.json`: what Sidecar 0.12.0 exported from the blueprint built in the harness game.
- `lithium-silo.json`: that export as the paste reads it (each list through its schema), with the target added and each
  machine's `prototype` (`cryogenic-plant` for machines 1 and 2 and `electric-furnace` for 3 to 8) taken from the
  scaffold, as the sidecar exports it since this export was taken; it only names the machines in the clock's
  descriptions. No other field was edited.

The export was taken after a warm-up of 3600 ticks without a clock. A furnace has no recipe until it gets its first
input, so an export taken earlier is incomplete: after 1 tick it had 2 machines and no belt. The sidecar exports a
rocket silo empty, whatever it holds when selected, so the config starts with an empty silo.

Lithium is not an ingredient of the rocket part, so it goes into the silo's rocket inventory, which holds at most
250 lithium by weight. The silo's crafting speed of 13.5 is from its 4 beacons; it crafts nothing here.

The rate is within the machines: the furnaces make 6 × 66 / 6.4 × 1.5 = 92.8 plates a second at most, and the
cryogenic plants 2 × 53.122 / 20 × 5 × 3 = 79.7 lithium a second, of which 80 plates take 53.3.

## In the game

The selected clock (3 output swings, 1080 ticks) and the clock with 1 output swing move 1440 plates in each of 63
periods in the game, and get back to it after the holmium plates are cut for 2 periods, the output is blocked for 4 and
the holmium plates are cut again (`tests/game/builds/lithium-silo-clock-controls.json`). The recording starts with a
filled silo: the harness warms the build up for 3600 ticks without a clock before the clock starts, so the silo holds
218 lithium then, whatever the config says. Each cut empties it. Building the two inserters that fill the silo after
the six that empty it changed nothing in any period.

The clock with 7 output swings (7560 ticks) is stable in the simulator but not in the game: it moves 9,440 to 9,600 of
its 10,080 plates a period. The output inserters of the two eastern furnaces drop onto underground belt entrances whose
exits side-load onto the belt that already carries the other four furnaces' plates. The export describes all of it as one
belt, and the simulator gives those two inserters the room of that belt. In the game they wait for the merge, their
furnaces stop with a full output, and the inserters that feed those furnaces from the silo miss hands. The clock opens
the six output inserters together, which the other two clocks do not.
