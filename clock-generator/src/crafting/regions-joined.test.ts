import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { buildRegionsOf } from "./graph/build-regions";
import { regionsJoinedInsights } from "./insights";

const notices = (config: Config) => regionsJoinedInsights(config, buildRegionsOf(config));

/** The utility science 320 build with its output inserters moved: `belts` sends each output inserter to a belt */
function withOutputs(config: Config, belts: Record<number, number>, change?: (config: Config) => void): Config {
    const moved = structuredClone(config);
    for (const inserter of moved.inserters) {
        const belt = belts[inserter.id!];
        if (belt !== undefined && inserter.sink.type === "belt") inserter.sink = { ...inserter.sink, id: belt };
    }
    change?.(moved);
    const on = (end: Config["inserters"][number]["sink"], id: number) => end.type === "belt" && end.id === id;
    moved.belts = moved.belts.filter(belt => moved.inserters.some(it => on(it.sink, belt.id) || on(it.source, belt.id)));
    return moved;
}

describe("the notice where repeated groups of machines are joined by a lane", () => {
    let utility: Config;
    beforeAll(async () => {
        utility = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
    });

    it("names the one lane that the output inserters of both groups drop on, and the inserters by number", () => {
        const one_lane = withOutputs(utility, { 11: 4, 18: 4, 19: 4 });
        const [notice, ...more] = notices(one_lane);
        expect(more).toEqual([]);
        expect(notice.title).toBe("Lane 1 of belt 4 keeps the repeated groups of machines from sharing one clock");
        expect(notice.what).toBe("The build has groups of machines that repeat, but inserters 1, 4, 11, 13, 18 and 19 of more than one group drop onto lane 1 of belt 4. "
            + "So the generator plans the build as one group.");
    });

    it("names both belts where each of two output belts has inserters of both groups, and a belt where its two lanes list the item", () => {
        const two_belts = withOutputs(utility, { 1: 4, 11: 4, 4: 3, 13: 3, 18: 3, 19: 3 }, config => {
            const belt = config.belts.find(it => it.id === 4)!;
            belt.lanes = [belt.lanes[0], { ...belt.lanes[0] }];
        });
        const [notice, ...more] = notices(two_belts);
        expect(more).toEqual([]);
        expect(notice.title).toBe("Lane 1 of belt 3 and belt 4 keep the repeated groups of machines from sharing one clock");
        expect(notice.what).toContain("inserters 1, 4, 11, 13, 18 and 19 of more than one group drop onto lane 1 of belt 3 and belt 4");
    });

    it("is not given where the finder finds the repeated groups", async () => {
        expect(notices(utility)).toEqual([]);
        expect(notices(await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY))).toEqual([]);
    });

    it("is not given where the build converts to one unit with copies, and is given where it does not", async () => {
        const fixture = (name: string) => loadConfigFromFile(path.join(__dirname, "..", "config", "fixtures", name));
        expect(notices(await fixture("grenade-240-seven-units.json"))).toEqual([]);
        const slow = notices(await fixture("grenade-240-seven-units-slow-assemblers.json"));
        expect(slow.length).toBeGreaterThan(0);
        expect(slow[0].what).toMatch(/inserters [\d, and]+ of more than one group drop onto (lane \d of )?belt \d/);
    });
});
