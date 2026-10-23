import { describe, expect, it } from "vitest";
import "../data/factorio-data-file";
import { machineForRecipe, machineForRule } from "../entities/machine/machine-rule";
import { parseConfig } from "./loader";
import { migrateMachineType, migrateMachineTypes } from "./migrate-machine-type";
import { MachineConfigurationSchema } from "./schema";

const machine = (fields: Record<string, unknown>) => ({ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, ...fields });

describe("a machine's former type", () => {
    it("becomes the machine of that rule that makes the recipe, by the recipe's own category first, then one burning no fuel", () => {
        const prototypeOf = (type: string, recipe: string) =>
            (migrateMachineType(machine({ type, recipe })) as { prototype?: string }).prototype;
        // the 2.1.21 data's choices; names are only the test's
        expect(prototypeOf("furnace", "iron-plate")).toBe("electric-furnace");
        expect(prototypeOf("furnace", "iron-plate-recycling")).toBe("recycler");
        expect(prototypeOf("biochamber", "nutrients-from-bioflux")).toBe("biochamber");
        expect(prototypeOf("machine", "iron-gear-wheel")).toBe("assembling-machine-1");
        expect(prototypeOf("machine", "processing-unit")).toBe("assembling-machine-2");
        expect(prototypeOf("machine", "plastic-bar")).toBe("chemical-plant");
        expect(prototypeOf("machine", "lithium")).toBe("chemical-plant");
        expect(prototypeOf("machine", "casting-iron")).toBe("foundry");
        expect(prototypeOf("machine", "electromagnetic-science-pack")).toBe("electromagnetic-plant");
        expect(prototypeOf("machine", "jellynut-processing")).toBe("assembling-machine-1");
    });

    it("keeps its rule where no machine of it makes the recipe: a furnace or biochamber still gets one, a crafting machine none", () => {
        expect(migrateMachineType(machine({ type: "furnace", recipe: "iron-gear-wheel" }))).toEqual(machine({ prototype: "electric-furnace", recipe: "iron-gear-wheel" }));
        expect(migrateMachineType(machine({ type: "biochamber", recipe: "iron-gear-wheel" }))).toEqual(machine({ prototype: "biochamber", recipe: "iron-gear-wheel" }));
        expect(migrateMachineType(machine({ type: "machine", recipe: "iron-plate" }))).toEqual(machine({}));
        expect(migrateMachineType(machine({ type: "machine", recipe: "no-such-recipe" }))).toEqual(machine({ recipe: "no-such-recipe" }));
    });

    it("is dropped beside a prototype, which decides; a machine without either is left as it is", () => {
        expect(migrateMachineType(machine({ type: "machine", prototype: "electric-furnace" }))).toEqual(machine({ prototype: "electric-furnace" }));
        expect(migrateMachineType(machine({ type: undefined }))).toEqual(machine({}));
        expect(migrateMachineType(machine({}))).toEqual(machine({}));
    });

    it("keeps the other fields of a row, the form's own too", () => {
        expect(migrateMachineTypes({ machines: [{ ...machine({ type: "furnace" }), _uuid: "a" }], belts: [] }))
            .toEqual({ machines: [{ ...machine({ prototype: "electric-furnace" }), _uuid: "a" }], belts: [] });
    });

    it("is read by the schema, and one that is no rule is refused as before", async () => {
        expect(MachineConfigurationSchema.parse(machine({ type: "furnace" }))).toEqual(machine({ prototype: "electric-furnace" }));
        const config = (type: string) => JSON.stringify({ target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 },
            machines: [machine({ type })], inserters: [], belts: [] });
        await expect(parseConfig(config("something"))).rejects.toThrow("expected one of \"machine\"|\"furnace\"|\"biochamber\"");
        await expect(parseConfig(config("recycler"))).rejects.toThrow("\"recycler\" is not supported yet");
    });
});

describe("the machine for a recipe", () => {
    const furnace = { name: "furnace-b", type: "furnace", crafting_categories: ["smelting"], burner_fuel_categories: [] };
    const burner = { name: "furnace-a", type: "furnace", crafting_categories: ["smelting"], burner_fuel_categories: ["chemical"] };
    const plant = { name: "plant", type: "assembling-machine", crafting_categories: ["chemistry"], burner_fuel_categories: [] };
    const cold = { name: "cold", type: "assembling-machine", crafting_categories: ["cryogenics"], burner_fuel_categories: [] };

    it("follows the data, not the names: own category, then no fuel, then the data's order", () => {
        expect(machineForRecipe(["smelting"], [burner, furnace])?.name).toBe("furnace-b");
        expect(machineForRecipe(["chemistry", "cryogenics"], [cold, plant])?.name).toBe("plant");
        expect(machineForRecipe(["cryogenics"], [plant])).toBeUndefined();
        expect(machineForRule("furnace", ["chemistry"], [burner, furnace, plant])?.name).toBe("furnace-b");
        expect(machineForRule("machine", ["smelting"], [burner, furnace, plant])).toBeUndefined();
    });
});
