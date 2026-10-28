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
     * its first items in it only when that decider was built after its own (`wokenThisTick`).
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
