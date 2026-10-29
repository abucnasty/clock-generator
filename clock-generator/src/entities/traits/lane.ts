import { BeltConfig } from "../../config/schema";
import { FactorioDataService } from "../../data";
import { beltSpeedOf, laneItemsPerSecond, lanesOf, laneStackFor } from "../belt/belt";
import { EntityId } from "../entity-id";
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
    /** The belt prototype's `speed` in the game data, in tiles a tick */
    readonly tiles_per_tick: number;
    /** The engine's belt speed: items a second on both lanes (turbo 60), the prototype's speed x 480 (belt.ts beltSpeedOf) */
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

/** Both lanes of a belt of the config, the second side of a belt that lists one included */
export function beltLanes(config: BeltConfig, supply: LaneTrait["supply"]): LaneTrait[] {
    const tiles_per_tick = FactorioDataService.findTransportBeltOrThrow(config.type).speed;
    const belt_speed = beltSpeedOf(config.type);
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
            supply,
            export_per_second: listed?.consumption_per_second ?? null,
        };
    });
}
