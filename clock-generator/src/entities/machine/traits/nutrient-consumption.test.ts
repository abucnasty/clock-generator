import { describe, expect, it } from "vitest";
import { NutrientConsumption } from "./nutrient-consumption";

describe("NutrientConsumption", () => {
    it("burns 0.125 nutrients/s at 500kW with 4MJ nutrients", () => {
        const c = NutrientConsumption.fromCraftingSpeed(2, 4);
        expect(c.rate_per_second).toBeCloseTo(0.125);
        expect(c.rate_per_tick).toBeCloseTo(0.125 / 60);
        // 4s recipe at speed 2 = 2s per craft
        expect(c.amount_per_craft).toBeCloseTo(0.25);
    });

    it("scales with the energy consumption bonus", () => {
        const c = NutrientConsumption.fromCraftingSpeed(2, 4, 50);
        expect(c.rate_per_second).toBeCloseTo(0.1875);
    });

    it("clamps the consumption bonus at -80%", () => {
        const c = NutrientConsumption.fromCraftingSpeed(2, 4, -95);
        expect(c.rate_per_second).toBeCloseTo(0.025);
    });
});
