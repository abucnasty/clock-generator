## Goals of this Algorithm

1. match the target rate of the recipe chosen exactly
2. minimize "active inserter windows" whenever possible to reduce update time in factorio

The goals above are listed in priority order.

## Active Inserter Windows

An active inserter window is defined as a period where an inserter receives a signal from a decider combinator telling it to be enabled. During that window it has the ability to actively do work and transfer materials from a source to a sink.


### Active Inserter Windows Definition of Good

A good clock output reduces an active inserter window to run just in time to transfer the items the machine needs to keep on crafting to meet the target production rate. This means that many times the inserter will transfer multiple times back to back to meet the transfer goal. Reducing the duration of an active window can lead to instability. The measure for a good active inserter window is when the inserter can pick up the items it needs in the least number of ticks. The output from a machine has also another special consideration which is that it should attempt to pick up the full stack size whenever possible. If it cannot do this, it should minimize the amount of time sitting idle over the machine, picking up the output one craft at a time.

## How clocking impacts updates per second
Clocking can reduce updates per second in theory by minimizing active inserter windows. Most notably, minimize the amount of crafts an inserter sees on its source or sink while idle and not transferring materials. These count as wasted updated checks. This doesn't always translate to improved performance on all hardware, but for the intents and purposes of this algorithm, it is assumed that it *always* does. The choice of removing a clock from an inserter is left up to the user and they can do this by overriding the inserter to "always" enabled in the config. An inserter that is set to "always" enabled is to get no combinator in the blueprint.

Given a recipe chain to produce a target end product, the amount of items that are needed are consistent in this build. Mathematically, the amount of items that need to be transferred is an independent concern of clocking. What clocking can control however is *when* those items get transferred.

Inserters have been measured to have lower update time cost when clocked. When an inserter is not controlled by the circuit network (control behavior enabling / disabling it) it checks every craft finish of its source or sink machine if it has new items to pick up or new items to drop into the sink. Clocking can help by creating a window (active inserter window) narrowing the amount of ticks these checks can happen. Ideally, the inserter is always enabled "just in time" and can transfer in a batch as many items at once as it can.

## Wake-up Lists

Wake-up lists are how the game decides which idle inserters to check, and they are what goal 2 is measured in.

An inserter with nothing to move goes to sleep on the wake-up list of the machine it is waiting on. Each time that machine finishes a craft it wakes the inserters on its list. A woken inserter looks for something to move, finds nothing or only part of a hand, and goes back to sleep. An inserter that is disabled by the circuit network is on no list and is never woken: the debug tooltip of a disabled inserter reads "Wakeup list count: 0".

This can be seen in the game with the debug setting `show-wakeup-lists`, which draws a yellow line from a waiting inserter to what it waits on. A line that flickers on and off very frequently is an inserter that keeps getting woken for nothing, and that is considered bad.

### Wake-ups, the measure for goal 2

A wake-up is one waking of an inserter by a machine: the machine finished a craft, or paid out a productivity bonus, while the inserter was enabled and asleep on its list. A machine wakes an inserter at most once in a tick. The measure for goal 2 is the number of wake-ups per minute, summed over the inserters of one copy of the build. Among the clocks that meet goal 1, the one with the fewest wake-ups is the best. It is defined in `clock-generator/src/crafting/wake-ups.ts`.

The generator is to select the clock with the fewest wake-ups among those that meet goal 1, with one exception: it must not give up belt pickup slack to get there on its own. Belt pickup slack is the few extra ticks a window stays open for an inserter that picks up from a belt, for the gaps other inserters leave on a shared belt. Neither the simulator nor a scaffold has such gaps, so a clock without the slack looks better there than it is in a real factory. Leaving the slack out is a choice for the user.

The game does not expose its wake-up lists to mods, so they cannot be recorded directly. They are worked out from what the game does show: the status of each inserter, which names what it is waiting for, and the number of products each machine has finished. The same calculation is used on a simulated run and on a recording of the game, so that the two can be compared.

Which list an inserter sleeps on follows its status: the machine it takes from while it is waiting for source items or for more items, and the machine it puts into while it is waiting for space in the destination. Whether a waiting inserter is also on the list of the machine at its other end has not been confirmed yet.

Belts and chests are left out of this measure. An inserter that works with a moving belt tracks the position of the item it is going to pick up, which costs more than a wake-up. Belts that do not move are cheaper and are what the simulator models, for simplicity.

## Crafting Constraints

The game has two primary constraints that make clocking difficult. Both of these are governed by the overload multiplier of the machine.

1. automated insertion limit
2. machine output block

The overload multiplier comes from adding beacons to an assembly machine, increasing the crafting speed of the machine. It is defined in the relative reference for this project here `clock-generator/src/entities/machine/traits/overload-multiplier.ts`

Insertion limits is a well defined term within factorio and can be observed by hovering over an input slot and reading the automated insertion limit value. In a given machine, if the input slot has inventory at or above the automated insertion limit, the inserter will not top up the items in it. If it is below it, then this constraint is removed.

There is a secondary constraint: the amount of items currently sitting in the output slot. If the amount of the recipe's main product in the output slot is greater than or equal to the output block, the machine will lock out all ingredient inputs. The output block is the overload multiplier times the amount of the main product one craft makes, or the stack size of that product when it is smaller. It is defined in `clock-generator/src/entities/machine/output/output-block.ts`. A furnace, a recipe without item ingredients and a by-product block only at the stack size. Any inserter wanting to insert an ingredient into the machine must wait until the output of the machine drops again below the output block. The fuel slot is not locked out: a machine at its output block still takes fuel while it is below its fuel limit. The machine also keeps crafting from the ingredients it already holds, so its output can grow well past the output block.

A final constraint is the stack size of the output product. If the stack size is met, then the machine will stop crafting. This can most notably cause issues with recipes that stack to only 50 items. Low density structures, lithium, carbon, all stack only to 50. The machines that craft these recipes are extremely fast with maximum productivity research in the game, so naturally many designs will try to sink 1 machine into four assembly machines. This in practice is a disaster for clocking since it wants to control all four output inserters at stack size 16 to have the same active inserter window. Since it stacks to only 50, one inserter will always be short. Ideally if the stack size was 64, these problems would be removed however this is a decision as of 2.1.21 of factorio and has not changed since the original 2.0 release for Factorio Space Age. The work around has been to only have two inserters or to reduce the stack size to 12. 

## Stack Inserter Constraints

Stack inserters behave functionally different than a bulk inserter in factorio. Many articles online reference clocking in the 1.x days of the game. These clocking methods are outdated since bulk inserters do not retain the items in their hand until they reach their stack size. Bulk inserters are much more flexible and allow transferring a dynamic amount of items to fit within the crafting constraints of the machine. Given that stack inserters are much less forgiving, creating a simulation like this is imperative to reduce the manual testing efforts required to figure out by trial and error a stable clock.

The reason that stack inserters are chosen by most end game designs where clocking is applicable is that it has the advantage of transferring 4 extra items (stack size 16) over a bulk inserter (stack size 12). This reduces the amount of inventory transfers from one machine to another, saving update time in the game (goal 2).

## Constraint Exceptions

Mining drills are an exception to the insertion limit rule as defined in the function: `clock-generator/src/entities/drill/mining-drill-ext.ts`

The actual limit of how much the drill can insert into a machine per tick is the automated insertion limit + 64, however, in practice it is observed that the mining drill will stop at a minimum of 114 items the assumption is due to the stack size of stone being 50 + 64 = 114.

Fuel consumption also deviates from the automated insertion rule as it has its own logic for determining when to insert into a fuel slot of a target entity. A machine that burns fuel fast is topped up to more than 5 items: to the fuel that holds this many times its energy buffer, rounded up to whole items. That is the fuel for 192 ticks at its full energy consumption. In the words of a Factorio developer, a burner does not obey the inserter limit if the fuel does not give it energy for at least 3 seconds of work, with the example of a buffer of 0.4 MJ times 180 ticks. Biochambers were tested in steps of +495% to +1427% energy consumption, whose slots were filled up to 5 to 13 nutrients in Factorio 2.1, all fit it.

Sources:
- https://forums.factorio.com/123927 ([2.0.24] High burner inserter to burner inserter fuel insertion limit)
- https://forums.factorio.com/124272 ([2.0.23] Tooltip for automated insertion limit of burnable fuel is often wrong)
- https://forums.factorio.com/viewtopic.php?p=705411#p705411 this is my own post on factorio where even I was confused until I tested the above and found the reason behind it in other forum posts.

## Simulator Goals

This project actively runs a simulation of the machines, inserters and mining drills that are in the configuration file. It simulates all their crafts and transfers every tick. Belts and infinity chests are not simulated tick by tick: they are a supply that is always full, which is the environment a scaffold gives the build, and fluids are left out. The status of each simulated entity matches exactly the statuses seen in the game and provides state transition logs in debug mode to provide insights into what each entity is doing and a description for why it wanted to transition to a different state. Any deviation from the game is measured by running "scaffold" tests. These tests are driven by having a "scaffold" blueprint paired with a configuration file. Any scaffold can be tested directly in factorio. The `clock-generator-recorder` can help record and run this scaffold and provide per tick entity statistics to compare against the simulator. This is a verification process that the simulator backing the algorithm is doing the right thing. A scaffold test checks both goals against the game: that every clock period moves exactly the expected output, and that the simulator counts the wake-ups the game shows.

### The status of an inserter

The status the game shows for an inserter is decided by its sink before the inserter itself, and not by what the inserter carries. It is defined in `clock-generator/src/state/factorio-entity-state.ts` and was derived from recordings of five scaffolds in Factorio 2.1.21.

- An inserter that is switched off by its circuit condition shows as disabled from that tick on, even while it finishes the swing and the drop it had already started. A window of 4 ticks shows as 4 ticks that are not disabled.
- With an empty hand, it is waiting for space in the destination whenever the sink takes nothing from anyone: the output of the machine is at its output block, or every ingredient is at its insertion limit, and its fuel is at its limit too. This is shown even while the arm is still swinging back.
- With an empty hand and a sink that still takes something, it is working while it swings back, and waiting for source items once there is nothing for it to take. This is also what it shows when the sink is full of the one item this inserter brings.
- With a hand it is still filling, it is waiting for more items between pickups.
- A full hand is working, until it cannot be dropped in one go. A hand goes onto a belt one stack at a time and shows as waiting for space in the destination in between.