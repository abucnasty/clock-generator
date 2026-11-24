import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import type { Config } from "../../config/schema";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { feasibilityOf } from "../feasibility/assert-feasible";
import { belt, inserter, lane } from "../feasibility/feasibility-test-helpers";
import { plannerGraphOf } from "./build-graph";
import { nearLanesOf, regionOrbitsOf, type FinderSteps, type FoundOrbit, type RegionOrbit } from "./regions";

/** The finder on a config, with the steps it took */
function find(config: Config) {
    const facts = toPlannerFacts(config);
    const graph = plannerGraphOf(facts);
    const steps: FinderSteps = { rounds: 0, pairs: 0 };
    const found = regionOrbitsOf(facts, graph, nearLanesOf(config), feasibilityOf(facts, graph).utilizations, steps);
    return { facts, graph, found, steps };
}
const orbitOf = (found: FoundOrbit[] | null): RegionOrbit => {
    expect(found).toHaveLength(1);
    expect(found![0].kind).toBe("orbit");
    return (found![0] as Extract<FoundOrbit, { kind: "orbit" }>).orbit;
};

// The utility science build at 320 a second: a cryogenic plant (machine 4) hands plastic to two foundries; foundry 3 hands low
// density structure to assemblers 1, 2, 5, foundry 7 to assemblers 6, 8, 9. Belt 5 feeds the first three, belt 2 the others.
describe("the copied regions of a build", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
    });
    const arms = (...ids: number[]) => ids.map(id => `inserter:${id}`);

    it("finds two regions about the cryogenic plant, mapped in the turn order of the foundries' takers", () => {
        const orbit = orbitOf(find(config).found);
        expect(orbit.anchor).toEqual(["machine:4", ...arms(7, 8, 15)]);
        expect(orbit.regions.map(region => [region.key, [...region.nodes].sort(), region.arms])).toEqual([
            ["machine:4/region:1", ["belt:4/lane:1", "machine:1", "machine:2", "machine:3", "machine:5"], arms(1, 2, 3, 4, 5, 6, 9, 10, 13)],
            ["machine:4/region:2", ["belt:3/lane:1", "machine:6", "machine:7", "machine:8", "machine:9"], arms(11, 12, 14, 16, 17, 18, 19, 20, 21)],
        ]);
        expect(orbit.maps).toHaveLength(2);
        expect(Object.entries(orbit.maps[0]).every(([from, to]) => from === to)).toBe(true);
        expect(orbit.maps[1]).toEqual({
            "machine:1": "machine:6", "machine:2": "machine:8", "machine:5": "machine:9", "machine:3": "machine:7", "belt:4/lane:1": "belt:3/lane:1",
            "inserter:5": "inserter:14", "inserter:6": "inserter:16", "inserter:9": "inserter:17",
            "inserter:2": "inserter:12", "inserter:3": "inserter:20", "inserter:10": "inserter:21",
            "inserter:1": "inserter:11", "inserter:4": "inserter:18", "inserter:13": "inserter:19",
        });
    });

    it("maps belt pickups by the side of the item's lane, not its index", () => {
        const { facts } = find(config);
        const laneOf = (id: number, item: string) => facts.edges.find(edge => edge.key === `inserter:${id}/${item}`)!.from;
        // flying robot frames: lane 1 of belt 5, lane 2 of belt 2; each region's arms take them from their near lane
        expect([laneOf(2, "flying-robot-frame"), laneOf(12, "flying-robot-frame")]).toEqual(["belt:5/lane:1", "belt:2/lane:2"]);
        expect([nearLanesOf(config).get("inserter:2"), nearLanesOf(config).get("inserter:12")]).toEqual([1, 2]);
        expect(orbitOf(find(config).found).maps[1]["inserter:2"]).toBe("inserter:12");
    });

    it("maps foundries of different speeds: the speed is a capacity check", () => {
        const { facts } = find(config);
        const speed = (key: string) => (facts.nodes.find(node => node.key === key) as { production: { speed: number } }).production.speed;
        expect([speed("machine:3"), speed("machine:7")]).toEqual([185, 199.75]);
        expect(orbitOf(find(config).found).maps[1]["machine:3"]).toBe("machine:7");
    });

    it("refuses an orbit where a foundry is too slow for its region's share", () => {
        const slowed = structuredClone(config);
        slowed.machines.find(machine => machine.id === 7)!.crafting_speed = 80;
        const found = find(slowed).found;
        expect(found).toHaveLength(1);
        expect(found![0]).toMatchObject({ kind: "refused", reason: "capacity_short" });
    });

    it("gives no orbit where one arm takes from the other side of its belt", () => {
        const swapped = structuredClone(config);
        const source = swapped.inserters.find(it => it.id === 12)!.source as { near_lane?: number };
        source.near_lane = 1;
        expect(find(swapped).found).toBeNull();
    });

    it("gives null for a build with no copy", async () => {
        expect(find(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240)).found).toBeNull();
    });
});

// Every sample: the anchor and the machines of each region where it has copied regions; every other sample has none. Two halves
// whose arms take one item from opposite sides of their belts are not copies (the chemical and military science samples).
describe("the copied regions of the samples", () => {
    const EXPECTED: Record<string, string> = {
        ADVANCED_CIRCUIT_230: "machine:5: 1 3 | 2 4",
        ADVANCED_CIRCUIT_240: "machine:3: 1 2 | 4 5",
        GRENADE_240_FILLS_BELT_EXACTLY: "machine:3: 1 2 | 4 5",
        UTILITY_SCIENCE_320_METERED_TAKERS: "machine:4: 1 2 3 5 | 6 7 8 9",
        UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN: "machine:7: 1 3 5 8 10 12 | 2 4 6 9 11 13",
    };
    it.each(Object.entries(ConfigPaths))("%s", async (name, file) => {
        const found = find(await loadConfigFromFile(file)).found;
        const summary = found === null ? null : found.map(it => {
            const orbit = it.kind === "orbit" ? it.orbit : it;
            const machines = orbit.regions.map(region => region.nodes.filter(node => node.startsWith("machine:")).map(node => Number(node.split(":")[1])).sort((a, b) => a - b).join(" "));
            return `${it.kind === "orbit" ? "" : `${it.reason} `}${orbit.anchor[0]}: ${machines.join(" | ")}`;
        }).join("; ");
        expect(summary).toBe(EXPECTED[name] ?? null);
    });
});

// Four regions about one gear assembler: each region has six belt assemblers that take gears from the gear assembler and
// plates from a belt outside the build, and drop on the region's own output belt. The six of a region are interchangeable.
describe("the cost of the finder", () => {
    const REGIONS = 4;
    const MACHINES = 6;
    function build(): Config {
        const machines: Config["machines"] = [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 10 }];
        const belts: Config["belts"] = [belt(1, [lane("iron-plate", { lane_end: { kind: "infinite" } })])];
        const inserters: Config["inserters"] = [inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 })];
        let next_inserter = 2;
        for (let r = 0; r < REGIONS; r++) {
            const output = 2 + r;
            belts.push(belt(output, [lane("transport-belt")]));
            for (let m = 0; m < MACHINES; m++) {
                const id = 2 + r * MACHINES + m;
                machines.push({ id, recipe: "transport-belt", productivity: 0, crafting_speed: 1 });
                inserters.push(inserter(next_inserter++, { type: "machine", id: 1 }, { type: "machine", id }));
                inserters.push(inserter(next_inserter++, { type: "belt", id: 1 }, { type: "machine", id }));
                inserters.push(inserter(next_inserter++, { type: "machine", id }, { type: "belt", id: output }));
            }
        }
        return { setpoint: { item: "transport-belt", items_per_second: 1, copies: 1 }, machines, belts, inserters } as Config;
    }

    it("maps four regions of six interchangeable machines without enumerating maps", () => {
        const { found, steps, graph } = find(build());
        const orbit = orbitOf(found);
        expect(orbit.regions).toHaveLength(REGIONS);
        expect(orbit.regions.every(region => region.nodes.filter(node => node.startsWith("machine:")).length === MACHINES)).toBe(true);
        // every map is one-to-one and sends machines to machines of its region
        for (const [i, map] of orbit.maps.entries()) {
            const targets = Object.values(map);
            expect(new Set(targets).size).toBe(targets.length);
            expect(targets.every(it => orbit.regions[i].nodes.includes(it) || orbit.regions[i].arms.includes(it))).toBe(true);
        }
        // the steps grow with the size of the graph, not with the 6! maps of each region: one pair fixed per machine and arm of each
        // map, and a refinement of at most as many rounds as there are nodes after each
        const n = graph.nodes.length + graph.edges.length;
        expect(steps.pairs).toBeLessThanOrEqual(REGIONS * n);
        expect(steps.rounds).toBeLessThanOrEqual((REGIONS * n + 1) * n);
        expect(steps.pairs).toBeLessThan(720);
    });
});
