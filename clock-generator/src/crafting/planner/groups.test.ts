import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { belt, infinityChest, inserter, lane } from "../feasibility/feasibility-test-helpers";
import { plannerGraphOf } from "../graph/build-graph";
import { groupsOf } from "./groups";

const groupsOfConfig = (config: Config) => {
    const facts = toPlannerFacts(config);
    return groupsOf(facts, plannerGraphOf(facts));
};

const gears = { recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 };

/**
 * Two gear assemblers, each fed iron plates by its own inserter and each putting its gears into an infinity chest of its
 * own: two branches that share no node
 */
const twoBranches: Config = {
    target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, ...gears }, { id: 2, ...gears }],
    belts: [belt(1, [lane("iron-plate")]), belt(2, [lane("iron-plate")])],
    chests: [infinityChest(3, ["iron-gear-wheel"]), infinityChest(4, ["iron-gear-wheel"])],
    inserters: [
        inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
        inserter(2, { type: "machine", id: 1 }, { type: "chest", id: 3 }),
        inserter(3, { type: "belt", id: 2 }, { type: "machine", id: 2 }),
        inserter(4, { type: "machine", id: 2 }, { type: "chest", id: 4 }),
    ],
} as Config;

const membersOf = (config: Config) => groupsOfConfig(config).groups.map(group => group.members);

describe("the groups of a build", () => {
    it("two branches that share no node are two groups, each with its edges; the lanes nothing drops on are in neither", () => {
        const { unbounded_sources, groups } = groupsOfConfig(twoBranches);
        expect(groups.map(group => [group.key, group.members, group.edges])).toEqual([
            ["group:1", ["machine:1"], ["inserter:1/iron-plate", "inserter:2/iron-gear-wheel"]],
            ["group:2", ["machine:2"], ["inserter:3/iron-plate", "inserter:4/iron-gear-wheel"]],
        ]);
        expect(unbounded_sources).toEqual([
            { vertex: "belt:1/lane:1#iron-plate", kind: "nothing-drops-on" },
            { vertex: "belt:2/lane:1#iron-plate", kind: "nothing-drops-on" },
        ]);
    });

    it("fed from one lane nothing drops on, they stay two groups: the lane brings what comes from outside", () => {
        const one_lane: Config = { ...twoBranches, belts: [twoBranches.belts[0]],
            inserters: twoBranches.inserters.map(it => it.id === 3 ? { ...it, source: { type: "belt", id: 1 } } : it) } as Config;
        expect(membersOf(one_lane)).toEqual([["machine:1"], ["machine:2"]]);
        expect(groupsOfConfig(one_lane).unbounded_sources).toEqual([{ vertex: "belt:1/lane:1#iron-plate", kind: "nothing-drops-on" }]);
    });

    it("fed from one infinity chest that gives the plates, they stay two groups", () => {
        const one_chest: Config = { ...twoBranches, belts: [], chests: [...twoBranches.chests!, infinityChest(5, ["iron-plate"])],
            inserters: twoBranches.inserters.map(it => it.id === 1 || it.id === 3 ? { ...it, source: { type: "chest", id: 5 } } : it) } as Config;
        expect(membersOf(one_chest)).toEqual([["machine:1"], ["machine:2"]]);
        expect(groupsOfConfig(one_chest).unbounded_sources).toEqual([{ vertex: "chest:5#iron-plate", kind: "infinity-supply" }]);
    });

    it("putting their gears into one buffer chest joins them into one group through its port", () => {
        const one_output: Config = { ...twoBranches, chests: [{ id: 3, type: "buffer-chest", storage_size: 48, item_filter: "iron-gear-wheel" }],
            inserters: twoBranches.inserters.map(it => it.id === 4 ? { ...it, sink: { type: "chest", id: 3 } } : it) } as Config;
        expect(membersOf(one_output)).toEqual([["machine:1", "machine:2", "chest:3#iron-gear-wheel"]]);
    });

    it("a loop is one member, by its key, with its vertices in the group (agricultural science's two egg machines)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE) as Config;
        const { groups } = groupsOfConfig(config);
        expect(groups.map(group => group.members)).toEqual([["machine:1", "machine:2", "loop:1", "machine:5"]]);
        expect(groups[0].vertices).toEqual(["machine:1", "machine:2", "machine:3", "machine:4", "machine:5"]);
    });

    it("the ore voider's infinity chest in no loop is taken out; the loop through the car stays whole", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED) as Config;
        const { unbounded_sources, groups } = groupsOfConfig(config);
        expect(unbounded_sources).toEqual([{ vertex: "chest:2#iron-ore", kind: "infinity-supply" }]);
        expect(groups.map(group => [group.members, group.vertices])).toEqual([[["loop:1"], ["machine:1", "chest:1#iron-ore"]]]);
    });
});
