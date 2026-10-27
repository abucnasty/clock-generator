import path from "path";
import { describe, expect, it } from "vitest";
import "../data/factorio-data-file";
import { machineForRecipe, machineForRule } from "../entities/machine/machine-rule";
import { loadConfigFromFile, parseConfig } from "./loader";
import { migrateMachineType, migrateMachineTypes } from "./migrate-machine-type";
import { MachineConfigurationSchema } from "./schema";

const machine = (fields: Record<string, unknown>) => ({ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, ...fields });

describe("a machine's former type", () => {
    it("becomes the machine of that rule that makes the recipe with the highest base crafting speed, then one burning no fuel", () => {
        const prototypeOf = (type: string, recipe: string) =>
            (migrateMachineType(machine({ type, recipe })) as { prototype?: string }).prototype;
        // the 2.1.21 data's choices; names are only the test's
        expect(prototypeOf("furnace", "iron-plate")).toBe("electric-furnace");
        expect(prototypeOf("furnace", "iron-plate-recycling")).toBe("recycler");
        expect(prototypeOf("biochamber", "nutrients-from-bioflux")).toBe("biochamber");
        expect(prototypeOf("machine", "iron-gear-wheel")).toBe("assembling-machine-3");
        expect(prototypeOf("machine", "processing-unit")).toBe("electromagnetic-plant");
        expect(prototypeOf("machine", "electronic-circuit")).toBe("electromagnetic-plant");
        expect(prototypeOf("machine", "plastic-bar")).toBe("cryogenic-plant");
        expect(prototypeOf("machine", "lithium")).toBe("cryogenic-plant");
        expect(prototypeOf("machine", "sulfuric-acid")).toBe("cryogenic-plant");
        expect(prototypeOf("machine", "advanced-oil-processing")).toBe("oil-refinery");
        expect(prototypeOf("machine", "casting-iron")).toBe("foundry");
        expect(prototypeOf("machine", "electromagnetic-science-pack")).toBe("electromagnetic-plant");
        expect(prototypeOf("machine", "jellynut-processing")).toBe("assembling-machine-3");
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
        // a recycler is a machine named by its prototype, as any other: no rule is called so
        await expect(parseConfig(config("recycler"))).rejects.toThrow("expected one of \"machine\"|\"furnace\"|\"biochamber\"");
    });

    it("is read from the legacy fixture: each rule's machine, none for a crafting machine none of which makes the recipe", async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "fixtures/legacy/machine-type.json"));
        expect(config.machines.map(machine => [machine.id, machine.prototype])).toEqual([
            [1, "electric-furnace"], [2, "assembling-machine-3"], [3, "biochamber"], [4, undefined], [5, "cryogenic-plant"]]);
        expect(config.machines.some(machine => "type" in machine)).toBe(false);
    });
});

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
