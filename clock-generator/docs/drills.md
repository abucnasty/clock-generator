# Mining drills

This page holds the game's mining drill mechanics as recorded, and how the simulator models each. The simulator page ([simulator.md](simulator.md#mining-drills)) summarises it; the rules are indexed in `src/rules-of-the-game.ts` (rules 3, 16 and 17) and [rules-of-the-game.md](rules-of-the-game.md).

## How a drill mines

A drill mines by two progress bars, as the game's does (since 0.20.0). The bars run from 0 to the resource's mining time (1 for iron and copper ore, coal, stone and calcite; 0.5 for scrap, 2 for uranium ore, 5 for tungsten ore), as the game's `mining_progress` and `bonus_mining_progress` read. In each tick the drill mines, its mining bar moves by its mining speed a tick and its bonus bar by that times its mining productivity. Each wrap of either bar is an item. The bars are doubles summed tick by tick, as in the game's: a bar of 0.198 a tick wraps in its 97th tick, not in the 96th an exact sum gives. So a drill making less than one item a tick mines.

### The bonus bar near a whole item

The game's bonus bar has a tolerance near a whole item; its mining bar has none (since 0.20.0, `bonusBarTick`). In each tick the bonus bar:

1. A bar of 2 mining times or more makes its whole mining times as items and keeps what is left of a mining time. The game keeps that fraction as it is, in its own units: on scrap (0.5) a bar of 1.45 makes 2 items and keeps 0.9, which is another item. On tungsten ore (5), 10.01 keeps 0.002, where 0.01 would be left in units. A bar of 1 to 2 mining times makes one item and loses one mining time.
2. A bar 0.0001 or less below a mining time makes one more item and loses one mining time.
3. A bar that made an item and keeps less than 0.001 keeps nothing. A bar under 0.001 that made no item is kept, so a slow bonus bar still fills.

With a mining time of 1, a bar that reaches 0.9999 makes its item, and after an item a remainder under 0.001 is dropped. So a drill at +82% and 0.0875 a tick loses the 0.00025 its 223rd tick leaves (223 x 0.07175 = 16.00025), and its bar repeats every 223 ticks. A drill at +399,990% makes its 1,000th item from a sum 2.5e-8 short of 1,000. The double sum alone would carry the 0.00025 in the first case, and make one item fewer in the second.

The two tolerances were measured by setting the bars by script: they hold at bonus steps of 0.0005 to 1,000 a tick, at mining steps of 0.094 and 0.25, with the mining bar making an item in the same tick or not, with the drill built last or moved, and on all three mining times. They are in the game's units, not shares of a mining time.

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

Each drill has its own productivity (`productivity` of its config, in percent, as a machine's; since 0.20.0). In the game a drill's `productivity_bonus` is the force's mining productivity research bonus (`force.mining_drill_productivity_bonus`, 10% a level researched) and its productivity modules' together, not capped, and its bonus bar moves by its mining step times that bonus in every tick: recorded in the drills family with no modules and with four legendary productivity modules 3 and no research (+100%), and checked in the game with modules on top of research when the level went (+70% and four legendary productivity modules 3: +170%; +440% and two of them: +490%; +70% and three normal productivity modules 1: +82%). Sidecar exports it per drill from 0.12.0 on (`productivity_bonus` x 100). A config with the former `mining_productivity_level` is read as each drill's productivity, the level x 10%. The harness save's research, mining productivity 3 at level 8000, is 7,999 levels, +79,990%.

## The first tick

The game's drill has no mining target in its first tick, so it mines a tick after the simulator's, and its first drop into a chest comes a tick after the simulator's too. Not modelled; the recordings count game row k as the simulator's k-th tick.

## Evidence

Recorded in Factorio 2.1.21 by two families of game tests:

- **The drills family** (`tests/game/mechanics/drills/`, [README](../tests/game/mechanics/drills/README.md); #308, the stop asserted in #310). 18 builds of a big mining drill, with the research set by script: 0.0167, 0.25, 0.34, 0.43, 0.93 and 1.35 items a tick, one with four productivity modules and no research, into a car emptied by an inserter and into an assembling machine that crafts or never crafts, built last, moved to another chunk, and disabled by its circuit while it holds items. Driven by the game's takes, the simulator's drill has the game's bars, waits and drops in every tick; the simulator's run of the whole build equals the game's in every tick where the build's other entities are modelled as the game has them. The stop into a machine is the 114 on rail and 214 on landfill above. Six more builds set the drill's bars by script near a whole item, on iron ore at two mining steps, built last and moved, and on scrap and tungsten ore; the simulator's bonus bar gives the game's bar and items in every trial (`remainder.game.test.ts`).
- **The containers family** (`tests/game/mechanics/containers/`, [README](../tests/game/mechanics/containers/README.md); #299). A big mining drill on iron ore into a car (4,000 ore in its 80 slots), into a car with five slots filtered to copper plates (3,750 ore, the five slots empty), into a steel chest (2,400) and into a rocket silo (500 ore in its rocket inventory, nothing in its input slots), each emptied by one stack inserter, at two places. The containers end as the simulator has them, slot for slot, with every hand equal, and fill by the simulator's amounts in every tick from the drill's first drop.

The stop into a machine was changed in #310 to the larger of the stack and the insertion limit, + 64, after the drills family's stops (the previous rule added one craft's ingredients to the limit and gave 115 and 264).

## Known limits

- The first-tick offset above is not modelled.
- A mining bar that moves a mining time or more in a tick (several items a tick from the mining bar, on scrap a mining speed of 30 a second) is not recorded; the simulator makes one item a tick from it at most.
- Some builds of the drills family are compared through the drill alone: a yellow inserter taking from a car leaves with what is there where the simulator's waits to fill its hand, and an assembler starts its next craft a tick later in the simulator than in the game.
- The drills family's research levels are set by script, and the containers family uses the harness save's 7,999 levels; no other level is recorded. One build of the drills family has productivity modules.
- A drill that drops into something the Sidecar does not export is listed as left out ([game-data-and-scope.md](game-data-and-scope.md)).
- Two inserters acting on one container in the same tick are a known limit of the containers rule, listed in `src/rules-of-the-game.ts` and [simulator.md](simulator.md#cars-wagons-and-rocket-silos-as-chests).
