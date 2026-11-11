import type { Config } from "../../config/schema";

/**
 * Whether a lane ends in a dead end, from the config's own fields alone: the end a lane states, and without one the
 * config's switch. The lane facts (lane-facts.ts) read the ends from here, and a page can ask the question about every
 * input lane on its main thread (the light entry).
 */

/** One lane of a belt as the config lists it, with the lane facts it states */
type LaneConfig = Config["belts"][number]["lanes"][number];

/** Whether the config's lanes all end in a dead end: the one place the config's switch is read */
export function configDeadEnds(config: Pick<Config, "overrides">): boolean {
    return config.overrides?.backed_up_belts === true;
}

/** Whether a lane of the config is a dead end: the end it states, and without one the config's switch */
function laneIsDeadEnd(stated: LaneConfig, config: Pick<Config, "overrides">): boolean {
    return stated.lane_end !== undefined ? stated.lane_end.kind === "dead_end" : configDeadEnds(config);
}

/**
 * Whether every input lane (each lane a belt an inserter takes from states) is a dead end, for a reader that has no
 * lane of its own, such as a label about the whole build. A belt that states one lane has one lane, so its one lane
 * decides. A build with no input lane answers as its lanes would if it had one.
 */
export function everyInputLaneIsDeadEnd(config: Pick<Config, "belts" | "overrides" | "inserters">): boolean {
    const belt_ids = new Set(config.belts.map(belt => belt.id));
    const input_belts = new Set<number>();
    for (const inserter of config.inserters) {
        if (inserter.source.type === "belt" && belt_ids.has(inserter.source.id)) input_belts.add(inserter.source.id);
    }
    if (input_belts.size === 0) return configDeadEnds(config);
    return config.belts.filter(belt => input_belts.has(belt.id)).every(belt => {
        const listed: readonly LaneConfig[] = belt.lanes;
        return listed.every(lane => laneIsDeadEnd(lane, config));
    });
}
