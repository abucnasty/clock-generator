import type { CheckedLanes } from "./checked-lanes";

/**
 * The part of a result's checked lanes (checked-lanes.ts) that reads every clock of the result: the other clock that "what
 * changes it" names. Its own module, with no import but types, so that a page that puts the clocks of a generation together
 * on its main thread can take it from the light entry.
 */

/** A number as the texts write it: "120", "26.67", "1,234" */
export function figure(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Each clock's "what changes it" with another clock of the same result that holds with all the copies: a clock run with
 * the copies, stable, with no row short or at a full join; the selected clock where it is one, else the first listed.
 * "Another clock of this build holds with all 9: <its name>, window cycle 216 ticks." For a full join: "Another clock of
 * this build has no full join: ...".
 */
export function withOtherClocks<T extends { id: string; label: string; verdict: string; checked_lanes?: CheckedLanes; result: { simulation_duration: { ticks: number } } }>(
    alternatives: readonly T[], selected_index: number, copies: number): T[] {
    const holding = (it: T) => it.verdict === "stable" && it.checked_lanes !== undefined && it.checked_lanes.line.run_with_copies
        && it.checked_lanes.rows.every(row => row.state.kind !== "short" && row.state.kind !== "join_full");
    const order = [alternatives[selected_index], ...alternatives.filter((_, index) => index !== selected_index)].filter(it => it !== undefined);
    return alternatives.map(alternative => {
        const cause = alternative.checked_lanes?.cause;
        if (cause === null || cause === undefined) return alternative;
        const other = order.find(it => it !== alternative && holding(it));
        if (other === undefined) return alternative;
        const name = other.label.split(":")[0];
        const window_cycle_ticks = other.result.simulation_duration.ticks;
        const text = cause.kind === "join" ? `Another clock of this build has no full join: ${name}, window cycle ${figure(window_cycle_ticks)} ticks.`
            : `Another clock of this build holds with all ${figure(copies)}: ${name}, window cycle ${figure(window_cycle_ticks)} ticks.`;
        const changes = { text: cause.changes === null ? text : `${cause.changes.text} ${text}`,
            data: { fewer_copies: cause.changes?.data.fewer_copies ?? null, other_clock: { id: other.id, label: other.label, window_cycle_ticks } } };
        return { ...alternative, checked_lanes: { ...alternative.checked_lanes!, cause: { ...cause, changes } } };
    });
}
