import type { Crafting } from "./crafting";
import type { Ingress } from "./ingress";

/**
 * A crafting machine's Wakes: what its last tick tells the inserters that wait on it. Written at the end of the
 * machine's tick (`endOfTick`), after its craft and its placing; inserters run before machines, so they read the machine
 * as its last tick left it (same-tick rule 1). The decider a taker marks in the inserter phase is cleared here (rule 3).
 */
export class MachineWakes {
    /**
     * Whether the main product was at the output block when the machine's last tick was done. Inserters are updated
     * before machines, so an inserter that finds this set and the block gone knows that another inserter took the
     * products down in the tick it is in.
     */
    public outputBlockedAfterLastTick: boolean = false;

    /** Whether the machine finished a craft in its last tick, which wakes the inserters that wait on it */
    public finishedCraftInLastTick: boolean = false;

    /**
     * Whether the machine started a craft in its last tick, taking its ingredients: what wakes the inserters waiting
     * to put into it (docs/wake-ups.md)
     */
    public startedCraftInLastTick: boolean = false;

    /**
     * Where the last built of the deciders stands (`decider_build_order`) whose inserters took the machine's products
     * in this tick in the first tick of their window of a clock of the game; -1 for such an inserter whose decider is
     * not known, null when none took them so. Set by those inserters, which are updated before the inserters that put
     * into the machine, and cleared after the machine's tick. An inserter whose window opens in this tick too takes
     * its first items in it only when that decider was built after its own (`Hand.wokenThisTick`).
     */
    public windowOpeningTakeDecider: number | null = null;

    /** The crafts finished when the machine's last tick was done (a running total, out of every key) */
    private crafts_seen: number = 0;
    /** The crafts started when the machine's last tick was done (a running total, out of every key) */
    private starts_seen: number = 0;

    /**
     * A taker took the machine's products in the first tick of its window of a clock of the game: the last built of
     * the deciders whose inserters took so stays (`order` -1 where the taker's decider is not known). In the inserter
     * phase, by the taker's pickup (MachineHandPickup); cleared at the machine's end of tick (same-tick rule 3).
     */
    public markWindowOpeningTake(order: number): void {
        this.windowOpeningTakeDecider = Math.max(this.windowOpeningTakeDecider ?? -1, order);
    }

    /**
     * Counts the crafts finished and started from those the crafting has now: when the machine's archetype is built,
     * once per state (one archetype per MachineState)
     */
    public watchFrom(crafting: Crafting): void {
        this.crafts_seen = crafting.craftCount;
        this.starts_seen = crafting.craftsStarted;
    }

    /**
     * What the inserters that wait on the machine go by in its next tick, for the machine's key (see
     * simulationStateKey): the three flags of its last tick. The decider is cleared at the end of every tick of the
     * machine, so a key, which is taken between ticks, always finds it null; the seen counts are running totals.
     */
    public key(): string {
        return `${this.outputBlockedAfterLastTick};${this.finishedCraftInLastTick};${this.startedCraftInLastTick}`;
    }

    /** After the machine's tick: what the inserters that wait on it go by in the next one, and the decider cleared */
    public endOfTick(crafting: Crafting, ingress: Ingress): void {
        this.finishedCraftInLastTick = crafting.craftCount !== this.crafts_seen;
        this.crafts_seen = crafting.craftCount;
        this.startedCraftInLastTick = crafting.craftsStarted !== this.starts_seen;
        this.starts_seen = crafting.craftsStarted;
        this.outputBlockedAfterLastTick = ingress.outputBlocked();
        this.windowOpeningTakeDecider = null;
    }
}

/**
 * When a waiting inserter acts (GOALS.md, "When a waiting inserter acts"): a predicate of the machine's Wakes, which the
 * Hand of an inserter that puts into the machine reads (its idle rule) and so does a belt's pickup port.
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
 * phase, has no such tick, and waits like the hand from a machine does (2 ticks from the enable to the first stack).
 * Where the window of the inserter that takes the products opens in that tick too, either kind goes in the tick of the
 * take only when that inserter's decider was built after its own, as the game updates the last built first
 * (`Hand.wokenThisTick`). A hand from a belt that waited for the machine's own craft start has no such tick either
 * (`wokenByItsMachinesCraftStart`).
 *
 * `sink` is the machine's Wakes as its last tick left them: they record after every tick of a machine whether it
 * was at its output block and whether it finished a craft, and the inserters read them in the next tick. Inserters
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
 * output block (`Hand.wokenThisTick`; tests/game/builds/lane-phase-controls.json).
 */
export function wokenByItsMachinesCraftStart(sink: { outputBlockedAfterLastTick: boolean; startedCraftInLastTick: boolean }): boolean {
    return sink.startedCraftInLastTick && !sink.outputBlockedAfterLastTick;
}
