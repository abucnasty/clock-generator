import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { buildTraits } from "../entities/traits/build-traits";
import { laneKey } from "../entities/traits/lane";
import { modelLanesOf } from "./shared-lane-lanes";

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

    // the config only, parsed: no run and no generation. A belt the model runs with every copy on it, and that states no
    // flow direction, is run both ways (shared-lane-verdict.ts). The one belt listed is of a build of one copy whose three
    // tungsten ore inserters take from one belt: the model runs them together since it runs the takers of one copy, and the
    // sample states neither the belt's flow direction nor the inserters' positions, so the lane is run both ways with its
    // takers a tile apart in the order of the configuration
    it("state the flow direction of every belt with a lane the model runs with every copy on it", async () => {
        const problems: string[] = [];
        for (const [key, file] of SAMPLES) {
            const config = await loadConfigFromFile(file);
            const judged = new Set(modelLanesOf(config).filter(lane => lane.shared).map(lane => lane.belt_id));
            for (const belt_id of judged) {
                if (config.belts.find(belt => belt.id === belt_id)!.flow_direction === undefined) problems.push(`${key} belt ${belt_id} states no flow direction`);
            }
        }
        expect(problems).toEqual(["METALLURGIC_SCIENCE_45 belt 1 states no flow direction"]);
    });
});
