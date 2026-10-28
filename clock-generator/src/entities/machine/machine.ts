import Fraction, { fraction } from "../../data-types/fraction"
import { MachineConfiguration } from "../../config";
import { machinePlacesResults, machineRuleOf } from "../../config/machine-prototype";
import { AutomatedInsertionLimit, ConsumptionRate } from "./input";
import { BurnerEnergySource, FuelSlot } from "./fuel";
import { MachineMetadata } from "./machine-metadata";
import { MachineOutput, OutputBlock, OverloadMultiplier, ProductionRate } from "./output";
import { RecipeMetadata, expectedAmount, amountIgnoredByProductivity, isStochastic } from "./recipe";
import { EnrichedIngredient, Ingredient } from "../../data";
import { BonusProductivityRate, CraftingRate, InsertionDuration, FuelConsumption } from "./traits";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { Percentage, SerializableMachineFacts, SerializableMachineInput } from "../../data-types";
import { MachineInputs } from "./input/machine-inputs";
import { MachineInput } from "./input/machine-input";
import { defaultLogger, Logger } from "../../common/logger";


export class Machine implements Entity {

    public static fromConfig = fromConfig
    public static createMachine = createMachine
    public static printMachineFacts = printMachineFacts
    public static getMachineFacts = getMachineFacts
    public static computeMachineFacts = computeMachineFacts

    constructor(
        public readonly entity_id: EntityId,
        public readonly metadata: MachineMetadata,
        public readonly overload_multiplier: OverloadMultiplier,
        public readonly inputs: MachineInputs,
        public readonly output: MachineOutput,
        /** The main product first, then the by-products */
        public readonly outputs: readonly MachineOutput[],
        public readonly crafting_rate: CraftingRate,
        public readonly bonus_productivity_rate: BonusProductivityRate,
        public readonly insertion_duration: InsertionDuration,
        public readonly fuel_consumption?: FuelConsumption,
        public readonly fuel_slot?: FuelSlot,
        /**
         * The machine or container a machine that places its results itself puts them into: the one at its result spot (the
         * config's `result_target`). Without it such a machine keeps them in its output, as any other machine does.
         */
        public readonly result_target?: EntityId,
    ) {
        const loop = recipeLoopOf(
            outputs.map(it => ({ item_name: it.item_name, amount_per_craft: it.amount_per_craft.toDecimal() })),
            it => inputs.get(it)?.ingredient.amount,
        );
        this.self_ingredients = loop.self_ingredients;
        this.looping_ingredients = loop.looping_ingredients;
    }

    /** Ingredients the recipe also makes, like the pentapod egg: the machine keeps those it is given apart from those it makes */
    public readonly self_ingredients: ReadonlySet<string>;

    /**
     * The ingredients the recipe makes at least as much of as a craft uses (the pentapod egg): a loop that cannot start
     * from nothing, so its machines are seeded with them. Recycled ore comes back at a quarter of what a craft uses, from
     * ore brought in from outside: no loop to seed.
     */
    public readonly looping_ingredients: ReadonlySet<string>;

    /** The input an inserter fills for an item: the ingredient, or the fuel a burner machine burns */
    public getInsertableInput(item_name: string): MachineInput | undefined {
        const ingredient = this.inputs.get(item_name);
        if (ingredient || this.fuel_slot?.fuel.item_name !== item_name) {
            return ingredient;
        }
        return this.fuel_input;
    }

    /** True when an inserter carrying exactly these items only fills this machine's fuel slot */
    public isFuelOnly(item_names: ReadonlySet<string>): boolean {
        const fuel_item = this.fuel_slot?.fuel.item_name;
        return fuel_item !== undefined && item_names.size > 0
            && Array.from(item_names).every(it => it === fuel_item && !this.inputs.has(it));
    }

    /** Every input an inserter can fill: the ingredients, and the fuel of a burner machine */
    public getInsertableInputs(): MachineInput[] {
        const fuel_input = this.fuel_input;
        // a fuel that is also an ingredient is one input, which fills the fuel slot along the way
        return fuel_input && !this.inputs.has(fuel_input.item_name)
            ? [...this.inputs.values(), fuel_input]
            : Array.from(this.inputs.values());
    }

    public getInsertableInputOrThrow(item_name: string): MachineInput {
        const input = this.getInsertableInput(item_name);
        if (!input) {
            throw new Error(`${this} has no input for ${item_name}`);
        }
        return input;
    }

    private get fuel_input(): MachineInput | undefined {
        const slot = this.fuel_slot;
        const consumption = this.fuel_consumption;
        if (!slot || !consumption) {
            return undefined;
        }
        return {
            item_name: slot.fuel.item_name,
            consumption_rate: {
                item: slot.fuel.item_name,
                rate_per_second: consumption.rate_per_second,
                rate_per_tick: consumption.rate_per_tick,
                amount_per_craft: consumption.amount_per_craft,
            },
            automated_insertion_limit: { quantity: slot.automated_insertion_limit, item: slot.fuel.item_name },
            ingredient: { type: "item", name: slot.fuel.item_name, amount: consumption.amount_per_craft },
        };
    }

    public toString(): string {
        return `Machine(${this.entity_id.id}, recipe=${this.metadata.recipe.name})`;
    }
}

function fromConfig(config: MachineConfiguration): Machine {
    return createMachine(config.id, {
        recipe: RecipeMetadata.fromRecipeName(config.recipe),
        productivity: config.productivity,
        crafting_speed: config.crafting_speed,
        type: machineRuleOf(config),
        energy_consumption_bonus: config.energy_consumption_bonus,
        fuel: config.fuel,
        ...(config.prototype !== undefined ? { prototype: config.prototype } : {}),
        ...(machinePlacesResults(config) ? { places_results: true } : {}),
    }, config.result_target === undefined ? undefined : config.result_target.type === "machine" ? EntityId.forMachine(config.result_target.id) : EntityId.forChest(config.result_target.id));
}

function createMachine(
    id: number,
    metadata: MachineMetadata,
    result_target?: EntityId,
): Machine {
    const recipe = metadata.recipe;
    const overload_multiplier = OverloadMultiplier.fromCraftingSpeed(metadata.crafting_speed, recipe.energy_required)

    const machineInputs = new MachineInputs(
        recipe.raw.ingredients.map(ingredient => [ingredient.name, machineInputOf(ingredient, metadata.crafting_speed, recipe.energy_required, overload_multiplier)])
    );

    const craftingRate = machineCraftingRate(recipe, metadata.crafting_speed);
    const { amount_per_craft, production_rate } = mainProductOf(recipe, craftingRate, metadata.productivity);

    const machineOutput: MachineOutput = {
        item_name: recipe.output.name,
        amount_per_craft,
        production_rate,
        ingredient: recipe.output,
        outputBlock: OutputBlock.fromRecipe(metadata.type, recipe, overload_multiplier)
    };

    const byProducts = recipe.outputs.slice(1).map(result =>
        createByProductOutput(result, craftingRate.crafts_per_tick, metadata.productivity)
    );

    

    const insertionDurationPeriod = InsertionDuration.create(machineOutput.production_rate, overload_multiplier)

    const bonusProductivityRate = BonusProductivityRate.fromCraftingRate(craftingRate, new Percentage(metadata.productivity));
    return new Machine(
        EntityId.forMachine(id),
        metadata,
        overload_multiplier,
        machineInputs,
        machineOutput,
        [machineOutput, ...byProducts],
        craftingRate,
        bonusProductivityRate,
        insertionDurationPeriod,
        ...fuelOf(metadata),
        result_target,
    );
}

/**
 * The ingredients a recipe also makes (Machine.self_ingredients), and those of them it makes at least as much of a craft
 * as a craft uses (Machine.looping_ingredients), from its results' amounts a craft and the amount a craft takes of each
 * ingredient (undefined for an item it does not take)
 */
export function recipeLoopOf(
    outputs: readonly { readonly item_name: string; readonly amount_per_craft: number }[],
    ingredientAmountOf: (item_name: string) => number | undefined,
): { self_ingredients: ReadonlySet<string>; looping_ingredients: ReadonlySet<string> } {
    const self_ingredients = new Set(outputs.map(it => it.item_name).filter(it => ingredientAmountOf(it) !== undefined));
    const looping_ingredients = new Set(outputs
        .filter(it => self_ingredients.has(it.item_name) && it.amount_per_craft >= ingredientAmountOf(it.item_name)!)
        .map(it => it.item_name));
    return { self_ingredients, looping_ingredients };
}

/** An ingredient of a machine: what it takes of it a second at its speed, and its automated insertion limit */
export function machineInputOf(ingredient: Ingredient, crafting_speed: number, energy_required: number, overload_multiplier: OverloadMultiplier): MachineInput {
    return {
        item_name: ingredient.name,
        consumption_rate: ConsumptionRate.fromCraftingSpeed(
            ingredient.name,
            crafting_speed,
            energy_required,
            ingredient.amount
        ),
        automated_insertion_limit: AutomatedInsertionLimit.fromIngredient(ingredient, overload_multiplier),
        ingredient: ingredient
    };
}

/** The crafting rate of a machine on the recipe at its speed */
export function machineCraftingRate(recipe: RecipeMetadata, crafting_speed: number): CraftingRate {
    // a main product that comes by chance (recycled iron ore comes back at 0.25 a craft) is made at its expected amount
    const output_per_craft = expectedAmount(recipe.output);
    return CraftingRate.fromCraftingSpeed(
        fraction(output_per_craft),
        crafting_speed,
        recipe.energy_required
    );
}

/**
 * What a craft makes of a result with productivity: productivity multiplies its expected amount except for the part
 * the recipe ignores for it (1 of the 2 pentapod eggs)
 */
export function amountPerCraftOf(result: Ingredient, productivity: number): Fraction {
    const ignored_by_productivity = amountIgnoredByProductivity(result);
    return fraction(expectedAmount(result) - ignored_by_productivity)
        .multiply(fraction(1).add(fraction(productivity).divide(100)))
        .add(fraction(ignored_by_productivity));
}

/** The main product's amount per craft with productivity, and the rate a machine makes it at on its crafting rate */
export function mainProductOf(recipe: RecipeMetadata, crafting_rate: CraftingRate, productivity: number): { amount_per_craft: Fraction; production_rate: ProductionRate } {
    const amount_per_craft = amountPerCraftOf(recipe.output, productivity);
    return {
        amount_per_craft,
        production_rate: amountIgnoredByProductivity(recipe.output) === 0
            ? ProductionRate.fromCraftingRate(recipe.output.name, crafting_rate, new Percentage(productivity))
            : ProductionRate.perTick(recipe.output.name, amount_per_craft.multiply(fraction(crafting_rate.crafts_per_tick))),
    };
}

/**
 * A by-product's amount per craft and rate: its expected amount per craft, a probable result counted by its
 * probability, which productivity multiplies except for the part of the amount the recipe ignores for productivity
 */
export function byProductOf(result: Ingredient, crafts_per_tick: number, productivity: number): { amount_per_craft: Fraction; production_rate: ProductionRate } {
    const amount_per_craft = amountPerCraftOf(result, productivity);
    return {
        amount_per_craft,
        production_rate: ProductionRate.perTick(result.name, amount_per_craft.multiply(fraction(crafts_per_tick))),
    };
}

/** The fuel consumption and fuel slot of a burner, or neither */
function fuelOf(metadata: MachineMetadata): [FuelConsumption | undefined, FuelSlot | undefined] {
    const [consumption, slot] = createFuel(metadata);
    return [consumption, slot];
}

/** A by-product's output: its amount and rate as byProductOf gives them, blocked once its stack is full */
function createByProductOutput(result: EnrichedIngredient, crafts_per_tick: number, productivity: number): MachineOutput {
    const { amount_per_craft, production_rate } = byProductOf(result, crafts_per_tick, productivity);
    return {
        item_name: result.name,
        amount_per_craft,
        production_rate,
        ingredient: result,
        outputBlock: OutputBlock.forByProduct(result),
    };
}

function createFuel(metadata: MachineMetadata): [FuelConsumption?, FuelSlot?] {
    const source = BurnerEnergySource.forMachineType(metadata.type);
    if (!source) {
        return [];
    }
    return burnerFuelOf(source, metadata.fuel, metadata.crafting_speed, metadata.recipe.energy_required, metadata.energy_consumption_bonus);
}

/** What a burner machine burns of its fuel (the one named, else the source's first) over a craft and a second, and its fuel slot */
export function burnerFuelOf(
    source: BurnerEnergySource,
    fuel_name: string | undefined,
    crafting_speed: number,
    energy_required: number,
    energy_consumption_bonus: number | undefined,
): [FuelConsumption, FuelSlot] {
    const fuel = BurnerEnergySource.selectFuel(source, fuel_name);
    const consumption = FuelConsumption.fromCraftingSpeed(
        source,
        fuel,
        crafting_speed,
        energy_required,
        energy_consumption_bonus ?? 0,
    );
    return [consumption, FuelSlot.create(fuel, consumption)];
}

function printMachineFacts(machine: Machine, logger: Logger = defaultLogger): void {
    logger.log(`--------------------------------------------------`)
    logger.log(`Machine Facts:`);
    logger.log(`  Recipe: ${machine.metadata.recipe.name}`);
    logger.log(`  Crafting Speed: ${machine.metadata.crafting_speed}`);
    logger.log(`  Productivity: ${machine.metadata.productivity}%`);
    logger.log(`  Output Per Craft: ${machine.output.amount_per_craft.toDecimal().toFixed(2)}`);
    logger.log(`  Output Rate: ${machine.output.production_rate.amount_per_second.toDecimal().toFixed(2)} per second`);
    logger.log(`  Output Block: ${machine.output.outputBlock.ingredients_blocked_at} ${machine.output.outputBlock.item_name}`);
    logger.log(`  Overload Multiplier: ${machine.overload_multiplier.overload_multiplier.toString()}`);
    logger.log(`  Ticks per craft: ${machine.crafting_rate.ticks_per_craft.toFixed(2)} ticks`);
    logger.log(`  Ticks per Bonus Craft: ${machine.bonus_productivity_rate.ticks_per_bonus.toFixed(2)} ticks`);
    logger.log(`  Insertion Duration before overload lockout: ${machine.insertion_duration.tick_duration.toDecimal().toFixed(2)} ticks`);

    logger.log(`ingredient consumption rate facts:`)
    for (const input of machine.inputs.values()) {
        logger.log(`  - ${input.item_name}: ${input.consumption_rate.rate_per_second.toFixed(2)} per second`);
    }

    if (machine.fuel_consumption) {
        logger.log(`fuel consumption:`)
        logger.log(`  - ${machine.fuel_consumption.item}: ${machine.fuel_consumption.rate_per_second.toFixed(4)} per second while crafting`);
        logger.log(`  - ${machine.fuel_consumption.item}: ${machine.fuel_consumption.amount_per_craft.toFixed(4)} per craft`);
    }

    logger.log(`automated insertion limits:`)
    for (const input of machine.inputs.values()) {
        logger.log(`  - ${input.item_name}: ${input.automated_insertion_limit.quantity}`);
    }
}

/**
 * Extracts serializable facts from a Machine instance.
 */
function getMachineFacts(machine: Machine): SerializableMachineFacts {
    const inputs: SerializableMachineInput[] = [];
    for (const input of machine.inputs.values()) {
        inputs.push({
            item_name: input.item_name,
            consumption_rate_per_second: input.consumption_rate.rate_per_second,
            automated_insertion_limit: input.automated_insertion_limit.quantity,
            amount_per_craft: input.ingredient.amount,
        });
    }

    return {
        recipe: machine.metadata.recipe.name,
        crafting_speed: machine.metadata.crafting_speed,
        productivity: machine.metadata.productivity,
        type: machine.metadata.type,
        outputs: machine.outputs.map(output => {
            const rate = output.production_rate.amount_per_second;
            return {
                item_name: output.item_name, amount_per_craft: output.amount_per_craft.toDecimal(),
                rate_per_second: rate.toDecimal(), rate_ratio: { numerator: rate.getNumerator, denominator: rate.getDenominator },
                output_block_size: output.outputBlock.ingredients_blocked_at,
                stochastic: isStochastic(output.ingredient),
            };
        }),
        output_item: machine.output.item_name,
        output_per_craft: machine.output.amount_per_craft.toDecimal(),
        output_rate_per_second: machine.output.production_rate.amount_per_second.toDecimal(),
        output_rate_ratio: {
            numerator: machine.output.production_rate.amount_per_second.getNumerator,
            denominator: machine.output.production_rate.amount_per_second.getDenominator,
        },
        output_block_size: machine.output.outputBlock.ingredients_blocked_at,
        overload_multiplier: machine.overload_multiplier.overload_multiplier,
        ticks_per_craft: machine.crafting_rate.ticks_per_craft,
        ticks_per_bonus_craft: machine.bonus_productivity_rate.ticks_per_bonus,
        insertion_duration_ticks: machine.insertion_duration.tick_duration.toDecimal(),
        inputs,
        fuel: machine.fuel_consumption && {
            item_name: machine.fuel_consumption.item,
            energy_consumption_bonus: machine.metadata.energy_consumption_bonus ?? 0,
            consumption_rate_per_second: machine.fuel_consumption.rate_per_second,
            amount_per_craft: machine.fuel_consumption.amount_per_craft,
        },
    };
}

/**
 * Computes machine facts from configuration parameters.
 * This is useful for computing facts on-the-fly in the UI without running a full simulation.
 */
export interface ComputeMachineFactsParams {
    recipe: string;
    productivity: number;
    crafting_speed: number;
    /** The machine's prototype, whose game data gives its rule; without it the crafting rule */
    prototype?: string;
    energy_consumption_bonus?: number;
    fuel?: string;
}

function computeMachineFacts(params: ComputeMachineFactsParams): SerializableMachineFacts {
    const machine = createMachine(1, {
        recipe: RecipeMetadata.fromRecipeName(params.recipe),
        productivity: params.productivity,
        crafting_speed: params.crafting_speed,
        type: machineRuleOf(params),
        energy_consumption_bonus: params.energy_consumption_bonus,
        fuel: params.fuel,
    });
    return getMachineFacts(machine);
}