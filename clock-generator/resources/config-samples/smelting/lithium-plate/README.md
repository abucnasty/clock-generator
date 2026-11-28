# Lithium plates through a rocket silo

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `lithium-plate-80-silo-chest` | abucnasty | blueprint given on 2026-10-21 | none recorded | Scaffold: yes (a blueprint given 2026-10-21). Two cryogenic plants fill a rocket silo taken as a chest and six furnaces empty it, all legendary, 80 plates a second. The recommended clock (3 output swings, 1080 ticks) recorded 1440 in every window cycle, both build orders, and got back to it after the holmium plates were cut twice and the output blocked; the clock with 1 output swing too. The clock with 7 output swings is short in the game (a side-loaded output belt, the sample's README). the chest ends agree (on the 2160-tick clock the inserters into the silo wake 4 times a window cycle in both the game and the simulator); output inserters 11 and 12 (furnace to belt) wake 10 times a window cycle in the game and 0 in a simulator started cold, because the furnaces' output levels the game's warm-up leaves decide it: started from the recording's first sample the simulator equals the game on all 16 inserters (`scripts/sim-game-check.js`). Note: in `test:game`. |

The build: two legendary cryogenic plants make lithium from holmium plates (infinity chests) and fluids
(infinity pipes), and two stack inserters put it into a rocket silo, which is used as a chest. Six stack inserters take
the lithium out of the silo into six legendary electric furnaces making lithium plates, each furnace with 4 legendary
beacons. Their output inserters put the plates onto a turbo belt that a loader empties into a disposal chest. The target
is 80 plates a second from one copy.

- `lithium-plate-80-silo-chest.scaffold`: the build's blueprint as given by abucnasty on 2026-10-21. The infinity chests, infinity pipes, loader and disposal
  chest are part of it.
- `lithium-plate-80-silo-chest.json`: an earlier export of the same build as the paste reads it (each list through its schema), with the
  target added. It is the export above without the qualities, positions and directions; each machine's `prototype`
  (`cryogenic-plant` for machines 1 and 2 and `electric-furnace` for 3 to 8) was taken from the scaffold and is the one
  the export names, and the two marks of the export above were added to it. The `output_belt` section was written from
  the scaffold, see "The output belt". No other field was edited.

The export was taken after a warm-up of 3600 ticks without a clock. A furnace has no recipe until it gets its first
input, so an export taken earlier is incomplete: after 1 tick it had 2 machines and no belt. The sidecar exports a
rocket silo empty, whatever it holds when selected, so the config starts with an empty silo.

Lithium is not an ingredient of the rocket part, so it goes into the silo's rocket inventory, which holds at most
250 lithium by weight. The silo's crafting speed of 13.5 is from its 4 beacons; it crafts nothing here.

The rate is within the machines: the furnaces make 6 × 66 / 6.4 × 1.5 = 92.8 plates a second at most, and the
cryogenic plants 2 × 53.122 / 20 × 5 × 3 = 79.7 lithium a second, of which 80 plates take 53.3.

## In the game

The recommended clock (3 output swings, 1080 ticks) and the clock with 1 output swing move 1440 plates in each of 63
window cycles in the game, and go back to it after the holmium plates are cut for 2 window cycles, the output is blocked for 4 and
the holmium plates are cut again (`tests/game/builds/lithium-plate-80-silo-chest-clock-controls.json`). The recording starts with a
filled silo: the harness warms the build up for 3600 ticks without a clock before the clock starts, so the silo holds
218 lithium then, whatever the config says. Each cut empties it. Building the two inserters that fill the silo after
the six that empty it changed nothing in any window cycle.

With the output belt stated, the simulator selects the clock of 2,160 ticks (6 output swings), as before. In the game
(Factorio 2.1.24, warm-up 3,600 ticks, 10,800 ticks recorded) it moves 2,880 plates, its target, in each of 4 whole
window cycles. The clock with 5 output swings (1,080 ticks) is now unstable in the simulator, and in the game it moves
1,344 to 1,408 of its 1,440 plates a window cycle (9 window cycles).

The clock with 7 output swings (7560 ticks) is not stable in the game: it moves 9,440 to 9,600 of its 10,080 plates a
window cycle. The output inserters of the two eastern furnaces drop onto underground belt entrances whose exits side-load
onto the belt that already carries the other four furnaces' plates. In the game they wait for the merge, their furnaces
stop with a full output, and the inserters that feed those furnaces from the silo miss hands. The clock opens the six
output inserters together, which the other two clocks do not. Before the config stated its output belt, the simulator
called this clock stable, because it gave each output inserter the room of a belt of its own. It now calls it unstable.

## The output belt

The config states the output belt of the scaffold (`output_belt`). Each row of three furnaces puts its plates on a line
of its own, and the two lines side-load onto the underground entrance that leads to the loader. They are stated as two
groups of stretches (`stretch_groups`), each with its own copy of the entrance's line and its own loader, because the
config cannot state two side-loads onto one tile. That is exact only if the two lanes of that entrance never interact.
- Row 1 is furnaces 3, 5 and 7 (output inserters 1, 3 and 5), row 2 furnaces 4, 6 and 8 (2, 4 and 6).
- The first furnace of a row drops in line onto an underground entrance, the second 10 tiles on onto its exit, and the
  third (7 and 8, the inserters marked as side-loaded) onto a side belt of 3 tiles that side-loads onto the line 4 tiles
  on. The line turns after 10 tiles (row 1 right, row 2 left) and side-loads onto the entrance that leads to the loader,
  row 1 from its left side and row 2 from its right side, 6 tiles from the loader.
- The lane of an in-line drop is the right lane, and the left lane for a mirrored inserter (the engine's rule and the
  Sidecar's). The inserters of row 2 are mirrored in the scaffold, those of row 1 and the side belts' are not. The
  entrance's hood lets through the right lane of row 1 and the left lane of row 2, and the furnaces deliver in the game,
  so their plates are on those lanes. The drop lanes are read from the blueprint and that rule, not exported by the
  Sidecar for this build, and not measured on an underground end.

The simulator moves the plates on these lines, so an output inserter that cannot put its plates down waits, as in the
game.
