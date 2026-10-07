import { Fuel } from "./energy-source";
import { FuelConsumption } from "../traits/fuel-consumption";

/**
 * Inserters top a burner's fuel slot up to a few items rather than to an overload multiple of what a craft needs: at
 * least this many. A burner machine only holds the one fuel it is configured with.
 */
export const FUEL_AUTOMATED_INSERTION_LIMIT = 5;

/**
 * A burner machine works from a buffer of energy that holds this many ticks of work: a tick of work draws a tick of
 * energy from it, and the fuel tops it up again
 */
export const ENERGY_BUFFER_TICKS = 16 / 15;

/**
 * A machine that burns fuel fast is topped up to more than 5 items: to the fuel that holds this many times its energy
 * buffer, rounded up to whole items. That is the fuel for 192 ticks at its full energy consumption. In the words of a
 * Factorio developer, a burner does not obey the inserter limit if the fuel does not give it energy for at least 3
 * seconds of work, with the example of a buffer of 0.4 MJ times 180 ticks. Biochambers from +495% to +1427% energy
 * consumption, whose slots were filled up to 5 to 13 nutrients in Factorio 2.1, all fit it.
 *
 * Sources:
 * - https://forums.factorio.com/123927 ([2.0.24] High burner inserter to burner inserter fuel insertion limit)
 * - https://forums.factorio.com/124272 ([2.0.23] Tooltip for automated insertion limit of burnable fuel is often wrong)
 * - https://forums.factorio.com/viewtopic.php?p=705411#p705411 (abuc's report of the biochamber limits measured above;
 *   expected to be answered as working as intended, given the rule in the first thread)
 */
export const FUEL_INSERTION_BUFFERS = 180;

export interface FuelSlot {
    readonly fuel: Fuel;
    /** Inserters stop dropping this fuel once the slot holds this many items: 5, or more for a machine that burns fuel fast. */
    readonly automated_insertion_limit: number;
    /** Energy burned over one craft in MJ. Fuel is spent in proportion to crafting progress. */
    readonly energy_per_craft_mj: number;
}

function create(fuel: Fuel, consumption: FuelConsumption): FuelSlot {
    return {
        fuel,
        automated_insertion_limit: Math.max(
            FUEL_AUTOMATED_INSERTION_LIMIT,
            // a rate that lands on a whole item is not rounded up to the next by floating point noise
            Math.ceil(consumption.rate_per_tick * ENERGY_BUFFER_TICKS * FUEL_INSERTION_BUFFERS - 1e-9),
        ),
        energy_per_craft_mj: consumption.amount_per_craft * fuel.fuel_value_mj,
    };
}

export const FuelSlot = {
    create,
};
