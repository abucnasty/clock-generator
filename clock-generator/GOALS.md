## Goals of this Algorithm

1. match the target rate of the recipe chosen exactly
2. reduce the update time the build costs the game (UPS)

The goals above are listed in priority order.

Goal 2 was first written as "minimize active inserter windows whenever possible to reduce update time in factorio". Its aim is the update time itself (the owner, 2026-10-15: "The specific goal is to reduce UPS. Goal as stated is outdated."). The selection does not measure update time yet: it ranks clocks by their wake-ups ("Wake-ups, the measure for goal 2"), which stand in for it. The wake-ups stay the measure until a plan to measure update time replaces them.

### Goal 1: match the target rate exactly

> A clock must always recover. When any item of a build stops arriving for a while, or its output stops being taken, the machines run dry or fill up, and when the item comes back the build has to return to its target rate under the same clock by itself. Nobody should have to restart a build because one input ran out.
>
> A clock that does this survives backpressure loss, and one that does not cannot survive backpressure loss. This is what "stable" has meant in this project: a stable clock is one that survives backpressure loss. A clock that only makes its target rate from a clean start, with every machine full of ingredients and emptied of products, does not meet goal 1.

The detail is in [docs/stability.md](docs/stability.md).

### Goal 2: reduce the update time the build costs the game

> The measure for goal 2 is the number of wake-ups per minute, summed over the inserters of one copy of the build. Among the clocks that meet goal 1, the one with the fewest wake-ups is the best. It is defined in `clock-generator/src/crafting/wake-ups.ts`. Since 0.13.0 it follows the mechanic above: the inserters into a machine are woken by its craft starts, which the simulator counts itself, and not by its payouts. Before that both lists were woken by finishes and payouts, which on a machine with productivity counted more wake-ups of the inserters into it than the game makes (the advanced circuit scaffold's inputs: 1,075 a minute against 625). The game's figure in a recording is read by the series' method from status and products_finished ("The rule's count and the clock-or-unwired advice"), whose standing per machine type is named with it; on a biochamber it is a known miss, and on machine types never recorded it is not checked.

The detail is in [docs/wake-ups.md](docs/wake-ups.md).

## Backpressure Loss

Moved to docs/stability.md.

### How a clock is tried for it

Moved to docs/stability.md.

## Working Rules

Moved to docs/working-rules.md.

## Game Data and What Is Not Modelled Yet

The generator reads the game's recipes, items, drills and resources from a dump of Factorio 2.1.21 (build 87673, `resources/data-version.json`, since 0.14.0; before that an older 2.0 dump that still named the ore melting recipes `molten-iron` and `molten-copper`). 2.1 gives a recipe a list of crafting categories; the generator reads the list, and the only thing it does with it is tell a biochamber from an assembler in an older sidecar's export. The game's version the data comes from is recorded beside it and printed in the header of `npm run calls`, so a call can be told from one made on other data.

A config describes one copy of a build, and `copies` is the number of identical copies, with no inserter between copies and the belts shared (`src/config/schema.ts`). A config that holds several identical copies is refused and told to describe one (`src/config/copies-validator.ts`): the smallest repeating unit is what is planned, never a block of hundreds of inserters.

What the generator does not model is refused by name, with where it is on the roadmap (`docs/ROADMAP.md`), so that a user and the config writer know whether to wait or to work around it:
- A recipe whose only products are fluids (ore melting, acid, oil cracking): follow-up F1, a fluid rate model for the drills and inserters feeding it. Fluid ingredients are dropped from a recipe and the machine is taken to be fed; whether that lets the model's foundry run faster or slower than the game's is a question of milestone M1.
- A car, tank or cargo wagon as a chest, and a rocket silo as a chest or as the machine crafting rocket parts: milestone M2.
- Recyclers and per-quality output: milestone M3. The recycler's recipe data (`shared_probability` per result) is in the dump and not read yet.
- Latches and sensors switching an inserter: not modelled and not compared; such an inserter is one to clock.

## Active Inserter Windows

Moved to docs/stability.md.

### Active Inserter Windows Definition of Good

Moved to docs/stability.md.

## How clocking impacts updates per second

Moved to docs/wake-ups.md.

## Wake-up Lists

Moved to docs/wake-ups.md.

### Wake-ups, the measure for goal 2

Moved to docs/wake-ups.md.

### Even hands

Moved to docs/wake-ups.md.

## The rule's count and the clock-or-unwired advice

Moved to docs/advice.md.

## The rules of the game, indexed

Moved to docs/rules-of-the-game.md.

## Crafting Constraints

Moved to docs/rules-of-the-game.md.

## Stack Inserter Constraints

Moved to docs/rules-of-the-game.md.

## Constraint Exceptions

Moved to docs/rules-of-the-game.md.

## Simulator Goals

Moved to docs/simulator.md.

### The status of an inserter

Moved to docs/simulator.md.

### What an inserter takes off a belt first

Moved to docs/simulator.md.

### Two inserters that bring the same item

Moved to docs/simulator.md.

### When a waiting inserter acts

Moved to docs/simulator.md.
