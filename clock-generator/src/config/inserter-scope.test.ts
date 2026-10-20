import { describe, expect, it } from "vitest";
import { ConfigSchema, InserterConfigSchema } from "./schema";
import { Config } from "./index";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { validateConfig } from "../crafting/plan/validate-config";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { computeMachineTargetRates } from "../crafting/machine-target-rates";
import { Entity } from "../entities/entity";
import { insertersScopeProblem } from "./inserter-scope";
import { createInserterCoverageValidator, validateInserterCoverage } from "./inserter-coverage-validator";

const base = () => ({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16 },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16 },
    ],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }] }],
    chests: [{ id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true }],
});
/** The base build with the given fields set on its belt-fed inserter (1) or its machine-to-chest inserter (2) */
const withInserter = (id: 1 | 2, fields: object): Config => {
    const config = base();
    return ConfigSchema.parse({ ...config, inserters: config.inserters.map(inserter => inserter.id === id ? { ...inserter, ...fields } : inserter) });
};
/** A gear build fed from a chest, which has no belt pickup at all */
const chestFed = (fields: object): Config => ConfigSchema.parse({
    ...base(),
    inserters: [
        { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, ...fields },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: 16, ...fields },
    ],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }] }],
    chests: [{ id: 1, type: "infinity-chest", item_filter: [{ item_name: "iron-plate", request_count: 100 }] }],
});
const quiet = { log() {}, warn() {}, error() {}, debug() {} };

describe("a belt pickup by an inserter other than the legendary stack inserter", () => {
    it.each([
        { fields: { prototype: "fast-inserter", quality: "normal" }, kind: "a normal fast-inserter" },
        { fields: { prototype: "long-handed-inserter" }, kind: "a legendary long-handed-inserter" },
        { fields: { prototype: "bulk-inserter", quality: "legendary" }, kind: "a legendary bulk-inserter" },
        { fields: { prototype: "stack-inserter", quality: "rare" }, kind: "a rare stack-inserter" },
        { fields: { quality: "epic" }, kind: "an epic stack-inserter" },
        { fields: { prototype: "inserter", quality: "uncommon" }, kind: "an uncommon inserter" },
    ])("is refused with the reason before any check or simulation ($kind)", ({ fields, kind }) => {
        const config = withInserter(1, fields);
        const says = `Inserter 1: picking up from a belt with ${kind} is not supported yet: belt pickup timing is calibrated `
            + "on the legendary stack inserter only (follow-up F7)";
        expect(() => validateConfig(config)).toThrow(says);
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow(says);
        expect(() => computeMachineTargetRates(config)).toThrow(says);
        expect(() => SimulationContext.fromConfig(config)).toThrow(says);
    });

    it("names what still works and what to build instead", () => {
        expect(() => validateConfig(withInserter(1, { prototype: "fast-inserter" }))).toThrow(
            /Other kinds and qualities work on chests and machines; take from this belt with a legendary stack inserter$/);
    });

    it("is refused in a Sidecar capture, across save and reload", () => {
        let config = ConfigSchema.parse({ ...withInserter(1, { prototype: "long-handed-inserter", quality: "normal" }), sidecar_version: "0.11.0" });
        for (let reload = 0; reload < 3; reload++) {
            config = ConfigSchema.parse(JSON.parse(JSON.stringify(config)));
            expect(config.inserters[0]).toMatchObject({ prototype: "long-handed-inserter", quality: "normal" });
            expect(() => validateConfig(config)).toThrow("Inserter 1: picking up from a belt with a normal long-handed-inserter is not supported yet");
        }
    });

    it("is refused for the burner inserter and an unknown name for what they are, not for the belt", () => {
        expect(() => validateConfig(withInserter(1, { prototype: "burner-inserter" }))).toThrow("burner inserter needs fuel");
        expect(() => validateConfig(withInserter(1, { prototype: "assembling-machine-3" }))).toThrow("not an inserter of the game data");
    });

    it("is not refused for the legendary stack inserter, named or not", () => {
        for (const fields of [{}, { prototype: "stack-inserter" }, { quality: "legendary" }, { prototype: "stack-inserter", quality: "legendary" }]) {
            expect(() => validateConfig(withInserter(1, fields))).not.toThrow();
        }
    });
});

describe("another inserter kind or quality away from a belt pickup", () => {
    it.each([
        { prototype: "fast-inserter", quality: "normal" },
        { prototype: "long-handed-inserter", quality: "rare" },
        { prototype: "stack-inserter", quality: "rare" },
    ])("keeps working into a chest from a machine ($quality $prototype)", fields => {
        const config = withInserter(2, fields);
        expect(() => validateConfig(config)).not.toThrow();
        const [, output] = SimulationContext.fromConfig(config).entity_registry.getAll().filter(Entity.isInserter);
        expect(output.metadata).toMatchObject({ type: fields.prototype, quality: fields.quality });
    });

    it("keeps working from a chest and onto a belt", () => {
        expect(() => validateConfig(chestFed({ prototype: "bulk-inserter", quality: "normal" }))).not.toThrow();
    });
});

describe("filters that are a blacklist", () => {
    it("are kept by the schema, never stripped and read as the items to move", () => {
        const inserter = { source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, filters: ["iron-gear-wheel"], filter_mode: "blacklist" };
        expect(InserterConfigSchema.parse(inserter)).toMatchObject({ filter_mode: "blacklist", filters: ["iron-gear-wheel"] });
        expect(() => InserterConfigSchema.parse({ ...inserter, filter_mode: "greylist" })).toThrow();
    });

    it("are refused with the reason, on a belt pickup and anywhere else", () => {
        const says = (id: number) => `Inserter ${id}: \`filter_mode\` "blacklist" is refused: filters that are a blacklist, naming the items an inserter leaves, are out of scope`;
        const onBelt = withInserter(1, { filters: ["copper-plate"], filter_mode: "blacklist" });
        expect(() => validateConfig(onBelt)).toThrow(says(1));
        expect(() => SimulationContext.fromConfig(onBelt)).toThrow(says(1));
        const fromMachine = withInserter(2, { filters: ["iron-plate"], filter_mode: "blacklist" });
        expect(() => validateConfig(fromMachine)).toThrow(says(2));
        expect(() => generateClockAlternatives(fromMachine, { logger: quiet })).toThrow(says(2));
        expect(() => SimulationContext.fromConfig(fromMachine)).toThrow(says(2));
    });

    it("are refused across save and reload of a Sidecar capture", () => {
        let config = ConfigSchema.parse({ ...withInserter(2, { filters: ["iron-plate"], filter_mode: "blacklist" }), sidecar_version: "0.11.0" });
        for (let reload = 0; reload < 3; reload++) {
            config = ConfigSchema.parse(JSON.parse(JSON.stringify(config)));
            expect(() => validateConfig(config)).toThrow(/Inserter 2: `filter_mode` "blacklist" is refused/);
        }
    });

    it("are not refused when they name nothing, nor is a whitelist", () => {
        expect(() => validateConfig(withInserter(2, { filter_mode: "blacklist" }))).not.toThrow();
        expect(() => validateConfig(withInserter(2, { filter_mode: "blacklist", filters: [] }))).not.toThrow();
        expect(() => validateConfig(withInserter(2, { filter_mode: "whitelist", filters: ["iron-gear-wheel"] }))).not.toThrow();
    });
});

describe("the live check of what is out of scope", () => {
    it("names the first inserter that is out of scope, or none", () => {
        expect(insertersScopeProblem(withInserter(2, { filters: ["iron-plate"], filter_mode: "blacklist" })))
            .toMatch(/^Inserter 2: `filter_mode` "blacklist" is refused/);
        expect(insertersScopeProblem(withInserter(1, { prototype: "fast-inserter" })))
            .toMatch(/^Inserter 1: picking up from a belt with a legendary fast-inserter is not supported yet/);
        expect(insertersScopeProblem(withInserter(1, { prototype: "assembling-machine-3" }))).toMatch(/^Inserter 1: .*not an inserter of the game data/);
        expect(insertersScopeProblem(withInserter(2, { prototype: "fast-inserter", filters: ["iron-gear-wheel"] }))).toBeNull();
        expect(insertersScopeProblem(base() as unknown as Config)).toBeNull();
    });

    it("is what Check refuses with, word for word", () => {
        const config = withInserter(2, { filters: ["iron-plate"], filter_mode: "blacklist" });
        expect(() => validateConfig(config)).toThrow(insertersScopeProblem(config)!);
    });
});

describe("coverage of an inserter whose filters are a blacklist", () => {
    // the build a blacklist capture gives: the output inserter leaves iron plates, so it still takes the gears out
    const blacklisting = (items: string[]) => withInserter(2, { filters: items, filter_mode: "blacklist" });

    it("reads the filters as the items it leaves, never as the items it moves", () => {
        expect(validateInserterCoverage(blacklisting(["iron-plate"]))).toEqual([]);
        expect(createInserterCoverageValidator()(blacklisting(["iron-plate"]))).toEqual([]);
        // read as a whitelist, the same filters would leave the gears without an output inserter
        expect(validateInserterCoverage(withInserter(2, { filters: ["iron-plate"] }))).toMatchObject([{ kind: "missing_output_inserter", item_name: "iron-gear-wheel" }]);
    });

    it("misses the item it names, with its filters to review", () => {
        expect(validateInserterCoverage(blacklisting(["iron-gear-wheel"]))).toMatchObject([{
            kind: "missing_output_inserter", item_name: "iron-gear-wheel",
            fix_options: expect.arrayContaining([{ type: "review_filters", inserter_id: 2, item_name: "iron-gear-wheel" }]),
        }]);
    });

    it("is checked again in the live editor when only the filter mode changes", () => {
        const live = createInserterCoverageValidator();
        expect(live(withInserter(2, { filters: ["iron-plate"] }))).toHaveLength(1);
        expect(live(blacklisting(["iron-plate"]))).toEqual([]);
    });
});
