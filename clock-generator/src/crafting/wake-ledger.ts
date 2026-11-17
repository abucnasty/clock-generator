import { FactorioInserterState } from "../state/factorio-entity-state";
import type { StockRecording } from "./machine-stock";
import { armAwayOf, type InserterEnds, type WakeCause, wakeUpsOfStock } from "./wake-ups";

/**
 * The ledger of a clock's wakeups for the maker log (scripts/blast/MAKER-LOG.md): the wakeups of a run of one copy, counted as
 * the record counts them (`wakeUpsOfStock`), by inserter, by the list that woke it and by what alarmed that list, the ghost
 * wakeups apart, and the ticks each inserter waited with an empty hand at its source while it was enabled. It reads the stock of
 * the run and changes nothing.
 */

const TICKS_PER_MINUTE = 3600;

/** Wakeups by what alarmed the list: the machine, or another inserter (`WakeCause`) */
export type WakeupsByCause = Record<WakeCause, number>;

/** One inserter of the ledger */
export interface LedgerRow {
    inserter_id: string;
    /** Wakeups from the list of the machine it puts into */
    input: WakeupsByCause;
    /** Wakeups from the list of the machine it takes from, or of the machine that places into the chest it takes from */
    output: WakeupsByCause;
    /** Of those, the ghost wakeups: the clock had switched it off while it was asleep on the list, by list */
    ghost: { input: number; output: number };
    /** Ticks it was enabled with an empty hand at its source, its arm not away: at its pickup, or at rest */
    empty_hand_enabled_ticks: { pickup: number; rest: number };
}

/** The ledger of a run over the ticks from `from_tick` up to, not including, `to_tick` */
export interface Ledger {
    from_tick: number;
    to_tick: number;
    /** The ticks counted, as `WakeUps.ticks` */
    ticks: number;
    /** Every wakeup counted: the sum of every row's lists */
    wake_ups: number;
    /** `wake_ups` a minute, worked out as `wakeUps` works out its own */
    wake_ups_per_minute: number;
    rows: LedgerRow[];
}

/** The ledger of a simulated run, from the tick `from_tick` to its end, over the same ticks and inserters as `wakeUpsOfStock` */
export function ledgerOfStock(stock: StockRecording, ends: readonly InserterEnds[], from_tick: number): Ledger {
    const OFF = FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR;
    const series = new Map(stock.inserters.map(it => [it.inserter_id, it]));
    const rows = new Map<string, LedgerRow>();
    const rowOf = (inserter_id: string): LedgerRow => {
        let row = rows.get(inserter_id);
        if (row === undefined) {
            row = { inserter_id, input: { machine: 0, inserter: 0 }, output: { machine: 0, inserter: 0 }, ghost: { input: 0, output: 0 }, empty_hand_enabled_ticks: { pickup: 0, rest: 0 } };
            rows.set(inserter_id, row);
        }
        return row;
    };
    let total = 0;
    const counted = wakeUpsOfStock(stock, ends, from_tick, (inserter_id, tick, end, by) => {
        const row = rowOf(inserter_id);
        const list = end === "sink" ? "input" : "output";
        row[list][by]++;
        total++;
        // a wakeup of an inserter shown disabled after the tick before is a ghost (`ghostWakeUps`)
        if (series.get(inserter_id)?.factorio_state[tick - 1] === OFF) row.ghost[list]++;
    });
    const first = Math.max(1, from_tick);
    for (const end of ends) {
        const of = series.get(end.inserter_id);
        if (of === undefined) continue;
        const row = rowOf(end.inserter_id);
        const armAway = armAwayOf(of.held, end.return_ticks);
        for (let tick = first; tick < stock.ticks; tick++) {
            const away = armAway(tick);
            if (of.held[tick] !== 0 || of.factorio_state[tick] === OFF || away) continue;
            if (of.at_pickup?.[tick] === true) row.empty_hand_enabled_ticks.pickup++;
            else row.empty_hand_enabled_ticks.rest++;
        }
    }
    const ticks = counted.ticks;
    return {
        from_tick: first, to_tick: stock.ticks, ticks, wake_ups: total,
        wake_ups_per_minute: ticks === 0 ? 0 : total * TICKS_PER_MINUTE / ticks,
        rows: ends.flatMap(end => rows.has(end.inserter_id) ? [rows.get(end.inserter_id)!] : []),
    };
}

/** The wakeups a count a minute stands for over its ticks, rounded to the whole count it was made from */
export function wakeUpsCountOf(wake_ups_per_minute: number, ticks: number): number {
    return Math.round(wake_ups_per_minute * ticks / TICKS_PER_MINUTE);
}
