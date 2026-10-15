import { describe, expect, it } from "vitest";
import { FactorioDataService } from "../../../data";
import {
    configuredHandSize,
    fullResearchHandSize,
    INSERTER_SPECS,
    inserterSpecFor,
    rotationTicks,
} from "./inserter-spec";

/**
 * The swing of every inserter prototype at every quality, chest to chest, as measured in the game by the lead on
 * 2026-10-15 (Factorio 2.1.21, harness; clock-generator/.scratch/geppetto/inserter-timing/chest.txt): ticks from the
 * pickup to the next pickup. The qualities in order: normal, uncommon, rare, epic, legendary. The bulk and the stack
 * inserter turn at the same speed as the fast one.
 */
const MEASURED_SWINGS: Record<string, number[]> = {
    "inserter": [70, 54, 44, 36, 28],
    "fast-inserter": [24, 18, 14, 12, 8],
    "long-handed-inserter": [48, 38, 30, 26, 18],
    "bulk-inserter": [24, 18, 14, 12, 8],
    "stack-inserter": [24, 18, 14, 12, 8],
};

const QUALITIES = ["normal", "uncommon", "rare", "epic", "legendary"];

/** The hand at full research, measured in the same run */
const MEASURED_HANDS: Record<string, number> = {
    "inserter": 4,
    "fast-inserter": 4,
    "long-handed-inserter": 4,
    "bulk-inserter": 12,
    "stack-inserter": 16,
};

describe("inserterSpecFor", () => {
    const combinations = Object.entries(MEASURED_SWINGS).flatMap(([prototype, swings]) =>
        swings.map((swing, level) => ({ prototype, quality: QUALITIES[level], swing }))
    );

    it("covers the 25 combinations that were measured", () => {
        expect(combinations).toHaveLength(25);
    });

    it.each(combinations)("swings a $prototype of $quality quality in $swing ticks, machine to machine", ({ prototype, quality, swing }) => {
        const spec = inserterSpecFor(prototype, quality);
        expect(spec.machine.pickup.ticks + spec.machine.drop.ticks + 2 * spec.rotation.ticks).toBe(swing);
    });

    it("turns the arm for ceil(0.5 / ω) - 2 ticks each way", () => {
        expect(rotationTicks("stack-inserter", "legendary")).toBe(3);
        expect(rotationTicks("stack-inserter", "rare")).toBe(6);
        expect(rotationTicks("fast-inserter", "normal")).toBe(11);
        expect(rotationTicks("inserter", "normal")).toBe(34);
        expect(rotationTicks("long-handed-inserter", "legendary")).toBe(8);
    });

    it("reproduces the legendary stack inserter that the timings were calibrated on", () => {
        expect(inserterSpecFor("stack-inserter", "legendary")).toEqual(INSERTER_SPECS["stack-inserter"].legendary);
    });

    it("keeps the belt pickup and drop of the legendary stack inserter for every prototype and quality", () => {
        for (const { prototype, quality } of combinations) {
            const spec = inserterSpecFor(prototype, quality);
            expect(spec.belt.pickup.ticks).toBe(4);
            expect(spec.belt.drop.ticks).toBe(4);
        }
    });

    it("refuses the burner inserter, which needs fuel", () => {
        expect(() => inserterSpecFor("burner-inserter", "normal")).toThrow("not supported: the burner inserter needs fuel");
    });

    it("refuses a name that is not an inserter of the game data, and a quality that is not one", () => {
        expect(() => inserterSpecFor("transport-belt", "normal")).toThrow("not an inserter of the game data");
        expect(() => inserterSpecFor("constructor", "normal")).toThrow("not an inserter of the game data");
        expect(() => inserterSpecFor("fast-inserter", "mythic")).toThrow("not a quality of the game data");
    });
});

describe("fullResearchHandSize", () => {
    it.each(Object.entries(MEASURED_HANDS))("is the measured hand of the %s", (prototype, hand) => {
        expect(fullResearchHandSize(prototype)).toBe(hand);
    });

    it("is 1, the prototype's bonus and the research total of its kind", () => {
        const research = FactorioDataService.inserterResearch();
        expect(research).toEqual({ inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11 });
        expect(1 + FactorioDataService.findInserterOrThrow("stack-inserter").stack_size_bonus! + research.bulk_inserter_capacity_bonus).toBe(16);
    });

    it("is refused for the burner inserter", () => {
        expect(() => fullResearchHandSize("burner-inserter")).toThrow("burner inserter needs fuel");
    });
});

describe("configuredHandSize", () => {
    it("is the stack size the config sets", () => {
        expect(configuredHandSize({ prototype: "fast-inserter", stack_size: 2 })).toBe(2);
    });

    it("is the full research hand of the prototype without one, and of the stack inserter without a prototype", () => {
        expect(configuredHandSize({ prototype: "fast-inserter" })).toBe(4);
        expect(configuredHandSize({ prototype: "bulk-inserter" })).toBe(12);
        expect(configuredHandSize({})).toBe(16);
    });
});
