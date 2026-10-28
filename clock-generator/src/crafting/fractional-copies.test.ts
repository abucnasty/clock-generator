import { beforeAll, describe, expect, it } from "vitest";
import { TargetProductionRateConfigSchema, type Config } from "../config/schema";
import { FactorioDataService } from "../data";
import { fraction } from "../data-types/fraction";
import { CopiesError } from "../config/errors";
import { validateCopies } from "../config/copies-validator";
import { generateClockAlternatives, generateClockForConfig } from "./generate-blueprint";
import { TargetProductionRate } from "./target-production-rate";
import { quiet } from "./generate-blueprint-test-helpers";

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

const target = (copies: number) => ({ recipe: "iron-gear-wheel", items_per_second: 240, copies });

/** The per-copy rate of a target of 240 a second, as the exact fraction it is stored in */
const perCopy = (copies: number) => TargetProductionRate.fromConfig(target(copies)).machine_production_rate.amount_per_second;

describe("copies in the target output schema", () => {
    const parse = (copies: number) => TargetProductionRateConfigSchema.safeParse(target(copies));

    it("accepts a whole number and a short decimal", () => {
        expect(parse(1).success).toBe(true);
        expect(parse(5.5).success).toBe(true);
        expect(parse(2.25).success).toBe(true);
    });

    it("refuses zero, a negative number, an infinite one and NaN", () => {
        for (const copies of [0, -1, Infinity, NaN]) {
            expect(parse(copies).success, `copies ${copies}`).toBe(false);
        }
    });

    it("refuses a number that is not a short decimal, such as a third, and says what is accepted", () => {
        const result = parse(1 / 3);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe("copies must be a whole number or a short decimal such as 5.5");
        expect(parse(0.001).success).toBe(true);
        expect(parse(0.0001).success).toBe(false);
    });
});

describe("the rate of one copy", () => {
    it("is the target divided by a fractional number of copies, as an exact fraction", () => {
        const two_and_a_half = perCopy(2.5);
        expect([two_and_a_half.getNumerator, two_and_a_half.getDenominator]).toEqual([96, 1]);
        const five_and_a_half = perCopy(5.5);
        expect([five_and_a_half.getNumerator, five_and_a_half.getDenominator]).toEqual([480, 11]);
        expect(five_and_a_half.multiply(fraction(5.5)).toString()).toBe("240");
    });

    it("keeps today's numbers for a whole number of copies", () => {
        const four = perCopy(4);
        expect([four.getNumerator, four.getDenominator]).toEqual([60, 1]);
        const one = TargetProductionRate.fromConfig(target(1));
        expect(one.machine_production_rate.amount_per_second.toString()).toBe("240");
        expect(one.copies).toBe(1);
    });
});

describe("the copies validator with a fractional number of copies", () => {
    const gear = (id: number) => ({ id, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 });
    const lane = (ingredient: string) => ({ type: "transport-belt", lanes: [{ ingredient, stack_size: 1 }] });
    /** Two identical machines, each fed from belt 1 and dropping on belt 2 */
    const twoUnits = (copies: number): Config => ({
        target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies },
        machines: [gear(1), gear(2)],
        inserters: [1, 2].flatMap(id => [
            { source: { type: "belt", id: 1 }, sink: { type: "machine", id }, stack_size: 1 },
            { source: { type: "machine", id }, sink: { type: "belt", id: 2 }, stack_size: 1 },
        ]),
        belts: [{ id: 1, ...lane("iron-plate") }, { id: 2, ...lane("iron-gear-wheel") }],
    } as unknown as Config);

    it("tells to set the copies to the exact product, 11 for 5.5 copies of two units", () => {
        expect(() => validateCopies(twoUnits(5.5))).toThrow(CopiesError);
        try {
            validateCopies(twoUnits(5.5));
        } catch (error) {
            expect((error as Error).message).toContain("set target_output.copies to 11 (now 5.5, times 2).");
            expect((error as CopiesError).configured_copies).toBe(5.5);
        }
        expect(() => validateCopies(twoUnits(0.1))).toThrow("set target_output.copies to 0.2 (now 0.1, times 2).");
    });

    it("does not refuse a config of one unit with 5.5 copies", () => {
        const config = twoUnits(5.5);
        const one_unit = { ...config, machines: [gear(1)], inserters: config.inserters.slice(0, 2) };
        expect(() => validateCopies(one_unit)).not.toThrow();
    });
});

describe("a clock for a fractional number of copies", () => {
    const build = (copies: number, items_per_second: number): Config => ({
        target_output: { recipe: "iron-gear-wheel", items_per_second, copies },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 1, filters: ["iron-plate"] },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 1, filters: ["iron-gear-wheel"] },
        ],
        belts: [
            { id: 1, type: "transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 1 }] },
            { id: 2, type: "transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 1 }] },
        ],
    } as unknown as Config);

    for (const [copies, items_per_second] of [[5.5, 5.5], [2.25, 2.25], [2, 2]]) {
        it(`reports the target over all of ${copies} copies for the first clock and the one selected`, () => {
            const { alternatives, selected_index } = generateClockAlternatives(build(copies, items_per_second), { logger: quiet });
            expect(alternatives[0].assessment.items_per_second).toBeCloseTo(items_per_second, 9);
            expect(alternatives[selected_index].assessment.items_per_second).toBeCloseTo(items_per_second, 9);
        });
    }

    it("names the fractional number of copies and the rate of one in the blueprint", () => {
        const { blueprint } = generateClockForConfig(build(5.5, 11), { logger: quiet });
        expect(blueprint.description?.split("\n")[0]).toBe("Target: 11 [item=iron-gear-wheel] per second over 5.5 copies (2 each)");
    });
});
