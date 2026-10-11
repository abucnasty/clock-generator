import { OpenRange } from "../../data-types";

/** Ticks added to the latest tick an output machine was seen back at its block, before its feeders are enabled again */
export const OUTPUT_FEEDER_MARGIN_TICKS = 2;

/**
 * The disabled stretch has to hold at least this many swings of the inserter back to back, or switching it off and
 * on again costs about what it saves.
 */
export const OUTPUT_FEEDER_MIN_SWINGS = 2;

export interface OutputFeederWindows {
    /** Windows over the clock period in which the feeders are enabled */
    windows: OpenRange[];
    /** The latest tick after the end of an output window at which the output machine was back at its block */
    latest_back_at_block_ticks: number;
    /** Ticks after the end of an output window that the feeders stay enabled: the latest tick plus the margin */
    enabled_after_output_window_ticks: number;
    /** Ticks of the shortest stretch in which the feeders are disabled, over the gaps between output windows */
    disabled_ticks: number;
}

/**
 * Windows for an inserter that is always enabled and puts into the machine the build's output is taken from (and not when it can carry that machine's fuel).
 *
 * The machine takes nothing from it while its output holds the block quantity or more, and on a clock that takes the
 * output in bursts that holds for a stretch of every cycle: the machine is back at its block some ticks after the
 * output windows close, and until they open again the inserter only waits. From the long run of the build with the
 * inserter always enabled, the latest tick after the end of an output window at which the output is back at its block
 * is taken; if it gets there after every output window of the run, the inserter is enabled from the start of an
 * output window until that tick and a margin after the window ends, and disabled until the next one opens.
 *
 * Null when it does not: the output is not back at its block after some window, the stretch it would be disabled is
 * shorter than `min_disabled_ticks`, or the period is not a whole number of ticks.
 *
 * @param output output quantity of the machine after each tick of the run, which starts at the start of a period
 * @param output_block quantity at which the machine takes no more ingredients
 * @param output_windows windows of the output inserters over the period, as planned; ticks are counted from where they
 *        end as planned, which is where the run's windows end less the circuit latency, as in the game
 * @param min_disabled_ticks the least the inserter may be disabled for, in every gap between output windows
 */
export function outputFeederWindows(
    output: readonly number[],
    output_block: number,
    output_windows: readonly OpenRange[],
    period: number,
    min_disabled_ticks: number,
): OutputFeederWindows | null {
    const windows = OpenRange.reduceRanges(output_windows.map(it => it));
    if (!Number.isInteger(period) || windows.length === 0 || output.length < 2 * period) {
        return null;
    }
    // what follows the first third of the run: the start-up of a loop can take a dozen periods to work out of
    const first_judged_period = Math.floor(Math.floor(output.length / period) / 3);
    const last_period = Math.floor(output.length / period) - 1;
    let latest = -Infinity;
    for (let n = first_judged_period; n <= last_period; n++) {
        for (let index = 0; index < windows.length; index++) {
            const end = n * period + windows[index].end_inclusive;
            const wrapped = index + 1 === windows.length;
            const next_start = n * period + (wrapped ? period + windows[0].start_inclusive : windows[index + 1].start_inclusive);
            // the run ends with its last period: a window that opens after it cannot be judged
            if (next_start >= output.length) {
                continue;
            }
            // the last tick before the next window opens at which the output is below its block
            let below = end;
            for (let tick = next_start - 1; tick > end; tick--) {
                if (output[tick] < output_block) {
                    below = tick;
                    break;
                }
            }
            if (below === next_start - 1) {
                return null;
            }
            latest = Math.max(latest, below + 1 - end);
        }
    }
    if (!Number.isFinite(latest)) {
        return null;
    }
    const enabled_after = latest + OUTPUT_FEEDER_MARGIN_TICKS;
    let shortest_stretch = Infinity;
    const enabled: OpenRange[] = [];
    windows.forEach((window, index) => {
        const next_start = index + 1 === windows.length ? period + windows[0].start_inclusive : windows[index + 1].start_inclusive;
        shortest_stretch = Math.min(shortest_stretch, next_start - (window.end_inclusive + enabled_after));
        enabled.push(OpenRange.from(window.start_inclusive, Math.min(window.end_inclusive + enabled_after - 1, next_start - 1)));
    });
    if (shortest_stretch < min_disabled_ticks) {
        return null;
    }
    // an enabled stretch that runs past the end of the period comes round to the start of the next
    const wrapped_windows: OpenRange[] = [];
    for (const window of enabled) {
        if (window.end_inclusive >= period) {
            wrapped_windows.push(OpenRange.from(window.start_inclusive, period - 1), OpenRange.from(0, window.end_inclusive - period));
        } else {
            wrapped_windows.push(window);
        }
    }
    return {
        windows: OpenRange.reduceRanges(wrapped_windows),
        latest_back_at_block_ticks: latest,
        enabled_after_output_window_ticks: enabled_after,
        disabled_ticks: shortest_stretch,
    };
}
