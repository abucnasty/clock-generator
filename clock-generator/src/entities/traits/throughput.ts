import { fraction } from "../../data-types/fraction";
import { HandTrait } from "./hand";
import { Ratio, ratioOf } from "./ratio";
import { TimingTrait } from "./timing";

/** What an inserter moves of one item it carries a second */
export interface ThroughputItem {
    readonly item: string;
    /** At the planned cycle: its hand of the item x 60 / `timing.planned.cycle` */
    readonly planned_per_second: Ratio;
    /** The most it can move: its hand of the item x 60 / the item's floor cycle; null where the floor is not known */
    readonly items_per_second_ceiling: Ratio | null;
}

/** An inserter's throughput, an edge per item it carries */
export interface ThroughputTrait {
    /** The edges of one inserter share one capacity: its entity id */
    readonly capacity_group: string;
    readonly by_item: readonly ThroughputItem[];
}

const perSecond = (hand: number, cycle_ticks: number): Ratio => ratioOf(fraction(hand * 60).divide(cycle_ticks));

export function inserterThroughput(entity: string, hand: HandTrait, timing: TimingTrait): ThroughputTrait {
    return {
        capacity_group: entity,
        by_item: hand.by_item.map(({ item, hand: items }, index) => {
            const floor = timing.by_item[index].floor.cycle;
            return {
                item,
                planned_per_second: perSecond(items, timing.planned.cycle),
                items_per_second_ceiling: floor === null ? null : perSecond(items, floor),
            };
        }),
    };
}
