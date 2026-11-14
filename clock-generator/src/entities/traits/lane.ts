import { BeltConfig } from "../../config/schema";
import { lanesOf } from "../belt/belt";
import { beltSpeedOf, laneItemsPerSecond, laneStackFor, tilesPerTickOf } from "../belt/belt-speed";
import { EntityId } from "../entity-id";
import { LaneEnd, LaneFactsOfBuild } from "./lane-facts";
import { Ratio, ratioOf } from "./ratio";

/** One lane of a belt, a node of its own, keyed "belt:B/lane:L" */
export interface LaneTrait {
    readonly key: string;
    readonly belt: string;
    readonly lane: 1 | 2;
    /**
     * Whether the config lists the lane. A belt that lists one lane is supplied on that lane only, but what is dropped on
     * it can land on either side: its second side is a lane that carries no item, at the first lane's stack.
     */
    readonly listed: boolean;
    readonly item: string | null;
    readonly stack: number;
    readonly belt_prototype: string;
    /** The belt prototype's speed in tiles a tick, as its `speed` in the game data (belt-speed.ts) */
    readonly tiles_per_tick: number;
    /** The engine's belt speed: items a second on both lanes (turbo 60), the prototype's speed x 480 (belt-speed.ts beltSpeedOf) */
    readonly belt_speed: number;
    /** Items a second the lane carries: half the belt's speed times the lane's stack (turbo, stack 4: 120) */
    readonly items_per_second_ceiling: Ratio;
    /** A moving belt is assumed full (A24); a backed-up one is a standing queue */
    readonly supply: "moving" | "backed_up";
    /** Items a second taken off an export lane by consumers outside the config; null for another lane */
    readonly export_per_second: number | null;
}

export function laneKey(belt_id: number, lane: number): string {
    return `${EntityId.forBelt(belt_id).id}/lane:${lane}`;
}

/** The trait's supply of a lane end: an infinite end moves its items on, a dead end leaves a standing queue */
export function supplyOfLaneEnd(lane_end: LaneEnd): LaneTrait["supply"] {
    return lane_end.kind === "dead_end" ? "backed_up" : "moving";
}

/**
 * Both sides of a belt of the config, each lane it states supplied by that lane's own facts. A belt that states one lane
 * has one lane: its other side is kept only for what is dropped on it, carries no item and has no lane facts, and its
 * supply is the belt's, that of the lane the belt states.
 */
export function beltLanesOfFacts(config: BeltConfig, facts: LaneFactsOfBuild): LaneTrait[] {
    const stated = facts.lanesOf(config.id);
    return lanesOfBelt(config, lane => supplyOfLaneEnd((stated[lane - 1] ?? stated[0]).lane_end));
}

function lanesOfBelt(config: BeltConfig, supplyOf: (lane: 1 | 2) => LaneTrait["supply"]): LaneTrait[] {
    const belt_speed = beltSpeedOf(config.type);
    const tiles_per_tick = tilesPerTickOf(belt_speed);
    const lanes = lanesOf(config);
    return ([1, 2] as const).map(lane => {
        const listed = lanes[lane - 1];
        const stack = laneStackFor(config, lane);
        return {
            key: laneKey(config.id, lane),
            belt: EntityId.forBelt(config.id).id,
            lane,
            listed: listed !== undefined,
            item: listed?.ingredient_name ?? null,
            stack,
            belt_prototype: config.type,
            tiles_per_tick,
            belt_speed,
            items_per_second_ceiling: ratioOf(laneItemsPerSecond(belt_speed, stack)),
            supply: supplyOf(lane),
            export_per_second: listed?.consumption_per_second ?? null,
        };
    });
}
