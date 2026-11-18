// The rows, clocks and readers shared by the whole-build generation tests (src/crafting/whole-build.generation.test.ts and
// src/crafting/whole-build-copies.generation.test.ts): the generations are in two files, so that no file holds more than one long one.
import { automationRow } from './automation-row';
import type { ClockAlternativesResult } from '../../src/crafting/alternatives';
import { quiet } from '../../src/crafting/generate-blueprint-test-helpers';
import type { Config } from '../../src/config';
import type { SerializableClockWindows } from '../../src/crafting/clock';
import { judgeSharedLanes } from '../../src/crafting/shared-lane-verdict';

/** The 72-tick clock of two output swings each output cycle: outputs open 2-14 and inputs 29-52, a clock the game fails at 9 tiles */
export const TWO_SWINGS = 'takt_batches_observed_swings_2';

export const clockOf = (result: ClockAlternativesResult, id: string) => {
    const clock = result.alternatives.find(alternative => alternative.id === id);
    if (clock === undefined) throw new Error(`no clock ${id}: ${result.alternatives.map(it => it.id).join(', ')}`);
    return clock;
};

export const lossesOf = (result: ClockAlternativesResult, id: string) => (clockOf(result, id).assessment.shared_lane_losses ?? [])
    .map(loss => 'inserter_id' in loss ? `${loss.inserter_id} ${loss.item} ${loss.swings}/${loss.alone_swings}` : loss.kind);

const INPUT = [{ start: 0, end: 50 }, { start: 122, end: 149 }, { start: 159, end: 186 }, { start: 215, end: 215 }];
export const TWO_OUTPUT_WINDOWS = [{ start: 1, end: 37 }, { start: 109, end: 145 }];
export const SIX_OUTPUT_WINDOWS = [0, 36, 72, 108, 144, 180].map(start => ({ start, end: start + 3 }));
/** A clock of 216 ticks for a build of three of the assemblers (inserters 1, 3 and 5 the inputs, 2, 4 and 6 the outputs), by the outputs' windows */
export const threeOf = (outputs: readonly (typeof TWO_OUTPUT_WINDOWS)[]): SerializableClockWindows => Object.fromEntries(outputs.flatMap((output, index) =>
    [[`inserter:${2 * index + 1}`, INPUT], [`inserter:${2 * index + 2}`, output]]));
/**
 * The clock that Coordinated Sources selected for three copies of three without the output line (784.241 wakeups a
 * minute), and the one of Time-Study Windows (902.088): the same but for the outputs of the first two assemblers
 */
export const COORDINATED = threeOf([SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS]);
export const TIME_STUDY = threeOf([TWO_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS]);
/** The clock that Coordinated Sources selects for three copies of three on the output line: the second assembler's output in two windows */
export const COORDINATED_ON_LINE = threeOf([SIX_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS]);
/** The same windows on the build of nine: assembler k has those of assembler ((k - 1) mod 3) + 1 */
export const onNine = (windows: SerializableClockWindows): SerializableClockWindows => Object.fromEntries(Array.from({ length: 18 }, (_, index) =>
    [`inserter:${index + 1}`, windows[`inserter:${(index % 6) + 1}`]]));

/** The assemblers whose input inserter (2k - 1 of a copy of k) takes less on the lanes than alone, upstream first */
export const shortAssemblers = (config: Config, windows: SerializableClockWindows) => {
    const per_copy = config.machines.length;
    return [...new Set(judgeSharedLanes(config, windows, 216, quiet).losses
        .map(loss => (loss.copy - 1) * per_copy + (loss.inserter_id + 1) / 2))].sort((a, b) => a - b);
};

/** The row of nine at 9 tiles on the output line of its scaffold, with `off_line` assemblers kept off it */
export const nineOnLine = (off_line: number[] = []) => automationRow({ machines: 9, pitch: 9, output_line: { off_line } });
/** Three copies of a build of three of the assemblers, the copies 27 tiles apart: the same row, on the same line */
export const threeCopiesOnLine = () => automationRow({ machines: 3, pitch: 9, copies: 3, copy_offset: { x: 27, y: 0 }, output_line: {} });
