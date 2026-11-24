import { windowCycleTicks, type WindowCycle } from "../../common/subtick-window-cycle";
import { Config } from "../../config";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { EntityId } from "../../entities";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { Logger } from "../../common/logger";
import { TimeStudyWindows, chestFeedWindowsOf, deriveTimeStudyWindows } from "../candidates/time-study-windows";
import { alwaysEnabledByConfig, windowsFromHistory } from "../plan/unclocked-run";
import { Confirmed, QuickTrial, confirm, search } from "./search";
import { withOutputWindowMoved } from "./transforms";
import { lastPosition, positionStep, windowTicks, withWindowsKeepingLength } from "../clock";

/** Positions tried for moved output swings; each costs dozens of clock-only simulations */
const MAX_UNEVEN_OUTPUT_CANDIDATES = 24;


export interface MovedOutputSwingCandidate {
    /** Index of the moved window among each output inserter's windows, in clock order */
    window_index: number;
    shift_ticks: number;
    output_windows: Map<string, OpenRange[]>;
}

/**
 * The planned output windows with one window moved earlier or later in steps of a craft, the first window staying
 * put as the reference. A moved window keeps at least its own length clear of its neighbours. Every output inserter
 * moves the same window by the same amount, in whole ticks. On a p/q-tick window cycle the windows are given in its
 * clock's positions (`withWindowsKeepingLength`), so a moved window keeps its length in every window cycle. Empty when
 * there is a single window per window cycle, or the window cycle is fractional with no subtick clock.
 */
export function movedOutputSwingCandidates(
    output_windows: Map<string, OpenRange[]>,
    window_cycle: WindowCycle,
    step_ticks: number,
): MovedOutputSwingCandidate[] {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    const sorted = new Map(Array.from(output_windows, ([key, ranges]) =>
        [key, [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive)] as const));
    const count = Math.min(...Array.from(sorted.values(), ranges => ranges.length));
    // a tick, or the 1/q tick between two positions of a subtick clock
    const position = positionStep(window_cycle);
    if (position === null || sorted.size === 0 || count < 2
        || Array.from(sorted.values()).some(ranges => ranges.length !== count)) {
        return [];
    }
    const last = lastPosition(window_cycle);

    // shifts every output inserter has room for, per moved window
    const room: { window_index: number; min: number; max: number }[] = [];
    for (let window_index = 1; window_index < count; window_index++) {
        let min = -Infinity;
        let max = Infinity;
        for (const ranges of sorted.values()) {
            const window = ranges[window_index];
            const length = windowTicks(window, window_cycle);
            const next_start = window_index + 1 < count ? ranges[window_index + 1].start_inclusive : ranges[0].start_inclusive + window_cycle_ticks;
            min = Math.max(min, ranges[window_index - 1].end_inclusive + length + position - window.start_inclusive);
            max = Math.min(max, next_start - length - position - window.end_inclusive, last - window.end_inclusive);
        }
        room.push({ window_index, min, max });
    }
    const span = room.reduce((sum, it) => sum + Math.max(0, it.max - it.min), 0);
    const step = Math.max(step_ticks, span / MAX_UNEVEN_OUTPUT_CANDIDATES, 1);

    const candidates: MovedOutputSwingCandidate[] = [];
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
 * its output over the whole window cycle, so it can craft more between one pair of swings than the next. Every candidate
 * position gets its own observed windows, which is its quick trial; of those that pass, one whose neighbouring
 * positions pass too is confirmed before one whose do not, the smallest move of those (see search.ts). Null when there
 * is nothing to move or no position passes.
 */
export function movedOutputSwingWindows(
    config: Config,
    planned_history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    lane_hand_room: Map<string, number>,
    window_cycle: WindowCycle,
    step_ticks: number,
    logger: Logger,
    report?: (detail: string) => void,
): TimeStudyWindows | null {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    // read off the whole ticks of the planning run: on a p/q-tick window cycle made again in the clock's positions, as long
    // in every window cycle as in the planning run's
    const planned_windows = withWindowsKeepingLength(
        windowsFromHistory(planned_history, createEntityRegistryFromConfig(config), alwaysEnabledByConfig(config)), window_cycle);
    const output_windows = new Map(Array.from(planned_windows).filter(([key]) => output_inserter_ids.has(key)));
    const drill_ids = new Set(Array.from(planned_history.keys()).filter(EntityId.isDrill).map(it => it.id));
    const drill_windows = new Map(Array.from(planned_windows).filter(([key]) => drill_ids.has(key)));
    const chest_feed_windows = chestFeedWindowsOf(config, planned_windows, window_cycle, logger);

    const candidates = movedOutputSwingCandidates(output_windows, window_cycle, step_ticks);
    const describe = (candidate: MovedOutputSwingCandidate) => `output swing ${candidate.window_index + 1} moved ${candidate.shift_ticks} ticks`;
    const { picked, pick, tried } = search<MovedOutputSwingCandidate, QuickTrial & { derived: TimeStudyWindows }, Confirmed>({
        candidates,
        // each position gets its own observed windows, with the padding search and its pick taken on the quick trial
        quick: (candidate, index) => {
            const derived = deriveTimeStudyWindows(base_config, candidate.output_windows, drill_windows, output_inserter_ids,
                lane_hand_room, window_cycle, describe(candidate), logger,
                report && (detail => report(`Position ${index + 1}/${candidates.length}: ${detail}`)), false, true, chest_feed_windows);
            // only the windows that pass are read again; the runs of a position that does not are let go
            return derived.windows === null
                ? { holds: false, derived: { ...derived, verification: null, as_built: null, even_output_windows: null } }
                : { holds: true, derived };
        },
        // candidates are listed per moved window in shift order, so neighbours in the list are neighbours in time
        neighbours: (a, b) => a.window_index === b.window_index,
        tieBreak: (a, b) => Math.abs(a.candidate.shift_ticks) - Math.abs(b.candidate.shift_ticks),
        confirm: ({ candidate, quick }) => confirm(base_config, quick.derived.windows!, window_cycle, logger, describe(candidate), report, quick.derived.verified, true),
    });
    logger.log(`Moved Output Swing: ${tried.filter(it => it.quick.holds).length} of ${candidates.length} positions pass the quick trial`);
    if (picked === null || pick === null) {
        return null;
    }
    return {
        windows: pick.quick.derived.windows,
        end_padding_ticks: pick.quick.derived.end_padding_ticks,
        verification: picked.result,
        as_built: picked.check,
        even_output_windows: null,
        search: {
            kind: "moved output swing",
            candidates: tried.map(it => ({ row: it.candidate.window_index + 1, setting: it.candidate.shift_ticks, holds: it.quick.holds })),
            picked: { row: pick.candidate.window_index + 1, setting: pick.candidate.shift_ticks },
        },
    };
}
