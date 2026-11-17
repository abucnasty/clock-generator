import type { Config } from "../config";
import type { OpenRange } from "../data-types";
import type { SerializableClockWindows } from "./clock";
import { inserterEnds } from "./inserter-counters";
import type { StockRecording } from "./machine-stock";
import { noteRunOfOneCopy, timedCheck } from "./maker-log";
import type { FractionalSwings } from "./plan/unclocked-run";
import type { SimulationContext } from "./sequence/simulation-context";
import { type InserterTimetableRecord, recordTimetable, timetableOf, type TimetableLine, windowRangesOf } from "./timetable";
import { type Ledger, ledgerOfStock } from "./wake-ledger";

/**
 * What the maker log reads of the run of one copy whose wakeups the record holds (the long run of the clock-only check,
 * `runAsBuiltCheck`), only where a log asks for it: the timetable of the run and the ledger of its wakeups, over the ticks the
 * wakeups are counted on. Nothing here changes the run, and nothing of it reaches a result.
 */

/** What the log kept of a run of one copy */
export interface OneCopyForLog {
    window_cycle_ticks: number;
    /** The timetable over the ticks the wakeups are counted on; null where it could not be read (`errors`) */
    timetable: TimetableLine | null;
    /** The ticks of the run before the first tick of its stock: the warm-up. The timetable's ticks are the run's, the ledger's the stock's */
    ticks_before_stock: number | null;
    ledger: Ledger | null;
    errors: string[];
}

/** How a listed clock is run on one copy, as its long run was made: what the repeat check runs again */
export interface ClockRunForLog {
    /** The config the clock was planned on, with its output swings */
    config: Config;
    windows: SerializableClockWindows;
    window_cycle_ticks: number;
    expected_output_items: number;
    long_run_ticks: number;
    swings: FractionalSwings;
}

/** A part of the log, made where it can be: an error of it goes to `errors` */
function made<T>(make: () => T, errors: string[]): T | null {
    try {
        return make();
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return null;
    }
}

/**
 * The record of a run of one copy for the log: `on_context` puts the recorder of the timetable into the run (the last run it
 * is given, where a check runs it again), and `keep` reads it with the run's stock once the wakeups are counted, and keeps it
 * by the wakeups (`noteRunOfOneCopy`)
 */
export function runOfOneCopyForLog(config: Config, windows: ReadonlyMap<string, readonly OpenRange[]>, window_cycle_ticks: number): {
    on_context: (context: SimulationContext) => void;
    keep: (wake_ups: object, stock: StockRecording, from_tick: number) => void;
} {
    let records: (() => InserterTimetableRecord[]) | null = null;
    const whole = Number.isInteger(window_cycle_ticks);
    return {
        on_context: context => {
            if (whole) records = recordTimetable(context);
        },
        keep: (wake_ups, stock, from_tick) => timedCheck("timetable", () => {
            const errors: string[] = [];
            const ledger = made(() => ledgerOfStock(stock, inserterEnds(config), from_tick), errors);
            let timetable: TimetableLine | null = null;
            let ticks_before_stock: number | null = null;
            if (!whole) {
                errors.push(`no timetable of a window cycle of ${window_cycle_ticks} ticks: it reads whole ticks`);
            } else if (records === null) {
                errors.push("no record of the timetable was made");
            } else {
                const read = made(records, errors);
                if (read !== null && read.length > 0) {
                    // the stock is of the ticks after the warm-up, up to the run's end: its last tick is the record's
                    const shift = read[0].last_tick - (stock.ticks - 1);
                    const lined_up = stock.inserters.every(series => {
                        const record = read.find(it => it.copy === 0 && it.inserter_id === series.inserter_id);
                        if (record === undefined) return false;
                        for (let tick = Math.max(0, from_tick); tick < stock.ticks; tick++) if (record.heldAt(tick + shift) !== series.held[tick]) return false;
                        return true;
                    });
                    if (!lined_up) {
                        errors.push("the record of the timetable does not line up with the run's stock");
                    } else {
                        ticks_before_stock = shift;
                        timetable = made(() => timetableOf({ records: read, windows: windowRangesOf(windows), window_cycle_ticks, from: from_tick + shift, to: stock.ticks + shift,
                            needed_from: Math.min(...read.map(it => it.first_tick)) }), errors);
                    }
                }
            }
            noteRunOfOneCopy(wake_ups, { window_cycle_ticks, timetable, ticks_before_stock, ledger, errors });
        }),
    };
}
