import { Config } from "../../config";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { Logger } from "../../common/logger";
import { deriveWithOutputWindows } from "../candidates/observed-windows";
import { CheckedShiftRow, checkedShiftRows } from "../candidates/shifted-swings";
import { TrialRun, alwaysEnabledByConfig, windowsFromHistory } from "../plan/plan-run";
import { AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck } from "../trial";
import { search } from "./search";
import { withOutputWindowMoved } from "./transforms";

/** Positions tried for moved output swings; each costs dozens of clock-only simulations */
const MAX_UNEVEN_OUTPUT_CANDIDATES = 24;


interface UnevenOutputCandidate {
    /** Index of the moved window among each output inserter's windows, in clock order */
    window_index: number;
    shift_ticks: number;
    output_windows: Map<string, OpenRange[]>;
}

/**
 * The planned output windows with one window moved earlier or later in steps of a craft, the first window staying
 * put as the reference. A moved window keeps at least its own length clear of its neighbours. Every output inserter
 * moves the same window by the same amount. Empty when there is a single window per period or the period is fractional.
 */
function unevenOutputCandidates(
    output_windows: Map<string, OpenRange[]>,
    period: number,
    step_ticks: number,
): UnevenOutputCandidate[] {
    const sorted = new Map(Array.from(output_windows, ([key, ranges]) =>
        [key, [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive)] as const));
    const count = Math.min(...Array.from(sorted.values(), ranges => ranges.length));
    if (!Number.isInteger(period) || sorted.size === 0 || count < 2
        || Array.from(sorted.values()).some(ranges => ranges.length !== count)) {
        return [];
    }

    // shifts every output inserter has room for, per moved window
    const room: { window_index: number; min: number; max: number }[] = [];
    for (let window_index = 1; window_index < count; window_index++) {
        let min = -Infinity;
        let max = Infinity;
        for (const ranges of sorted.values()) {
            const window = ranges[window_index];
            const length = window.end_inclusive - window.start_inclusive + 1;
            const next_start = window_index + 1 < count ? ranges[window_index + 1].start_inclusive : ranges[0].start_inclusive + period;
            min = Math.max(min, ranges[window_index - 1].end_inclusive + length + 1 - window.start_inclusive);
            max = Math.min(max, next_start - length - 1 - window.end_inclusive, period - 1 - window.end_inclusive);
        }
        room.push({ window_index, min, max });
    }
    const span = room.reduce((sum, it) => sum + Math.max(0, it.max - it.min), 0);
    const step = Math.max(step_ticks, span / MAX_UNEVEN_OUTPUT_CANDIDATES, 1);

    const candidates: UnevenOutputCandidate[] = [];
    for (const { window_index, min, max } of room) {
        const shifts = new Set<number>();
        for (let n = 1; n * step <= Math.max(max, -min); n++) {
            shifts.add(Math.round(n * step));
            shifts.add(-Math.round(n * step));
        }
        for (const shift_ticks of Array.from(shifts).filter(it => it >= min && it <= max).sort((a, b) => a - b)) {
            candidates.push({ window_index, shift_ticks, output_windows: withOutputWindowMoved(sorted, window_index, shift_ticks) });
        }
    }
    return candidates;
}

/**
 * Like deriveClockWindows, but with one output swing moved off its planned start: a machine only has to make up for
 * its output over the whole period, so it can craft more between one pair of swings than the next. Every candidate
 * position gets its own observed windows; of those that pass the clock-only check, the one with the most passing
 * positions on either side is confirmed and used, since its neighbours show how far the timing can slip.
 * Null when there is nothing to move or no position passes.
 */
export function deriveUnevenOutputClockWindows(
    config: Config,
    planned_history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    step_ticks: number,
    logger: Logger,
    report?: (detail: string) => void,
): {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: TrialRun | null;
    as_built: AsBuiltStabilityCheck | null;
    moved_output_swing: { swing: number; shift_ticks: number; shifts_checked: CheckedShiftRow[] };
} | null {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_windows = windowsFromHistory(planned_history, createEntityRegistryFromConfig(config), alwaysEnabledByConfig(config));
    const output_windows = new Map(Array.from(planned_windows).filter(([key]) => output_inserter_ids.has(key)));
    const drill_windows = new Map(Array.from(planned_windows).filter(([key]) => key.startsWith("drill:")));

    const candidates = unevenOutputCandidates(output_windows, period, step_ticks);
    const describe = (candidate: UnevenOutputCandidate) => `swing ${candidate.window_index + 1} moved ${candidate.shift_ticks} ticks`;
    type Derived = ReturnType<typeof deriveWithOutputWindows>;
    const { picked, tried } = search<UnevenOutputCandidate, Derived, Omit<NonNullable<ReturnType<typeof deriveUnevenOutputClockWindows>>, "moved_output_swing">>({
        candidates,
        // each position gets its own observed windows, with the padding search but without its confirmation
        quick: (candidate, index) => {
            const derived = deriveWithOutputWindows(base_config, candidate.output_windows, drill_windows, output_inserter_ids,
                belt_pickup_slack, period, `output ${describe(candidate)}`, logger,
                report && (detail => report(`Position ${index + 1}/${candidates.length}: ${detail}`)), false);
            // only the windows that pass are read again; the runs of a position that does not are let go
            return derived.windows === null ? { ...derived, verification: null, as_built: null, even_output_windows: null } : derived;
        },
        // once every position is tried: the most passing positions on either side first, then the smallest move
        picks: (attempts, done) => {
            if (!done) {
                return [];
            }
            const passing = attempts.filter(it => it.quick.windows !== null);
            const passes = new Set(passing.map(it => it.index));
            // candidates are listed per moved window in shift order, so neighbours in the list are neighbours in time
            const neighboursPassing = (index: number, direction: 1 | -1) => {
                let run = 0;
                for (let next = index + direction; passes.has(next) && candidates[next].window_index === candidates[index].window_index; next += direction) {
                    run++;
                }
                return run;
            };
            const margin = (index: number) => Math.min(neighboursPassing(index, 1), neighboursPassing(index, -1));
            const ranked = [...passing].sort((a, b) => margin(b.index) - margin(a.index)
                || Math.abs(a.candidate.shift_ticks) - Math.abs(b.candidate.shift_ticks));
            logger.log(`Uneven output swings: ${passing.length} of ${candidates.length} positions pass the quick clock-only check`);
            for (const { index, candidate, quick: derived } of passing) {
                const windows = Array.from(derived.windows!, ([key, ranges]) => `${key} ${ranges.map(r => `${r.start_inclusive}-${r.end_inclusive}`).join(",")}`).join("; ");
                logger.log(`Uneven output swings: ${describe(candidate)}, ${margin(index)} passing positions on each side: ${windows}`);
            }
            return ranked.map(it => it.index);
        },
        confirm: ({ candidate, quick: derived }) => {
            const full = runAsBuiltCheck(base_config, derived.windows!, period, logger, FULL_CHECK_START_PHASES,
                (n, total) => report?.(`Confirming output ${describe(candidate)}, clock start ${n}/${total}`));
            logger.log(`Uneven output swings: ${describe(candidate)} full check -> stable=${full.check.holds}`);
            return full.check.holds ? { windows: derived.windows, end_padding_ticks: derived.end_padding_ticks, verification: full.result, as_built: full.check } : null;
        },
    });
    if (picked === null) {
        return null;
    }
    const passes = new Set(tried.filter(it => it.quick.windows !== null).map(it => it.index));
    const chosen = tried.find(it => it.confirmed)!.candidate;
    return {
        ...picked,
        moved_output_swing: {
            swing: chosen.window_index + 1,
            shift_ticks: chosen.shift_ticks,
            shifts_checked: checkedShiftRows(candidates.map((it, index) =>
                ({ index: it.window_index + 1, shift_ticks: it.shift_ticks, holds: passes.has(index) }))),
        },
    };
}
