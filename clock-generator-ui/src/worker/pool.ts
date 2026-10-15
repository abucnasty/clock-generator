/**
 * The workers doing work that is about to be thrown away: every one running a task, and the first one, which plans and
 * checks, while it plans or checks.
 */
export function busyWorkersOf<W>(pool: W[], state: { running: Iterable<W>; planning: boolean; checking: boolean }): W[] {
    const busy = new Set(state.running);
    if ((state.planning || state.checking) && pool.length > 0) {
        busy.add(pool[0]);
    }
    return pool.filter((worker) => busy.has(worker));
}

/**
 * The check to send again after the pool changed: the one still waiting for its answer, when the first worker, which
 * runs the checks, was replaced. Null otherwise.
 */
export function checkToResend<W, C>(before: W[], after: W[], pending: C | null): C | null {
    return pending !== null && before[0] !== after[0] ? pending : null;
}

/**
 * What a worker that stopped unexpectedly ends: the check waiting on it (the first worker runs the checks), the
 * generation on screen, and whether it is replaced: only once it had started, so a worker that cannot load is not
 * started again and again
 */
export function crashOutcome({ started, isCheckWorker, checkRunning, runOnScreen }: {
    started: boolean;
    isCheckWorker: boolean;
    checkRunning: boolean;
    runOnScreen: boolean;
}): { settleCheck: boolean; endRun: boolean; replace: boolean } {
    return { settleCheck: checkRunning && isCheckWorker, endRun: runOnScreen, replace: started };
}

/**
 * The pool with each busy worker terminated and a new one started in its place, so the first worker stays the one
 * that plans and checks. The others keep running.
 */
export function replaceWorkers<W extends { terminate(): void }>(pool: W[], busy: W[], start: () => W): W[] {
    return pool.map((worker) => {
        if (!busy.includes(worker)) {
            return worker;
        }
        worker.terminate();
        return start();
    });
}
