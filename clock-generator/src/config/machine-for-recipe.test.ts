import { describe, expect, it } from "vitest";
import { machineForRecipe, machineForRule } from "../entities/machine/machine-rule";

describe("the machine for a recipe", () => {
    const furnace = { name: "furnace-b", type: "furnace", crafting_categories: ["smelting"], burner_fuel_categories: [], crafting_speed: 2 };
    const burner = { name: "furnace-a", type: "furnace", crafting_categories: ["smelting"], burner_fuel_categories: ["chemical"], crafting_speed: 2 };
    const plant = { name: "plant", type: "assembling-machine", crafting_categories: ["chemistry"], burner_fuel_categories: [], crafting_speed: 1 };
    const cold = { name: "cold", type: "assembling-machine", crafting_categories: ["cryogenics"], burner_fuel_categories: [], crafting_speed: 2 };
    const slow = { ...plant, name: "slow", crafting_speed: 0.5 };

    it("follows the data, not the names: the highest base crafting speed, then no fuel, then the data's order", () => {
        expect(machineForRecipe(["smelting"], [burner, furnace])?.name).toBe("furnace-b");
        expect(machineForRecipe(["chemistry", "cryogenics"], [plant, cold])?.name).toBe("cold");
        expect(machineForRecipe(["chemistry"], [slow, plant])?.name).toBe("plant");
        expect(machineForRecipe(["chemistry"], [plant, { ...plant, name: "twin" }])?.name).toBe("plant");
        expect(machineForRecipe(["cryogenics"], [plant])).toBeUndefined();
        expect(machineForRule("furnace", ["chemistry"], [burner, furnace, plant])?.name).toBe("furnace-b");
        expect(machineForRule("machine", ["smelting"], [burner, furnace, plant])).toBeUndefined();
    });
});
