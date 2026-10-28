import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { FactorioDataService } from "../../data/factorio-data-service";
import { machineCanMake, machineRuleOfPrototype } from "./machine-rule";
import { MachineType } from "./machine-type";

// The rule of every crafting machine of 2.1.21, from its data: names are only the test's
describe("the simulation rule of a crafting machine prototype", () => {
    const ruleOf = (name: string) => machineRuleOfPrototype(FactorioDataService.findCraftingMachine(name)!);

    it("is the furnace rule for the furnace prototypes, the recycler too", () => {
        for (const name of ["stone-furnace", "steel-furnace", "electric-furnace", "recycler"]) {
            expect(ruleOf(name), name).toBe(MachineType.FURNACE);
        }
    });

    it("is the biochamber rule for a burner that is no furnace: on nutrients or on food", () => {
        for (const name of ["biochamber", "captive-biter-spawner"]) {
            expect(ruleOf(name), name).toBe(MachineType.BIOCHAMBER);
        }
    });

    it("is the crafting rule for any other crafting machine", () => {
        for (const name of ["assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "oil-refinery", "chemical-plant",
            "centrifuge", "crusher", "foundry", "electromagnetic-plant", "cryogenic-plant"]) {
            expect(ruleOf(name), name).toBe(MachineType.MACHINE);
        }
    });

    it("covers every crafting machine of the data, and the data holds no rocket silo or character among them", () => {
        const names = FactorioDataService.getAllCraftingMachines().map(machine => machine.name);
        expect(names).toHaveLength(16);
        expect(names).not.toContain("rocket-silo");
        expect(names).not.toContain("character");
    });

    it("follows the data, not the name: a furnace prototype of any name is a furnace, any other burner a biochamber", () => {
        expect(machineRuleOfPrototype({ type: "furnace", crafting_categories: ["smelting"], burner_fuel_categories: ["nutrients"] })).toBe(MachineType.FURNACE);
        expect(machineRuleOfPrototype({ type: "assembling-machine", crafting_categories: [], burner_fuel_categories: ["chemical", "nutrients"] })).toBe(MachineType.BIOCHAMBER);
        expect(machineRuleOfPrototype({ type: "assembling-machine", crafting_categories: [], burner_fuel_categories: ["chemical"] })).toBe(MachineType.BIOCHAMBER);
        expect(machineRuleOfPrototype({ type: "assembling-machine", crafting_categories: [], burner_fuel_categories: [] })).toBe(MachineType.MACHINE);
    });
});

describe("the recipes a crafting machine can make", () => {
    const can = (machine: string, recipe: string) =>
        machineCanMake(FactorioDataService.findCraftingMachine(machine)!, FactorioDataService.findRecipe(recipe)!.categories);

    it("are those of its crafting categories, as in the game", () => {
        expect(can("cryogenic-plant", "lithium-plate")).toBe(false);
        expect(can("cryogenic-plant", "lithium")).toBe(true);
        expect(can("electric-furnace", "lithium-plate")).toBe(true);
        expect(can("assembling-machine-1", "electronic-circuit")).toBe(true);
        expect(can("electromagnetic-plant", "electronic-circuit")).toBe(true);
        expect(can("recycler", "iron-gear-wheel-recycling")).toBe(true);
        expect(can("recycler", "iron-gear-wheel")).toBe(false);
    });
});
