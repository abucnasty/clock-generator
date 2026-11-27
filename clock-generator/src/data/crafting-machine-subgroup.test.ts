import { describe, expect, it } from "vitest";
import "./factorio-data-file";
import { FactorioDataService } from "./factorio-data-service";

/**
 * The subgroup the data holds for each crafting machine of Factorio 2.1.24: the prototype's own where it sets one, else
 * that of the item that places it (resources/filter-raw.js derives it). A table of the data as it stands, so a data
 * refresh that moves a machine to another subgroup shows here.
 */
const SUBGROUP_OF_MACHINE: Record<string, string> = {
    "assembling-machine-1": "production-machine",
    "assembling-machine-2": "production-machine",
    "assembling-machine-3": "production-machine",
    "centrifuge": "production-machine",
    "chemical-plant": "production-machine",
    "cryogenic-plant": "production-machine",
    "electromagnetic-plant": "production-machine",
    "oil-refinery": "production-machine",
    "electric-furnace": "smelting-machine",
    "steel-furnace": "smelting-machine",
    "stone-furnace": "smelting-machine",
    "foundry": "smelting-machine",
    "recycler": "smelting-machine",
    "biochamber": "agriculture",
    "captive-biter-spawner": "agriculture",
    "crusher": "space-platform",
};

describe("the subgroup of a crafting machine in the game data", () => {
    const machines = FactorioDataService.getAllCraftingMachines();

    it("holds the machines of the table, no more and no fewer", () => {
        expect(machines.map(machine => machine.name).sort()).toEqual(Object.keys(SUBGROUP_OF_MACHINE).sort());
    });

    it("gives every machine the subgroup of its row", () => {
        for (const machine of machines) {
            expect(typeof machine.subgroup, machine.name).toBe("string");
            expect(machine.subgroup, machine.name).not.toBe("");
            expect(machine.subgroup, machine.name).toBe(SUBGROUP_OF_MACHINE[machine.name]);
        }
    });
});
