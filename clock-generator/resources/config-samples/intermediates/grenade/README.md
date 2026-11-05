# Grenades from coal and molten iron

| Build | Credit | Source | Issues | Recorded in the game |
|---|---|---|---|---|
| `grenade-240-fills-belt-exactly` | warbaque | blueprints given on 2026-10-23: the scaffold, the wiring guide, the full build of seven copies | #446, #363 | Scaffold: yes (blueprints given 2026-10-23: the scaffold, the wiring guide, the full build of seven copies). Four assemblers on grenades, a foundry casting iron and four drills dropping coal into the assemblers, all legendary, 240 grenades a second over 7 copies on one turbo belt whose two lanes are exactly full. The hand-made clock (112 ticks) and the selected clock, the 112-tick clock with its windows made from the hands and the sources ("Hands in groups", `docs/stability.md`), made 64 in each of 63 periods on one copy and 448 on the full build, with no output inserter waiting for the belt, and got back after the foundry was stopped, the output blocked until the belt was full and the drills stopped. Wake-ups a minute (Factorio 2.1.24, #446): 128.6 simulated and 127.6 in the game for the hand-made clock, 136.6 and 133.6 for the generated one (+2.2% on inserters 3-5, which changes no verdict). Note: in `test:game`. |

The build, 240 grenades a second from 7 copies (34.2857 a second each). A copy has four legendary assembling machine 3s
making grenades (crafting speed 70.4159, with speed modules 3 and beacons), a legendary foundry casting iron (143.75, 4
productivity modules 3: 150%) fed molten iron from an infinity pipe, and four electric mining drills that drop coal straight into
the assemblers. The foundry's four stack inserters (hand 16) fill the assemblers with plates; each assembler's stack inserter puts
its grenades on one turbo belt of two lanes at stack 4. The seven copies stand 12 tiles apart along two belt lines (the north
machines' and the south machines') that merge into one belt, which a loader empties into a disposal chest. Both lanes are exactly
full at the target: 7 x 34.2857 = 240 = 2 x 120 a second.

Given by warbaque on 2026-10-23:

- `grenade-240-fills-belt-exactly.json`: the export of the build as the paste reads it, one copy, target 240 a second over 7 copies. The drills'
  productivity is 80010 where the harness save gives 79990 (its research, 7,999 levels); generation gives the same clocks for
  both. The belt is a `turbo-transport-belt`, where the Sidecar of the time named it `turbo-loader` after the loader at the end of
  the line, which the paste refuses; Sidecar 0.14.0 gives a line with a loader the belt type of its first belt, underground belt
  or splitter (#363).
  `target_output.copy_offset` (12 tiles east) and each output inserter's `belt_direction` (west) were added to it afterwards, for the
  check of the copies' drops onto the belt; the export given has neither.
- `grenade-240-fills-belt-exactly.scaffold`: the blueprint "scaffold" of the book given, one copy with its 22 beacons and no clock (86 entities).
  The harness needs `drill_resource: coal`; its export matches `grenade-240-fills-belt-exactly.json` entity by entity.
- `grenade-240-fills-belt-exactly-wiring-guide.blueprint`: the blueprint "wiring guide": one copy without beacons and with the hand-made clock (77 entities).
- `grenade-240-fills-belt-exactly-hand-clock.blueprint`: the scaffold with the wiring guide's seven decider combinators and their 23 wires added,
  made for the game test (the given files are not changed): one copy on the hand-made clock.
- `grenade-240-fills-belt-exactly-full-build.blueprint`: the full build, 458 entities: seven copies and one clock of the same design, the belt lines
  and the loader. The game tests build it as seven copies of the config.

The hand-made clock counts 0 to 111 (112 ticks) and has six window deciders: the output inserters of the north machines are enabled
in tick 0 and those of the south machines in tick 56 (one tick each); the foundry's inserters into the north machines in ticks
2..43 and into the south machines in ticks 58..99; the north drills in ticks 5..7 and the south drills in ticks 61..63. In the
game (`tests/game/builds/grenade-clock-controls.json`) it makes 64 grenades in each of 64 periods on one copy and 448 on the
full build, on the belt just in time (no output inserter ever waits for room), and gets back after the foundry is stopped, the
output blocked until the belt is full and the drills stopped. The generator makes the same period (112 ticks) and, since 0.22.0,
windows of the same kind (see "Hands in groups" in `docs/stability.md`). The simulator counts 128.6 wake-ups a minute for the hand-made clock and the game 127.6 (#446).
