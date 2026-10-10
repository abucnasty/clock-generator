## Goals of this Algorithm

1. match the target rate of the recipe chosen exactly
2. minimize "active inserter windows" whenever possible to reduce update time in factorio

The goals above are listed in priority order.

## Backpressure Loss

A clock must always recover. When any item of a build stops arriving for a while, or its output stops being taken, the machines run dry or fill up, and when the item comes back the build has to return to its target rate under the same clock by itself. Nobody should have to restart a build because one input ran out.

A clock that does this survives backpressure loss, and one that does not cannot survive backpressure loss. This is what "stable" has meant in this project: a stable clock is one that survives backpressure loss. A clock that only makes its target rate from a clean start, with every machine full of ingredients and emptied of products, does not meet goal 1.

Builds are classified the same way. Some builds cannot survive backpressure loss whatever the clock, such as a loop of machines that does not start again once it has run dry. That is a limit of the build, and it is fine to say so and to give such a build the clocks it can have, as long as they are named for what they are.

Decided on 2026-10-10, after a clock for the advanced circuit build that makes its 704 a period from a clean start made 608 and 624 in the game: one of its two plants held products when the clock started, and never caught up.

## Working Rules

Decided on 2026-10-10, after a day in which each recording of the game led to another rule for the simulator and the work on goal 2 did not start.

1. The simulator is the judge of a clock, because it is the only judge that ships with the generator. The game is what the simulator is calibrated against.
2. A difference between the simulator and the game is chased only when it changes whether a clock is stable, or which clock is selected, on some sample. Any other difference gets a line in `resources/config-samples/README.md` and is left.
3. Margin comes before precision. A clock has to recover from losses and hold with its windows a tick off, so that a modelling error of one tick does not decide whether it works.
4. Scaffold tests are a regression check. They do not decide whether a change ships.
5. The generator is built from general patterns. A sample, a scaffold or a clock someone made by hand is evidence and a benchmark, never the target. A build the generator cannot clock is a gap to record, not a reason to change the build.

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

There are two kinds of design: a clock that only works when its inserters pick up from a belt that does not move, and a clock that also works when the items on the belt are moving. An inserter changes its tick timing when the belt is moving, and all the more when the belt has gaps, which it can have when the build needs the whole capacity of the belt. The simulator only has the first kind of belt: always full, and not moving. So do the scaffolds, all but one: their belts are closed at the end and stand still once they are full. The iron bacteria scaffold lets 32 items through in every 61 ticks to keep its nutrients fresh, so its belt creeps.

What a build does when its belt moves has to be accounted for (decided on 2026-10-10), and nothing checks it yet: a clock made for a moving belt has never been recorded on one. It needs scaffolds whose belt moves as the belt of a row of copies does, where what passes one copy is what the copies after it take.

Belt pickup slack is an easy way to get a clock for a moving belt without modelling one. Each window of an inserter that picks up from a belt stays open a few ticks longer: the ticks one more full hand takes at one belt stack a tick, which is 4 for a hand of 16 from stacks of 4. It is a rule of thumb. It may work on one build and not on another, and neither the simulator nor a scaffold can tell which.

The generator selects the clock with the fewest wake-ups among those that meet goal 1, with one exception: it must not give up belt pickup slack to get there on its own. A clock without the slack is a clock for a belt that does not move, a non-moving belt clock, and in the simulator it looks better than it is on a moving belt. Leaving the slack out is a choice for the user, made with `overrides.non_moving_belts` in the config ("Belts do not move" in the UI): then each clock is made without the slack and the clock with the fewest wake-ups is selected; a clock that does not hold the target rate without the slack is offered as unstable, and is not made again with it. Without that choice a clock without the slack is only selected when no clock with it meets goal 1, whether the slack was left out on purpose or because the clock does not hold with it. The order is in `combineClockAlternativeRuns` in `clock-generator/src/crafting/generate-blueprint.ts`.

When no clock meets goal 1, the generator selects the one whose rate in the simulator is nearest to the target, above or below, whatever belt it is made for, and says so when its blueprint is copied. The processing unit sample with a belt export and the utility science sample with direct-insert low density structures are the two without a clock that holds: the first selects 34.6 of 40 a second, the second 200 of 240.

An inserter that takes fuel for its machine off a belt, as well as an ingredient, needs longer windows on a belt that does not move too. The fuel slot asks for a hand when it falls below its limit, which does not repeat with the clock: the hand of fuel comes at any tick of any window, ahead of the hands the window is planned for. A window ends where its last planned hand is back from the drop, so with a hand of fuel ahead that hand is full later than the window ends, by the ticks the fuel hand takes to fill: 4 for a hand of 16 from stacks of 4. Without them the window closes on a partly filled hand, and an inserter that holds an ingredient takes no fuel. This is room for a hand of fuel, and it is as long as belt pickup slack. A clock for belts that do not move gets it when it does not hold the target rate without, and stays a clock for a belt that does not move; one that does not hold with the room either is offered as it is, unstable. The agricultural science sample is the case: 377 of 400 a period in the game without the room, 400 with it. On a moving belt the two are not added up: the slack is all such an inserter has there, a hand of fuel uses it up, and nothing is left for a pickup that comes late. That is a known limit of the rule of thumb, left as it is so that the clocks for a moving belt stay as they are.

Every clock the generator offers names the belt it is made for: moving, with the ticks of slack it has, or non-moving. The slack is not given to a clock with a period that is not a whole number of ticks, so a subtick clock is a non-moving belt clock for now. It is not ranked behind the clocks for a moving belt, as a clock that left the slack out is. On the three samples with a subtick clock, no clock with the slack meets goal 1.

The inserters of a loop of machines, and those that take from its machines to another machine, are left always enabled by every clock, whatever that costs in wake-ups: a loop that runs dry does not start again. The one exception is an inserter that feeds the machine the build's output is taken from, which gets windows when the clock holds with them. Clocking them can save a lot. On the iron bacteria sample a clock with windows on its two loop inserters held the target rate in the game for ten minutes at 1,587 wake-ups a minute, where the selected clock has 4,490. It is not offered: ten minutes on one build is not enough to risk a loop on, and the rule stays until it is decided otherwise.

The game does not expose its wake-up lists to mods, so they cannot be recorded directly. They are worked out from what the game does show: the status of each inserter, which names what it is waiting for, and the number of products each machine has finished. The same calculation is used on a simulated run and on a recording of the game, so that the two can be compared.

Which list an inserter sleeps on follows its status: the machine it takes from while it is waiting for source items or for more items, and the machine it puts into while it is waiting for space in the destination. Whether a waiting inserter is also on the list of the machine at its other end has not been confirmed yet.

A clock can settle into more than one steady state with the same output, depending on what the machines hold when it starts, and each has wake-ups of its own. Batched swings on the utility science sample makes 192 a period in each of three, at 10.7, 26.8 and 32.1 wake-ups a minute; in the game it settled into the second. The generator counts the wake-ups of the state its own run settles into, so its figure for such a clock is one of several. A scaffold test looks for the game's figure among those the simulator counts from other starts of the clock.

Belts and chests are left out of this measure. An inserter that works with a moving belt tracks the position of the item it is going to pick up, which costs more than a wake-up. Belts that do not move are cheaper and are what the simulator models, for simplicity.

## Crafting Constraints

The game has two primary constraints that make clocking difficult. Both of these are governed by the overload multiplier of the machine.

1. automated insertion limit
2. machine output block

The overload multiplier comes from adding beacons to an assembly machine, increasing the crafting speed of the machine. It is defined in the relative reference for this project here `clock-generator/src/entities/machine/traits/overload-multiplier.ts`

Insertion limits is a well defined term within factorio and can be observed by hovering over an input slot and reading the automated insertion limit value. In a given machine, if the input slot has inventory at or above the automated insertion limit, the inserter will not top up the items in it. If it is below it, then this constraint is removed.

There is a secondary constraint: the amount of items currently sitting in the output slot. If the amount of the recipe's main product in the output slot is greater than or equal to the output block, the machine will lock out all ingredient inputs. The output block is the overload multiplier times the amount of the main product one craft makes. Where that is more than a stack of the product, the block is never reached: such a machine stops crafting when its stack is full and goes on taking ingredients up to their insertion limits. Recorded in Factorio 2.1.21 on the cryogenic plant that makes plastic in three scaffolds: with an overload multiplier of 73 and 2 plastic bars a craft its block is 146 against a stack of 100, and with 100 plastic bars and the status full output it took coal at 69 and left its inserter waiting for space in the destination at 73, the insertion limit of coal. It is defined in `clock-generator/src/entities/machine/output/output-block.ts`. A furnace, a recipe without item ingredients and a by-product block only at the stack size. Any inserter wanting to insert an ingredient into the machine must wait until the output of the machine drops again below the output block. The fuel slot is not locked out: a machine at its output block still takes fuel while it is below its fuel limit. The machine also keeps crafting from the ingredients it already holds, so its output can grow well past the output block.

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

This project actively runs a simulation of the machines, inserters and mining drills that are in the configuration file. It simulates all their crafts and transfers every tick. Belts and infinity chests are not simulated tick by tick: they are a supply that is always full, which is the environment a scaffold gives the build, and fluids are left out. The status of each simulated entity matches exactly the statuses seen in the game and provides state transition logs in debug mode to provide insights into what each entity is doing and a description for why it wanted to transition to a different state. Any deviation from the game is measured by running "scaffold" tests. These tests are driven by having a "scaffold" blueprint paired with a configuration file. Any scaffold can be tested directly in factorio. The `clock-generator-recorder` can help record and run this scaffold and provide per tick entity statistics to compare against the simulator. This is a verification process that the simulator backing the algorithm is doing the right thing. A scaffold test checks both goals against the game: that every clock period moves exactly the expected output, and that the simulator counts the wake-ups the game shows. It also lays the simulator against the game entity by entity: a run of the same clock in the simulator has to move what the game moved through every inserter and finish what it finished in every machine. For that the simulator writes its run in the format of the recorder, so that one set of functions reads both (`clock-generator/src/verification/compare-recordings.ts`); `npm run verify` makes the same comparison for any recording.

### The status of an inserter

The status the game shows for an inserter is decided by its sink before the inserter itself, and not by what the inserter carries. It is defined in `clock-generator/src/state/factorio-entity-state.ts` and was derived from recordings of five scaffolds in Factorio 2.1.21.

- An inserter that is switched off by its circuit condition shows as disabled from that tick on, even while it finishes the swing and the drop it had already started. A window of 4 ticks shows as 4 ticks that are not disabled.
- The status is a tick ahead of what the inserter does. It takes nothing in the first tick it shows as enabled, and it can still take in the first tick it shows as disabled, never after that. So an inserter acts in as many ticks as its window has, the first one included, and the simulator enables it for exactly those.
- With an empty hand, it is waiting for space in the destination whenever the sink takes nothing from anyone: the output of the machine is at its output block, or every ingredient is at its insertion limit, and its fuel is at its limit too. This is shown even while the arm is still swinging back.
- With an empty hand and a sink that still takes something, it is working while it swings back, and waiting for source items once there is nothing for it to take. This is also what it shows when the sink is full of the one item this inserter brings.
- With a hand it is still filling, it is waiting for more items between pickups.
- A full hand is working, until it cannot be dropped in one go. A hand goes onto a belt one stack at a time and shows as waiting for space in the destination in between.

### What an inserter takes off a belt first

An inserter that takes two items off one belt, one from each lane, takes from the lane nearest to it first whenever its sink takes both, and from the far lane only when the sink takes nothing more of the item on the near one. The order of its filters has no say in it. Recorded on the utility science scaffold in Factorio 2.1.21: the inserter that brings processing units and low density structures took the low density structures first while they were on its near lane, and the processing units first once the two lanes were swapped, with the same filters both times.

Which item comes first decides how an ingredient is split between two inserters that both bring it, and with it whether a clock holds. Under one clock for that build the simulator made 192 of 192 a period with the processing units taken first, where the game, taking the low density structures first, made 96.

The config names the nearest lane with `near_lane` on the belt an inserter picks up from, and the sidecar exports it for an inserter beside a straight piece of belt. Without it the simulator takes the items in the order of the inserter's filters, or of the sink's ingredients, which is a guess. A scaffold test fails when the config and the recorded build disagree on which item comes first, or on the stack size of an inserter.

### When a waiting inserter acts

An inserter that waits for space in a machine is asleep, and acts in the tick after the one that wakes it. Two things wake it: the machine finishes a craft, or another inserter takes the machine's products. So when the output inserter takes a machine down from its output block, an inserter that was waiting to put into it takes its first items one tick later. Only when the machine finished a craft in the tick before the products were taken was it awake already, and then it takes them in the tick they are taken. An inserter whose arm comes back in that tick, or whose window opens in it, is not held up. It is defined in `clock-generator/src/control-logic/inserter/transitions/idle-mode-transition-evaluator.ts`.

Recorded in Factorio 2.1.21 on the scaffolds, on inserters that take from a machine or a chest and had waited 6 ticks or more: the first items came a tick later in 5,777 cases of 5,777 where no craft was finished the tick before, and in the same tick in 3,756 of 3,756 where one was. A hand from a belt that stopped part way at the output block goes by the same rule (843 of 843 and 248 of 248). A hand from a belt that had not started lands its first stack a tick after the products are taken either way.

That one tick decides whether a clock holds when its windows are as long as the hands they are made for. Under a clock for the advanced circuit build with windows of 4 ticks for the inserters that take off a belt, the game made 608 and 624 of 704 a period in turn, where the simulator made 704. One of the two plants had fallen two hands of plastic and of cable behind the other. Its output stood over the output block for the ticks before every output window, the plastic and the cable inserter whose windows opened in those ticks took their hands a tick after the output inserter had cleared it, and a window that was a tick short for it lost a hand: 192 of 256 plastic, 384 of 512 cable and 264 of 352 products a period. With this rule and the output block above, a run of the simulator that starts in the state the game was recorded in holds what every machine and every inserter of the game held, tick for tick, for the 36,372 ticks the recording goes on, and so it does for the recording of the clock tightened by hand that holds 704.

That clock has two states, and the game was in both: one plant made its 352 a period and the other 264, under the same windows. Which one a machine ends up in is decided by what it holds when the clock starts. Started as the generator starts every clock, with the machines filled with ingredients and emptied of products, the simulator holds 704 from every place in the period, and so the generator still takes this clock for one that meets goal 1. Started with the plants short of ingredients it ends up in a state that is short from 12 of 108 starts tried, where the clock tightened by hand and the clock version 0.5.0 made get back to 704 from all 108. The clock selected for this build ends up short from some of those starts too in the simulator, which the game was not seen to do: it has only been recorded from the start a scaffold gives it, which is the build as it runs without a clock. Nothing checks for this yet: a clock is only checked from the start the generator gives it.

