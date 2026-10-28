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
 * the stack where the limit is below it. Cases: `rules-of-the-game.test.ts`, the game's stops of the drills mechanics
 * family (114 on rail, 214 on landfill) and the stone brick sample, whose furnaces have a limit above the stack.
 * The drill's mechanics as a whole: docs/drills.md.
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
 * as well as an ingredient, on a backed-up belt. Cases: `rules-of-the-game.test.ts` (agricultural science,
 * 377 of 400 a period without it).
 */
export { fuelHandRoomTicks } from "./crafting/clock";

/**
 * 12. Wake-ups (GOALS.md "Wake-ups, the measure for goal 2"): a machine wakes the enabled inserters asleep on its
 * lists at most once a tick: those that take from it when it finishes a craft or pays out a productivity bar, those
 * that put into it when it starts a craft (docs/mechanics D7; since 0.13.0, before which both were woken by finishes). Cases: `crafting/wake-ups.test.ts`; against the game,
 * `crafting/clock-from-windows.test.ts` (355 and 395.5 a minute by where the clock starts, 354.6 in the game) and
 * `crafting/belt-near-lane.test.ts` (10.7, 26.8 and 32.1).
 */
export { wakeUps, wakeUpsOfStock } from "./crafting/wake-ups";

/**
 * 13. Where an item goes in a container of mixed items (docs/simulator.md "Cars, wagons and rocket silos as chests"):
 * first into the slots filtered to it, in slot order, then topping up the free slots that hold it, then into empty free
 * slots in slot order; a slot filtered to another item never takes it (`SlotInventoryState.addQuantity`).
 * 14. What an inserter takes from one (the same section): the item of the last slot that holds one it may take, from
 * that slot backwards, a hand that holds some only more of its item (`SlotInventoryState.lastItemAmong`,
 * `ChestPickupLogic`). Cases of both: `state/slot-inventory.test.ts`, `crafting/container-chest.test.ts`; against the
 * game, `tests/game/mechanics/containers` (339 of 339 hands, 120 of 120 slots, at two places and in both build orders).
 *
 * Known limit, a stand-in: which of two inserters acting on one container in the same tick goes first. The game serves
 * the last built first; the simulator serves the lowest config id first, as for clock deciders (rule 5). Built the
 * other way, two of the five recorded builds split the container differently in the game.
 */
export { SlotInventoryState } from "./state/slot-inventory";

/**
 * 15. A rocket silo as a chest (the same section): its fixed recipe's ingredients, of that recipe's quality, go into its
 * input slots, a whole hand while under the automated insertion limit (rule 2); everything else goes into its rocket
 * inventory while the rocket lifts its weight (in the game's 1/65536 parts), and only that inventory gives. No craft is
 * run. Cases: `simulation/components/weight-storage.test.ts`; against the game, `tests/game/mechanics/containers`.
 */
export { RocketSiloInventoryState } from "./state/rocket-silo-inventory";

/**
 * 16. A mining drill into a chest (docs/simulator.md "Cars, wagons and rocket silos as chests"): it drops what it
 * holds as far as the chest has room, by the chest's own rules (13, 15: free slots for a car, weight for a silo's
 * rocket inventory); what does not fit stays in the drill, which mines no more until it has dropped it, so a full chest
 * stops it. A clock gives it windows made from the takes out of the chest (`crafting/chest-drill-windows.ts`). Cases: `crafting/drill-into-chest.test.ts`; against the game,
 * `tests/game/mechanics/containers` (a car, a car with filtered slots, a steel chest and a rocket silo, at two places).
 */
export { DrillChestWorkingMode } from "./control-logic/drill/modes/chest-working-mode";

/**
 * 17. A mining drill's progress (docs/drills.md): each tick an enabled drill first drops what it
 * holds (into a machine up to its limit, 3; into a chest by 16); while it still holds anything it waits, its bars
 * still; else it mines: its mining bar moves by its crafting rate a tick, its bonus bar by that times its mining
 * productivity (its own: the research, 10% a level, and its productivity modules together, as the game's
 * `productivity_bonus`), a wrap of either is an item, and what it mines is dropped in the next tick.
 * The sink is not checked before mining. A drill disabled by its circuit keeps what it holds and both bars. The bars
 * are doubles summed tick by tick, as in the game, in the game's units (0 to the resource's mining time). Near a whole
 * item the bonus bar has the game's tolerance (`bonusBarTick`): within 0.0001 below it makes the item, and after an
 * item a remainder under 0.001 is dropped; from 2 mining times it keeps the fraction of a mining time in its own units.
 * Cases: `control-logic/drill/modes/drill-working-modes.test.ts`, `mining-progress.test.ts`; against the game,
 * `tests/game/mechanics/drills` (0.0167 to 1.35 items a tick into a car and into a machine, built last, moved and
 * circuit-disabled, one with productivity modules; the bonus bar set near a whole item on iron ore, scrap and tungsten
 * ore) and the containers family's drill fills (200 a tick).
 */
export { MiningProgress } from "./control-logic/drill/modes/mining-progress";

/**
 * 18. A machine that places its results itself (the recycler, by its prototype's `vector_to_place_result`; docs/simulator.md
 * "A machine that places its results itself"): its results go into its output whatever it holds, any number of stacks, and
 * while a stack of any one of them waits there it starts no craft and takes no ingredients; with a result target (the
 * machine or container at its result spot) it puts what waits into that target each tick: into a machine by the
 * mining drill's stop (3, shared `placeIntoMachine`), into a container as far as it has room, what the
 * tick's crafts gave included. At its
 * output a bulk inserter waits for a full hand, and any other swings what it holds. A result that comes by chance is made
 * at its expected amount, the fraction carried to the next craft (`expectedAmount`: the chance times the amount and its
 * extra count fraction). Cases: `crafting/places-results.test.ts`. Recorded in the game (2.1.21, a lab on the ore voider
 * benchmark's saves): 4 crafts a tick at crafting speed 7.5, iron ore back at 0.2511 a craft over 47,992, gears at 0.4978,
 * returns a tick a binomial of its crafts, and 50 ore waiting in its output when its car was full, its 12 result slots
 * not filled; on scrap (a lab beside it), each result in a slot of its own, a full stack of the rarest result stopping it
 * as one of the commonest did, a stack inserter waiting with a part hand and a long-handed inserter swinging each low
 * density structure on its own; on the ore voider's exact-speed cell under its clock (an hour), nothing left in its output
 * after any tick while its car had room, and no ore brought into it while a stack waited with its car full.
 */
export { MachineWorkingMode } from "./control-logic/machine/modes/machine-working-mode";
