import assert from "../../common/assert";
import type { Config } from "../../config/schema";
import { beltSpeedOf, laneItemsPerSecond, laneStackFor } from "../belt/belt";
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

/** The facts about one lane of one belt that decide how its items reach a hand */
export interface LaneFacts {
    /** Items a second entering the lane at its upstream end */
    readonly supply_rate: Ratio;
    readonly lane_end: LaneEnd;
    readonly sharing: LaneSharing;
}

/** The facts of every lane of every belt of one build */
export interface LaneFactsOfBuild {
    /** The facts of lane 1 or 2 of a belt of the config; a belt that lists one lane has both sides (the second carries no item) */
    of(belt_id: number, lane: 1 | 2): LaneFacts;
}

/** The part of a config the facts are derived from */
export type LaneFactsConfig = Pick<Config, "belts" | "overrides">;

/** Whether the lane holds its items until a hand takes them */
export function isDeadEnd(facts: LaneFacts): boolean {
    return facts.lane_end.kind === "dead_end";
}

/** Whether the config's lanes all end in a dead end: the one place the config's switch is read */
function configDeadEnds(config: Pick<Config, "overrides">): boolean {
    return config.overrides?.backed_up_belts === true;
}

/**
 * The facts of the lanes of a config, derived from its `backed_up_belts` switch: with it set every lane is a dead end,
 * without it every lane has a free outlet that carries away as much as the lane carries. The supply rate is the lane's
 * capacity (half the belt's speed times the lane's stack size) and the copies share the lane.
 */
export function laneFactsOf(config: LaneFactsConfig): LaneFactsOfBuild {
    const dead_end = configDeadEnds(config);
    const by_lane = new Map<string, LaneFacts>();
    for (const belt of config.belts) {
        const belt_speed = beltSpeedOf(belt.type);
        for (const lane of [1, 2] as const) {
            const capacity = ratioOf(laneItemsPerSecond(belt_speed, laneStackFor(belt, lane)));
            by_lane.set(`${belt.id}/${lane}`, {
                supply_rate: capacity,
                lane_end: dead_end ? { kind: "dead_end" } : { kind: "outlet", outlet_rate: capacity },
                sharing: "shared_by_copies",
            });
        }
    }
    return {
        of(belt_id, lane) {
            const facts = by_lane.get(`${belt_id}/${lane}`);
            assert(facts !== undefined, `Lane ${lane} of belt ${belt_id} is not in the config`);
            return facts;
        },
    };
}

/**
 * Whether every input lane (both sides of each belt an inserter takes from) is a dead end, for a reader that has no
 * lane of its own, such as a label about the whole build. A build with no input lane answers as its lanes would if it
 * had one.
 */
export function everyInputLaneIsDeadEnd(config: LaneFactsConfig & Pick<Config, "inserters">): boolean {
    const belt_ids = new Set(config.belts.map(belt => belt.id));
    const input_belts = new Set<number>();
    for (const inserter of config.inserters) {
        if (inserter.source.type === "belt" && belt_ids.has(inserter.source.id)) input_belts.add(inserter.source.id);
    }
    if (input_belts.size === 0) return configDeadEnds(config);
    const facts = laneFactsOf(config);
    return [...input_belts].every(belt_id => ([1, 2] as const).every(lane => isDeadEnd(facts.of(belt_id, lane))));
}
