## Goals of this Algorithm

1. match the target rate of the recipe chosen exactly
2. reduce the update time the build costs the game (UPS)

The goals above are listed in priority order.

Both are worked toward arithmetic first (decided 2026-10-23): what plain arithmetic settles of a plan (a source's buffer and rate against its takers' draws, a machine's stock against the gap until its next window, a window's length against its hands) is settled before anything is simulated, so that fewer clocks are tried for a build. A rule that computes a placement is preferred to one that tries placements in turn, and a rule that deletes code to one that adds it: the simulator judges the result, it does not search for it ([working rules](docs/working-rules.md), rule 6).

Goal 2 was first written as "minimize active inserter windows whenever possible to reduce update time in factorio". Its aim is the update time itself (decided 2026-10-15: "The specific goal is to reduce UPS. Goal as stated is outdated."). The selection does not measure update time yet: it ranks clocks by their wake-ups ("Wake-ups, the measure for goal 2"), which stand in for it. The wake-ups stay the measure until a plan to measure update time replaces them.

### Goal 1: match the target rate exactly

> A clock must always recover. When any item of a build stops arriving for a while, or its output stops being taken, the machines run dry or fill up, and when the item comes back the build has to return to its target rate under the same clock by itself. Nobody should have to restart a build because one input ran out.
>
> A clock that does this survives backpressure loss, and one that does not cannot survive backpressure loss. This is what "stable" has meant in this project: a stable clock is one that survives backpressure loss. A clock that only makes its target rate from a clean start, with every machine full of ingredients and emptied of products, does not meet goal 1.

"Exactly" allows one thing: a clock whose period is not a whole number of ticks and whose blueprint counts it rounded down to whole ticks (where no subtick clock gives the exact period, or as the rounded alternative of one) meets goal 1 when it runs at most 0.1% faster than the target and within what the machines can make, tried on its own whole-tick period like any other clock. It is labelled with how much it runs fast, and a clock at exactly the target rate comes first (decided 2026-10-23: Atlan cell 29's 2,888-tick clock of a 2,888.666-tick period runs 0.02% fast, and held and recovered in the game, #332).

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
