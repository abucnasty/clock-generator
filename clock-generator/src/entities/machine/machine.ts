import { fraction } from "fractionability"
import { MachineConfiguration } from "../../config";
import { AutomatedInsertionLimit, ConsumptionRate } from "./input";
import { MachineMetadata, MachineType } from "./machine-metadata";
import { MachineOutput, OutputBlock, OverloadMultiplier, ProductionRate } from "./output";
import { RecipeMetadata } from "./recipe";
import { BonusProductivityRate, CraftingRate, InsertionDuration, NutrientConsumption } from "./traits";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { Percentage, SerializableMachineFacts, SerializableMachineInput } from "../../data-types";
import { MachineInputs } from "./input/machine-inputs";
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
        public readonly crafting_rate: CraftingRate,
        public readonly bonus_productivity_rate: BonusProductivityRate,
        public readonly insertion_duration: InsertionDuration,
        public readonly nutrient_consumption?: NutrientConsumption,
    ) {}

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

    

    const insertionDurationPeriod = InsertionDuration.create(machineOutput.production_rate, overload_multiplier)

    const bonusProductivityRate = BonusProductivityRate.fromCraftingRate(craftingRate, new Percentage(metadata.productivity));
    return new Machine(
        EntityId.forMachine(id),
        metadata,
        overload_multiplier,
        machineInputs,
        machineOutput,
        craftingRate,
        bonusProductivityRate,
        insertionDurationPeriod,
        metadata.type === MachineType.BIOCHAMBER
            ? NutrientConsumption.fromCraftingSpeed(
                metadata.crafting_speed,
                recipe.energy_required,
                metadata.energy_consumption_bonus ?? 0,
            )
            : undefined,
    );
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

    if (machine.nutrient_consumption) {
        logger.log(`nutrient consumption:`)
        logger.log(`  - ${machine.nutrient_consumption.rate_per_second.toFixed(4)} per second while crafting`);
        logger.log(`  - ${machine.nutrient_consumption.amount_per_craft.toFixed(4)} per craft`);
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
        nutrients: machine.nutrient_consumption && {
            energy_consumption_bonus: machine.metadata.energy_consumption_bonus ?? 0,
            consumption_rate_per_second: machine.nutrient_consumption.rate_per_second,
            amount_per_craft: machine.nutrient_consumption.amount_per_craft,
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
}

function computeMachineFacts(params: ComputeMachineFactsParams): SerializableMachineFacts {
    const machine = createMachine(1, {
        recipe: RecipeMetadata.fromRecipeName(params.recipe),
        productivity: params.productivity,
        crafting_speed: params.crafting_speed,
        type: params.type ?? 'machine',
        energy_consumption_bonus: params.energy_consumption_bonus,
    });
    return getMachineFacts(machine);
}