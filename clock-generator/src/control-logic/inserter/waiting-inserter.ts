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
 * either way, which the pickup mode has (`belt_grab_decided`).
 *
 * `sink` is the machine as its last tick left it: `MachineStatusPlugin` records after every tick of a machine whether
 * it was at its output block and whether it finished a craft, and the inserters read them in the next tick. Inserters
 * are updated before machines, and those that take from a machine before those that put into it, so a machine that
 * was at its block when its last tick was done, and is not now, has had its products taken in this tick.
 */
export function actsInTheTickTheBlockIsLifted(sink: { outputBlockedAfterLastTick: boolean; finishedCraftInLastTick: boolean }): boolean {
    return sink.outputBlockedAfterLastTick && sink.finishedCraftInLastTick;
}
