import assert from "../../common/assert";
import type { Config } from "../../config/schema";
import { fraction } from "../../data-types/fraction";
import { beltSpeedOf, laneItemsPerSecond, laneStackFor } from "../belt/belt-speed";
import { configDeadEnds } from "./lane-ends";
import { LaneRole, LaneRolesOfBuild } from "./lane-role";
import { Ratio, ratioOf } from "./ratio";

/**
 * What happens to an item at the downstream end of a lane. A dead end holds items until a hand takes them, so the lane
 * is a standing queue; an infinite end takes every item that reaches it, as much as the lane carries, so a moving lane is
 * assumed full. "unknown" is a lane whose end the build has not said.
 */
export type LaneEnd =
    | { readonly kind: "dead_end" }
    | { readonly kind: "infinite" }
    | { readonly kind: "unknown" };

/** Whether every copy of the unit takes from the same lane, or each copy has a lane of its own */
export type LaneSharing = "shared" | "per_copy";

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
    /** What the build does with the lane (lane-role.ts); null where no inserter takes from it or drops onto it */
    readonly role: LaneRole | null;
}

/**
 * The facts of one lane a belt of a config states, for a reader that lists every lane, such as a page's form: the lane
 * facts with the belt and the lane they are of, the lane's capacity, and whether the supply rate is that capacity
 * because the lane states none
 */
export interface BeltLaneFacts extends LaneFacts {
    readonly belt_id: number;
    readonly lane: 1 | 2;
    /** Items a second the lane carries: half the belt's speed times the lane's stack size */
    readonly capacity: Ratio;
    /** Whether the lane states no supply rate, so that its supply rate is its capacity */
    readonly supply_rate_by_default: boolean;
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

/** Items a second a lane of a belt of the config carries: half the belt's speed times the lane's stack size */
function laneCapacityOf(belt: Config["belts"][number], lane: number): Ratio {
    return ratioOf(laneItemsPerSecond(beltSpeedOf(belt.type), laneStackFor(belt, lane)));
}

/**
 * The facts of the lanes of a config. A fact that a lane of the config states is read as it is; a fact that it does
 * not state is derived from the config's `backed_up_belts` switch: with the switch set the lane is a dead end, without
 * it the lane has an infinite end, which takes as much as the lane carries. A supply rate that is not stated is the
 * lane's capacity (half the belt's speed times the lane's stack size), and the copies share a lane that does not say
 * otherwise. A belt that states one lane has one lane: there is no fact of a lane it does not state, so nothing reads
 * that lane's end, supply or sharing. Both lanes of a belt move the way the belt states (`flow_direction`), and no way
 * where it states none. Each lane carries its role, as `roles` gives it (laneRolesOf, lane-role.ts).
 */
export function laneFactsOf(config: LaneFactsConfig, roles: LaneRolesOfBuild): LaneFactsOfBuild {
    const dead_end = configDeadEnds(config);
    const by_belt = new Map<number, readonly LaneFacts[]>();
    for (const belt of config.belts) {
        const listed: readonly LaneConfig[] = belt.lanes;
        by_belt.set(belt.id, listed.map((stated, index) => {
            const capacity = laneCapacityOf(belt, index + 1);
            const role = roles.of(belt.id, index + 1 as 1 | 2);
            return {
                supply_rate: stated.supply_rate === undefined ? capacity : ratioOf(fraction(stated.supply_rate)),
                lane_end: stated.lane_end !== undefined ? { kind: stated.lane_end.kind }
                    : dead_end ? { kind: "dead_end" } : { kind: "infinite" },
                sharing: stated.sharing ?? "shared",
                flow_direction: belt.flow_direction === undefined ? null : flowOf(belt.flow_direction),
                role,
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

/**
 * The facts of every lane the belts of a config state, belt by belt in the config's order and lane 1 before lane 2:
 * laneFactsOf's facts of each lane, its role included, with its capacity and whether its supply rate is that capacity by
 * default. The roles come from what the inserters carry, which needs the game data: the caller gives them (laneRolesOf).
 */
export function beltLaneFactsOf(config: LaneFactsConfig, roles: LaneRolesOfBuild): BeltLaneFacts[] {
    const facts = laneFactsOf(config, roles);
    return config.belts.flatMap(belt => {
        const listed: readonly LaneConfig[] = belt.lanes;
        return listed.map((stated, index) => {
            const lane = index + 1 as 1 | 2;
            return {
                belt_id: belt.id,
                lane,
                ...facts.of(belt.id, lane),
                capacity: laneCapacityOf(belt, lane),
                supply_rate_by_default: stated.supply_rate === undefined,
            };
        });
    });
}
