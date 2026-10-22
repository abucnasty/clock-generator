# The rules of the game

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals. Of the fifteen rules `src/rules-of-the-game.ts` indexes, rules 1 to 4 are below; rules 5 to 11 and 13 to 15 are the simulator rules in [simulator.md](simulator.md) and rule 12 is in [wake-ups.md](wake-ups.md).

## The rules of the game, indexed

Each rule of the game below is one named function, and `clock-generator/src/rules-of-the-game.ts` names all fifteen: where each lives, the GOALS.md section it comes from, and the test that holds its recorded cases. The recorded figures travel with the code, as numbers in those tests and in the comments next to the functions; none of those tests reads a recording.

## Crafting Constraints

The game has two primary constraints that make clocking difficult. Both of these are governed by the overload multiplier of the machine.

1. automated insertion limit
2. machine output block

The overload multiplier comes from adding beacons to an assembly machine, increasing the crafting speed of the machine. It is defined in the relative reference for this project here `clock-generator/src/entities/machine/traits/overload-multiplier.ts`

Insertion limits is a well defined term within factorio and can be observed by hovering over an input slot and reading the automated insertion limit value. In a given machine, if the input slot has inventory at or above the automated insertion limit, the inserter will not top up the items in it. If it is below it, then this constraint is removed. A hand that is taken goes in whole, so the stock can end over the limit (factorio-benchmarks docs/mechanics, machines.md section 5). The plan counts the hands an input can bring in a row by this (since 2026-10-14; before, it held the stock after the drop to the limit): the iron of an accumulator plant of the accumulator sample, limit 32, takes a third hand at 25 and not a fourth, so its 8/3 hands a cycle can be planned as 3, 3 and 2. Fractional swings, which could not be planned on that sample and six others before, is now offered on them (and the production science sample, planned with fractional swings, gets its 4 and 5 output swing clocks, unstable); on the chemical science sample it is stable at 10.1 wake-ups a minute and selected with belts moving, where batched swings had 20.4.

Mechanic: machines.md section 2 (the insertion limit and the output block), standing Rule, checked

There is a secondary constraint: the amount of items currently sitting in the output slot. If the amount of the recipe's main product in the output slot is greater than or equal to the output block, the machine will lock out all ingredient inputs. The output block is the overload multiplier times the amount of the main product one craft makes. The rule is the same for every machine (assembling machines, chemical plants, foundries, cryogenic plants; the owner, 2026-10-16): where the block is more than a stack of the product, the block is never reached, and the machine stops crafting when its stack is full and goes on taking ingredients up to their insertion limits. At a multiplier of 50 a plastic plant's block is 100, a full stack, and it takes no coal; at 51 the block is 102 and it takes coal to its limit (`output-block.test.ts`). Recorded in Factorio 2.1.21 on the cryogenic plant that makes plastic in three scaffolds: with an overload multiplier of 73 and 2 plastic bars a craft its block is 146 against a stack of 100, and with 100 plastic bars and the status full output it took coal at 69 and left its inserter waiting for space in the destination at 73, the insertion limit of coal. It is defined in `clock-generator/src/entities/machine/output/output-block.ts`. A furnace, a recipe without item ingredients and a by-product block only at the stack size. Any inserter wanting to insert an ingredient into the machine must wait until the output of the machine drops again below the output block. The fuel slot is not locked out: a machine at its output block still takes fuel while it is below its fuel limit. The machine also keeps crafting from the ingredients it already holds, so its output can grow well past the output block.

Mechanic: machines.md section 2 (the insertion limit and the output block), standing Rule, checked

A final constraint is the stack size of the output product. If the stack size is met, then the machine will stop crafting. This can most notably cause issues with recipes that stack to only 50 items. Low density structures, lithium, carbon, all stack only to 50. The machines that craft these recipes are extremely fast with maximum productivity research in the game, so naturally many designs will try to sink 1 machine into four assembly machines. This in practice is a disaster for clocking since it wants to control all four output inserters at stack size 16 to have the same active inserter window. Since it stacks to only 50, one inserter will always be short. Ideally if the stack size was 64, these problems would be removed however this is a decision as of 2.1.21 of factorio and has not changed since the original 2.0 release for Factorio Space Age. The work around has been to only have two inserters or to reduce the stack size to 12. 

## Stack Inserter Constraints

Stack inserters behave functionally different than a bulk inserter in factorio. Many articles online reference clocking in the 1.x days of the game. These clocking methods are outdated since bulk inserters do not retain the items in their hand until they reach their stack size. Bulk inserters are much more flexible and allow transferring a dynamic amount of items to fit within the crafting constraints of the machine. Given that stack inserters are much less forgiving, creating a simulation like this is imperative to reduce the manual testing efforts required to figure out by trial and error a stable clock.

The reason that stack inserters are chosen by most end game designs where clocking is applicable is that it has the advantage of transferring 4 extra items (stack size 16) over a bulk inserter (stack size 12). This reduces the amount of inventory transfers from one machine to another, saving update time in the game (goal 2).

### An inserter's swing, by its prototype and quality

Since 0.14.0 an inserter's prototype and quality come from the config, and its swing from the game data: its rotation speed ω is the prototype's `rotation_speed` times 1 + 0.3 × the quality's level (normal 0, uncommon 1, rare 2, epic 3, legendary 5). It turns for ceil(0.5 / ω) − 2 ticks each way, and takes 1 tick to pick up from a machine or chest and 1 tick to drop into one, so a swing from machine to machine is 2 · ceil(0.5 / ω) − 2 ticks: 8 for a legendary stack inserter, 24 for a normal fast inserter, 70 for a normal inserter. Its hand at full research is 1, plus the prototype's stack size bonus, plus the research's bonus for its kind: 16 for a stack inserter, 12 for a bulk inserter, 4 for the others. A `stack_size` in the config overrides the hand. Picking up from a belt and dropping onto one keep the timing measured on the legendary stack inserter, which is not checked for any other prototype or quality (follow-up F7): a belt pickup by another one is refused.

Mechanic: the swing and the hand by prototype and quality, standing Measured once (25 type and quality pairs, chest to chest, harness, 2.1.21), not yet in docs/mechanics.

## Constraint Exceptions

Mining drills are an exception to the insertion limit rule as defined in the function: `clock-generator/src/entities/drill/mining-drill-ext.ts`

The actual limit of how much the drill can insert into a machine per tick is the automated insertion limit + 64, however, in practice it is observed that the mining drill will stop at a minimum of 114 items the assumption is due to the stack size of stone being 50 + 64 = 114.

Fuel consumption also deviates from the automated insertion rule as it has its own logic for determining when to insert into a fuel slot of a target entity. A machine that burns fuel fast is topped up to more than 5 items: to the fuel that holds this many times its energy buffer, rounded up to whole items. That is the fuel for 192 ticks at its full energy consumption. In the words of a Factorio developer, a burner does not obey the inserter limit if the fuel does not give it energy for at least 3 seconds of work, with the example of a buffer of 0.4 MJ times 180 ticks. Biochambers were tested in steps of +495% to +1427% energy consumption, whose slots were filled up to 5 to 13 nutrients in Factorio 2.1, all fit it.

Sources:
- https://forums.factorio.com/123927 ([2.0.24] High burner inserter to burner inserter fuel insertion limit)
- https://forums.factorio.com/124272 ([2.0.23] Tooltip for automated insertion limit of burnable fuel is often wrong)
- https://forums.factorio.com/viewtopic.php?p=705411#p705411 this is my own post on factorio where even I was confused until I tested the above and found the reason behind it in other forum posts.

