import type { Config } from "../../config/schema";

/**
 * The lane facts that a config's own fields decide, without the game data: whether a lane ends in a dead end. The
 * rates of a lane (lane-facts.ts) need the belt's speed, which only the game data gives; whether a lane is a dead end
 * does not, so a page can ask it on its main thread (the light entry).
 */

/** One lane of a belt as the config lists it, with the lane facts it states */
type LaneConfig = Config["belts"][number]["lanes"][number];

/** Whether the config's lanes all end in a dead end: the one place the config's switch is read */
export function configDeadEnds(config: Pick<Config, "overrides">): boolean {
    return config.overrides?.backed_up_belts === true;
}

/** Whether a lane of the config is a dead end: the end it states, and without one the config's switch */
function laneIsDeadEnd(stated: LaneConfig | undefined, config: Pick<Config, "overrides">): boolean {
    return stated?.lane_end !== undefined ? stated.lane_end.kind === "dead_end" : configDeadEnds(config);
}

/**
 * Whether every input lane (both sides of each belt an inserter takes from) is a dead end, for a reader that has no
 * lane of its own, such as a label about the whole build. A build with no input lane answers as its lanes would if it
 * had one.
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
        return ([1, 2] as const).every(lane => laneIsDeadEnd(listed[lane - 1], config));
    });
}
