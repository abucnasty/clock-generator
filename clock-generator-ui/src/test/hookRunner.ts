/**
 * Shared setup for Node-only hook tests. Tests explicitly render, commit effects, and deliver async answers;
 * this is not a React renderer or a substitute for browser lifecycle checks.
 */
export function createHookRunner() {
    let states: unknown[] = [], refs: { current: unknown }[] = [];
    let memos: { deps: readonly unknown[]; value: unknown }[] = [];
    let effects: { deps?: readonly unknown[]; create: () => (() => void) | void; cleanup?: () => void }[] = [];
    let queued: (() => void)[] = [];
    let si = 0, ri = 0, mi = 0, ei = 0;
    const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
        a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const memo = (create: () => unknown, deps: readonly unknown[]) => {
        const i = mi++;
        if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: create() };
        return memos[i].value;
    };
    const effect = (create: () => (() => void) | void, deps?: readonly unknown[]) => {
        const i = ei++;
        if (!effects[i] || !same(effects[i].deps, deps)) queued.push(() => {
            effects[i]?.cleanup?.();
            effects[i] = { deps, create, cleanup: create() || undefined };
        });
    };
    const unmount = () => {
        effects.forEach(entry => { entry.cleanup?.(); entry.cleanup = undefined; });
    };
    return {
        reset() { unmount(); states = []; refs = []; memos = []; effects = []; queued = []; },
        begin() { si = ri = mi = ei = 0; queued = []; },
        commit() { const pending = queued; queued = []; pending.forEach(run => run()); },
        replay() {
            unmount();
            effects.forEach(entry => { entry.cleanup = entry.create() || undefined; });
        },
        unmount,
        react: {
            useState(initial: unknown) {
                const i = si++;
                if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
                return [states[i], (next: unknown) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
            },
            useRef(value: unknown) { return refs[ri++] ??= { current: value }; },
            useMemo: memo,
            useCallback: (fn: unknown, deps: readonly unknown[]) => memo(() => fn, deps),
            useEffect: effect,
            useLayoutEffect: effect,
            useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
        },
    };
}
