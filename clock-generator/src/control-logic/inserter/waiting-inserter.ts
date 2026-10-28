/**
 * When a waiting inserter acts (GOALS.md, "When a waiting inserter acts").
 *
 * An inserter that waits for space in a machine is asleep, and acts in the tick after the one that wakes it. Two things
 * wake it: the machine finishes a craft, or another inserter takes the machine's products. So when the output inserter
 * takes a machine down from its output block, an inserter that was waiting to put into it takes its first items a tick
 * later. Only when the machine finished a craft in the tick before was it awake already, and then it takes them in the
 * tick the products are taken.
 *
 * Recorded in Factorio 2.1.21 on the scaffolds, on inserters that take from a machine or a chest and had waited 6 ticks
 * or more: the first items came a tick later in 5,777 cases of 5,777 where no craft was finished the tick before, and
 * in the same tick in 3,756 of 3,756 where one was. A hand from a belt that stopped part way at the output block goes
 * by the same rule: 248 hands of 248 went on in that tick, and 843 of 843 a tick later where no craft was finished the
 * tick before. A hand from a belt that had not started lands its first stack a tick after the products are taken
 * either way, which the belt's pickup port has (`HandScratch.belt_grab_decided`, set by `BeltHandPickup.enter`). A
 * hand from a belt whose window opens on a machine at its output block is the exception: it comes from the disabled
 * mode, has no such tick, and waits like the hand from a machine does (2 ticks from the enable to the first stack).
 * Where the window of the inserter that takes the products opens in that tick too, either kind goes in the tick of the
 * take only when that inserter's decider was built after its own, as the game updates the last built first
 * (`wokenThisTick`). A hand from a belt that waited for the machine's own craft start has no such tick either
 * (`wokenByItsMachinesCraftStart`).
 *
 * `sink` is the machine as its last tick left it: its Wakes record after every tick of a machine whether
 * it was at its output block and whether it finished a craft, and the inserters read them in the next tick. Inserters
 * are updated before machines, and those that take from a machine before those that put into it, so a machine that
 * was at its block when its last tick was done, and is not now, has had its products taken in this tick.
 */
export function actsInTheTickTheBlockIsLifted(sink: { outputBlockedAfterLastTick: boolean; finishedCraftInLastTick: boolean }): boolean {
    return sink.outputBlockedAfterLastTick && sink.finishedCraftInLastTick;
}

/**
 * Whether the room an inserter waited for in its machine came from the machine's own craft start, not from products
 * being taken. Starting a craft takes the ingredients, which lifts the insertion limit and wakes the inserters
 * waiting to put into the machine (docs/wake-ups.md). Machines are updated after inserters, so an inserter finds that
 * room in the tick after the start, which is the tick the game has it act in: a hand from a belt takes its first stack
 * in that tick, without the tick a hand woken by products being taken waits (`belt_grab_decided`).
 *
 * Recorded in Factorio 2.1.21 on the normal moving underground pickups from cold starts at chosen lane phases: in all
 * 102 resumes from such a wait in the game runs behind PR #266 the game took its first stack in the tick after the
 * craft start, a tick before a simulator that kept the extra tick. With it the simulator follows the game from each
 * of the 64 lane-phase starts of both builds, tick for tick with the rule for a window that opens on a machine at its
 * output block (`wokenThisTick`; tests/game/builds/lane-phase-controls.json).
 */
export function wokenByItsMachinesCraftStart(sink: { outputBlockedAfterLastTick: boolean; startedCraftInLastTick: boolean }): boolean {
    return sink.startedCraftInLastTick && !sink.outputBlockedAfterLastTick;
}
