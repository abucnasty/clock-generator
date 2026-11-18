export interface ProgressState {
    progress: number;
}

function empty(): ProgressState {
    return {
        progress: 0
    }
}

/** What a key keeps of a progress in crafts: its billionths of a craft, rounded */
const KEY_GRID = 1e-9;

/**
 * A progress in crafts as a simulation key keeps it (see simulationStateKey): its billionths of a craft, rounded, so that
 * two doubles that drift apart by less than that key alike and a run that repeats is seen to repeat. Only keys read it:
 * the simulation runs on the full double.
 */
function keyOf(progress: number): number {
    return progress === 0 ? 0 : Math.round(progress / KEY_GRID);
}

export const ProgressState = {
    empty: empty,
    keyOf: keyOf,
};
