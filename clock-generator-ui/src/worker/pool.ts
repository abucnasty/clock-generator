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
