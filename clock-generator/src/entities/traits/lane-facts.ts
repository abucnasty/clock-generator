import assert from "../../common/assert";
import type { Config } from "../../config/schema";
import { fraction } from "../../data-types/fraction";
import { beltSpeedOf, laneItemsPerSecond, laneStackFor } from "../belt/belt";
import { configDeadEnds } from "./lane-ends";
import { Ratio, ratioOf } from "./ratio";

/**
 * What happens to an item at the downstream end of a lane. A dead end holds items until a hand takes them, so the lane
 * is a standing queue; an outlet carries them away at `outlet_rate` items a second, so a moving lane is assumed full.
 * "unknown" is a lane whose end the build has not said.
 */
export type LaneEnd =
    | { readonly kind: "dead_end" }
    | { readonly kind: "outlet"; readonly outlet_rate: Ratio }
    | { readonly kind: "unknown" };

/** Whether every copy of the unit takes from the same lane, or each copy has a lane of its own */
export type LaneSharing = "shared_by_copies" | "one_per_copy";

/** A map direction as a unit step, x east and y south: the way a lane's items move */
export interface FlowDirection {
    readonly x: number;
    readonly y: number;
}

/** The facts about one lane of one belt that decide how its items reach a hand */
export interface LaneFacts {
    /** Items a second entering the lane at its upstream end */
    readonly supply_rate: Ratio;
    readonly lane_end: LaneEnd;
    readonly sharing: LaneSharing;
    /** The way its items move, where the config states it on the belt; null where it does not */
    readonly flow_direction: FlowDirection | null;
}

/** The facts of every lane of every belt of one build */
export interface LaneFactsOfBuild {
    /** The facts of lane 1 or 2 of a belt of the config; a lane the belt does not state is refused */
    of(belt_id: number, lane: 1 | 2): LaneFacts;
    /** The facts of the lanes a belt of the config states, in its order: one for a belt that states one lane */
    lanesOf(belt_id: number): readonly LaneFacts[];
}

/** The part of a config the facts are derived from */
export type LaneFactsConfig = Pick<Config, "belts" | "overrides">;

/** Whether the lane holds its items until a hand takes them */
export function isDeadEnd(facts: LaneFacts): boolean {
    return facts.lane_end.kind === "dead_end";
}

/** A cardinal direction of the game (0 north, 4 east, 8 south, 12 west) as a map step */
function flowOf(direction: 0 | 4 | 8 | 12): FlowDirection {
    return direction === 0 ? { x: 0, y: -1 } : direction === 4 ? { x: 1, y: 0 } : direction === 8 ? { x: 0, y: 1 } : { x: -1, y: 0 };
}

/** One lane of a belt as the config lists it, with the lane facts it states */
type LaneConfig = Config["belts"][number]["lanes"][number];

/** A lane end the config states, with the outlet's rate made exact: an outlet that states no rate is free, at the lane's capacity */
function laneEndOf(stated: NonNullable<LaneConfig["lane_end"]>, capacity: Ratio): LaneEnd {
    if (stated.kind !== "outlet") return { kind: stated.kind };
    return { kind: "outlet", outlet_rate: stated.outlet_rate === undefined ? capacity : ratioOf(fraction(stated.outlet_rate)) };
}

/**
 * The facts of the lanes of a config. A fact that a lane of the config states is read as it is; a fact that it does
 * not state is derived from the config's `backed_up_belts` switch: with the switch set the lane is a dead end, without
 * it the lane has a free outlet that carries away as much as the lane carries. A supply rate that is not stated is the
 * lane's capacity (half the belt's speed times the lane's stack size), and the copies share a lane that does not say
 * otherwise. A belt that states one lane has one lane: there is no fact of a lane it does not state, so nothing reads
 * that lane's end, supply or sharing. Both lanes of a belt move the way the belt states (`flow_direction`), and no way
 * where it states none.
 */
export function laneFactsOf(config: LaneFactsConfig): LaneFactsOfBuild {
    const dead_end = configDeadEnds(config);
    const by_belt = new Map<number, readonly LaneFacts[]>();
    for (const belt of config.belts) {
        const belt_speed = beltSpeedOf(belt.type);
        const listed: readonly LaneConfig[] = belt.lanes;
        by_belt.set(belt.id, listed.map((stated, index) => {
            const capacity = ratioOf(laneItemsPerSecond(belt_speed, laneStackFor(belt, index + 1)));
            return {
                supply_rate: stated.supply_rate === undefined ? capacity : ratioOf(fraction(stated.supply_rate)),
                lane_end: stated.lane_end !== undefined ? laneEndOf(stated.lane_end, capacity)
                    : dead_end ? { kind: "dead_end" } : { kind: "outlet", outlet_rate: capacity },
                sharing: stated.sharing ?? "shared_by_copies",
                flow_direction: belt.flow_direction === undefined ? null : flowOf(belt.flow_direction),
            };
        }));
    }
    const lanesOf = (belt_id: number) => {
        const lanes = by_belt.get(belt_id);
        assert(lanes !== undefined, `Belt ${belt_id} is not in the config`);
        return lanes;
    };
    return {
        of(belt_id, lane) {
            const facts = by_belt.get(belt_id)?.[lane - 1];
            assert(facts !== undefined, `Lane ${lane} of belt ${belt_id} is not in the config`);
            return facts;
        },
        lanesOf,
    };
}

