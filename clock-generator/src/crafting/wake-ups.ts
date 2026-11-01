import { FactorioInserterState } from "../state/factorio-entity-state";
import { StockRecording } from "./machine-stock";

/**
 * The wake-up lists of the game, and what they cost a build (GOALS.md, goal 2).
 *
 * An inserter with nothing to move goes to sleep on the wake-up list of the machine it waits on. A machine wakes the
 * inserters that put into it when it starts a craft, and the inserters that take from it when it finishes a craft or
 * pays out a productivity bar (`wakeUps` below). A woken inserter looks for something to move, finds nothing or a
 * little, and goes back to sleep: with the debug option `show-wakeup-lists` the yellow line from the
 * inserter to the machine flickers. An inserter its clock has disabled is on no list and is never woken. A wake-up
 * is one such waking, and what a clock is there to spare a build.
 *
 * The game does not let a mod read its wake-up lists, so they are worked out here from what it does show: the state
 * of each inserter, which names what it waits for, and the products each machine has finished. The same working out
 * serves a simulated run and a recording of the game.
 */

/** The end of an inserter whose machine wakes it */
type WatchedEnd = "source" | "sink";

/**
 * The list an inserter sleeps on, by the state the game shows for it while it waits: on the machine it takes from
 * while it waits for items, on the machine it puts into while it waits for space. Any other state is on no list.
 *
 * Open: whether a waiting inserter is also on the list of the machine at its other end. The game shows how many
 * lists an inserter is on ("Wakeup list count" in the debug tooltip, 0 for a disabled one); the count of a waiting
 * one has not been read yet. One list is assumed until it is.
 */
const WATCHED_END: Readonly<Record<string, WatchedEnd | undefined>> = {
    [FactorioInserterState.WAITING_FOR_SOURCE_ITEMS]: "source",
    [FactorioInserterState.WAITING_FOR_MORE_ITEMS]: "source",
    [FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION]: "sink",
};

/** An inserter of a run, with the machines at its ends */
export interface WatchingInserter {
    inserter_id: string;
    /** The machine it takes from; null when it takes from a belt or a chest */
    source_machine_id: string | null;
    /** The machine it puts into; null when it puts onto a belt or into a chest */
    sink_machine_id: string | null;
    /**
     * The machine that places its results itself into the chest it takes from (that chest is the machine's result
     * target): its placings wake it while it waits there for items. Null or absent for any other source.
     */
    source_placer_id?: string | null;
    /** The state the game shows for it after each tick (`defines.entity_status`) */
    states: readonly string[];
    /**
     * Items in its hand after each tick, and the ticks its arm is away swinging back after a drop that empties the hand
     * (`returnTicksOf`): with both, it is not on a list in those ticks, whatever state the game shows (see `armAway`).
     * Without them every waiting state counts, as before 0.26.0.
     */
    held?: readonly number[];
    return_ticks?: number;
}

export interface WatchedMachine {
    machine_id: string;
    /** Crafts finished and productivity bars paid out so far, after each tick: what alarms the inserters that take from it */
    products_finished: readonly number[];
    /**
     * The machine truly started a craft in the tick (consumed its ingredients), per tick: what alarms the inserters that
     * put into it (docs/mechanics D7 a1: a payout wakes no input). From the simulator's own count, or worked out from a
     * recording. Absent when it cannot be known: the rises of `products_finished` then stand in, as they did before
     * 0.13.0, and the machine is named in `true_starts_unknown`.
     */
    true_starts?: readonly boolean[];
    /**
     * Results placed so far where inserters take them, after each tick, for a machine that places its results itself
     * (rule 18): into its result target, else into its own output. What alarms the inserters that take them, in place of
     * `products_finished`: a craft that gives no result wakes none of them (recorded on a recycler on scrap). Absent for
     * any other machine.
     */
    results_placed?: readonly number[];
}

/**
 * Why a machine's alarm, in a tick the game shows the inserter waiting on its list, is not counted as a wake-up: the
 * arm is still swinging back from a drop that emptied its hand ("arm away"), so it is not asleep on the list
 */
export type UncountedWake = "arm away";

export interface InserterWakeUps {
    inserter_id: string;
    /** Times a machine it slept on woke it, a minute */
    wake_ups_per_minute: number;
    /** Alarms in ticks it showed a waiting state that are not counted as wake-ups, a minute, by why (see UncountedWake) */
    uncounted_per_minute: Record<UncountedWake, number>;
    /** Times the machines at its ends woke their lists, a minute: the most it could be woken */
    alarms_per_minute: number;
    /** Share of the ticks the game shows it as enabled */
    enabled_share: number;
    /** Share of the ticks it was enabled and asleep on a list */
    waiting_share: number;
}

export interface WakeUps {
    /** Ticks the count covers */
    ticks: number;
    /** Sum over the inserters, a minute */
    wake_ups_per_minute: number;
    /** Sum over the inserters of the alarms not counted, a minute, by why */
    uncounted_per_minute: Record<UncountedWake, number>;
    inserters: InserterWakeUps[];
    /** Machines without `true_starts`, whose finishes and payouts alarmed their sink lists instead */
    true_starts_unknown: string[];
}

const TICKS_PER_MINUTE = 3600;

/**
 * The ticks, from the one in which a drop empties its hand, after which an inserter's arm is still away: the drop tick
 * and the turn back, `rotation_ticks` (the simulator's ticks a turn, inserter-spec.ts) and one, which is
 * ceil(0.5 / rotation speed) - 1 of the game data: 4 for the legendary stack inserter, which drops in tick d, turns
 * back in d + 1 to d + 3 and picks up again from d + 4. The game shows "waiting for space" on such an arm when the
 * machine it dropped into is full, and it is on no list (cell 02's takers in the game read W W W W F F F W).
 */
export function returnTicksOf(rotation_ticks: number): number {
    return rotation_ticks + 1;
}

/**
 * Whether the arm is away after `tick`: within `return_ticks` of the latest tick at or before it in which the hand fell
 * to empty. A hand that falls but stays above empty (a part hand dropped) waits where it is, and is not away.
 */
function armAwayOf(held: readonly number[] | undefined, return_ticks: number | undefined): (tick: number) => boolean {
    if (held === undefined || held.length === 0 || return_ticks === undefined || return_ticks <= 0) {
        return () => false;
    }
    let emptied = -Infinity;
    let scanned = 0;
    // called with ticks in rising order
    return tick => {
        for (; scanned <= tick && scanned < held.length; scanned++) {
            if (scanned > 0 && held[scanned] === 0 && held[scanned - 1] > 0) {
                emptied = scanned;
            }
        }
        return tick - emptied < return_ticks;
    };
}

/**
 * Wake-ups of every inserter over the ticks `from_tick` (inclusive) to `to_tick` (exclusive) of a run.
 *
 * A machine wakes the inserters that were asleep on its list when the tick began, so the state of an inserter after
 * the tick before decides whether it is woken, and once in that tick at most. What wakes which list (factorio-benchmarks
 * docs/mechanics, machines.md D7): the inserters that take from a machine are woken when it finishes a craft or pays
 * out a productivity bar (D7 b, part hands); the inserters that put into a machine are woken when it starts a craft,
 * consuming its ingredients, and not by a payout (D7 a1, confirmed on two designs of one machine type, the advanced
 * circuit electromagnetic plant; other machine types untested). Before 0.13.0 both lists were woken by finishes and
 * payouts. A machine that places its results itself wakes the inserters that take them when it places one, into its own
 * output or into its result target (a chest), and not when a craft gives none (rule 18; recorded on a recycler on scrap,
 * 2.1.21: a stack inserter waiting with a part hand showed working in each of 1,708 ticks a result of another item came,
 * and in none of 1,198 in which a craft gave nothing). Any other belt and chest finishes no crafts and wakes no one here.
 * An inserter whose arm is away, swinging back from a drop that emptied its hand, is on no list whatever state it shows
 * (since 0.26.0, where the hand and the turn are given): those alarms are kept apart (`uncounted_per_minute`).
 */
export function wakeUps(
    inserters: readonly WatchingInserter[],
    machines: readonly WatchedMachine[],
    from_tick: number,
    to_tick: number,
): WakeUps {
    const first = Math.max(1, from_tick);
    const ticks = Math.max(0, to_tick - first);
    const finished = new Map(machines.map(machine => [machine.machine_id, machine.products_finished]));
    const started = new Map(machines.flatMap(machine => machine.true_starts === undefined ? [] : [[machine.machine_id, machine.true_starts] as const]));
    const placed = new Map(machines.flatMap(machine => machine.results_placed === undefined ? [] : [[machine.machine_id, machine.results_placed] as const]));
    const rose = (list: readonly number[]) => (tick: number) => list[tick] > list[tick - 1] ? 1 : 0;
    const true_starts_unknown = machines.filter(machine => machine.true_starts === undefined).map(machine => machine.machine_id);
    // a tick at which the machine alarmed the list: the sink list on a true start, the source list on a finish or payout
    const alarmed = (end: WatchedEnd, machine_id: string | null): ((tick: number) => number) | undefined => {
        if (machine_id === null) {
            return undefined;
        }
        const starts = end === "sink" ? started.get(machine_id) : undefined;
        if (starts !== undefined) {
            return tick => starts[tick] ? 1 : 0;
        }
        const placings = end === "source" ? placed.get(machine_id) : undefined;
        if (placings !== undefined) {
            return rose(placings);
        }
        const list = finished.get(machine_id);
        return list === undefined ? undefined : rose(list);
    };
    // the chest a machine places its results into: its takers are alarmed by the placings alone
    const placedInto = (placer_id: string | null | undefined): ((tick: number) => number) | undefined => {
        const placings = placer_id === null || placer_id === undefined ? undefined : placed.get(placer_id);
        return placings === undefined ? undefined : rose(placings);
    };
    const per_minute = (count: number) => ticks === 0 ? 0 : count * TICKS_PER_MINUTE / ticks;
    const share = (count: number) => ticks === 0 ? 0 : count / ticks;

    const counted = inserters.map(inserter => {
        const lists: Record<WatchedEnd, ((tick: number) => number) | undefined> = {
            source: inserter.source_machine_id !== null ? alarmed("source", inserter.source_machine_id) : placedInto(inserter.source_placer_id),
            sink: alarmed("sink", inserter.sink_machine_id),
        };
        const alarmedIn = (end: WatchedEnd, tick: number) => lists[end]?.(tick) ?? 0;
        const armAway = armAwayOf(inserter.held, inserter.return_ticks);
        let woken = 0;
        let away = 0;
        let alarms = 0;
        let enabled = 0;
        let waiting = 0;
        for (let tick = first; tick < to_tick; tick++) {
            alarms += alarmedIn("source", tick) + alarmedIn("sink", tick);
            const asleep_on = WATCHED_END[inserter.states[tick - 1]];
            if (asleep_on !== undefined) {
                // shown waiting after the tick before; on the list only with its arm at home then
                const alarm = alarmedIn(asleep_on, tick);
                if (alarm > 0 && armAway(tick - 1)) {
                    away += alarm;
                } else {
                    woken += alarm;
                }
            }
            const state = inserter.states[tick];
            if (state !== FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR) {
                enabled++;
                if (WATCHED_END[state] !== undefined) {
                    waiting++;
                }
            }
        }
        return { inserter_id: inserter.inserter_id, woken, away, alarms, enabled, waiting };
    });

    return {
        ticks,
        wake_ups_per_minute: per_minute(counted.reduce((sum, it) => sum + it.woken, 0)),
        uncounted_per_minute: { "arm away": per_minute(counted.reduce((sum, it) => sum + it.away, 0)) },
        inserters: counted.map(it => ({
            inserter_id: it.inserter_id,
            wake_ups_per_minute: per_minute(it.woken),
            uncounted_per_minute: { "arm away": per_minute(it.away) },
            alarms_per_minute: per_minute(it.alarms),
            enabled_share: share(it.enabled),
            waiting_share: share(it.waiting),
        })),
        true_starts_unknown,
    };
}

/** The machine ids at the ends of an inserter, as the stock of a run names its machines */
export interface InserterEnds {
    inserter_id: string;
    source_machine_id: string | null;
    sink_machine_id: string | null;
    /** The machine whose result target the inserter takes from (see WatchingInserter) */
    source_placer_id?: string | null;
    /** The ticks its arm is away after a drop that empties its hand (see WatchingInserter, returnTicksOf) */
    return_ticks?: number;
}

/** Wake-ups of a simulated run, from the tick `from_tick` to its end */
export function wakeUpsOfStock(stock: StockRecording, ends: readonly InserterEnds[], from_tick: number): WakeUps {
    const recorded = new Map(stock.inserters.map(series => [series.inserter_id, series]));
    const inserters = ends.flatMap(end => {
        const series = recorded.get(end.inserter_id);
        return series === undefined ? [] : [{ ...end, states: series.factorio_state, held: series.held }];
    });
    const machines: WatchedMachine[] = stock.machines.map(machine => ({
        machine_id: machine.machine_id,
        products_finished: machine.products_finished,
        true_starts: machine.crafts_started.map((started, tick) => tick > 0 && started > machine.crafts_started[tick - 1]),
        ...(machine.results_placed !== undefined && { results_placed: machine.results_placed }),
    }));
    return wakeUps(inserters, machines, from_tick, stock.ticks);
}
