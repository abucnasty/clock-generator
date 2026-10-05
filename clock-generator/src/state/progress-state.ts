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
}

function cloneFuel(fuelProgress: FuelProgressState): FuelProgressState {
    return { energy_remaining_mj: fuelProgress.energy_remaining_mj };
}

function emptyFuel(): FuelProgressState {
    return { energy_remaining_mj: 0 };
}

export const FuelProgressState = {
    clone: cloneFuel,
    empty: emptyFuel,
};
