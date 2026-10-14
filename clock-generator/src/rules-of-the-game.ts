/**
 * The rules of the game, as GOALS.md states them and the simulator implements them: one named function each, with the
 * section of GOALS.md it comes from and the test that holds its recorded cases. The rules stay where their siblings
 * live; this file names them so that there is one place to find each and to see that it has a table. The figures of
 * the game are in those tests and in the comments next to the functions, so no test needs a recording.
 *
 * What the rules say is tested in the game and is not changed here: a change to one is a finding to record first.
 */

/**
 * 1. Output block (GOALS.md "Crafting Constraints"): the overload multiplier times the amount a craft makes, never
 * reached where that is more than a stack. Recorded cases: `control-logic/machine/machine-state-machine.test.ts`
 * ("at the output block": six recipes, and the plastic plant that takes coal at 100 of 100 bars).
 */
export { OutputBlock } from "./entities/machine/output/output-block";

/**
 * 2. Automated insertion limit (GOALS.md "Crafting Constraints"): the amount a craft takes times the overload
 * multiplier, rounded up; an input at or above it is not topped up. The machine state answers for one item
 * (`MachineState.machineInputIsBlocked`) and for all of them (`MachineState.takesNothing`). Cases:
 * `rules-of-the-game.test.ts`.
 */
export { AutomatedInsertionLimit } from "./entities/machine/input/automated-insertion-limit";

/**
 * 3. Mining drill limit (GOALS.md "Constraint Exceptions"): a drill fills a machine past the automated insertion limit,
 * to the limit + 64, and was observed to stop at 114 items at the least, the stack of stone + 64. The function takes
 * the stack where the limit is below it, and a craft's amount on top. Cases: `rules-of-the-game.test.ts` pins the
 * function on the stone brick sample, whose furnaces have a limit above the stack; the 114 has no table yet.
 */
export { miningDrillMaxInsertion } from "./entities/drill/mining-drill-ext";

/**
 * 4. Fuel limit (GOALS.md "Constraint Exceptions"): a fuel slot is topped up to the fuel that holds 180 energy
 * buffers, at least 5 items. Cases: `entities/machine/fuel/fuel-slot.test.ts` (eleven biochambers from +495% to
 * +1427% energy consumption). The fuel slot is not locked out by the output block: `MachineState.machineInputIsBlocked`.
 */
export { FuelSlot } from "./entities/machine/fuel/fuel-slot";

/**
 * 5. When a waiting inserter acts (GOALS.md "When a waiting inserter acts"): a tick after the products are taken, in
 * the same tick when the machine finished a craft the tick before. Cases: `rules-of-the-game.test.ts` and
 * `control-logic/inserter/transitions/transitions.test.ts` (5,777 and 3,756 inserters, 843 and 248 belt hands). An
 * inserter whose window opens in the tick the products are taken takes its first items a tick later too, unless the
 * inserter that took them opened its window in that tick as well (1,158 of 1,170 and 852 of 888 cases): the idle
 * transition of an inserter. A partial hand from a machine waits while the machine it puts into is at its block
 * (20,701 of 20,701 samples): the pickup of an inserter.
 */
export { actsInTheTickTheBlockIsLifted } from "./control-logic/inserter/waiting-inserter";

/**
 * 6. Nearest lane first (GOALS.md "What an inserter takes off a belt first"): the order an inserter takes two items off
 * one belt. Cases: `rules-of-the-game.test.ts`, and `crafting/belt-near-lane.test.ts` for the split it makes on the
 * utility science build (64 and 128 against 96 and 96).
 */
export { nearestLaneFirst } from "./entities/inserter/inserter";

/**
 * 7. The status of an inserter as the game shows it (GOALS.md "The status of an inserter"): decided by its sink
 * before the inserter itself. Cases: `state/factorio-entity-state.test.ts`; the tick ahead it is shown enabled,
 * `control-logic/inserter/inserter-state-machine.test.ts`.
 */
export { factorioInserterState } from "./state/factorio-entity-state";

/**
 * 8. The inserters of a loop of machines stay always enabled (GOALS.md "Wake-up Lists"), and so do those that take from
 * a loop machine to another machine. Cases: `crafting/sequence/unplanned-inserter-clock.test.ts` (agricultural science).
 */
export { loopInserters, alwaysEnabledInserters } from "./crafting/sequence/unplanned-inserter-clock";

/**
 * 9. Two inserters that bring the same item (GOALS.md "Two inserters that bring the same item"): a deadlock risk of the
 * build, read off the config. Cases: `crafting/deadlock-risk.test.ts` (utility science, 0 of 192 in 53 periods).
 */
export { sharedItemDeadlockRisks } from "./crafting/deadlock-risk";

/**
 * 10. Belt pickup slack (GOALS.md "Wake-up Lists"): the ticks one more full hand takes at one belt stack a tick (the
 * code caps them at 16). A rule of thumb for a moving belt. Cases: `rules-of-the-game.test.ts`.
 */
export { beltPickupSlackTicks } from "./crafting/clock";

/**
 * 11. Room for a hand of fuel (GOALS.md "Wake-up Lists"): the same ticks, for an inserter that takes fuel off a belt
 * as well as an ingredient, on a belt that does not move. Cases: `rules-of-the-game.test.ts` (agricultural science,
 * 377 of 400 a period without it).
 */
export { fuelHandRoomTicks } from "./crafting/clock";

/**
 * 12. Wake-ups (GOALS.md "Wake-ups, the measure for goal 2"): a machine that finishes a craft wakes the enabled
 * inserters asleep on its list, at most once a tick. Cases: `crafting/wake-ups.test.ts`; against the game,
 * `crafting/clock-from-windows.test.ts` (355 and 395.5 a minute by where the clock starts, 354.6 in the game) and
 * `crafting/belt-near-lane.test.ts` (10.7, 26.8 and 32.1).
 */
export { wakeUps, wakeUpsOfStock } from "./crafting/wake-ups";
