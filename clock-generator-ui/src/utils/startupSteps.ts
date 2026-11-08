/**
 * The steps the page takes before it shows the form, in order, and what the startup alert says when one fails or does
 * not answer. A step that never answers fires no error (a phone can stop a worker without one), so the page gives the
 * whole start a time limit and then names the first step that is not done.
 */

/** How long the page waits for every startup step before it says which one has not answered */
export const STARTUP_TIMEOUT_MS = 60_000;

export interface StartupProgress {
    /** the game data file is fetched */
    dataLoaded: boolean;
    /** the engine's worker has loaded the game data and answered with its names and recipes */
    engineReady: boolean;
    /** every simulator worker of the pool has loaded the game data */
    workersReady: boolean;
    /** the saved build is checked and loaded */
    configLoaded: boolean;
    /** the browser's store of kept clocks is open */
    storeOpened: boolean;
    /** the clocks kept for the saved build are back */
    resultsRestored: boolean;
}

const STEP_NAMES: [keyof StartupProgress, string][] = [
    ['dataLoaded', 'loading the game data'],
    ['engineReady', 'starting the engine'],
    ['workersReady', 'starting the simulator workers'],
    ['configLoaded', 'loading the saved build'],
    ['storeOpened', 'opening the kept clocks'],
    ['resultsRestored', 'restoring the kept clocks'],
];

/** The name of the first of the steps given that is not done, or null when all are */
export function pendingStartupStep(progress: Partial<StartupProgress>): string | null {
    return STEP_NAMES.find(([key]) => key in progress && progress[key] !== true)?.[1] ?? null;
}

/** What the alert says when a step failed with `message`: what failed, and in which step */
export function startupFailureText(message: string, step: string | null): string {
    return step === null ? message : `${message} (while ${step})`;
}

/** What the alert says when the start took longer than `timeoutMs`: the step that has not answered */
export function startupTimeoutText(step: string, timeoutMs: number = STARTUP_TIMEOUT_MS): string {
    return `${step} did not finish in ${Math.round(timeoutMs / 1000)} seconds`;
}
