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
 * Whether every input lane (each lane a belt an inserter takes from states) is a dead end, by the ends its lane facts
 * give, for a reader that has no lane of its own, such as a label about the whole build. A belt that states one lane has
 * one lane, so its one lane decides. A build with no input lane answers as the config's switch.
 */
export function everyInputLaneIsDeadEnd(config: Pick<Config, "belts" | "overrides" | "inserters">, facts: Pick<LaneFactsOfBuild, "lanesOf">): boolean {
    const belt_ids = new Set(config.belts.map(belt => belt.id));
    const input_belts = new Set<number>();
    for (const inserter of config.inserters) {
        if (inserter.source.type === "belt" && belt_ids.has(inserter.source.id)) input_belts.add(inserter.source.id);
    }
    if (input_belts.size === 0) return configDeadEnds(config);
    return config.belts.filter(belt => input_belts.has(belt.id))
        .every(belt => facts.lanesOf(belt.id).every(lane => lane.lane_end.kind === "dead_end"));
}
