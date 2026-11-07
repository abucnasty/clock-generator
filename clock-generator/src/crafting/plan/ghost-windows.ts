import { OpenRange } from "../../data-types";
import { FactorioInserterState } from "../../state/factorio-entity-state";
import type { StockRecording } from "../machine-stock";
import type { GhostWakeUp } from "../wake-ups";

/** An enable window that left its inserter asleep on a machine's list at its switch-off, and what it becomes */
export interface GhostWindow {
    inserter_id: string;
    /** The window as it was */
    window: OpenRange;
    /** The window closed earlier, or null where it is dropped */
    shaped: OpenRange | null;
    /** The ghost wakeups after it in the run */
    ghost_wake_ups: number;
}

/**
 * The windows of a clock with each enable window shaped so that its switch-off finds its inserter awake (decision 1
 * of 0.28.0, #641): a switch-off sends no alarm, so an inserter that the clock switches off while it is asleep on a
 * machine's list stays on it, and the machine's next alarm gives it a ghost wakeup (`GhostWakeUp`). The window that
 * closed last before each ghost wakeup of the run closes before the inserter went to sleep, or before it took the hand it
 * held then: its update in that tick then finds it disabled with its hand empty and its arm home, and it goes on no list.
 * Where that leaves the window nothing, it is dropped.
 *
 * Read off the run of the clock (`stock`, with the ghost wakeups of its judged part): an inserter whose last enabled
 * update is in tick c (it shows disabled from c on) and went to sleep in tick s (or took its hand in tick q) needs its
 * last enabled update in tick s - 1 (q - 1), so its window closes c - s + 1 (c - q + 1) ticks earlier. Not for the
 * inserters in `fixed` (the windows of a moving belt's slack, of a loop), for a hand taken before its window opened, or
 * where the run's switch-offs do not line up with the windows. Null where no window changes.
 */
export function windowsWithoutGhostWakeUps(
    windows: ReadonlyMap<string, readonly OpenRange[]>,
    period_ticks: number,
    stock: StockRecording,
    ghosts: readonly GhostWakeUp[],
    fixed: ReadonlySet<string>,
    /**
     * The tick of the run less the tick of the clock, where the run knows it (`AsBuiltStabilityCheck.clock_tick_at_first_judged`):
     * a window ending at e switches its inserter off in the ticks t with t - offset = e + 1 modulo the period. Else read
     * off the switch-offs, where only one offset lines them up with the windows.
     */
    clock_offset: number | undefined,
    /** Told why the windows of an inserter with ghost wakeups are left as they are */
    left?: (inserter_id: string, why: string) => void,
): { windows: Map<string, OpenRange[]>; shaped: GhostWindow[] } | null {
    if (!Number.isInteger(period_ticks) || ghosts.length === 0) {
        return null;
    }
    const OFF = FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR;
    const mod = (value: number) => ((value % period_ticks) + period_ticks) % period_ticks;
    const series = new Map(stock.inserters.map(it => [it.inserter_id, it]));
    const result = new Map(Array.from(windows, ([id, ranges]) => [id, ranges.slice()] as const));
    const shaped: GhostWindow[] = [];
    const by_inserter = new Map<string, GhostWakeUp[]>();
    for (const ghost of ghosts) {
        by_inserter.set(ghost.inserter_id, [...by_inserter.get(ghost.inserter_id) ?? [], ghost]);
    }
    for (const [id, own] of by_inserter) {
        const ranges = windows.get(id);
        const recorded = series.get(id);
        if (fixed.has(id) || ranges === undefined || ranges.length === 0 || recorded === undefined) {
            left?.(id, fixed.has(id) ? "its windows are fixed" : "no windows");
            continue;
        }
        const { factorio_state: states, held } = recorded;
        // the run's clock against the windows: the offset k that puts the tick of every switch-off of the inserter one
        // after the end of a window (a window ends at e when the inserter shows disabled from the tick at position e + 1)
        const ends = new Set(ranges.map(range => mod(range.end_inclusive)));
        const switch_offs: number[] = [];
        for (let tick = Math.max(1, own[0].switched_off - 2 * period_ticks); tick < states.length; tick++) {
            if (states[tick] === OFF && states[tick - 1] !== OFF) switch_offs.push(tick);
        }
        const offsets = (clock_offset !== undefined ? [mod(clock_offset)] : ranges.map(range => mod(own[0].switched_off - 1 - range.end_inclusive)))
            .filter(k => switch_offs.every(tick => ends.has(mod(tick - 1 - k))));
        if (new Set(offsets).size !== 1) {
            left?.(id, "its switch-offs do not line up with its windows");
            continue;
        }
        const offset = offsets[0];
        const shifts = new Map<number, { ticks: number; ghosts: number }>();
        let usable = true;
        for (const ghost of own) {
            const index = ranges.findIndex(range => mod(range.end_inclusive) === mod(ghost.switched_off - 1 - offset));
            if (index < 0) { left?.(id, `no window ends before the switch-off at ${ghost.switched_off}`); usable = false; break; }
            const range = ranges[index];
            const c = ghost.switched_off;
            // the tick it took the hand it held at the switch-off, or the tick it went to sleep with an empty hand
            let q = ghost.asleep_from;
            if (held[c] > 0) {
                q = c;
                while (q > 0 && !(held[q - 1] === 0 && held[q] > 0)) q--;
            }
            const opened = c - (range.end_inclusive - range.start_inclusive + 1);
            if (q <= opened || q > c) { left?.(id, `the hand or the sleep (tick ${q}) is from before the window ${range.start_inclusive}-${range.end_inclusive}`); usable = false; break; }
            const before = shifts.get(index);
            shifts.set(index, { ticks: Math.max(before?.ticks ?? 0, c - q + 1), ghosts: (before?.ghosts ?? 0) + 1 });
        }
        if (!usable || shifts.size === 0) continue;
        const kept: OpenRange[] = [];
        ranges.forEach((range, index) => {
            const shift = shifts.get(index);
            if (shift === undefined) {
                kept.push(range);
                return;
            }
            const end = range.end_inclusive - shift.ticks;
            const window = end >= range.start_inclusive ? OpenRange.from(range.start_inclusive, end) : null;
            if (window !== null) kept.push(window);
            shaped.push({ inserter_id: id, window: range, shaped: window, ghost_wake_ups: shift.ghosts });
        });
        result.set(id, kept);
    }
    return shaped.length === 0 ? null : { windows: result, shaped };
}
