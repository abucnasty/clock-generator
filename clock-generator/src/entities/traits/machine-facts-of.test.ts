import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { Entity } from "../entity";
import { buildTraits, MachineTraits } from "./build-traits";
import { computeMachineFacts, machineFactsOf, machineFactsOfEntity } from "./machine-facts-of";

describe("the machine facts of the traits", () => {
    // an entity keeps the fields of its configuration that its traits are built from: its facts, and those of a machine configured
    // with its parameters, are the facts of the traits built from the config
    it("are the facts of the entity and of the parameters it was configured with, for every machine of every sample", async () => {
        let machines = 0;
        for (const [key, file] of Object.entries(ConfigPaths)) {
            const config = await loadConfigFromFile(file) as Config;
            const traits = buildTraits(config);
            for (const machine of SimulationContext.fromConfig(config).entity_registry.getAll().filter(Entity.isMachine)) {
                const facts = machineFactsOf(traits[machine.entity_id.id] as MachineTraits);
                expect(machineFactsOfEntity(machine), `${key} ${machine.entity_id.id}`).toStrictEqual(facts);
                expect(computeMachineFacts(config.machines.find(it => it.id === machine.entity_id.number)!), `${key} ${machine.entity_id.id}`).toStrictEqual(facts);
                machines += 1;
            }
        }
        expect(machines).toBeGreaterThan(100);
    });

    // the facts these machines had while they were read from the entity's own figures, recorded before the traits made them
    it("are, for a furnace, a biochamber and a recycler, what the entity's figures gave", () => {
        expect(computeMachineFacts({ recipe: "iron-plate", productivity: 0, crafting_speed: 2, prototype: "electric-furnace" })).toEqual({
            recipe: "iron-plate", crafting_speed: 2, productivity: 0, type: "furnace",
            outputs: [{ item_name: "iron-plate", amount_per_craft: 1, rate_per_second: 0.625, rate_ratio: { numerator: 5, denominator: 8 }, output_block_size: 100, stochastic: false }],
            output_item: "iron-plate", output_per_craft: 1, output_rate_per_second: 0.625, output_rate_ratio: { numerator: 5, denominator: 8 }, output_block_size: 100,
            overload_multiplier: 2, ticks_per_craft: 96, ticks_per_bonus_craft: 0, insertion_duration_ticks: 192,
            inputs: [{ item_name: "iron-ore", consumption_rate_per_second: 0.625, automated_insertion_limit: 2, amount_per_craft: 1 }],
        });
        expect(computeMachineFacts({ recipe: "nutrients-from-yumako-mash", productivity: 0, crafting_speed: 2, prototype: "biochamber", energy_consumption_bonus: 50 })).toEqual({
            recipe: "nutrients-from-yumako-mash", crafting_speed: 2, productivity: 0, type: "biochamber",
            outputs: [{ item_name: "nutrients", amount_per_craft: 6, rate_per_second: 3, rate_ratio: { numerator: 3, denominator: 1 }, output_block_size: 12, stochastic: false }],
            output_item: "nutrients", output_per_craft: 6, output_rate_per_second: 3, output_rate_ratio: { numerator: 3, denominator: 1 }, output_block_size: 12,
            overload_multiplier: 2, ticks_per_craft: 120, ticks_per_bonus_craft: 0, insertion_duration_ticks: 40,
            inputs: [{ item_name: "yumako-mash", consumption_rate_per_second: 2, automated_insertion_limit: 8, amount_per_craft: 4 }],
            fuel: { item_name: "nutrients", energy_consumption_bonus: 50, consumption_rate_per_second: 0.375, amount_per_craft: 0.75 },
        });
        expect(computeMachineFacts({ recipe: "iron-gear-wheel-recycling", productivity: 0, crafting_speed: 0.5, prototype: "recycler" })).toEqual({
            recipe: "iron-gear-wheel-recycling", crafting_speed: 0.5, productivity: 0, type: "furnace",
            outputs: [{ item_name: "iron-plate", amount_per_craft: 0.5, rate_per_second: 8, rate_ratio: { numerator: 8, denominator: 1 }, output_block_size: 100, stochastic: true }],
            output_item: "iron-plate", output_per_craft: 0.5, output_rate_per_second: 8, output_rate_ratio: { numerator: 8, denominator: 1 }, output_block_size: 100,
            overload_multiplier: 20, ticks_per_craft: 3.75, ticks_per_bonus_craft: 0, insertion_duration_ticks: 150,
            inputs: [{ item_name: "iron-gear-wheel", consumption_rate_per_second: 16, automated_insertion_limit: 20, amount_per_craft: 1 }],
        });
    });

    it("are the crafting rule's for a machine that names no prototype, or one the game data does not hold", () => {
        const facts = (prototype?: string) => computeMachineFacts({ recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1, prototype });
        expect(facts().type).toBe("machine");
        expect(facts("modded-machine")).toEqual(facts());
    });

    it("are refused as building the machine is: an unknown recipe, a speed of zero, a fuel its burner does not burn", () => {
        expect(() => computeMachineFacts({ recipe: "unknown-recipe", productivity: 0, crafting_speed: 1 })).toThrowError("Recipe unknown-recipe was not found");
        expect(() => computeMachineFacts({ recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 0 })).toThrow();
        expect(() => computeMachineFacts({ recipe: "nutrients-from-yumako-mash", productivity: 0, crafting_speed: 1, prototype: "biochamber", fuel: "wood" }))
            .toThrowError("Unsupported fuel wood; accepted fuels: nutrients");
    });
});
