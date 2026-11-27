import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResearch, researchDifferences } from "./apply-research";
import type { ResearchBase, ResearchBonuses, ResearchBuild, ResearchChoice } from "./apply-research";
import type { FactorioData } from "../data/factorio-data-types";
import { fullResearchHandSize } from "../entities/inserter/metadata/inserter-spec";

// the game data is read from the file, and never written by hand: its type gains sections as the data does
const DATA = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../resources/data-filtered.json"), "utf8")) as FactorioData;

const NO_BONUSES: ResearchBonuses = {
    mining_drill_productivity_bonus: 0,
    inserter_stack_size_bonus: 0,
    bulk_inserter_capacity_bonus: 0,
    belt_stack_size_bonus: 0,
    recipes: {},
};
const choiceOf = (change: Partial<ResearchBonuses> = {}, profile = "P"): ResearchChoice =>
    ({ profile, template: null, bonuses: { ...NO_BONUSES, ...change } });
const NO_BASE: ResearchBase = { machines: [], drills: [], silos: [], inserters: [], belts: [] };
const baseOf = (rows: Partial<ResearchBase>): ResearchBase => ({ ...NO_BASE, ...rows });

type Row = Record<string, unknown>;
const build = (parts: { machines?: Row[]; drills?: Row[]; inserters?: Row[]; belts?: Row[]; chests?: Row[] }): ResearchBuild =>
    ({
        machines: parts.machines ?? [],
        ...(parts.drills && { drills: { configs: parts.drills } }),
        inserters: parts.inserters ?? [],
        belts: parts.belts ?? [],
        ...(parts.chests && { chests: parts.chests }),
    }) as unknown as ResearchBuild;

const machine = (id: number, recipe: string, productivity = 0): Row => ({ id, recipe, productivity, crafting_speed: 1 });
const drill = (id: number, type = "big-mining-drill", productivity = 0): Row =>
    ({ id, type, mined_item_name: "iron-ore", speed_bonus: 0, productivity, target: { type: "chest", id: 1 } });
const silo = (id: number, productivity?: number): Row => ({ type: "rocket-silo", id, ...(productivity !== undefined && { productivity }) });
const chest = (id: number): Row => ({ type: "buffer-chest", id, storage_size: 1, item_filter: "iron-plate" });
const inserter = (id: number | undefined, prototype?: string, stack_size?: number): Row => ({
    ...(id !== undefined && { id }),
    source: { type: "machine", id: 1 },
    sink: { type: "machine", id: 2 },
    ...(prototype !== undefined && { prototype }),
    ...(stack_size !== undefined && { stack_size }),
});
const belt = (id: number, stacks: [number] | [number, number] = [4, 4]): Row =>
    ({ id, type: "turbo-transport-belt", lanes: stacks.map(stack_size => ({ ingredient: "iron-plate", stack_size })) });

const machinesOf = (result: { build: ResearchBuild }) => result.build.machines as unknown as Row[];
const drillsOf = (result: { build: ResearchBuild }) => (result.build.drills as unknown as { configs: Row[] }).configs;
const chestsOf = (result: { build: ResearchBuild }) => result.build.chests as unknown as Row[];
const insertersOf = (result: { build: ResearchBuild }) => result.build.inserters as unknown as Row[];
const beltsOf = (result: { build: ResearchBuild }) => result.build.belts as unknown as Row[];

const within = (actual: unknown, expected: number) => expect(Math.abs((actual as number) - expected)).toBeLessThan(1e-6);

describe("the fixture rows", () => {
    // nine reads of a game save: a row that is read in full gives the research exactly, a row at the cap gives a lower bound on it
    const DRILLS: [string, string, number, number][] = [
        ["a big mining drill", "big-mining-drill", 79990, 79990.00000001134],
        ["a second big mining drill", "big-mining-drill", 79990, 79990.00000001134],
        ["an electric mining drill", "electric-mining-drill", 80010, 80010.00000001132],
    ];
    it.each(DRILLS)("gives the read of %s", (_name, type, bonus, read) => {
        const result = applyResearch(build({ drills: [drill(1, type)] }), baseOf({ drills: [{ id: 1, productivity: 0 }] }),
            choiceOf({ mining_drill_productivity_bonus: bonus }), DATA);
        within(drillsOf(result)[0].productivity, read);
    });

    it("gives the read of a silo that makes rocket parts", () => {
        const result = applyResearch(build({ chests: [silo(1)] }), baseOf({ silos: [{ id: 1, recipe: "rocket-part", productivity: 0 }] }),
            choiceOf({ recipes: { "rocket-part": { productivity_bonus: 10 } } }), DATA);
        within(chestsOf(result)[0].productivity, 10);
    });

    const BOUNDS: [string, string, number, number][] = [
        ["a furnace of steel plate", "steel-plate", 0, 300],
        ["a foundry of low density structure", "casting-low-density-structure", 50, 250],
        ["a second foundry of low density structure", "casting-low-density-structure", 50, 250],
        ["a cryogenic plant of plastic bars", "plastic-bar", 0, 300],
        ["a second cryogenic plant of plastic bars", "plastic-bar", 0, 300],
    ];
    it.each(BOUNDS)("gives 300 for %s, with research at the lower bound and at 1000", (_name, recipe, base, lowest) => {
        for (const research of [lowest, 1000]) {
            const result = applyResearch(build({ machines: [machine(1, recipe)] }), baseOf({ machines: [{ id: 1, recipe, productivity: base }] }),
                choiceOf({ recipes: { [recipe]: { productivity_bonus: research } } }), DATA);
            within(machinesOf(result)[0].productivity, 300);
        }
    });
});

describe("a crafting machine below the cap", () => {
    it("adds the research to its base: 50 and 100 give 150", () => {
        const result = applyResearch(build({ machines: [machine(1, "iron-gear-wheel", 50)] }),
            baseOf({ machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 50 }] }),
            choiceOf({ recipes: { "iron-gear-wheel": { productivity_bonus: 100 } } }), DATA);
        within(machinesOf(result)[0].productivity, 150);
    });

    it("writes the base for a recipe that the choice does not name, and caps a recipe at its maximum from the data", () => {
        const plain = applyResearch(build({ machines: [machine(1, "iron-gear-wheel", 99)] }),
            baseOf({ machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 20 }] }), choiceOf(), DATA);
        expect(machinesOf(plain)[0].productivity).toBe(20);

        const capped: FactorioData = { ...DATA, recipe: { ...DATA.recipe, "iron-gear-wheel": { ...DATA.recipe["iron-gear-wheel"], maximum_productivity: 2 } } };
        const result = applyResearch(build({ machines: [machine(1, "iron-gear-wheel")] }),
            baseOf({ machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 50 }] }),
            choiceOf({ recipes: { "iron-gear-wheel": { productivity_bonus: 250 } } }), capped);
        expect(machinesOf(result)[0].productivity).toBe(200);
    });

    it("writes 0 over the build's own value where the base and the research are both 0", () => {
        const result = applyResearch(build({ machines: [machine(1, "iron-gear-wheel", 5)] }),
            baseOf({ machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0 }] }),
            choiceOf({ recipes: { "iron-gear-wheel": { productivity_bonus: 0 } } }), DATA);
        expect(machinesOf(result)[0].productivity).toBe(0);
    });
});

describe("the hand of an inserter", () => {
    const PROTOTYPES = ["stack-inserter", "bulk-inserter", "fast-inserter", "long-handed-inserter", "inserter"];
    const hands = (bonuses: Partial<ResearchBonuses>) => {
        const result = applyResearch(build({ inserters: PROTOTYPES.map((prototype, index) => inserter(index + 1, prototype)) }),
            baseOf({ inserters: PROTOTYPES.map((_prototype, index) => ({ id: index + 1 })) }), choiceOf(bonuses), DATA);
        return insertersOf(result).map(row => row.stack_size);
    };

    it("is what the game gives a save with all the finite research, and what the engine reads for it", () => {
        expect(hands({ inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11 })).toEqual([16, 12, 4, 4, 4]);
        expect(PROTOTYPES.map(fullResearchHandSize)).toEqual([16, 12, 4, 4, 4]);
    });

    it("is 5, 1, 1, 1, 1 with no research", () => {
        expect(hands({})).toEqual([5, 1, 1, 1, 1]);
    });

    it("is the stack inserter's where the build names no prototype", () => {
        const result = applyResearch(build({ inserters: [inserter(1)] }), baseOf({ inserters: [{ id: 1 }] }),
            choiceOf({ bulk_inserter_capacity_bonus: 11 }), DATA);
        expect(insertersOf(result)[0].stack_size).toBe(16);
    });

    it("follows the prototype that the inserter has now", () => {
        const base = baseOf({ inserters: [{ id: 1 }] });
        const choice = choiceOf({ inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11 });
        expect(insertersOf(applyResearch(build({ inserters: [inserter(1, "fast-inserter")] }), base, choice, DATA))[0].stack_size).toBe(4);
        expect(insertersOf(applyResearch(build({ inserters: [inserter(1, "bulk-inserter")] }), base, choice, DATA))[0].stack_size).toBe(12);
    });
});

describe("a belt lane", () => {
    it.each([[0, 1], [3, 4], [4, 4]])("holds %s more in a stack: %s items", (bonus, stack) => {
        const result = applyResearch(build({ belts: [belt(1, [2, 3])] }), baseOf({ belts: [{ id: 1 }] }), choiceOf({ belt_stack_size_bonus: bonus }), DATA);
        expect((beltsOf(result)[0].lanes as Row[]).map(lane => lane.stack_size)).toEqual([stack, stack]);
    });

    it("keeps a belt of one lane at one lane", () => {
        const result = applyResearch(build({ belts: [belt(1, [2])] }), baseOf({ belts: [{ id: 1 }] }), choiceOf({ belt_stack_size_bonus: 2 }), DATA);
        expect((beltsOf(result)[0].lanes as Row[]).map(lane => lane.stack_size)).toEqual([3]);
    });
});

describe("a row that is kept", () => {
    const choice = choiceOf({
        mining_drill_productivity_bonus: 20, inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3,
        recipes: { "iron-gear-wheel": { productivity_bonus: 10 }, "rocket-part": { productivity_bonus: 10 } },
    });

    it("keeps the override that the base states for an inserter", () => {
        const result = applyResearch(build({ inserters: [inserter(1, "stack-inserter", 3)] }), baseOf({ inserters: [{ id: 1, stack_size: 3 }] }), choice, DATA);
        expect(insertersOf(result)[0].stack_size).toBe(3);
    });

    it("leaves a row whose id is not in the base", () => {
        const source = build({ machines: [machine(7, "iron-gear-wheel", 33)], drills: [drill(8, "big-mining-drill", 44)], inserters: [inserter(9, "fast-inserter", 2)], belts: [belt(10, [2, 2])], chests: [silo(11, 5)] });
        const result = applyResearch(source, NO_BASE, choice, DATA);
        expect(result.build).toEqual(source);
    });

    it("leaves an inserter that has no id", () => {
        const source = build({ inserters: [inserter(undefined, "fast-inserter", 2)] });
        const result = applyResearch(source, baseOf({ inserters: [{ id: 1 }] }), choice, DATA);
        expect(result.build).toEqual(source);
    });

    it("leaves a machine whose recipe is not its base row's", () => {
        const source = build({ machines: [machine(1, "copper-cable", 33)] });
        const result = applyResearch(source, baseOf({ machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0 }] }), choice, DATA);
        expect(result.build).toEqual(source);
    });

    it("leaves a machine and a silo whose recipe is not in the data", () => {
        const source = build({ machines: [machine(1, "no-such-recipe", 33)], chests: [silo(2, 5)] });
        const result = applyResearch(source, baseOf({
            machines: [{ id: 1, recipe: "no-such-recipe", productivity: 0 }],
            silos: [{ id: 2, recipe: "no-such-recipe", productivity: 0 }],
        }), choice, DATA);
        expect(result.build).toEqual(source);
    });

    it("leaves an inserter whose prototype is not in the data", () => {
        const source = build({ inserters: [inserter(1, "no-such-inserter", 2)] });
        const result = applyResearch(source, baseOf({ inserters: [{ id: 1 }] }), choice, DATA);
        expect(result.build).toEqual(source);
    });

    it("writes a silo whose base row's recipe is rocket-part, and never touches another chest", () => {
        const result = applyResearch(build({ chests: [chest(1), silo(2)] }), baseOf({ silos: [{ id: 2, recipe: "rocket-part", productivity: 0 }] }), choice, DATA);
        expect(chestsOf(result)[0]).toEqual(chest(1));
        expect(chestsOf(result)[1].productivity).toBe(10);
        const same = applyResearch(build({ chests: [chest(1)] }), baseOf({ silos: [{ id: 1, recipe: "rocket-part", productivity: 0 }] }), choice, DATA);
        expect(chestsOf(same)[0]).toEqual(chest(1));
    });

    it("keeps every other key of the build", () => {
        const source = { ...build({ machines: [machine(1, "iron-gear-wheel")] }), setpoint: { item: "iron-gear-wheel" }, overrides: { copies: 2 } };
        const result = applyResearch(source, baseOf({ machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0 }] }), choice, DATA);
        expect(result.build.setpoint).toEqual({ item: "iron-gear-wheel" });
        expect(result.build.overrides).toEqual({ copies: 2 });
        expect("drills" in result.build).toBe(false);
        expect("chests" in result.build).toBe(false);
    });
});

describe("the block that applyResearch returns", () => {
    it("is the choice with the base", () => {
        const base = baseOf({ belts: [{ id: 1 }] });
        const choice = choiceOf({ belt_stack_size_bonus: 1 }, "My game");
        expect(applyResearch(build({ belts: [belt(1)] }), base, choice, DATA).block).toEqual({ ...choice, base });
    });

    it("lets a switch work without the blueprint: P1 then P2 equals P2 alone", () => {
        const source = build({
            machines: [machine(1, "iron-gear-wheel", 50)], drills: [drill(2)], inserters: [inserter(3, "bulk-inserter"), inserter(4, "stack-inserter", 6)],
            belts: [belt(5, [1, 1])], chests: [silo(6)],
        });
        const base = baseOf({
            machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 50 }], drills: [{ id: 2, productivity: 0 }], silos: [{ id: 6, recipe: "rocket-part", productivity: 0 }],
            inserters: [{ id: 3 }, { id: 4, stack_size: 6 }], belts: [{ id: 5 }],
        });
        const first = choiceOf({ mining_drill_productivity_bonus: 20, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3, recipes: { "iron-gear-wheel": { productivity_bonus: 40 } } }, "P1");
        const second = choiceOf({ mining_drill_productivity_bonus: 5, bulk_inserter_capacity_bonus: 2, belt_stack_size_bonus: 0, recipes: { "rocket-part": { productivity_bonus: 7 } } }, "P2");
        const viaFirst = applyResearch(applyResearch(source, base, first, DATA).build, applyResearch(source, base, first, DATA).block.base, second, DATA);
        expect(viaFirst).toEqual(applyResearch(source, base, second, DATA));
    });

    it("does not change its input", () => {
        const source = build({ machines: [machine(1, "iron-gear-wheel", 50)], drills: [drill(2)], inserters: [inserter(3, "bulk-inserter")], belts: [belt(5, [1, 1])], chests: [silo(6)] });
        const before = structuredClone(source);
        const base = baseOf({
            machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 50 }], drills: [{ id: 2, productivity: 0 }], silos: [{ id: 6, recipe: "rocket-part", productivity: 0 }],
            inserters: [{ id: 3 }], belts: [{ id: 5 }],
        });
        const baseBefore = structuredClone(base);
        const choice = choiceOf({ mining_drill_productivity_bonus: 20, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3 });
        const result = applyResearch(source, base, choice, DATA);
        expect(source).toEqual(before);
        expect(base).toEqual(baseBefore);
        expect(result.build).not.toEqual(before);
    });
});

describe("researchDifferences", () => {
    const source = build({
        machines: [machine(1, "iron-gear-wheel", 50)], drills: [drill(2)], inserters: [inserter(3, "bulk-inserter"), inserter(4, "stack-inserter", 6)],
        belts: [belt(5, [1, 1])], chests: [chest(7), silo(6)],
    });
    const base = baseOf({
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 50 }], drills: [{ id: 2, productivity: 0 }], silos: [{ id: 6, recipe: "rocket-part", productivity: 0 }],
        inserters: [{ id: 3 }, { id: 4, stack_size: 6 }], belts: [{ id: 5 }],
    });
    const choice = choiceOf({ mining_drill_productivity_bonus: 20, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3, recipes: { "iron-gear-wheel": { productivity_bonus: 40 } } });
    const applied = applyResearch(source, base, choice, DATA);
    const config = { ...applied.build, research: applied.block };
    const edit = (change: (copy: { machines: Row[]; drills: { configs: Row[] }; inserters: Row[]; belts: Row[]; chests: Row[] }) => void) => {
        const copy = structuredClone(config) as unknown as Parameters<typeof change>[0];
        change(copy);
        return researchDifferences(copy as unknown as typeof config, DATA);
    };

    it("says that nothing is recorded for a config with no block", () => {
        expect(researchDifferences(applied.build, DATA)).toEqual({ recorded: false });
    });

    it("finds nothing edited right after applyResearch", () => {
        expect(researchDifferences(config, DATA)).toEqual({ recorded: true, edited: [], outside: [] });
    });

    it("lists a changed machine productivity, a changed hand and a changed lane", () => {
        const result = edit(copy => {
            copy.machines[0].productivity = 120;
            copy.inserters[0].stack_size = 5;
            (copy.belts[0].lanes as Row[])[1].stack_size = 2;
        });
        expect(result).toEqual({
            recorded: true,
            outside: [],
            edited: [
                { kind: "machine", id: 1, expected: 90, actual: 120 },
                { kind: "inserter", id: 3, expected: 12, actual: 5 },
                { kind: "lane", id: 5, lane: 2, expected: 4, actual: 2 },
            ],
        });
    });

    it("lists a changed drill and a changed silo, and reads an absent silo productivity as 0", () => {
        expect(edit(copy => {
            copy.drills.configs[0].productivity = 7;
            copy.chests[1].productivity = 5;
        })).toEqual({
            recorded: true,
            outside: [],
            edited: [{ kind: "drill", id: 2, expected: 20, actual: 7 }, { kind: "silo", id: 6, expected: 0, actual: 5 }],
        });
        expect(edit(copy => { delete copy.chests[1].productivity; })).toEqual({ recorded: true, edited: [], outside: [] });
    });

    it("reads an absent hand as what all the research gives", () => {
        const result = edit(copy => { delete copy.inserters[0].stack_size; });
        expect(result).toMatchObject({ recorded: true, edited: [] });
        const smaller = researchDifferences({ ...config, research: { ...applied.block, bonuses: { ...applied.block.bonuses, bulk_inserter_capacity_bonus: 2 } } }, DATA);
        expect(smaller).toMatchObject({ edited: expect.arrayContaining([{ kind: "inserter", id: 3, expected: 3, actual: 12 }]) });
    });

    it("sends an added row, a renumbered row and an inserter with no id to outside, and a chest not", () => {
        const result = edit(copy => {
            copy.machines.push(machine(8, "iron-gear-wheel", 5));
            copy.belts[0].id = 9;
            copy.inserters.push(inserter(undefined, "fast-inserter", 2));
            copy.chests.push(chest(10));
        });
        expect(result).toEqual({
            recorded: true,
            edited: [],
            outside: [
                { kind: "machine", id: 8, reason: "its id is not in the base" },
                { kind: "inserter", reason: "it is an inserter with no id" },
                { kind: "belt", id: 9, reason: "its id is not in the base" },
            ],
        });
    });

    it("names a machine whose recipe changed, and a machine and an inserter that the data does not know", () => {
        const result = edit(copy => {
            copy.machines[0].recipe = "copper-cable";
            copy.inserters[1].prototype = "no-such-inserter";
        });
        expect(result).toEqual({
            recorded: true,
            edited: [],
            outside: [
                { kind: "machine", id: 1, reason: "its recipe differs from its base row" },
                { kind: "inserter", id: 4, reason: "its prototype is not in the data" },
            ],
        });
    });

    it("does not count 79990.00000001134 against 79990 as an edit", () => {
        const drillBuild = build({ drills: [drill(1)] });
        const drillBase = baseOf({ drills: [{ id: 1, productivity: 0 }] });
        const drillChoice = choiceOf({ mining_drill_productivity_bonus: 79990 });
        const made = applyResearch(drillBuild, drillBase, drillChoice, DATA);
        const read = structuredClone(made.build) as unknown as { drills: { configs: Row[] } };
        read.drills.configs[0].productivity = 79990.00000001134;
        expect(researchDifferences({ ...(read as unknown as ResearchBuild), research: made.block }, DATA)).toMatchObject({ edited: [] });
        read.drills.configs[0].productivity = 79990.01;
        expect(researchDifferences({ ...(read as unknown as ResearchBuild), research: made.block }, DATA)).toMatchObject({ edited: [{ kind: "drill", id: 1 }] });
    });
});
