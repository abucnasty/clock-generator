import { FactorioInserterState } from "../state/factorio-entity-state";
import { StockRecording } from "./machine-stock";

/**
 * The wake-up lists of the game, and what they cost a build (GOALS.md, goal 2).
 *
 * An inserter with nothing to move goes to sleep on the wake-up list of the machine it waits on, and a machine wakes
 * the inserters on its list each time it finishes a craft. A woken inserter looks for something to move, finds
 * nothing or a little, and goes back to sleep: with the debug option `show-wakeup-lists` the yellow line from the
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
    /** The state the game shows for it after each tick (`defines.entity_status`) */
    states: readonly string[];
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
}

export interface InserterWakeUps {
    inserter_id: string;
    /** Times a machine it slept on woke it, a minute */
    wake_ups_per_minute: number;
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
    inserters: InserterWakeUps[];
    /** Machines without `true_starts`, whose finishes and payouts alarmed their sink lists instead */
    true_starts_unknown: string[];
}

const TICKS_PER_MINUTE = 3600;

/**
 * Wake-ups of every inserter over the ticks `from_tick` (inclusive) to `to_tick` (exclusive) of a run.
 *
 * A machine wakes the inserters that were asleep on its list when the tick began, so the state of an inserter after
 * the tick before decides whether it is woken, and once in that tick at most. What wakes which list (factorio-benchmarks
 * docs/mechanics, machines.md D7): the inserters that take from a machine are woken when it finishes a craft or pays
 * out a productivity bar (D7 b, part hands); the inserters that put into a machine are woken when it starts a craft,
 * consuming its ingredients, and not by a payout (D7 a1, confirmed on two designs of one machine type, the advanced
 * circuit electromagnetic plant; other machine types untested). Before 0.13.0 both lists were woken by finishes and
 * payouts. A belt and a chest finish no crafts and wake no one here.
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
        const list = finished.get(machine_id);
        return list === undefined ? undefined : tick => list[tick] > list[tick - 1] ? 1 : 0;
    };
    const per_minute = (count: number) => ticks === 0 ? 0 : count * TICKS_PER_MINUTE / ticks;
    const share = (count: number) => ticks === 0 ? 0 : count / ticks;

    const counted = inserters.map(inserter => {
        const lists: Record<WatchedEnd, ((tick: number) => number) | undefined> = {
            source: alarmed("source", inserter.source_machine_id),
            sink: alarmed("sink", inserter.sink_machine_id),
        };
        const alarmedIn = (end: WatchedEnd, tick: number) => lists[end]?.(tick) ?? 0;
        let woken = 0;
        let alarms = 0;
        let enabled = 0;
        let waiting = 0;
        for (let tick = first; tick < to_tick; tick++) {
            alarms += alarmedIn("source", tick) + alarmedIn("sink", tick);
            const asleep_on = WATCHED_END[inserter.states[tick - 1]];
            if (asleep_on !== undefined) {
                woken += alarmedIn(asleep_on, tick);
            }
            const state = inserter.states[tick];
            if (state !== FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR) {
                enabled++;
                if (WATCHED_END[state] !== undefined) {
                    waiting++;
                }
            }
        }
        return { inserter_id: inserter.inserter_id, woken, alarms, enabled, waiting };
    });

    return {
        ticks,
        wake_ups_per_minute: per_minute(counted.reduce((sum, it) => sum + it.woken, 0)),
        inserters: counted.map(it => ({
            inserter_id: it.inserter_id,
            wake_ups_per_minute: per_minute(it.woken),
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
}

/** Wake-ups of a simulated run, from the tick `from_tick` to its end */
export function wakeUpsOfStock(stock: StockRecording, ends: readonly InserterEnds[], from_tick: number): WakeUps {
    const states = new Map(stock.inserters.map(series => [series.inserter_id, series.factorio_state]));
    const inserters = ends.flatMap(end => {
        const series = states.get(end.inserter_id);
        return series === undefined ? [] : [{ ...end, states: series }];
    });
    const machines: WatchedMachine[] = stock.machines.map(machine => ({
        machine_id: machine.machine_id,
        products_finished: machine.products_finished,
        true_starts: machine.crafts_started.map((started, tick) => tick > 0 && started > machine.crafts_started[tick - 1]),
    }));
    return wakeUps(inserters, machines, from_tick, stock.ticks);
}
