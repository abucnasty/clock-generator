import { fraction } from "fractionability"
import { MachineConfiguration } from "../../config";
import { AutomatedInsertionLimit, ConsumptionRate } from "./input";
import { BurnerEnergySource, FuelSlot } from "./fuel";
import { MachineMetadata } from "./machine-metadata";
import { MachineOutput, OutputBlock, OverloadMultiplier, ProductionRate } from "./output";
import { RecipeMetadata, expectedAmount, amountIgnoredByProductivity } from "./recipe";
import { EnrichedIngredient } from "../../data";
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
    ) {}

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
        return fuel_input ? [...this.inputs.values(), fuel_input] : Array.from(this.inputs.values());
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
        type: config.type ?? "machine",
        energy_consumption_bonus: config.energy_consumption_bonus,
        fuel: config.fuel,
    });
}

function createMachine(
    id: number,
    metadata: MachineMetadata
): Machine {
    const recipe = metadata.recipe;
    const overload_multiplier = OverloadMultiplier.fromCraftingSpeed(metadata.crafting_speed, recipe.energy_required)

    const machineInputs = new MachineInputs(
        recipe.raw.ingredients.map(ingredient => {
            return [ingredient.name, {
                item_name: ingredient.name,
                consumption_rate: ConsumptionRate.fromCraftingSpeed(
                    ingredient.name,
                    metadata.crafting_speed,
                    recipe.energy_required,
                    ingredient.amount
                ),
                automated_insertion_limit: AutomatedInsertionLimit.fromIngredient(ingredient, overload_multiplier),
                ingredient: ingredient
            }];
        })
    );

    const craftingRate = CraftingRate.fromCraftingSpeed(
        fraction(recipe.output.amount),
        metadata.crafting_speed,
        recipe.energy_required
    );

    const machineOutput: MachineOutput = {
        item_name: recipe.output.name,
        amount_per_craft: fraction(recipe.output.amount).multiply(fraction(1).add(fraction(metadata.productivity).divide(100))),
        production_rate: ProductionRate.fromCraftingRate(
            recipe.output.name,
            craftingRate,
            new Percentage(metadata.productivity),
        ),
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
        ...createFuel(metadata),
    );
}

/**
 * A by-product's rate is its expected amount per craft, a probable result counted by its probability.
 * Productivity multiplies it except for the part of the amount the recipe ignores for productivity.
 */
function createByProductOutput(result: EnrichedIngredient, crafts_per_tick: number, productivity: number): MachineOutput {
    const productive_amount = fraction(expectedAmount(result) - amountIgnoredByProductivity(result));
    const amount_per_craft = productive_amount
        .multiply(fraction(1).add(fraction(productivity).divide(100)))
        .add(fraction(amountIgnoredByProductivity(result)));
    return {
        item_name: result.name,
        amount_per_craft,
        production_rate: ProductionRate.perTick(result.name, amount_per_craft.multiply(fraction(crafts_per_tick))),
        ingredient: result,
        outputBlock: OutputBlock.forByProduct(result),
    };
}

function createFuel(metadata: MachineMetadata): [FuelConsumption?, FuelSlot?] {
    const source = BurnerEnergySource.forMachineType(metadata.type);
    if (!source) {
        return [];
    }
    const fuel = BurnerEnergySource.selectFuel(source, metadata.fuel);
    if (metadata.recipe.inputsPerCraft.has(fuel.item_name)) {
        throw new Error(
            `Recipe ${metadata.recipe.name} uses ${fuel.item_name} as an ingredient, which is also the fuel of a ${metadata.type}. ` +
            `A machine with the same item as ingredient and fuel is not supported yet.`
        );
    }
    const consumption = FuelConsumption.fromCraftingSpeed(
        source,
        fuel,
        metadata.crafting_speed,
        metadata.recipe.energy_required,
        metadata.energy_consumption_bonus ?? 0,
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
    logger.log(`  Output Block: ${machine.output.outputBlock.quantity} ${machine.output.outputBlock.item_name}`);
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
        output_item: machine.output.item_name,
        output_per_craft: machine.output.amount_per_craft.toDecimal(),
        output_rate_per_second: machine.output.production_rate.amount_per_second.toDecimal(),
        output_block_size: machine.output.outputBlock.quantity,
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
    type?: 'machine' | 'furnace' | 'biochamber';
    energy_consumption_bonus?: number;
    fuel?: string;
}

function computeMachineFacts(params: ComputeMachineFactsParams): SerializableMachineFacts {
    const machine = createMachine(1, {
        recipe: RecipeMetadata.fromRecipeName(params.recipe),
        productivity: params.productivity,
        crafting_speed: params.crafting_speed,
        type: params.type ?? 'machine',
        energy_consumption_bonus: params.energy_consumption_bonus,
        fuel: params.fuel,
    });
    return getMachineFacts(machine);
}