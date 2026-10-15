/**
 * Holds a worker's requests until it has loaded the game data. A worker started in place of a cancelled or crashed one
 * gets its requests at once, before its `initialize` has finished; they wait here, in the order they came, and then
 * run. When loading failed, every waiting and later request fails with the same error.
 */
interface ReadyGate {
    open(): void;
    fail(error: Error): void;
    /** Resolves once the gate is open (at once when it is); rejects once it has failed */
    whenOpen(): Promise<void>;
}

export function createReadyGate(): ReadyGate {
    let open!: () => void;
    let fail!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
        open = resolve;
        fail = reject;
    });
    // a gate that fails before anything waits on it must not be an unhandled rejection
    ready.catch(() => {});
    return {
        open: () => open(),
        fail: (error) => fail(error),
        // promise reactions run in the order they were added, so the waiting requests keep their order
        whenOpen: () => ready,
    };
}
