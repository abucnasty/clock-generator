export interface ProgressState {
    progress: number;
}

function empty(): ProgressState {
    return {
        progress: 0
    }
}

export const ProgressState = {
    empty: empty
};
