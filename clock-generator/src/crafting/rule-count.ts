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

import { FactorioInserterState } from "../state/factorio-entity-state";

/**
 * What the end of an inserter is. Any other end is named by its entity type, as the series names it ("car", "rocket-silo"),
 * and is a group of its own: "car to machine" is not "other to machine".
 */
export type EndKind = "machine" | "belt" | "chest" | "vehicle" | "none" | (string & {});

export interface RuleCountInserter {
    inserter_id: string;
    source_kind: EndKind;
    sink_kind: EndKind;
    /** The machine it takes from, when `source_kind` is "machine" */
    source_machine_id: string | null;
    /** The machine it puts into, when `sink_kind` is "machine" */
    sink_machine_id: string | null;
    /** The recipe of the source machine, for the group's key; read from the machine given when absent */
    source_recipe?: string;
    /** The recipe of the sink machine, for the group's key; read from the machine given when absent */
    sink_recipe?: string;
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

/** An inserter's per-index counts of the rule over the counted indices */
export interface InserterRuleCount {
    inserter_id: string;
    wired: boolean;
    /** Woken while waiting for source items by a craft its source machine finished */
    source_wake_ups: number;
    /** Woken while waiting for space by a craft its sink machine started (its own drop left out) */
    sink_wake_ups: number;
    /** Pickups of a machine's output that no counted wake-up, and no disabled index, explains */
    pickups: number;
    /** The three together: the inserter's `w` over the counted indices */
    wake_ups: number;
    source_wake_ups_per_minute: number;
    sink_wake_ups_per_minute: number;
    pickups_per_minute: number;
    wake_ups_per_minute: number;
    /**
     * Simulated runs only (the sink machine has `crafts_started`): the sink wake-ups counted with the machine's true
     * starts in place of the starts the rule infers from `products_finished` and `working`. Null otherwise. The call
     * always uses `sink_wake_ups`, the inferred figure.
     */
    sink_wake_ups_true_starts: number | null;
    sink_wake_ups_true_starts_per_minute: number | null;
}

/** The series' key of a group of inserters: what each moves, between what, in which machines */
export interface RuleCountGroupKey {
    /** "machine to belt" and so on */
    role: string;
    /** The items sorted and joined by "+", or "-" when there are none */
    items: string;
    /** "source recipe > sink recipe", with "" for an end that is not a machine */
    recipes: string;
}

/** The group's key as one string, for maps */
export function ruleCountGroupKeyText(key: RuleCountGroupKey): string {
    return `${key.role} | ${key.items} | ${key.recipes}`;
}

/** Inserters of one key, with their counts summed (wired and unwired ones together, as the series' removed() does) */
export interface RuleCountGroup extends RuleCountGroupKey {
    key: string;
    inserters: number;
    wired: number;
    source_wake_ups: number;
    sink_wake_ups: number;
    pickups: number;
    /** The group's `w`: source, sink and pickup wake-ups of all its inserters over the counted indices */
    wake_ups: number;
    wake_ups_per_minute: number;
    /** Sink wake-ups of the group's inserters that have a true-start count, by the inferred starts (to lay against the next) */
    sink_wake_ups_where_true_starts_known: number;
    /** Inserters of the group that have a true-start count */
    inserters_with_true_starts: number;
    /** Sink wake-ups of those same inserters by the true starts; null when no inserter of the group has them */
    sink_wake_ups_true_starts: number | null;
}

/** A machine whose starts the rule could not read from its finishes and its working status */
export interface StartRuleFallback {
    machine_id: string;
    recipe: string;
    /** Starts the rule read (a finish, or the status turning to working) over the counted indices */
    starts: number;
    /** Finishes (any rise of `products_finished`) over the counted indices, which were used as its starts instead */
    finishes: number;
}

/** What `ruleCount` finds for one run */
export interface RuleCountRun {
    /** Indices counted: from `max(1, from_index)` up to `to_index` (exclusive), which is the series' `n - 1` for a whole dump */
    ticks: number;
    /** `ticks / 3600` */
    minutes: number;
    inserters: InserterRuleCount[];
    groups: RuleCountGroup[];
    /** Machines that counted by finishes: their starts differed from their finishes by more than 3% */
    start_rule_fallback: StartRuleFallback[];
}

/** The starts of a machine differ from its finishes by more than this share of the finishes: it counts by finishes */
const START_RULE_TOLERANCE = 0.03;
/** A pickup is explained by a counted wake-up, or a disabled index, at its index or this many indices before it */
const PICKUP_WINDOW = 3;
const TICKS_PER_MINUTE = 3600;

/** What the rule reads of a machine, per index */
interface MachineEvents {
    recipe: string;
    finished: Uint8Array;
    started: Uint8Array;
    started_true: Uint8Array | null;
}

function isWaitingForSource(state: string): boolean {
    return state === FactorioInserterState.WAITING_FOR_SOURCE_ITEMS || state === FactorioInserterState.WAITING_FOR_MORE_ITEMS;
}

/**
 * The count of the inserter cost series' rule over the indices `from_index` (inclusive) to `to_index` (exclusive), as
 * the series' recount script (fuller.py, "the generator's reading": e_src_g, e_dst_g, e_pick_g) counts a dump. Belt
 * fed waiting is never counted here, and belts, chests and vehicles wake no one.
 *
 * An inserter is woken at index t when it was waiting at t-1 and:
 * - it waited for source items (or for more) and its source machine finished a craft at t: a source wake-up;
 * - it waited for space in its destination and its sink machine started a craft at t, unless the inserter's own hand
 *   dropped at t (the drop is what made the room): a sink wake-up.
 * A pickup (the hand rose at t) from a machine is counted when none of the wake-ups above, and no index at which the
 * inserter is disabled, falls at t, t-1, t-2 or t-3: it is a pickup the wake-ups miss, such as one picked up straight
 * from swinging back. A disabled index is read at the same index as the others (not the one before). The window looks
 * at indices before `from_index` too, since the series has them; at index 0 only the disabled state is known, because
 * a wake-up needs the index before.
 *
 * A machine "finished" at t when `products_finished` rose: a craft or a productivity payout, any rise, as fuller.py's
 * PF does. It "started" at t when it finished, or when its status turned to working: `finished + working[t] -
 * working[t-1] > 0`. Where that disagrees with its finishes by more than 3% of the finishes over the counted indices
 * (a furnace that melts ore, say), the machine's finishes are used as its starts and the machine is reported in
 * `start_rule_fallback`.
 *
 * Minutes are `ticks / 3600` for the `ticks` counted: a dump of n samples counted whole (from 0 to n) is n-1 ticks,
 * the series' `(n - 1) / 3600`. The counted range ends early at the shortest series given.
 */
export function ruleCount(
    inserters: readonly RuleCountInserter[],
    machines: readonly RuleCountMachine[],
    from_index: number,
    to_index: number,
): RuleCountRun {
    const first = Math.max(1, from_index);
    let end = to_index;
    for (const inserter of inserters) {
        end = Math.min(end, inserter.states.length, inserter.held.length);
    }
    for (const machine of machines) {
        end = Math.min(end, machine.products_finished.length, machine.working.length);
        if (machine.crafts_started !== undefined) {
            end = Math.min(end, machine.crafts_started.length);
        }
    }
    const ticks = Math.max(0, end - first);
    const minutes = ticks / TICKS_PER_MINUTE;
    const per_minute = (count: number) => minutes === 0 ? 0 : count / minutes;

    const fallback: StartRuleFallback[] = [];
    const events = new Map<string, MachineEvents>();
    for (const machine of machines) {
        const finished = new Uint8Array(end);
        const started = new Uint8Array(end);
        const { products_finished, working } = machine;
        for (let t = 1; t < end; t++) {
            finished[t] = products_finished[t] > products_finished[t - 1] ? 1 : 0;
            started[t] = finished[t] + (working[t] ? 1 : 0) - (working[t - 1] ? 1 : 0) > 0 ? 1 : 0;
        }
        let finishes = 0;
        let starts = 0;
        for (let t = first; t < end; t++) {
            finishes += finished[t];
            starts += started[t];
        }
        const uses_finishes = finishes > 0 && Math.abs(starts - finishes) / finishes > START_RULE_TOLERANCE;
        if (uses_finishes) {
            fallback.push({ machine_id: machine.machine_id, recipe: machine.recipe, starts, finishes });
        }
        let started_true: Uint8Array | null = null;
        if (machine.crafts_started !== undefined) {
            started_true = new Uint8Array(end);
            for (let t = 1; t < end; t++) {
                started_true[t] = machine.crafts_started[t] > machine.crafts_started[t - 1] ? 1 : 0;
            }
        }
        events.set(machine.machine_id, { recipe: machine.recipe, finished, started: uses_finishes ? finished : started, started_true });
    }

    const counts: InserterRuleCount[] = [];
    const groups = new Map<string, RuleCountGroup>();
    // the index an inserter is woken at, or disabled at, for the window of a pickup
    const marked = new Uint8Array(end);
    for (const inserter of inserters) {
        const source = inserter.source_machine_id === null ? undefined : events.get(inserter.source_machine_id);
        const sink = inserter.sink_machine_id === null ? undefined : events.get(inserter.sink_machine_id);
        const { states, held } = inserter;
        let source_wake_ups = 0;
        let sink_wake_ups = 0;
        let pickups = 0;
        let sink_true = sink?.started_true ? 0 : null;
        for (let t = 0; t < end; t++) {
            let woken_by_source = false;
            let woken_by_sink = false;
            let woken_by_true_start = false;
            if (t >= 1) {
                woken_by_source = source !== undefined && source.finished[t] === 1 && isWaitingForSource(states[t - 1]);
                const waited_for_space = states[t - 1] === FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION;
                const own_drop = held[t] < held[t - 1];
                woken_by_sink = sink !== undefined && waited_for_space && sink.started[t] === 1 && !own_drop;
                woken_by_true_start = sink?.started_true != null && waited_for_space && sink.started_true[t] === 1 && !own_drop;
            }
            marked[t] = woken_by_source || woken_by_sink || states[t] === FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR ? 1 : 0;
            if (t < first) {
                continue;
            }
            source_wake_ups += woken_by_source ? 1 : 0;
            sink_wake_ups += woken_by_sink ? 1 : 0;
            if (sink_true !== null && woken_by_true_start) {
                sink_true++;
            }
            if (source !== undefined && held[t] > held[t - 1]) {
                let explained = false;
                for (let back = 0; back <= PICKUP_WINDOW && t - back >= 0; back++) {
                    explained ||= marked[t - back] === 1;
                }
                pickups += explained ? 0 : 1;
            }
        }
        const wake_ups = source_wake_ups + sink_wake_ups + pickups;
        counts.push({
            inserter_id: inserter.inserter_id,
            wired: inserter.wired,
            source_wake_ups, sink_wake_ups, pickups, wake_ups,
            source_wake_ups_per_minute: per_minute(source_wake_ups),
            sink_wake_ups_per_minute: per_minute(sink_wake_ups),
            pickups_per_minute: per_minute(pickups),
            wake_ups_per_minute: per_minute(wake_ups),
            sink_wake_ups_true_starts: sink_true,
            sink_wake_ups_true_starts_per_minute: sink_true === null ? null : per_minute(sink_true),
        });

        const items = [...inserter.items].sort().join("+") || "-";
        const key: RuleCountGroupKey = {
            role: `${inserter.source_kind} to ${inserter.sink_kind}`,
            items,
            recipes: `${inserter.source_kind === "machine" ? inserter.source_recipe ?? source?.recipe ?? "" : ""} > `
                + `${inserter.sink_kind === "machine" ? inserter.sink_recipe ?? sink?.recipe ?? "" : ""}`,
        };
        const text = ruleCountGroupKeyText(key);
        let group = groups.get(text);
        if (group === undefined) {
            group = {
                ...key, key: text, inserters: 0, wired: 0, source_wake_ups: 0, sink_wake_ups: 0, pickups: 0, wake_ups: 0,
                wake_ups_per_minute: 0, sink_wake_ups_where_true_starts_known: 0, inserters_with_true_starts: 0,
                sink_wake_ups_true_starts: null,
            };
            groups.set(text, group);
        }
        group.inserters++;
        group.wired += inserter.wired ? 1 : 0;
        group.source_wake_ups += source_wake_ups;
        group.sink_wake_ups += sink_wake_ups;
        group.pickups += pickups;
        group.wake_ups += wake_ups;
        if (sink_true !== null) {
            group.inserters_with_true_starts++;
            group.sink_wake_ups_where_true_starts_known += sink_wake_ups;
            group.sink_wake_ups_true_starts = (group.sink_wake_ups_true_starts ?? 0) + sink_true;
        }
    }
    for (const group of groups.values()) {
        group.wake_ups_per_minute = per_minute(group.wake_ups);
    }
    return { ticks, minutes, inserters: counts, groups: [...groups.values()], start_rule_fallback: fallback };
}

/** How the sink wake-ups counted with the inferred starts compare with those counted with the true starts, for a group */
export interface TrueStartAgreement {
    key: string;
    /** Inserters of the group whose sink machine has true starts */
    inserters: number;
    /** Their sink wake-ups by the starts the rule infers */
    inferred: number;
    /** Their sink wake-ups by the simulator's true starts */
    true_starts: number;
    /** `inferred - true_starts` */
    difference: number;
}

/** Per group of a simulated run, the sink wake-ups by inferred starts against those by true starts; only groups that have the latter */
export function trueStartAgreementOf(run: RuleCountRun): TrueStartAgreement[] {
    return run.groups.flatMap(group => group.sink_wake_ups_true_starts === null ? [] : [{
        key: group.key,
        inserters: group.inserters_with_true_starts,
        inferred: group.sink_wake_ups_where_true_starts_known,
        true_starts: group.sink_wake_ups_true_starts,
        difference: group.sink_wake_ups_where_true_starts_known - group.sink_wake_ups_true_starts,
    }]);
}
