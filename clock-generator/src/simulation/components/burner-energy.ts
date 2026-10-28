import { ENERGY_BUFFER_TICKS, FuelSlot } from "../../entities/machine/fuel/fuel-slot";
import { LiveQuantity, WritableInventoryState } from "../../state/inventory-state";
import type { EnergyUser } from "./energy";

// absorbs floating point drift when summing fractional per-tick energy
const ENERGY_EPSILON = 1e-9;

// A burner's energy buffer is topped up from its fuel after a tick of work, but not after the tick the machine stops.
// A stopped machine is left with the 1/15 tick the buffer holds over a tick of work, which is all it has to work with
// on the tick it starts again: that tick makes 1/15 of a tick's progress, and its top-up burns 16/15 of a tick's fuel.

/**
 * The energy of a machine that burns fuel the simulator models (the biochamber on nutrients): what is left of the
 * burning item and the buffer a tick of work draws from. Reads the fuel the machine burns (the Energy trait's fuel, as
 * the machine's fuel slot holds it) and the machine's fuel inventory, which stays the machine's.
 */
export class BurnerEnergy {
    /** Energy left in the item being burned, in MJ */
    public energy_remaining_mj: number = 0;

    /**
     * Energy the machine holds to work with, in MJ: what it draws a tick's work from, and what the fuel tops up after a
     * tick it keeps working. A machine that has not worked yet holds none.
     */
    public energy_buffer_mj: number = 0;

    /** The fuel items waiting in the fuel slot, read without a map lookup */
    private readonly fuel_quantity: LiveQuantity;

    constructor(
        /** What the machine burns: the item, its fuel value and the energy a craft takes */
        public readonly fuel_slot: FuelSlot,
        /** Energy a tick of work takes, in MJ */
        private readonly energy_per_tick: number,
        private readonly fuel_inventory: WritableInventoryState,
    ) {
        this.fuel_quantity = new LiveQuantity(fuel_inventory, fuel_slot.fuel.item_name);
    }

    /** The part of a tick's work the energy the machine holds pays for: all of it, except on the tick it starts again */
    public poweredShare(): number {
        return Math.min(1, this.energy_buffer_mj / this.energy_per_tick);
    }

    /** Whether the machine holds energy, or has fuel, to progress a craft: what a craft needs to start */
    public hasFuel(): boolean {
        return this.energy_buffer_mj + this.fuelEnergy() > ENERGY_EPSILON;
    }

    /**
     * A burner is out of fuel when it has nothing to burn and holds less energy than a tick of work takes: the 1/15 of
     * a tick a stopped machine keeps is not enough to count on. A craft underway spends what is left before the machine
     * reports it, so a partly filled buffer is used up, not thrown away. The game reports this ahead of a shortage of
     * ingredients and a full output.
     */
    public outOfFuel(user: EnergyUser): boolean {
        if (this.fuelEnergy() > ENERGY_EPSILON) {
            return false;
        }
        const buffer = this.energy_buffer_mj;
        if (user.craftInProgress() && buffer > ENERGY_EPSILON) {
            return false;
        }
        return buffer < this.energy_per_tick - ENERGY_EPSILON;
    }

    /**
     * A tick of work draws a tick of energy from what the machine holds, and the fuel tops it up if the machine keeps
     * working: a craft is underway, or the next one can start. A machine that holds no energy takes it from the fuel
     * first, and works from the next tick.
     */
    public spend(worked: boolean, user: EnergyUser): void {
        const energy_per_tick = this.energy_per_tick;
        let buffer = this.energy_buffer_mj;
        if (worked) {
            buffer -= Math.min(buffer, energy_per_tick);
        }
        if (user.keepsWorking()) {
            buffer += this.burnFuel(ENERGY_BUFFER_TICKS * energy_per_tick - buffer);
        }
        this.energy_buffer_mj = buffer;
    }

    /** A copy of what it holds, burning from the given fuel inventory (the copy of the machine's) */
    public clone(fuel_inventory: WritableInventoryState): BurnerEnergy {
        const cloned = new BurnerEnergy(this.fuel_slot, this.energy_per_tick, fuel_inventory);
        cloned.energy_remaining_mj = this.energy_remaining_mj;
        cloned.energy_buffer_mj = this.energy_buffer_mj;
        return cloned;
    }

    /**
     * What drives the burner's next ticks, for the machine's key (see simulationStateKey): what is left of the burning
     * item and what it holds to work with. The fuel slot is the machine's Storage, and keyed there.
     */
    public key(): string {
        return `${this.energy_remaining_mj};${this.energy_buffer_mj}`;
    }

    /** Energy in the burning item plus the items waiting in the fuel slot, in MJ */
    private fuelEnergy(): number {
        return this.energy_remaining_mj + this.fuel_quantity.get() * this.fuel_slot.fuel.fuel_value_mj;
    }

    /** Burns up to `energy` MJ of fuel, lighting the next fuel item when the burning one runs out; returns what was burned */
    private burnFuel(energy: number): number {
        const fuel = this.fuel_slot.fuel;
        let required = Math.min(energy, this.fuelEnergy());
        let burned = 0;
        while (required > ENERGY_EPSILON) {
            if (this.energy_remaining_mj <= ENERGY_EPSILON) {
                this.fuel_inventory.removeQuantity(fuel.item_name, 1);
                this.energy_remaining_mj = fuel.fuel_value_mj;
            }
            const spent = Math.min(required, this.energy_remaining_mj);
            this.energy_remaining_mj -= spent;
            required -= spent;
            burned += spent;
        }
        return burned;
    }
}
