import { FactorioDataService, ItemName } from "../data";
import { Entity, ReadableEntityRegistry } from "../entities";

/**
 * What a belt with a consumption rate has to receive. A lane of an export belt is emptied by consumers outside the
 * config (`consumption_per_second`), so the inserters that fill it have to put that many items on it. Lanes of one
 * belt that carry the same item are one demand: the inserters that fill the belt with the item serve all of them, so
 * the sum of their rates is what those inserters have to deliver.
 */
export interface ExportedItem {
    belt_id: string;
    belt_number: number;
    item: ItemName;
    /** The consumption rates of the belt's lanes of the item, summed */
    items_per_second: number;
    /** The inserters that put the item on the belt, by id */
    filler_ids: string[];
    /** The inserters' numbers, for telling the user */
    filler_numbers: number[];
    /** The largest hand of those inserters */
    hand: number;
}

/**
 * An export belt that received less than its consumers take, over what a run was judged on. The clock holds the target
 * and is not stable: the line that takes the items off the belt runs dry.
 */
export interface ExportShortfall {
    /** The belt's id in the config */
    belt_id: number;
    item: ItemName;
    /** The game's name of the item, in lower case: "electronic circuit" */
    item_label: string;
    /** What the consumers take off the belt, over its lanes of the item */
    expected_per_second: number;
    /** What the belt received */
    delivered_per_second: number;
    /** The inserters that fill it, by number */
    inserter_ids: number[];
}

/**
 * The belt lanes of the build that have a consumption rate, by belt and item, with the inserters that fill them. A belt
 * that the output inserters fill is left out: what it receives is the build's output, which every check already judges.
 */
export function exportedItemsOf(registry: ReadableEntityRegistry, output_inserter_ids: ReadonlySet<string>): ExportedItem[] {
    const inserters = registry.getAll().filter(Entity.isInserter);
    const result: ExportedItem[] = [];
    for (const belt of registry.getAll().filter(Entity.isBelt)) {
        const rates = new Map<ItemName, number>();
        for (const lane of belt.lanes) {
            if (lane.consumption_per_second) {
                rates.set(lane.ingredient_name, (rates.get(lane.ingredient_name) ?? 0) + lane.consumption_per_second);
            }
        }
        for (const [item, items_per_second] of rates) {
            const fillers = inserters.filter(it => it.sink.entity_id.id === belt.entity_id.id && it.filtered_items.has(item));
            if (fillers.length === 0 || fillers.some(it => output_inserter_ids.has(it.entity_id.id))) {
                continue;
            }
            result.push({
                belt_id: belt.entity_id.id,
                belt_number: belt.entity_id.number,
                item,
                items_per_second,
                filler_ids: fillers.map(it => it.entity_id.id),
                filler_numbers: fillers.map(it => it.entity_id.number),
                hand: Math.max(1, ...fillers.map(it => it.metadata.stack_size)),
            });
        }
    }
    return result;
}

function shortfallOf(exported: ExportedItem, delivered_per_second: number): ExportShortfall {
    return {
        belt_id: exported.belt_number,
        item: exported.item,
        item_label: FactorioDataService.itemDisplayName(exported.item).toLowerCase(),
        expected_per_second: exported.items_per_second,
        delivered_per_second,
        inserter_ids: exported.filler_numbers,
    };
}

/**
 * The exports that fell short in one period, from the items the inserters moved in it (all of them, by inserter id and
 * item). Short means more than `tolerance` items fewer than the consumers take in the period. More is not short: the
 * belt backs up in the game and the inserter waits, and a clock that takes what the build needs for itself from an
 * export fails the target on its own.
 */
export function exportShortfallsOfPeriod(
    exported: readonly ExportedItem[],
    moved: (inserter_id: string, item: ItemName) => number,
    period_ticks: number,
    tolerance: number,
): ExportShortfall[] {
    const short: ExportShortfall[] = [];
    for (const it of exported) {
        const delivered = it.filler_ids.reduce((sum, id) => sum + moved(id, it.item), 0);
        const expected = it.items_per_second * period_ticks / 60;
        if (expected - delivered > tolerance) {
            short.push(shortfallOf(it, delivered * 60 / period_ticks));
        }
    }
    return short;
}

/** Where the judged part of a long run lies: the bins its drops are counted in */
export interface JudgedBins {
    /** Tick of the run the first bin starts at */
    first_tick: number;
    /** Ticks in a bin; null when the judged part is compared as one span */
    bin_ticks: number | null;
    /** Ticks of the run; the last bin ends there */
    ticks: number;
    /** Bins judged (1 for a single span) */
    count: number;
    /**
     * The bins are a repeating cycle the run was proven to settle into (see judgeProvenCycle): a shortfall there never
     * ends, so it is judged to the item, not to a hand
     */
    proven: boolean;
}

/** The tolerance of a proven cycle: the items of rounding, as the outputs' (LCM_STABILITY_TOLERANCE) */
const PROVEN_CYCLE_TOLERANCE = 1;

/**
 * The exports that fell short over the judged part of a long run, from what each inserter held after each tick (a fall
 * from one tick to the next is a drop). Judged as the output is, in the same bins, with these differences: only a
 * shortfall counts, and a bin may be a hand of the inserters short as the output's may be off by one, because a drop on
 * the edge of a bin falls on either side of it from one period to the next. Over the judged part as a whole, a sampled run
 * may be a hand short and a proven cycle (which repeats for ever) at most an item.
 */
export function exportShortfallsOfRun(
    exported: readonly ExportedItem[],
    held_by_inserter: ReadonlyMap<string, readonly number[]>,
    bins: JudgedBins,
): ExportShortfall[] {
    const short: ExportShortfall[] = [];
    for (const it of exported) {
        const bin_ticks = bins.bin_ticks ?? bins.ticks - bins.first_tick;
        const delivered = new Array<number>(bins.count).fill(0);
        for (const id of it.filler_ids) {
            const series = held_by_inserter.get(id);
            if (series === undefined) {
                continue;
            }
            for (let t = Math.max(1, bins.first_tick); t < bins.ticks; t++) {
                if (series[t] < series[t - 1]) {
                    const index = Math.floor((t - bins.first_tick) / bin_ticks);
                    if (index < delivered.length) {
                        delivered[index] += series[t - 1] - series[t];
                    }
                }
            }
        }
        const expected_per_bin = it.items_per_second * bin_ticks / 60;
        const bin_short = delivered.some(items => expected_per_bin - items > it.hand);
        const total = delivered.reduce((sum, items) => sum + items, 0);
        const total_short = it.items_per_second * bin_ticks * bins.count / 60 - total > (bins.proven ? PROVEN_CYCLE_TOLERANCE : it.hand);
        if (bin_short || total_short) {
            short.push(shortfallOf(it, total * 60 / (bin_ticks * bins.count)));
        }
    }
    return short;
}
