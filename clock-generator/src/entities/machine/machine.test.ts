import { expect, vi, test,describe } from 'vitest'
import { Machine } from './machine'
import { RecipeMetadata } from './recipe'
import { MachineMetadata } from './machine-metadata';
import { Ingredient } from '../../data/factorio-data-types';
import { fraction } from 'fractionability';
import { TICKS_PER_SECOND } from '../../data-types';


const createMachine = (recipeName: string, metadata: Partial<MachineMetadata> = {}): Machine => {
    const id = -1;
    return Machine.createMachine(id, {
        crafting_speed: 1,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName(recipeName),
        ...metadata,
        type: metadata.type ?? "machine",
    })
}

describe("Machine Entity", () => {
    test("creates a machine with the correct recipe metadata", () => {
        const machine = createMachine("iron-gear-wheel")
        expect(machine.metadata.recipe.name).toBe("iron-gear-wheel")
        
        const ingredients = machine.inputs.mapValues(input => input.ingredient)

        const expectedIngredients: Ingredient[] = [
            { type: "item", name: "iron-plate", amount: 2 }
        ]
        expect(ingredients.map(it => it.name)).toEqual(expectedIngredients.map(it => it.name))
        expect(ingredients.map(it => it.amount)).toEqual(expectedIngredients.map(it => it.amount))
    })

    test("throws an error for unknown recipe", () => {
        expect(() => createMachine("unknown-recipe")).toThrowError("Recipe unknown-recipe was not found")
    })

    test("set crafting speed and productivity", () => {
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 1,
            productivity: 100,
        })
        expect(machine.metadata.crafting_speed).toBe(1)
        expect(machine.metadata.productivity).toBe(100)
    })

    test("minimum overload multiplier is 2", () => {
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 0.0001,
        })
        expect(machine.overload_multiplier.overload_multiplier).toBe(2)
    })

    test("sets overload multiplier based on crafting speed", () => {
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 2,
        })
        expect(machine.overload_multiplier.overload_multiplier).toBe(6)
    })

    test("throws an error if crafting speed is 0 or negative", () => {
        expect(() => createMachine("iron-gear-wheel", { crafting_speed: 0 })).toThrow()
        expect(() => createMachine("iron-gear-wheel", { crafting_speed: -1 })).toThrow()
    })
})

describe("Machine Entity - Input Consumption Rates", () => {
    test("amount per craft is based on recipe ingredient amount", () => {
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 1,
        })
        const ironPlateInput = machine.inputs.get("iron-plate")
        expect(ironPlateInput).toBeDefined()
        expect(ironPlateInput!.consumption_rate.amount_per_craft).toBe(machine.metadata.recipe.inputsPerCraft.get("iron-plate")!.amount)
    })

    test("calculates consumption rates per ingredient", () => {
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 1,
        })
        const iron_plate_input = machine.inputs.get("iron-plate")
        expect(iron_plate_input).toBeDefined()
        const expected_rate_per_second = iron_plate_input!.ingredient.amount / machine.metadata.recipe.energy_required
        expect(iron_plate_input!.consumption_rate.rate_per_second).toStrictEqual(expected_rate_per_second)
        const expected_rate_per_tick = expected_rate_per_second / TICKS_PER_SECOND.toDecimal()
        expect(iron_plate_input!.consumption_rate.rate_per_tick).toStrictEqual(expected_rate_per_tick)
    })

    test("calculates consumption rates per ingredient based on crafting speed", () => {
        const crafting_speed = 30;
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: crafting_speed,
        })
        const iron_plate_input = machine.inputs.get("iron-plate")
        expect(iron_plate_input).toBeDefined()
        const expected_rate_per_second = (iron_plate_input!.ingredient.amount / machine.metadata.recipe.energy_required) * crafting_speed
        expect(iron_plate_input!.consumption_rate.rate_per_second).toStrictEqual(expected_rate_per_second)
        const expected_rate_per_tick = expected_rate_per_second / TICKS_PER_SECOND.toDecimal()
        expect(iron_plate_input!.consumption_rate.rate_per_tick).toStrictEqual(expected_rate_per_tick)
    })

    test("handles recipes with multiple ingredients", () => {
        const machine = createMachine("advanced-circuit", {
            crafting_speed: 1,
        })
        const ingredients = Array.from(machine.inputs.values()).map(input => input.ingredient.name)
        expect(ingredients).toContain("electronic-circuit")
        expect(ingredients).toContain("plastic-bar")
        expect(ingredients).toContain("copper-cable")

        const electronicCircuitInput = machine.inputs.get("electronic-circuit")
        expect(electronicCircuitInput).toBeDefined()
        const expectedElectronicCircuitRatePerSecond = electronicCircuitInput!.ingredient.amount / machine.metadata.recipe.energy_required
        expect(electronicCircuitInput!.consumption_rate.rate_per_second).toStrictEqual(expectedElectronicCircuitRatePerSecond)

        const plasticBarInput = machine.inputs.get("plastic-bar")
        expect(plasticBarInput).toBeDefined()
        const expectedPlasticBarRatePerSecond = plasticBarInput!.ingredient.amount / machine.metadata.recipe.energy_required
        expect(plasticBarInput!.consumption_rate.rate_per_second).toStrictEqual(expectedPlasticBarRatePerSecond)

        const copperCableInput = machine.inputs.get("copper-cable")
        expect(copperCableInput).toBeDefined()
        const expectedCopperCableRatePerSecond = copperCableInput!.ingredient.amount / machine.metadata.recipe.energy_required
        expect(copperCableInput!.consumption_rate.rate_per_second).toStrictEqual(expectedCopperCableRatePerSecond)
    })

    test("productivity does not affect input consumption rates", () => {
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 1,
            productivity: 50,
        })
        const ironPlateInput = machine.inputs.get("iron-plate")
        expect(ironPlateInput).toBeDefined()
        const expected_rate_per_second = ironPlateInput!.ingredient.amount / machine.metadata.recipe.energy_required
        expect(ironPlateInput!.consumption_rate.rate_per_second).toStrictEqual(expected_rate_per_second)
    })
})

describe("Machine Entity - Output Production Rates", () => {
    test("amount per craft is based on recipe output amount and productivity", () => {
        const productivity = 50;
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 1,
            productivity: productivity,
        })
        const output = machine.output;
        const baseAmount = machine.metadata.recipe.output.amount;
        const expectedAmountPerCraft = fraction(baseAmount).multiply(1 + productivity / 100);
        expect(output.amount_per_craft).toStrictEqual(expectedAmountPerCraft);
    })

    test("calculates production rates", () => {
        const productivity = 100;
        const machine = createMachine("iron-gear-wheel", {
            crafting_speed: 1,
            productivity: productivity,
        })
        const output = machine.output;
        const baseAmount = machine.metadata.recipe.output.amount;
        const expectedAmountPerCraft = Math.floor(baseAmount * (1 + productivity / 100));
        const expected_rate_per_second = fraction(expectedAmountPerCraft).divide(machine.metadata.recipe.energy_required)
        expect(output.production_rate.amount_per_second).toStrictEqual(expected_rate_per_second)
        const expected_rate_per_tick = expected_rate_per_second.divide(60)
        expect(output.production_rate.amount_per_tick).toStrictEqual(expected_rate_per_tick)
    })
})
describe("Biochamber", () => {
    test("reports nutrient consumption and output blocking like a machine", () => {
        const biochamber = createMachine("nutrients-from-yumako-mash", { type: "biochamber", crafting_speed: 2, energy_consumption_bonus: 50 })
        expect(biochamber.nutrient_consumption?.rate_per_second).toBeCloseTo(0.1875)
        // 4s recipe at speed 2 = 2s per craft
        expect(biochamber.nutrient_consumption?.amount_per_craft).toBeCloseTo(0.375)
        expect(Machine.getMachineFacts(biochamber).nutrients?.energy_consumption_bonus).toBe(50)
        expect(biochamber.output.outputBlock.quantity).toBeGreaterThan(0)
    })

    test("non-biochamber machines have no nutrient consumption", () => {
        expect(createMachine("iron-gear-wheel").nutrient_consumption).toBeUndefined()
    })
})
