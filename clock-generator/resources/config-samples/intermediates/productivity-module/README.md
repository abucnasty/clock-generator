# Productivity modules from a chain of nine machines

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `productivity-module-80-chest-chain` | abucnasty | given with its config on 2026-10-23 (95 entities) | #89 is a related request; not checked whether it is this build | Scaffold: yes (given with its config, 2026-10-23, 95 entities). A chain of nine legendary machines (plastic, copper cable and iron casting, electronic circuits, advanced circuits, productivity modules) with three steel chests between them, a coal belt and an output belt, 80 modules a second over 6 copies (16 a window cycle of 72 ticks for one copy). Unclocked the scaffold makes 13.52 a second a copy (81.1 over 6, 101.4% of the target). No clock observed from the plan holds; the recommended clock, the 72-tick clock with windows made from the hands and the order of the chain ("Hands in groups", `docs/stability.md`), made 16 in each of 63 window cycles and 499 of 499 in the longer recording, and got back to 16 after the coal was cut for 40 window cycles, the output blocked for 24 and the iron foundries stopped for 26. Wakeups a minute: 575.6 simulated and 602.8 in the game, with "Backed-up belts" off and on (the clock kept before the rule ranked its placements: 843.8 and 858.5). Note: in `test:game`. |

A productivity module build, 80 modules a second from 6 copies (13.33 a second each), given by abucnasty as a config and a scaffold on
2026-10-23. A copy has nine machines: a cryogenic plant making plastic from coal and petroleum gas, four electromagnetic
plants (advanced circuits, two electronic circuits, and the modules), and four foundries casting copper cable (two) and iron
plates (two). The cables and the plastic go into steel chests; the advanced circuits go into a third chest; the electronic
circuits and the iron and copper pass from machine to machine. Fourteen stack inserters (hand 16) move everything between them, from a coal belt of one lane to an output belt (stack 4)
with the modules on one lane. Every machine is legendary, with beacons. Most machines feed others, and the module machine, which can make 13.51 modules a second (speed 135.0625, 1.5 modules a craft), has 1.3% to spare
over the 13.33 a copy must make.

- `productivity-module-80-chest-chain.json`: the config of the build as the paste reads it, one copy, target 80 a second over 6 copies.
  The coal lane is one per copy and a dead end: each copy takes its coal from a belt of its own that stops at the pickup.
- `productivity-module-80-chest-chain.scaffold`: the blueprint of one copy with its 23 beacons and no clock (95 entities): the coal in an
  infinity chest with its inserter, infinity pipes for the petroleum gas, the molten copper and the molten iron, the three
  steel chests, and a turbo loader at the end of the output belt that empties it into an infinity chest.

The scaffold built in the harness and exported with the sidecar matches the config machine by machine (recipe, speed,
productivity, prototype, quality), inserter by inserter (source, sink, prototype, stack size, direction), chest by chest and belt
by belt. The scaffold has two infinity chests the config does not (the coal's and the output belt's end).

With no clock the scaffold makes 13.52 modules a second a copy (81.1 over 6, 101.4% of the target): the module machine works
all the time and the advanced circuit machine 98.6% of it. The chain has about 1.3% to spare, so a clock has to hold nearly
every window of every inserter.

## In the game

See `tests/game/builds/README.md` ("The productivity module chain") for the clock recorded on the scaffold and its losses.
