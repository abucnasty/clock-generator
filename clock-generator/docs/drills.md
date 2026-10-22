# Mining drills

This page holds the game's mining drill mechanics as recorded, and how the simulator models each. The simulator page ([simulator.md](simulator.md#mining-drills)) summarises it; the rules are indexed in `src/rules-of-the-game.ts` (rules 3, 16 and 17) and [rules-of-the-game.md](rules-of-the-game.md).

## How a drill mines

A drill mines by two progress bars, as the game's does (since 0.20.0). Its mining bar moves by its crafting rate a tick (its mining speed over the resource's mining time) and its bonus bar by that times its mining productivity; each wrap of either is an item. The bars are doubles summed tick by tick, as in the game's: a bar of 0.198 a tick wraps in its 97th tick, not in the 96th an exact sum gives. So a drill making less than one item a tick mines.

## What a drill holds and when it drops

Each tick an enabled drill first drops what it holds. An item it mines is held and dropped in the next tick.

- **Into a machine** up to the drill's limit (the automated insertion limit + 64, `src/rules-of-the-game.ts` rule 3; see "The stop into a machine" below).
- **Into a chest** as far as it has room (since 0.20.0, a drill's `target` of type `chest`; `src/rules-of-the-game.ts` rule 16). The drill drops what it mines as far as the chest has room, by the chest's own rules: the free slots of a car, a tank or a wagon in slot order, the rocket inventory of a silo by weight, a buffer chest of its item. What does not fit stays in the drill, which mines no more until it has dropped it: a full chest stops the drill. A drill into a full chest that gets room puts in what it held in that tick and what it mines then in the next (5, then 11, in the containers family's filtered car).

## Waiting while it holds anything

While a drill still holds anything after dropping, it waits, and its bars stand still. Otherwise it mines. What it drops into is not checked before it mines, so a drill into a full car or a machine at its limit mines on until it holds an item.

## A drill disabled by its circuit

A drill disabled by its circuit neither drops nor mines, and keeps what it holds and both bars. Nothing gates a drill into a chest: it is always enabled and gets no clock window.

## The stop into a machine

Rule 3 of the rules of the game, as [rules-of-the-game.md](rules-of-the-game.md#constraint-exceptions) words it:

> Mining drills are an exception to the insertion limit rule as defined in the function: `clock-generator/src/entities/drill/mining-drill-ext.ts`
>
> The actual limit of how much the drill can insert into a machine per tick is the automated insertion limit + 64, however, in practice it is observed that the mining drill will stop at a minimum of 114 items the assumption is due to the stack size of stone being 50 + 64 = 114.

The simulator stops a drill into a machine at the larger of the stack and the automated insertion limit, + 64 (`miningDrillMaxInsertion`). The game's machine never goes above it: 114 for stone in an assembling machine on rail, 214 on landfill, and it reaches it in the rail builds and in `landfill-l45` and its drill-last and moved variants.

## Mining productivity

The mining productivity level is the number of levels researched, 10% each, as the game gives them: the force's bonus in 10% steps, which Sidecar exports from 0.12.0 on (`force.mining_drill_productivity_bonus` x 10). The harness save's research, mining productivity 3 at level 8000, is 7,999 levels.

## The first tick

The game's drill has no mining target in its first tick, so it mines a tick after the simulator's, and its first drop into a chest comes a tick after the simulator's too. Not modelled; the recordings count game row k as the simulator's k-th tick.

## Evidence

Recorded in Factorio 2.1.21 by two families of game tests:

- **The drills family** (`tests/game/mechanics/drills/`, [README](../tests/game/mechanics/drills/README.md); #308, the stop asserted in #310). 17 builds of a big mining drill, with the research set by script: 0.25, 0.34, 0.43, 0.93 and 1.35 items a tick into a car emptied by an inserter and into an assembling machine that crafts or never crafts, built last, moved to another chunk, and disabled by its circuit while it holds items. Driven by the game's takes, the simulator's drill has the game's bars, waits and drops in every tick; the simulator's run of the whole build equals the game's in every tick where the build's other entities are modelled as the game has them. The stop into a machine is the 114 on rail and 214 on landfill above.
- **The containers family** (`tests/game/mechanics/containers/`, [README](../tests/game/mechanics/containers/README.md); #299). A big mining drill on iron ore into a car (4,000 ore in its 80 slots), into a car with five slots filtered to copper plates (3,750 ore, the five slots empty), into a steel chest (2,400) and into a rocket silo (500 ore in its rocket inventory, nothing in its input slots), each emptied by one stack inserter, at two places. The containers end as the simulator has them, slot for slot, with every hand equal, and fill by the simulator's amounts in every tick from the drill's first drop.

The stop into a machine was changed in #310 to the larger of the stack and the insertion limit, + 64, after the drills family's stops (the previous rule added one craft's ingredients to the limit and gave 115 and 264).

## Known limits

- The first-tick offset above is not modelled.
- Some builds of the drills family are compared through the drill alone: a yellow inserter taking from a car leaves with what is there where the simulator's waits to fill its hand, and an assembler starts its next craft a tick later in the simulator than in the game.
- The drills family's research levels are set by script, and the containers family uses the harness save's 7,999 levels; no other level is recorded.
- A drill that drops into something the Sidecar does not export is listed as left out ([game-data-and-scope.md](game-data-and-scope.md)).
- Two inserters acting on one container in the same tick are a known limit of the containers rule, listed in `src/rules-of-the-game.ts` and [simulator.md](simulator.md#cars-wagons-and-rocket-silos-as-chests).
