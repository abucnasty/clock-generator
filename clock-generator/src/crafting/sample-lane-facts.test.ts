import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { buildTraits } from "../entities/traits/build-traits";
import { laneKey } from "../entities/traits/lane";

const SAMPLES = Object.entries(ConfigPaths);

describe("the lane facts of the samples", () => {
    // taken from by item and per lane: an inserter takes from the lanes of its belt that carry an item it carries, by
    // its filters or the ingredients of its machine (the inserter's timing, entities/traits/build-traits.ts)
    it("state the end of every lane an inserter takes from, and no end is unknown", async () => {
        const problems: string[] = [];
        for (const [key, file] of SAMPLES) {
            const config = await loadConfigFromFile(file);
            const taken = new Set(Object.values(buildTraits(config))
                .flatMap(node => node.kind === "inserter" ? node.timing.by_item.flatMap(item => item.source_lanes) : []));
            for (const belt of config.belts) {
                belt.lanes.forEach((lane, index) => {
                    const where = `${key} belt ${belt.id} lane ${index + 1}`;
                    if (lane.lane_end?.kind === "unknown") problems.push(`${where} states an unknown end`);
                    else if (lane.lane_end === undefined && taken.has(laneKey(belt.id, index + 1))) problems.push(`${where} states no end`);
                });
            }
        }
        expect(problems).toEqual([]);
    });

});
