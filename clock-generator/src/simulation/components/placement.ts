import { ItemName } from "../../data";
import { DropBy, DropPort, PickupPort } from "./ports";

/**
 * The Placement of a placer, a drill or a machine that places its results itself: it takes what waits at its source
 * (the drill's held items, the machine's output) and puts it into its target through the target's drop port, with the
 * placer's own rule (`DropBy.PLACER`: into a machine up to the drill's stop, into a container as far as it has room).
 * A drill places before it mines (R17); a machine before it crafts and again after, so its crafts of a tick reach the
 * target in that tick (R18).
 */
export class Placement {
    /**
     * Results placed so far where inserters take them: into its target, or into its own output where it counts that
     * (`counts_own_output`). A tick in which it grew woke the inserters waiting there for items (rule 18). A running
     * total, out of every state key.
     */
    public results_placed: number = 0;

    /** Where it places; null for a placer without a target, which places nothing. Bound at build (`placeInto`) */
    private target: DropPort | null = null;

    /**
     * Whether results put into its own output count as placed: a machine that places its results itself with no
     * container as its target (with a machine target they count there and again as they are placed)
     */
    private counts_own_output: boolean;

    constructor(
        /** Where what it places waits */
        private readonly source: PickupPort,
        /** What it places, in this order each time */
        private readonly results: readonly ItemName[],
        /** A machine that places its results itself (rule 18), whose own output is where inserters take them */
        private readonly places_results_itself: boolean,
    ) {
        this.counts_own_output = places_results_itself;
    }

    /**
     * Binds the target it places into, a container's storage or a machine's port; null for none. `own_output_counts`:
     * whether, with this target, results put into its own output still count as placed (the caller knows its target:
     * with none or a machine, yes; with a container, no)
     */
    public placeInto(target: DropPort | null, own_output_counts: boolean): void {
        this.target = target;
        this.counts_own_output = this.places_results_itself && own_output_counts;
    }

    /**
     * A snapshot's copy of `other`: its count and how it counts, with no target bound. The target is another entity's
     * live state, which a snapshot never changes, so a snapshot places nothing.
     */
    public copyCountFrom(other: Placement): void {
        this.results_placed = other.results_placed;
        this.counts_own_output = other.counts_own_output;
    }

    /** Each result waiting at the source into the target, as far as the target accepts it from a placer */
    public place(): void {
        const target = this.target;
        if (target === null) {
            return;
        }
        const source = this.source;
        const results = this.results;
        for (let index = 0; index < results.length; index++) {
            const item = results[index];
            const waiting = source.getCurrentQuantity(item);
            if (waiting <= 0) {
                continue;
            }
            const amount = target.accepts(item, waiting, DropBy.PLACER);
            if (amount > 0) {
                source.take(item, amount);
                target.insert(item, amount);
                this.results_placed += amount;
            }
        }
    }

    /** Results a machine put into its own output, counted where it places its results itself with no container target */
    public countPlacedInOwnOutput(amount: number): void {
        if (this.counts_own_output) {
            this.results_placed += amount;
        }
    }
}
