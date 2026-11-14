import type { Config } from "../../config/schema";
import type { LaneFactsOfBuild } from "./lane-facts";

/**
 * Whether the lanes of a config end in dead ends, for a reader that has no lane of its own, such as a label about the
 * whole build: the config's switch, and whether every input lane is a dead end by the ends the lane facts give
 * (lane-facts.ts). A page can ask the question about every input lane on its main thread (the light entry).
 */

/** Whether the config's switch says the belts are backed up: the one place the config's switch is read */
export function configDeadEnds(config: Pick<Config, "overrides">): boolean {
    return config.overrides?.backed_up_belts === true;
}

/**
 * Whether every input lane is a dead end, by the ends its lane facts give, for a reader that has no lane of its own, such
 * as a label about the whole build. The lanes read are those whose role (lane-role.ts) is input or buffer: an output lane,
 * or a lane with no role, on a belt an inserter takes from does not count. A belt that states one lane has one lane. A
 * build with no input or buffer lane answers as the config's switch.
 */
export function everyInputLaneIsDeadEnd(config: Pick<Config, "belts" | "overrides">, facts: Pick<LaneFactsOfBuild, "lanesOf">): boolean {
    const lanes = config.belts.flatMap(belt => facts.lanesOf(belt.id)).filter(lane => lane.role === "input" || lane.role === "buffer");
    if (lanes.length === 0) return configDeadEnds(config);
    return lanes.every(lane => lane.lane_end.kind === "dead_end");
}

/**
 * `config` with one end stated on every lane that states no consumption, for a reader that runs the build with that end
 * on every lane, such as the run with backpressure at the pickups: an end the lane states gives way, which the switch
 * never made it do. A lane with a consumption keeps its infinite end. The switch, if the config states it, is left as it
 * is: no lane it could give an end to is left.
 */
export function withEveryLaneEnd<C extends Pick<Config, "belts">>(config: C, kind: "dead_end" | "infinite"): C {
    return {
        ...config,
        belts: config.belts.map(belt => ({
            ...belt,
            lanes: (belt.lanes as readonly LaneOfBelt[]).map(lane => lane.consumption_per_second !== undefined ? lane : { ...lane, lane_end: { kind } }),
        })),
    };
}

/** A lane of a belt as the config lists it, read by withEveryLaneEnd */
type LaneOfBelt = Config["belts"][number]["lanes"][number] & { consumption_per_second?: number };
