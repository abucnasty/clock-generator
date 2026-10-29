import {FuelRecording, FuelRow, statusName} from "./recording";

/** J. Any difference under this is the log's rounding (to 0.001 J) */
export const TOLERANCE = 0.01;

const near = (a: number, b: number) => Math.abs(a - b) < TOLERANCE;

/**
 * The energy a burner holds is a buffer of 16/15 ticks of its energy usage. Each tick of work draws a tick of energy from
 * it (all of what is left, when less) and, if the machine can go on working, the fuel tops it up again to the full
 * buffer, taking the next item when the burning one has less than the top-up needs. A tick without work draws nothing and
 * burns nothing. `ledger` finds the ticks of a scenario that do not follow it:
 *  - what a tick drew (the buffer before, plus the fuel burned, less the buffer after) is nothing, a tick's energy, or all
 *    that the buffer held when that is less than a tick's energy;
 *  - after a tick that drew, a tick that burned fuel leaves the buffer full unless the fuel ran out;
 *  - fuel is burned without a draw only to fill an empty buffer.
 * Ticks in which fuel was put in the slot (by the probe or an inserter) cannot be told from the burning of it and are
 * not judged.
 */
export function ledger(rows: FuelRow[], usage: number, capacity: number, fuel_value: number): string[] {
    const faults: string[] = [];
    const energy = (row: FuelRow) => row.remaining + row.fuel_count * fuel_value;
    for (let k = 1; k < rows.length; k++) {
        const before = rows[k - 1], after = rows[k];
        const burned = energy(before) - energy(after);
        if (burned < -TOLERANCE) continue;
        const drew = before.heat + burned - after.heat;
        const kind = near(drew, 0) ? "none" : near(drew, usage) ? "full" : before.heat < usage && near(drew, before.heat) ? "partial" : "other";
        if (kind === "other") faults.push(`t=${after.t}: drew ${drew}`);
        else if (kind !== "none" && burned > TOLERANCE && energy(after) > TOLERANCE && !near(after.heat, capacity)) faults.push(`t=${after.t}: topped up to ${after.heat}`);
        else if (kind === "none" && burned > TOLERANCE && before.heat > TOLERANCE) faults.push(`t=${after.t}: burned ${burned} with no draw`);
    }
    return faults;
}

/** The ticks in which the burning item changed: the leftover of the old one, and what the new one has left */
export function swaps(rows: FuelRow[]): {t: number; leftover: number; remaining: number}[] {
    const found: {t: number; leftover: number; remaining: number}[] = [];
    for (let k = 1; k < rows.length; k++) {
        if (rows[k].fuel_count < rows[k - 1].fuel_count && rows[k].remaining > rows[k - 1].remaining) {
            found.push({t: rows[k].t, leftover: rows[k - 1].remaining, remaining: rows[k].remaining});
        }
    }
    return found;
}

/** The first tick a row satisfies `test` from the tick `from` on */
export function firstTick(rows: FuelRow[], test: (row: FuelRow, k: number) => boolean, from = 0): number {
    for (let k = from; k < rows.length; k++) if (test(rows[k], k)) return rows[k].t;
    return -1;
}

/** The runs of consecutive ticks whose status is `name`, as [first tick, last tick] */
export function statusSpans(recording: FuelRecording, rows: FuelRow[], name: string): [number, number][] {
    const spans: [number, number][] = [];
    for (const row of rows) {
        if (statusName(recording, row) !== name) continue;
        const last = spans[spans.length - 1];
        if (last !== undefined && last[1] === row.t - 1) last[1] = row.t;
        else spans.push([row.t, row.t]);
    }
    return spans;
}
