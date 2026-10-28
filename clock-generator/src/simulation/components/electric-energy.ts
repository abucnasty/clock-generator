import type { WritableInventoryState } from "../../state/inventory-state";
import type { EnergyUser } from "./energy";

/**
 * The energy of a machine that burns no fuel the simulator models: an electric one, or a burner whose fuel is not
 * modelled (`fuel_modelled`, entities/traits/energy.ts). It owns nothing: every tick is fully powered.
 */
export class ElectricEnergy {
    /** The part of a tick's work the machine's energy pays for */
    public poweredShare(): number {
        return 1;
    }

    /** Whether the machine has energy to progress a craft */
    public hasFuel(): boolean {
        return true;
    }

    public outOfFuel(user: EnergyUser): boolean {
        return false;
    }

    public spend(worked: boolean, user: EnergyUser): void { }

    /**
     * Owns nothing, so a copy is the same object. Valid only while this class holds no fields: one that adds state (a
     * drain, a power satisfaction) must return a new instance here, or a clone shares it with the original.
     */
    public clone(fuel_inventory: WritableInventoryState): ElectricEnergy {
        return this;
    }

    /** Nothing: it owns nothing that could drive the machine's next ticks */
    public key(): string {
        return "";
    }
}
