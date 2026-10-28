import type { Machine } from "../../entities/machine/machine";
import type { WritableInventoryState } from "../../state/inventory-state";
import { BurnerEnergy } from "./burner-energy";
import { ElectricEnergy } from "./electric-energy";

/**
 * A crafting machine's Energy component: one class for each variant, chosen once when the machine's state is built, so
 * a machine's energy calls always reach the same class
 */
export type Energy = ElectricEnergy | BurnerEnergy;

/**
 * What a machine's energy asks of its crafting, and only when it needs the answer: an electric machine never asks, so
 * the crafting does not work out an answer every tick for nothing
 */
export interface EnergyUser {
    /** Whether a craft is underway */
    craftInProgress(): boolean;
    /** Whether the machine works on after this tick: no product waits for room, and a craft is underway or can start */
    keepsWorking(): boolean;
}

/** The energy of a machine: a burner where its fuel is modelled (it has a fuel slot), burning from its fuel inventory */
function of(machine: Machine, fuel_inventory: WritableInventoryState): Energy {
    const slot = machine.fuel_slot;
    if (slot === undefined) {
        return new ElectricEnergy();
    }
    return new BurnerEnergy(slot, slot.energy_per_craft_mj * machine.crafting_rate.crafts_per_tick, fuel_inventory);
}

export const Energy = {
    of,
};
