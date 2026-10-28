import { CIRCUIT_LATENCY_TICKS } from "../../common/rule-constants";
import { InserterAnimationOverrideConfig } from "../../config";
import { InserterAnimation } from "../inserter/inserter-animation";
import { BeltDropMetadata } from "../inserter/metadata/animation";
import { InserterMetadata } from "../inserter/metadata/inserter-metadata";
import { beltPickupCalibrated, inserterSpecFor, rotationTicks } from "../inserter/metadata/inserter-spec";
import { EntityType } from "../entity-type";
import { HandTrait } from "./hand";
import { LaneTrait } from "./lane";

/**
 * The fewest ticks an inserter's pickup, drop and swing of an item take, a sound bound: the simulator and the game never
 * take fewer. Null where no sound bound is known (a belt pickup by a kind not calibrated on belts).
 */
export interface TimingFloor {
    readonly pickup: number | null;
    readonly drop: number | null;
    readonly cycle: number | null;
}

/** An inserter's timing for one item it carries, by the lanes it takes it from and drops it on */
export interface TimingItem {
    readonly item: string;
    /** The lanes of its source belt that carry the item; none for a machine or chest source */
    readonly source_lanes: readonly string[];
    /** The lane of its sink belt its hand of the item is rounded to; null for a machine or chest sink */
    readonly sink_lane: string | null;
    readonly floor: TimingFloor;
}

/** An inserter's timing */
export interface TimingTrait {
    /** Ticks the arm turns each way: ceil(0.5 / (rotation_speed x (1 + 0.3 x quality level))) - 2 */
    readonly rotation_ticks: number;
    /**
     * Today's figures, as the simulator runs them (inserter-spec.ts, animation.ts, inserter-animation.ts): pickup and
     * drop by source and sink, the drop onto a belt by its belt's drop pattern, a config's pickup override included
     */
    readonly planned: { readonly pickup: number; readonly drop: number; readonly cycle: number; readonly pickup_to_drop: number };
    readonly by_item: readonly TimingItem[];
    /** Whether the belt pickup arm model is calibrated for its prototype and quality (inserter-spec.ts BELT_PICKUP_CALIBRATED) */
    readonly belt_pickup_calibrated: boolean;
    /** Ticks from a circuit clock's value to the inserter acting on its decider */
    readonly enable_latency_ticks: number;
}

/** What the timing of an inserter reads of its ends: their types, and the lanes of a belt end */
export interface InserterTimingEnds {
    readonly source: EntityType;
    readonly sink: EntityType;
    readonly source_lanes: readonly LaneTrait[];
    /** The lane of the sink belt each item's hand is rounded to */
    readonly sink_lane_of: ReadonlyMap<string, LaneTrait>;
    /** The drop onto a sink belt, timed on its lane with the hand it drops there (inserterHands) */
    readonly belt_drop?: BeltDropMetadata;
}

/** Ticks to move a hand one belt stack a tick: one stack is picked up or placed a tick */
const stacksOf = (hand: number, stack: number) => Math.ceil(hand / stack);

export function inserterTiming(
    hand: HandTrait,
    filters: readonly string[],
    overrides: InserterAnimationOverrideConfig,
    ends: InserterTimingEnds,
): TimingTrait {
    const metadata = InserterMetadata.create(ends.source, ends.sink, hand.nominal, [...filters], overrides, ends.belt_drop,
        { prototype: hand.prototype, quality: hand.quality as InserterMetadata["quality"] });
    const animation = InserterAnimation.fromMetadata(metadata.animation);
    const spec = inserterSpecFor(hand.prototype, hand.quality);
    const rotation_ticks = rotationTicks(hand.prototype, hand.quality);
    const calibrated = beltPickupCalibrated(hand.prototype, hand.quality);
    return {
        rotation_ticks,
        planned: {
            pickup: animation.pickup.ticks,
            drop: animation.drop.ticks,
            cycle: animation.total.ticks,
            pickup_to_drop: animation.pickup_to_drop.ticks,
        },
        by_item: hand.by_item.map(({ item, hand: items }) => {
            const source_lanes = ends.source === EntityType.BELT ? ends.source_lanes.filter(lane => lane.item === item) : [];
            const sink_lane = ends.sink === EntityType.BELT ? ends.sink_lane_of.get(item) ?? null : null;
            const pickup = ends.source !== EntityType.BELT ? spec.machine.pickup.ticks
                : calibrated && source_lanes.length > 0 ? Math.min(...source_lanes.map(lane => stacksOf(items, lane.stack))) : null;
            const drop = ends.sink !== EntityType.BELT ? spec.machine.drop.ticks
                : sink_lane !== null ? stacksOf(items, sink_lane.stack) : null;
            return {
                item,
                source_lanes: source_lanes.map(lane => lane.key),
                sink_lane: sink_lane?.key ?? null,
                floor: { pickup, drop, cycle: pickup === null || drop === null ? null : pickup + 2 * rotation_ticks + drop },
            };
        }),
        belt_pickup_calibrated: calibrated,
        enable_latency_ticks: CIRCUIT_LATENCY_TICKS,
    };
}
