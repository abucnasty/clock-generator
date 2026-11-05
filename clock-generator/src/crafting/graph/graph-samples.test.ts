import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { TestConfigPaths } from "../../../tests/configs/paths";
import { InserterCoverageError, InserterCoverageIssue } from "../../config/errors";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { plannerGraphOf } from "./build-graph";
import { graphInvariantIssues, portsOfCoverageIssues, uncoveredPortsOf } from "./invariants";
import { graphSnapshotOf } from "./snapshot";

const SNAPSHOTS = path.join(__dirname, "__snapshots__");

async function graphOf(file: string) {
    const config = await loadConfigFromFile(file) as Config;
    const facts = toPlannerFacts(config);
    return { config, facts, graph: plannerGraphOf(facts) };
}

/** What the coverage check refuses a config for: the issues of the InserterCoverageError it throws, none where it passes */
function coverageIssuesOf(config: Config): InserterCoverageIssue[] {
    try {
        assertInserterCoverage(config);
    } catch (error) {
        if (error instanceof InserterCoverageError) return error.issues;
        throw error;
    }
    return [];
}

/**
 * The loops of each sample, by their members (P3 section 5's paper check): agricultural science's and iron bacteria's
 * two machines, which today's machine-only test finds too, and the ore voiders' loop through the car, which it does not.
 * The steel wagon carries ore one way and plates the other through one wagon: no loop on its item ports.
 */
const LOOPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
    AGRICULTURAL_SCIENCE_250: [["machine:3", "machine:4"]],
    IRON_BACTERIA_380_CULTIVATION: [["machine:1", "machine:2"]],
    IRON_ORE_VOIDER_400_EXACT_SPEED: [["machine:1", "chest:1#iron-ore"]],
    IRON_ORE_VOIDER_400_OVERBEACONED: [["machine:1", "chest:1#iron-ore"]],
};

/**
 * The terminal edges of each sample, by kind (P3 1.4), against the paper check's table (P3 section 5). Where they
 * differ: the ore voiders' 4 edges from the infinity chest (D13; the paper check lists them as
 * "from outside: 4 edges").
 */
const TERMINAL: Readonly<Record<string, number>> = {
    ACCUMULATOR_640: 2,
    ADVANCED_CIRCUIT_240: 2,
    ADVANCED_CIRCUIT_230: 2,
    AGRICULTURAL_SCIENCE_250: 1,
    AUTOMATION_SCIENCE_240: 1,
    AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER: 1,
    CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: 4,
    ELECTRIC_FURNACE_20: 1,
    ELECTROMAGNETIC_SCIENCE_330: 2,
    FLYING_ROBOT_FRAME_160: 1,
    ROCKET_FUEL_60: 3,
    IRON_BACTERIA_380_CULTIVATION: 4,
    LOGISTIC_SCIENCE_240: 1,
    LOGISTIC_SCIENCE_240_DIRECT_INSERT: 2,
    INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: 1,
    LDS_240: 4,
    METALLURGIC_SCIENCE_45: 1,
    MILITARY_SCIENCE_120: 1,
    PROCESSING_UNIT_15_CHEST_FED: 1,
    PRODUCTION_SCIENCE_120_TWO_BELTS: 1,
    IRON_PLATE_80_CAR_CHEST: 2,
    GRENADE_240_FILLS_BELT_EXACTLY: 4,
    LITHIUM_PLATE_80_SILO_CHEST: 6,
    IRON_ORE_VOIDER_400_EXACT_SPEED: 4,
    IRON_ORE_VOIDER_400_OVERBEACONED: 4,
    ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED: 3,
    PRODUCTIVITY_MODULE_80_CHEST_CHAIN: 1,
    PROCESSING_UNIT_80_CIRCUIT_EXPORT: 4,
    UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN: 8,
    STEEL_PLATE_26_WAGON_CHEST: 1,
    STONE_BRICK_120_DRILL_DIRECT_INSERT: 1,
    UTILITY_SCIENCE_120: 1,
    UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: 1,
};

describe("the planner graph", () => {
    describe.each(Object.entries(ConfigPaths))("of %s", (key, file) => {
        it("holds its invariants, leaves uncovered the ports the coverage check reports, and matches its snapshot", async () => {
            const { config, facts, graph } = await graphOf(file);
            expect(graphInvariantIssues(facts, graph, portsOfCoverageIssues(coverageIssuesOf(config)))).toEqual([]);
            const json = graphSnapshotOf(graph, key);
            // deterministic: built again from the config read again, byte for byte the same
            expect(graphSnapshotOf((await graphOf(file)).graph, key)).toBe(json);
            // small: a few hundred nodes and edges at most (P3 1.6 item 9); the largest, the utility science 480 build, is 24 kB
            expect(json.length).toBeLessThan(64 * 1024);
            await expect(json).toMatchFileSnapshot(path.join(SNAPSHOTS, `${key}.graph.json`));
        });

        it("finds the loops and the terminal edges of the paper check", async () => {
            const { graph } = await graphOf(file);
            expect(graph.components.map(component => component.members)).toEqual(LOOPS[key] ?? []);
            expect(graph.terminal.length).toBe(TERMINAL[key]);
        });
    });

    it("of the refusal sample leaves uncovered the accumulator's iron plate and its result, as the coverage check does", async () => {
        const { config, facts, graph } = await graphOf(TestConfigPaths.BAD_ACCUMULATOR_CONFIG);
        const expected = [{ side: "input", at: "machine:1", item: "iron-plate" }, { side: "output", at: "machine:1", item: "accumulator" }];
        expect(uncoveredPortsOf(facts, graph)).toEqual(expected);
        expect(() => assertInserterCoverage(config)).toThrow(InserterCoverageError);
        expect(portsOfCoverageIssues(coverageIssuesOf(config))).toEqual(expected);
    });

    it("keeps no snapshot of a sample that is gone, and an expectation for every sample", () => {
        const keys = new Set(Object.keys(ConfigPaths));
        const files = fs.existsSync(SNAPSHOTS) ? fs.readdirSync(SNAPSHOTS).filter(file => file.endsWith(".graph.json")) : [];
        expect(files.filter(file => !keys.has(file.replace(/\.graph\.json$/, "")))).toEqual([]);
        expect(Object.keys(LOOPS).filter(key => !keys.has(key))).toEqual([]);
        expect(Object.keys(TERMINAL).sort()).toEqual([...keys].sort());
    });
});
