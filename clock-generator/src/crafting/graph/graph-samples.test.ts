import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { InserterCoverageError, InserterCoverageIssue } from "../../config/errors";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { plannerGraphOf } from "./build-graph";
import { graphInvariantIssues, portsOfCoverageIssues, uncoveredPortsOf } from "./invariants";
import { graphSnapshotOf } from "./snapshot";


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
    AGRICULTURAL_SCIENCE: [["machine:3", "machine:4"]],
    IRON_BACTERIA_CULTIVATION: [["machine:1", "machine:2"]],
    REAL_OWNER_ORE_VOIDER_EXACT_SPEED: [["machine:1", "chest:1#iron-ore"]],
    REAL_OWNER_ORE_VOIDER_OVERBEACONED: [["machine:1", "chest:1#iron-ore"]],
};

/**
 * The terminal edges of each sample, by kind (P3 1.4), against the paper check's table (P3 section 5). Where they
 * differ: the scrap silo's 12 by-products into infinity chests plus the scrap brought in (D13: the paper check counts the
 * destroyed target apart), and the ore voiders' 4 edges from the infinity chest (D13; the paper check lists them as
 * "from outside: 4 edges").
 */
const TERMINAL: Readonly<Record<string, number>> = {
    ACCUMULATOR_640: 2,
    ADVANCED_CIRCUIT: 2,
    ADVANCED_CIRCUIT_230: 2,
    AGRICULTURAL_SCIENCE: 1,
    AUTOMATION_SCIENCE: 1,
    AUTOMATION_SCIENCE_BELTED_BUFFER: 1,
    BAD_ACCUMULATOR_CONFIG: 0,
    BIOCHAMBER_FUEL: 1,
    CHEMICAL_SCIENCE_SHARED_FOUNDRY: 4,
    ELECTRIC_FURNACE: 1,
    ELECTROMAGNETIC_SCIENCE: 2,
    ELECTROMAGNETIC_SCIENCE_AUTO: 2,
    FLYING_ROBOT_FRAME: 1,
    GLEBA_ROCKET_FUEL: 3,
    GLEBA_ROCKET_FUEL_JELLY_STACK_15: 3,
    IRON_BACTERIA_CULTIVATION: 4,
    JELLYNUT_PROCESSING_ROCKET_FUEL: 3,
    JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS: 3,
    LITHIUM_PLATES: 2,
    LOGISTIC_SCIENCE: 1,
    LOGISTIC_SCIENCE_DI: 2,
    LOGISTIC_SCIENCE_INSERTER_CRAFTING: 1,
    LOGISTIC_SCIENCE_SHARED_INSERTER: 1,
    LOW_DENSITY_STRUCTURE: 4,
    METALLURGIC_SCIENCE_PACK: 1,
    MILITARY_SCIENCE: 1,
    PROCESSING_UNITS: 1,
    PROCESSING_UNITS_BELT_EXPORT: 2,
    PRODUCTION_SCIENCE: 1,
    PRODUCTION_SCIENCE_JSON: 1,
    PRODUCTION_SCIENCE_SHARED: 1,
    PRODUCTION_SCIENCE_SHARED_JSON: 1,
    REAL_ATLAN_CELL29: 2,
    REAL_COMPOSITE04_CELL07: 2,
    REAL_OWNER_CAR: 2,
    REAL_OWNER_GRENADE: 4,
    REAL_OWNER_LITHIUM_SILO: 6,
    REAL_OWNER_ORE_VOIDER_EXACT_SPEED: 4,
    REAL_OWNER_ORE_VOIDER_OVERBEACONED: 4,
    REAL_OWNER_PINK_SCIENCE_ORIGINAL: 3,
    REAL_OWNER_PINK_SCIENCE_ORIGINAL_NO_BUFFERS: 3,
    REAL_OWNER_PINK_SCIENCE_RECYCLER: 3,
    REAL_OWNER_PRODUCTIVITY_CHAIN: 1,
    REAL_STUPIDFATHOBBIT_CELL02: 4,
    REAL_STUPIDFATHOBBIT_CELL06: 2,
    REAL_THAELN_CELL09: 8,
    RECYCLING_SCRAP_SILO: 13,
    SAMPLE_CONFIG: 1,
    STEEL_CARGO_WAGON: 1,
    STONE_BRICKS_DIRECT_INSERT: 1,
    STONE_BRICKS_DIRECT_INSERT_2_1: 1,
    UTILITY_SCIENCE: 1,
    UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS: 1,
    UTILITY_SCIENCE_DIRECT_INSERT_LDS_CHAIN_ALWAYS_ON: 2,
};

describe("the planner graph", () => {
    describe.each(Object.entries(ConfigPaths))("of %s", (key, file) => {
        it("holds its invariants, leaves uncovered the ports the coverage check reports, and comes out the same each time", async () => {
            const { config, facts, graph } = await graphOf(file);
            expect(graphInvariantIssues(facts, graph, portsOfCoverageIssues(coverageIssuesOf(config)))).toEqual([]);
            const json = graphSnapshotOf(graph, key);
            // deterministic: built again from the config read again, byte for byte the same
            expect(graphSnapshotOf((await graphOf(file)).graph, key)).toBe(json);
            // small: a few hundred nodes and edges at most (P3 1.6 item 9); the largest, Thaeln's cell 09, is 24 kB
            expect(json.length).toBeLessThan(64 * 1024);
        });

        it("finds the loops and the terminal edges of the paper check", async () => {
            const { graph } = await graphOf(file);
            expect(graph.components.map(component => component.members)).toEqual(LOOPS[key] ?? []);
            expect(graph.terminal.length).toBe(TERMINAL[key]);
        });
    });

    it("of the refusal sample leaves uncovered the accumulator's iron plate and its result, as the coverage check does", async () => {
        const { config, facts, graph } = await graphOf(ConfigPaths.BAD_ACCUMULATOR_CONFIG);
        const expected = [{ side: "input", at: "machine:1", item: "iron-plate" }, { side: "output", at: "machine:1", item: "accumulator" }];
        expect(uncoveredPortsOf(facts, graph)).toEqual(expected);
        expect(() => assertInserterCoverage(config)).toThrow(InserterCoverageError);
        expect(portsOfCoverageIssues(coverageIssuesOf(config))).toEqual(expected);
    });

    it("of processing units with a belt export (the brief's reference sample) is well under a megabyte of JSON", async () => {
        const { graph } = await graphOf(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT);
        const json = graphSnapshotOf(graph, "PROCESSING_UNITS_BELT_EXPORT");
        expect(json.length).toBeLessThan(64 * 1024);
        expect(graph.nodes.length + graph.edges.length).toBeLessThan(100);
    });

    it("keeps an expectation for every sample", () => {
        const keys = new Set(Object.keys(ConfigPaths));
        expect(Object.keys(LOOPS).filter(key => !keys.has(key))).toEqual([]);
        expect(Object.keys(TERMINAL).sort()).toEqual([...keys].sort());
    });
});
