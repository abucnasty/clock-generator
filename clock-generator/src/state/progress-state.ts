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
