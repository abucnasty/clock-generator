import { FactorioDataService } from "../../data";
import type { MiningDrill } from "../../entities/drill/mining-drill";
import { burnerEnergyPerTick, drillEnergy } from "../../entities/traits/energy";
import type { Machine } from "../../entities/machine/machine";
import type { WritableInventoryState } from "../../state/inventory-state";
import { BurnerEnergy } from "./burner-energy";
import { ElectricEnergy } from "./electric-energy";
import { SuppliedBurnerEnergy } from "./supplied-burner-energy";

/**
 * A machine's or drill's Energy component: one class for each variant, chosen once when the entity's state is built, so
 * its energy calls always reach the same class
 */
export type Energy = ElectricEnergy | BurnerEnergy | SuppliedBurnerEnergy;

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

/** The energy of a machine: a burner where it has a fuel slot (every burner machine), burning from its fuel inventory */
function of(machine: Machine, fuel_inventory: WritableInventoryState): Energy {
    const slot = machine.fuel_slot;
    if (slot === undefined) {
        return new ElectricEnergy();
    }
    return new BurnerEnergy(slot, slot.energy_per_craft_mj * machine.crafting_rate.crafts_per_tick, fuel_inventory);
}

/** The energy of a drill: a burner drill holds a buffer and has its fuel supplied (SuppliedBurnerEnergy), any other none */
function ofDrill(drill: MiningDrill): Energy {
    const per_tick = burnerEnergyPerTick(drillEnergy(FactorioDataService.getMiningDrillSpec(drill.meta.type)));
    return per_tick === null ? new ElectricEnergy() : new SuppliedBurnerEnergy(per_tick);
}

export const Energy = {
    of,
    ofDrill,
};
