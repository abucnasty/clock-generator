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
