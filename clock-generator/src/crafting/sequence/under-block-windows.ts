import { OpenRange } from "../../data-types";

/** Ticks added on each side of the ticks a machine was seen under its output block, before its inserter is enabled */
const UNDER_BLOCK_MARGIN_TICKS = 2;

/**
 * A stretch the inserter is disabled for has to hold at least this many of its swings back to back, or switching it
 * off and on again costs about what it saves.
 */
export const LOOP_WINDOW_MIN_SWINGS = 2;

/** Where in the window cycle a machine was under its output block over the judged part of a run of the build */
export interface UnderBlockMap {
    window_cycle_ticks: number;
    /** By tick of the window cycle: under its block in some judged window cycle */
    some: readonly boolean[];
}

interface UnderBlockWindows {
    /** Windows over the window cycle in which the inserter is enabled */
    windows: OpenRange[];
    /** Ticks of the shortest and the longest stretch in which it is disabled */
    shortest_off_ticks: number;
    longest_off_ticks: number;
}

/**
 * Where a machine was under its output block, from the quantity of its main product after each tick of a run that
 * starts at the start of a window cycle, judged after its first third, where the start-up of a loop has worked itself out.
 * Null when the run is shorter than two window cycles, the window cycle is not a whole number of ticks, or the machine was never
 * under its block.
 */
export function underBlockMap(output: readonly number[], output_block: number, window_cycle_ticks: number): UnderBlockMap | null {
    if (!Number.isInteger(window_cycle_ticks) || output.length < 2 * window_cycle_ticks) {
        return null;
    }
    const window_cycles = Math.floor(output.length / window_cycle_ticks);
    const some = new Array<boolean>(window_cycle_ticks).fill(false);
    for (let tick = Math.floor(window_cycles / 3) * window_cycle_ticks; tick < window_cycles * window_cycle_ticks; tick++) {
        if (output[tick] < output_block) {
            some[tick % window_cycle_ticks] = true;
        }
    }
    return some.includes(true) ? { window_cycle_ticks, some } : null;
}

/** The stretches of the ticks marked, around the window cycle, as [start, length] from the first after an unmarked tick */
function stretchesOf(marked: readonly boolean[]): { start: number; length: number }[] {
    const window_cycle_ticks = marked.length;
    const first_unmarked = marked.indexOf(false);
    if (first_unmarked < 0) {
        return [{ start: 0, length: window_cycle_ticks }];
    }
    const stretches: { start: number; length: number }[] = [];
    for (let step = 1; step <= window_cycle_ticks; step++) {
        const position = (first_unmarked + step) % window_cycle_ticks;
        if (!marked[position]) {
            continue;
        }
        const last = stretches[stretches.length - 1];
        if (last !== undefined && marked[(position - 1 + window_cycle_ticks) % window_cycle_ticks]) {
            last.length += 1;
        } else {
            stretches.push({ start: position, length: 1 });
        }
    }
    return stretches;
}

/** The ticks marked, with every stretch unmarked that is shorter than `min_ticks` marked too */
function withShortGapsFilled(marked: readonly boolean[], min_ticks: number): boolean[] {
    const filled = [...marked];
    for (const gap of stretchesOf(marked.map(it => !it)).filter(it => it.length < min_ticks && it.length < marked.length)) {
        for (let k = 0; k < gap.length; k++) {
            filled[(gap.start + k) % marked.length] = true;
        }
    }
    return filled;
}

/**
 * The stretches in which the machine was under its block, those less than `min_disabled_ticks` apart taken as one: an
 * inserter into it is switched off between them, where the machine could take nothing from it.
 */
export function underBlockStretches(map: UnderBlockMap, min_disabled_ticks: number): { start: number; length: number }[] {
    return stretchesOf(withShortGapsFilled(map.some, min_disabled_ticks));
}

/**
 * Windows for an inserter into a machine that takes nothing while its output holds the block quantity or more (see
 * `OutputBlock.ingredients_blocked_at`), with a margin on each side, the inserter disabled in the rest: the stretches in
 * which the machine was under its block (`underBlockStretches`), or with `length_ticks` only that many ticks of each,
 * from the first run of ticks under the block that is as long. Where the machine's output is taken in
 * windows, the stretches follow them and are the same every window cycle whatever the machine holds: the inserter is only
 * switched off where the machine could take nothing from it.
 *
 * Null when the windows would fill the window cycle: the machine is under its block at every tick, or is off it for less
 * than `min_disabled_ticks` at a time.
 */
export function underBlockWindows(map: UnderBlockMap, min_disabled_ticks: number, length_ticks?: number): UnderBlockWindows | null {
    const { window_cycle_ticks, some } = map;
    const enabled = new Array<boolean>(window_cycle_ticks).fill(false);
    for (const stretch of underBlockStretches(map, min_disabled_ticks)) {
        let from = 0;
        if (length_ticks !== undefined) {
            // from the first run of ticks under the block as long as the window, or the longest: a tick or two under it
            // while the output inserter is between two hands, which the machine fills again at once with the products it
            // holds, is not room for the hands
            const runs: { start: number; length: number }[] = [];
            for (let k = 0; k < stretch.length; k++) {
                if (!some[(stretch.start + k) % window_cycle_ticks]) {
                    continue;
                }
                const last = runs[runs.length - 1];
                if (last !== undefined && last.start + last.length === k) {
                    last.length += 1;
                } else {
                    runs.push({ start: k, length: 1 });
                }
            }
            from = (runs.find(it => it.length >= length_ticks) ?? runs.reduce((a, b) => b.length > a.length ? b : a)).start;
        }
        const to = length_ticks === undefined ? stretch.length : Math.min(stretch.length, from + length_ticks);
        for (let k = from - UNDER_BLOCK_MARGIN_TICKS; k < to + UNDER_BLOCK_MARGIN_TICKS; k++) {
            enabled[(((stretch.start + k) % window_cycle_ticks) + window_cycle_ticks) % window_cycle_ticks] = true;
        }
    }
    const kept = withShortGapsFilled(enabled, min_disabled_ticks);
    const off = stretchesOf(kept.map(it => !it));
    if (!kept.includes(false)) {
        return null;
    }
    const windows: OpenRange[] = [];
    for (let position = 0; position < window_cycle_ticks; position++) {
        if (kept[position] && (position === 0 || !kept[position - 1])) {
            let end = position;
            while (end + 1 < window_cycle_ticks && kept[end + 1]) {
                end++;
            }
            windows.push(OpenRange.from(position, end));
        }
    }
    return {
        windows,
        shortest_off_ticks: Math.min(...off.map(it => it.length)),
        longest_off_ticks: Math.max(...off.map(it => it.length)),
    };
}
