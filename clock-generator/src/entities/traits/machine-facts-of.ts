import { SerializableMachineFacts } from "../../data-types/machine-facts";
import type { Machine } from "../machine/machine";
import { MachineType } from "../machine/machine-type";
import { machineTraitsOf, MachineTraits } from "./build-traits";
import { Ratio } from "./ratio";

const decimalOf = (ratio: Ratio) => ratio.numerator / ratio.denominator;

/**
 * A machine's facts for the UI and the insights as a projection of its traits: the main product first, its rule from the
 * recipe selection and the fuel the traits model, as machine-rule.ts gives it. Every producer of facts goes through here
 * (`computeMachineFacts`, `machineFactsOfEntity`).
 */
export function machineFactsOf(t: Pick<MachineTraits, "production" | "yield" | "input_limits" | "output_block" | "recipe_selection" | "energy">): SerializableMachineFacts {
    // the output blocks and the results are the recipe's results in one order (output-block.ts, yield.ts)
    const blocked_at = (index: number) => t.output_block.per_result[index].ingredients_blocked_at;
    const main = t.yield.results[0];
    const fuel = t.energy.fuel;
    return {
        recipe: t.production.recipe_or_resource,
        crafting_speed: t.production.speed,
        productivity: t.production.productivity,
        type: t.recipe_selection.mode === "by-input" ? MachineType.FURNACE : t.energy.fuel_modelled ? MachineType.BIOCHAMBER : MachineType.MACHINE,
        outputs: t.yield.results.map((result, index) => ({
            item_name: result.item, amount_per_craft: result.expected_per_craft,
            rate_per_second: decimalOf(result.per_second), rate_ratio: { ...result.per_second },
            output_block_size: blocked_at(index),
            stochastic: result.stochastic,
        })),
        output_item: main.item,
        output_per_craft: main.expected_per_craft,
        output_rate_per_second: decimalOf(main.per_second),
        output_rate_ratio: { ...main.per_second },
        output_block_size: blocked_at(0),
        overload_multiplier: t.input_limits.overload_multiplier,
        ticks_per_craft: t.production.ticks_per_craft,
        ticks_per_bonus_craft: t.production.ticks_per_bonus!,
        insertion_duration_ticks: t.production.insertion_duration_ticks!,
        inputs: t.production.inputs.map(input => ({
            item_name: input.item,
            consumption_rate_per_second: input.per_second,
            automated_insertion_limit: t.input_limits.limits.find(limit => limit.kind === "ingredient" && limit.item === input.item)!.limit,
            amount_per_craft: input.per_craft,
        })),
        fuel: fuel === null ? undefined : {
            item_name: fuel.item,
            energy_consumption_bonus: t.energy.energy_bonus,
            consumption_rate_per_second: fuel.per_second,
            amount_per_craft: fuel.per_craft,
        },
    };
}

/** What a machine's facts follow from: its configuration but the id and the fields that are labels */
export interface ComputeMachineFactsParams {
    recipe: string;
    productivity: number;
    crafting_speed: number;
    /** The machine's prototype, whose game data gives its rule; without it the crafting rule */
    prototype?: string;
    energy_consumption_bonus?: number;
    fuel?: string;
}

/**
 * The facts of a machine configured so, worked out on the fly, as the UI shows them before any build is run: the traits
 * of such a machine, projected. Throws as building the machine does (an unknown recipe, a speed of zero, a fuel its burner
 * does not burn).
 */
export function computeMachineFacts(params: ComputeMachineFactsParams): SerializableMachineFacts {
    const { recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel } = params;
    return machineFactsOf(machineTraitsOf({ id: 1, recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel }));
}

/**
 * The facts of a machine of a build: its traits, built once for the call from the fields of its configuration the machine
 * keeps in its metadata (an entity holds no traits), projected.
 */
export function machineFactsOfEntity(machine: Machine): SerializableMachineFacts {
    const { recipe, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel } = machine.metadata;
    return machineFactsOf(machineTraitsOf({
        id: machine.entity_id.number, recipe: recipe.name, productivity, crafting_speed, prototype, energy_consumption_bonus, fuel,
    }));
}
