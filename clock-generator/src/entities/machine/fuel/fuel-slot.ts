import { Fuel } from "./energy-source";
import { FuelConsumption } from "../traits/fuel-consumption";

/**
 * Inserters top a burner's fuel slot up to a few items rather than to an overload multiple of
 * what a craft needs. A burner machine only holds the one fuel it is configured with.
 */
export const FUEL_AUTOMATED_INSERTION_LIMIT = 5;

export interface FuelSlot {
    readonly fuel: Fuel;
    /** Inserters stop dropping this fuel once the slot holds this many items. */
    readonly automated_insertion_limit: number;
    /** Energy burned over one craft in MJ. Fuel is spent in proportion to crafting progress. */
    readonly energy_per_craft_mj: number;
}

function create(fuel: Fuel, consumption: FuelConsumption): FuelSlot {
    return {
        fuel,
        automated_insertion_limit: FUEL_AUTOMATED_INSERTION_LIMIT,
        energy_per_craft_mj: consumption.amount_per_craft * fuel.fuel_value_mj,
    };
}

export const FuelSlot = {
    create,
};
