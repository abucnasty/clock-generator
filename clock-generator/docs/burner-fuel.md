# Burner fuel

This page holds how the game's burner machines and drills use fuel, as recorded, and how the simulator models it. The
recordings are `clock-generator/tests/game/mechanics/fuel/` (the probe, five game runs, their retained logs, the offline checks
that assert every figure below, and `simulation.test.ts`, which runs the simulator against them tick by tick). Measured in
Factorio 2.1.21 on the stone furnace, the steel furnace, the burner mining drill and the captive biter spawner, with the
biochamber beside them as the control.

## The energy a burner holds

A burner works from a buffer of energy that holds 16/15 of a tick of its energy usage (the prototype's `heat_capacity`:
1,600 J for both furnaces, 2,666.67 J for the drill, 1,777.78 J for the spawner, 8,888.89 J for the biochamber). The
energy usage is the prototype's `energy_usage` a tick (90 kW is 1,500 J) at an effectivity of 1, and it does not depend on
crafting speed, productivity or what is made: a steel furnace at speed 2 burns the same 1,500 J a tick as a stone furnace,
so a plate costs it half.

A machine that has never worked holds nothing. In its first tick of work the buffer is filled from the fuel (the first item
is taken from the slot) and the machine does no work; its progress starts in the next tick. In each tick of work it draws one
tick of energy from the buffer, and if it can go on working, the burning item tops the buffer up to full in that same tick.

## Taking the next item

An item burns until the top-up needs more than it has left. That tick the next item is taken, the leftover is used first and
the rest of the top-up comes from the new item: a stone furnace on coal swaps at 900 J left and the new item has 4,000,000 -
(1,500 - 900) = 3,999,400 J. An item lasts its fuel value over the usage: coal 2,667 ticks in a furnace and 1,600 in the
drill, wood half of that, solid fuel (12 MJ) three times, bioflux 3,600 ticks in the spawner, nutrients 240 in the biochamber.

A burner that has nothing to work on burns nothing and takes no item: a stone furnace with coal in the slot and no
ingredients held its buffer, its burning item and its slot unchanged for 3,000 ticks.

## Stopping and starting

A furnace (or biochamber) that stops because its ingredients ran out or its output is full spends its last tick of work
without a top-up, and so holds a fifteenth of a tick of energy (100 J) while it is stopped, burning nothing. Its restart
tick makes a fifteenth of a tick of progress and burns a full buffer, the next a whole tick. Each stop and start therefore
costs a furnace 100 J more than the work: a stone furnace fed an ore every 240 ticks by a burner drill burned 288,100 J a
plate (192 x 1,500 + 100).

A machine or drill switched off by a script (only a script was recorded, not a circuit) keeps its
full buffer, burns nothing and keeps its bars; its first tick back is a whole tick. A drill whose chest is full does the same:
the tick its bar wraps it still mines and is topped up, then it waits (`waiting_for_space_in_destination`) with a full
buffer and burns nothing until there is room, and works a whole tick again at once.

## Running out of fuel

With the slot empty and the burning item spent, the machine works its buffer down: the last tick makes the share of a tick
the buffer pays for (a furnace with 1,000 J of 1,500 makes 2/3), then the status is `no_fuel` and the buffer 0. The progress
of the craft or the mining bar is kept for as long as it lasts. One item put in the slot is taken in the next tick, which
fills the buffer and makes no progress, and the work goes on in the tick after. A machine with no fuel and no ingredients
reports `no_fuel` ahead of `no_ingredients` (or `item_ingredient_shortage`).

## Inserters and the fuel slot

The fuel slot is one slot. An inserter drops its whole hand into it whenever it holds fewer than 5 items, so the slot ends at
4 plus the hand: 5 with a hand of 1, 7 on a working machine and 8 on an idle one with a hand of 4 (one item is in the burner
while it works), 15 with a stack inserter's 16. An idle machine is filled the same. Every burner and fuel here has a limit of
5, because the biochamber's formula (the items that hold 180 buffers, at least 5) gives 5 for them: a stone furnace on tree
seed (0.1 MJ) needs 3, the drill 5, the spawner 1.

## Burner mining drill

A burner drill mines 0.25 a second: its bar moves 1/240 a tick on a mining time of 1, so an ore takes 240 ticks and 600 kJ,
6.67 ore to a coal. Its burn is the usage in every tick it mines, whatever its mining productivity: with the save's
research it made 3,996 ore in 1,200 ticks and burned the same 2,500 J a tick. A mined item is held and dropped in the next
tick (the bar wraps, one tick of `waiting_for_space_in_destination`, then it is in the chest).

## Captive biter spawner

The spawner makes 5 eggs from nothing in 10 s at 100 kW: 1 MJ a craft, 6 crafts to an item of bioflux (the only `food`
item). It does not wait for its output: with 100 eggs in its slot it went on making crafts, and the eggs that did not fit
were not kept. It stops only for fuel, or for a script.

## What the simulator models

Every burner is fuelled from its energy source in the game data (the prototype's `energy_usage`, `effectivity` and the items of its fuel categories): the stone and steel furnaces, the captive biter spawner and the biochamber have a fuel slot and burn the buffer-and-top-up model above, and the burner mining drill has the buffer. No branch is made on an entity, recipe or item name, nor on a fuel category.

For a crafting machine the model is the biochamber's, whose parts are the buffer of 16/15 ticks, the top-up after a tick that keeps working, the next item for the shortfall, and a craft in progress spending the buffer before the machine reports `no_fuel`. An inserter that fills it follows the slot's limit of 5 (the 3 second rule of the section above gives 5 for every burner here). `simulation.test.ts` holds the simulator to the recordings in every tick of the buffer, the burning item's energy, the items in the slot and the bar, for each burner and fuel of the steady run, the idle, run-out and spawner runs, and the drill runs.

The effectivity is applied as the fuel burned for a tick of work: the usage over it. It is unrecorded (1 on every burner of 2.1.21).

### The captive biter spawner

A machine whose recipe takes no ingredient at all, item or fluid (the spawner's), never waits for room: the eggs that do not fit under the stack of 100 are lost, nothing is held, and it only stops for fuel. This is keyed on the recipe's ingredients, which the data shows as none for the spawner's and for no other recipe of the game; the recipe's `preserve_products_in_machine_output` flag, which only it sets, is not what the model reads.

### The burner mining drill

A burner drill mines with the part of a tick's work its buffer pays for. Its first tick of mining fills the empty buffer and moves no bar (a drill's first ore comes a tick later), and from then on each tick of mining draws a tick of energy and tops the buffer up, also on the tick the bar wraps with the item held. A drill that waits (its chest is full) or is switched off draws nothing, keeps a full buffer and works a whole tick when it can. That is the drill's `keepsWorking`: always, which is what the recording shows for a drill holding an item it could not place; the open question of the recording is settled by following it.

Nothing in a build feeds a drill, so its fuel is assumed supplied without limit (`SuppliedBurnerEnergy`): it holds the buffer and burns no item, never runs out of fuel and keeps no fuel slot. The recorded run-out of a drill is not simulated.

### Where the simulator differs from the game

- A craft whose bar sums to exactly 1 (192 steps of 1/192 for a plate in a stone furnace, 600 for an egg) is finished by the game a tick after its bar shows 1: that tick tops the buffer up and the next draws a tick's energy with no top-up. The simulator finishes it in the tick the bar reaches 1, so a machine that stops after such a craft holds a tick of fuel more than the game's from then on (the biochamber's model has it too, since the fuel was first modelled), and the game's bar and product show a tick later. A craft that starts from a restart's 1/15 does not reach 1 exactly and matches.
- A crafting machine switched off by a script has no counterpart in the simulator; a drill's enable control does.
- The statuses `no_fuel` begin and end a tick apart from the game's.
- Modules or beacons on a burner, fuels with a burnt result, two fuels in one slot, spoiling fuel and a burner switched off by a circuit were not recorded.
