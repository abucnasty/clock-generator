import { RecordedInserter, Recording } from "../verification/recording";
import { Config } from "../config";
import { Machine } from "../entities";

/** One complete clock period of a recording: the samples from start (inclusive) to end (exclusive) */
export interface PeriodRange {
    start: number;
    end: number;
}

export interface PeriodOutput extends PeriodRange {
    /** Items the output inserters dropped during the period */
    items: number;
}

/**
 * Sample ranges of the complete clock periods in a series of recorded clock values. A period starts where the
 * value falls below the previous sample's: the clock may count from 0 or from 1, so the wrap is the only sure sign.
 * The first sample starts a period only when it holds the lowest value the clock reaches, and the last period is
 * complete only when its last sample holds the highest, so a recording that begins or ends mid-period loses its ends.
 */
export function clockPeriods(values: number[]): PeriodRange[] {
    if (values.length === 0) {
        return [];
    }
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    const starts: number[] = values[0] === lowest ? [0] : [];
    for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i - 1]) {
            starts.push(i);
        }
    }
    const periods: PeriodRange[] = [];
    for (let i = 0; i < starts.length; i++) {
        const next = starts[i + 1];
        if (next !== undefined) {
            periods.push({ start: starts[i], end: next });
        } else if (values[values.length - 1] === highest) {
            periods.push({ start: starts[i], end: values.length });
        }
    }
    return periods;
}

/** The recipes of the config's machines that make the item: a cast recipe is named after the item, with "casting-" in front */
export function recipesMaking(config: Config, item: string): Set<string> {
    return new Set(config.machines.filter(machine => Machine.fromConfig(machine).output.item_name === item).map(machine => machine.recipe));
}

/** The inserters that take the product out of the build: from a machine with one of the recipes into a chest or onto a belt */
export function outputInserters(recording: Recording, recipes: Iterable<string>): RecordedInserter[] {
    const names = new Set(recipes);
    const making = new Set(recording.machines.filter(machine => names.has(machine.recipe)).map(machine => machine.id));
    return recording.inserters.filter(inserter =>
        inserter.source.type === "machine" && making.has(inserter.source.id) && inserter.sink.type !== "machine");
}

/**
 * Items the output inserters of the recipes moved in each complete clock period of a clocked recording. A drop is a
 * fall of an inserter's held count from one sample to the next; it is counted in the period of the later sample, so
 * a drop on the period boundary belongs to the period that starts there. A partial drop into a full sink counts for
 * the items it did move.
 */
export function outputPerPeriod(recording: Recording, recipes: Iterable<string>): PeriodOutput[] {
    const inserters = outputInserters(recording, recipes);
    return clockPeriods(recording.clock?.values ?? []).map(period => {
        let items = 0;
        for (const inserter of inserters) {
            const held = inserter.samples.held_count;
            for (let i = Math.max(period.start, 1); i < period.end; i++) {
                if (held[i] < held[i - 1]) {
                    items += held[i - 1] - held[i];
                }
            }
        }
        return { ...period, items };
    });
}
