import { ENERGY_BUFFER_TICKS } from "../../entities/machine/fuel/fuel-slot";
import type { EnergyUser } from "./energy";

/**
 * The energy of a burner whose fuel nothing in a build feeds (a mining drill): the buffer of a burner, with the fuel
 * assumed to be there without limit. It holds a buffer of 16/15 of a tick of work, drawn by each tick of work and topped
 * up after a tick the machine keeps working, as BurnerEnergy's. It has no fuel slot, burns no item and never runs out,
 * so its only effect is the first tick of work, which fills the empty buffer and makes no progress (recorded on the
 * burner mining drill: tests/game/mechanics/fuel).
 */
export class SuppliedBurnerEnergy {
    /** Energy the machine holds to work with, in MJ; a machine that has not worked yet holds none */
    public energy_buffer_mj: number = 0;

    constructor(
        /** Energy a tick of work takes, in MJ */
        private readonly energy_per_tick: number,
    ) { }

    /** The part of a tick's work the energy the machine holds pays for: all of it, except on the tick it starts */
    public poweredShare(): number {
        return Math.min(1, this.energy_buffer_mj / this.energy_per_tick);
    }

    /** The fuel is always there */
    public hasFuel(): boolean {
        return true;
    }

    public outOfFuel(user: EnergyUser): boolean {
        return false;
    }

    /** A tick of work draws a tick of energy; the supply tops the buffer up if the machine keeps working */
    public spend(worked: boolean, user: EnergyUser): void {
        if (worked) {
            this.energy_buffer_mj -= Math.min(this.energy_buffer_mj, this.energy_per_tick);
        }
        if (user.keepsWorking()) {
            this.energy_buffer_mj = ENERGY_BUFFER_TICKS * this.energy_per_tick;
        }
    }

    public clone(): SuppliedBurnerEnergy {
        const cloned = new SuppliedBurnerEnergy(this.energy_per_tick);
        cloned.energy_buffer_mj = this.energy_buffer_mj;
        return cloned;
    }

    /** What drives the next ticks: the buffer */
    public key(): string {
        return `${this.energy_buffer_mj}`;
    }
}
