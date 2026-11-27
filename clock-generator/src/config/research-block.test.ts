import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { ConfigPaths } from "./config-paths";
import { ResearchBlockSchema } from "./research-block";
import type { ResearchBlock } from "./research-block";

const BLOCK: ResearchBlock = {
    profile: "My game",
    template: "all-finite-research",
    bonuses: {
        mining_drill_productivity_bonus: 79990,
        inserter_stack_size_bonus: 3,
        bulk_inserter_capacity_bonus: 11,
        belt_stack_size_bonus: 3,
        recipes: { "rocket-part": { productivity_bonus: 10 }, "steel-plate": { productivity_bonus: 0 } },
    },
    base: {
        machines: [{ id: 1, recipe: "steel-plate", productivity: 50 }],
        drills: [{ id: 2, productivity: 0 }],
        silos: [{ id: 3, recipe: "rocket-part", productivity: 0 }],
        inserters: [{ id: 4 }, { id: 5, stack_size: 2 }],
        belts: [{ id: 6 }],
    },
};

const sample = () => JSON.parse(readFileSync(ConfigPaths.AUTOMATION_SCIENCE_240, "utf8"));
const refused = (change: (block: ResearchBlock) => void): boolean => {
    const block = structuredClone(BLOCK);
    change(block);
    return !ResearchBlockSchema.safeParse(block).success;
};

describe("the research block of a config", () => {
    it("is optional: a config without it parses and is written back without a research key", () => {
        const parsed = ConfigSchema.parse(sample());
        expect("research" in parsed).toBe(false);
        expect("research" in JSON.parse(JSON.stringify(parsed))).toBe(false);
    });

    it("is read as it is stated, and a config that has it round-trips equal", () => {
        const parsed = ConfigSchema.parse({ ...sample(), research: BLOCK });
        expect(parsed.research).toEqual(BLOCK);
        const again = ConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
        expect(again.research).toEqual(BLOCK);
        expect(ResearchBlockSchema.parse(BLOCK)).toEqual(BLOCK);
    });

    it("is read with no template", () => {
        expect(ResearchBlockSchema.safeParse({ ...BLOCK, template: null }).success).toBe(true);
    });

    it("refuses a productivity that is below 0 or not finite", () => {
        expect(refused(block => { block.bonuses.mining_drill_productivity_bonus = -1; })).toBe(true);
        expect(refused(block => { block.bonuses.mining_drill_productivity_bonus = Number.POSITIVE_INFINITY; })).toBe(true);
        expect(refused(block => { block.bonuses.recipes["rocket-part"].productivity_bonus = -0.5; })).toBe(true);
        expect(refused(block => { block.bonuses.recipes["rocket-part"].productivity_bonus = Number.NaN; })).toBe(true);
        expect(refused(block => { block.base.machines[0].productivity = -1; })).toBe(true);
        expect(refused(block => { block.base.drills[0].productivity = Number.POSITIVE_INFINITY; })).toBe(true);
        expect(refused(block => { block.base.silos[0].productivity = -1; })).toBe(true);
    });

    it("refuses a stack bonus that is not whole or is below 0, and a bulk bonus above 254", () => {
        expect(refused(block => { block.bonuses.inserter_stack_size_bonus = 1.5; })).toBe(true);
        expect(refused(block => { block.bonuses.inserter_stack_size_bonus = -1; })).toBe(true);
        expect(refused(block => { block.bonuses.bulk_inserter_capacity_bonus = 2.5; })).toBe(true);
        expect(refused(block => { block.bonuses.bulk_inserter_capacity_bonus = -1; })).toBe(true);
        expect(refused(block => { block.bonuses.bulk_inserter_capacity_bonus = 255; })).toBe(true);
        expect(refused(block => { block.bonuses.belt_stack_size_bonus = 0.5; })).toBe(true);
        expect(refused(block => { block.bonuses.belt_stack_size_bonus = -1; })).toBe(true);
        expect(refused(block => { block.bonuses.bulk_inserter_capacity_bonus = 254; })).toBe(false);
    });

    it("refuses an unknown template and an empty or overlong profile name", () => {
        expect(refused(block => { (block as { template: unknown }).template = "some-research"; })).toBe(true);
        expect(refused(block => { block.profile = ""; })).toBe(true);
        expect(refused(block => { block.profile = "x".repeat(61); })).toBe(true);
        expect(refused(block => { block.profile = "x".repeat(60); })).toBe(false);
    });

    it("refuses a base id that is not a positive integer", () => {
        expect(refused(block => { block.base.machines[0].id = 0; })).toBe(true);
        expect(refused(block => { block.base.drills[0].id = 1.5; })).toBe(true);
        expect(refused(block => { block.base.silos[0].id = -2; })).toBe(true);
        expect(refused(block => { block.base.inserters[0].id = 0; })).toBe(true);
        expect(refused(block => { block.base.belts[0].id = Number.NaN; })).toBe(true);
    });

    it("keeps a belt bonus above 3", () => {
        const block = structuredClone(BLOCK);
        block.bonuses.belt_stack_size_bonus = 7;
        expect(ResearchBlockSchema.parse(block).bonuses.belt_stack_size_bonus).toBe(7);
    });
});
