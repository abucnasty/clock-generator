import Fraction, { fraction } from "fractionability";


export interface ProgressState {
    progress: number;
}

function clone(progressState: ProgressState): ProgressState {
    return { progress: progressState.progress };
}

function empty(): ProgressState {
    return {
        progress: 0
    }
}

export const ProgressState = {
    clone: clone,
    empty: empty
};

/** The burning progress of the item a burner machine is currently consuming. */
export interface FuelProgressState {
    /** Energy left in the item being burned, in MJ. */
    energy_remaining_mj: number;
    /**
     * Energy the machine holds to work with, in MJ: what it draws a tick's work from, and what the fuel tops up after
     * a tick it keeps working. A machine that has not worked yet holds none.
     */
    energy_buffer_mj: number;
}

function cloneFuel(fuelProgress: FuelProgressState): FuelProgressState {
    return { energy_remaining_mj: fuelProgress.energy_remaining_mj, energy_buffer_mj: fuelProgress.energy_buffer_mj };
}

function emptyFuel(): FuelProgressState {
    return { energy_remaining_mj: 0, energy_buffer_mj: 0 };
}

export const FuelProgressState = {
    clone: cloneFuel,
    empty: emptyFuel,
};
