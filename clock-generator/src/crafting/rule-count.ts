/**
 * The count of the inserter cost series' rule (factorio-benchmarks, benchmarks/2026-10-12-inserter-cost-2.1.21,
 * closing/CLOSING-2.md and CLOSING-2-RESULT.md), and the clock-or-unwired call it gives a group of inserters.
 *
 * This is advice only. It is not goal 2's measure (`wakeUps` in wake-ups.ts), which the selection uses and which is
 * left as it is. The two differ: this count wakes an inserter waiting for space on a craft its sink STARTS, adds the
 * pickups of a machine's output that no counted wake-up explains, and is ported from the series' recount script
 * (fuller.py, the generator reading) so that the generator and the series count the same saves the same way.
 *
 * One input shape serves the three sources: a simulated run, a recording of the game, and the series' extractor dumps.
 * Index `t` of every series is the state after tick t (sample t+1 of a dump, which holds the state before update t+1);
 * only differences between neighbouring indices are used, so the offset does not matter.
 */

/** What the end of an inserter is */
export type EndKind = "machine" | "belt" | "chest" | "vehicle" | "none" | "other";

export interface RuleCountInserter {
    inserter_id: string;
    source_kind: EndKind;
    sink_kind: EndKind;
    /** The machine it takes from, when `source_kind` is "machine" */
    source_machine_id: string | null;
    /** The machine it puts into, when `sink_kind` is "machine" */
    sink_machine_id: string | null;
    /** The items it moves, sorted: its filters, or the items seen in its hand */
    items: readonly string[];
    /** Wired: a circuit wire and the enable/disable condition (dump), or windows from the clock (simulation) */
    wired: boolean;
    /** The state the game shows, per index, as `FactorioInserterState` values */
    states: readonly string[];
    /** Items in the hand, per index */
    held: readonly number[];
}

export interface RuleCountMachine {
    machine_id: string;
    recipe: string;
    /** `products_finished` as the game counts it (crafts and productivity payouts), per index */
    products_finished: readonly number[];
    /** The machine's status is "working", per index */
    working: readonly boolean[];
    /** Simulated runs only: crafts started so far (the simulator's true starts), per index */
    crafts_started?: readonly number[];
}
