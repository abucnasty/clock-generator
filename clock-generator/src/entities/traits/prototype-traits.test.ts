import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { Config, ConfigSchema } from "../../config/schema";
import { FactorioDataService } from "../../data/factorio-data-service";
import { machineRuleOfPrototype, placesResultsItself } from "../machine/machine-rule";
import { MachineType } from "../machine/machine-type";
import { buildTraits, MachineTraits } from "./build-traits";
import { prototypeTraitsOf } from "./prototype-traits";

// What the UI's machine editor asks of a prototype (its Energy trait's fuel and its Placement trait), over every crafting
// machine of the game data: names are only the test's
describe("the traits of a crafting machine prototype", () => {
    const prototypes = FactorioDataService.getAllCraftingMachines();

    it("cover the 16 crafting machines of the game data", () => {
        expect(prototypes).toHaveLength(16);
    });

    // the editor's tests before it read traits: the biochamber rule, and the machines that have a place for their results
    it("equal what the editor read before: the biochamber rule for the fuel, `vector_to_place_result` for the placement", () => {
        for (const prototype of prototypes) {
            expect(prototypeTraitsOf(prototype), prototype.name).toEqual({
                fuel_modelled: machineRuleOfPrototype(prototype) === MachineType.BIOCHAMBER,
                places_results: placesResultsItself(prototype),
            });
        }
    });

    it("equal the Energy trait's `fuel_modelled` and the Placement trait that the engine builds for a machine of the prototype", () => {
        // one machine of each prototype on one recipe: a machine that cannot make its recipe is only warned about
        const machines = prototypes.map((prototype, index) => ({ id: index + 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0, prototype: prototype.name }));
        const traits = buildTraits(ConfigSchema.parse({
            target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 }, machines, belts: [], inserters: [],
        }) as Config);
        prototypes.forEach((prototype, index) => {
            const built = traits[`machine:${index + 1}`] as MachineTraits;
            expect(prototypeTraitsOf(prototype), prototype.name).toEqual({ fuel_modelled: built.energy.fuel_modelled, places_results: built.placement !== null });
        });
    });

    it("name the biochamber for its fuel and the recycler for its placement, and no other machine", () => {
        expect(prototypes.filter(prototype => prototypeTraitsOf(prototype).fuel_modelled).map(prototype => prototype.name)).toEqual(["biochamber"]);
        expect(prototypes.filter(prototype => prototypeTraitsOf(prototype).places_results).map(prototype => prototype.name)).toEqual(["recycler"]);
    });

    it("follow the data, not the name, from the fields the editor's machine picker carries", () => {
        const carried = { crafting_categories: [], crafting_speed: 1 };
        expect(prototypeTraitsOf({ ...carried, type: "assembling-machine", burner_fuel_categories: ["chemical", "nutrients"] })).toEqual({ fuel_modelled: true, places_results: false });
        expect(prototypeTraitsOf({ ...carried, type: "furnace", burner_fuel_categories: ["nutrients"], vector_to_place_result: [0, -2] })).toEqual({ fuel_modelled: false, places_results: true });
        expect(prototypeTraitsOf({ ...carried, type: "assembling-machine", burner_fuel_categories: [] })).toEqual({ fuel_modelled: false, places_results: false });
    });
});
