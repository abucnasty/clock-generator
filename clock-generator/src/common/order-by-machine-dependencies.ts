/**
 * Outputs update before inputs feeding their machine. Stable ties retain the original order of competing inserters;
 * cycles keep the simulator's existing traversal rule. Shared by simulation and repeated-unit comparison.
 */
export function orderByMachineDependencies<T>(
    items: readonly T[],
    sourceMachine: (item: T) => string | undefined,
    sink: (item: T) => string,
): T[] {
    const pickers = new Map<string, T[]>();
    for (const item of items) {
        const source = sourceMachine(item);
        if (source === undefined) continue;
        const own = pickers.get(source) ?? [];
        own.push(item);
        pickers.set(source, own);
    }
    const depths = new Map<T, number>();
    const visiting = new Set<T>();
    const depthOf = (item: T): number => {
        const known = depths.get(item);
        if (known !== undefined) return known;
        if (visiting.has(item)) return 0;
        visiting.add(item);
        const downstream = pickers.get(sink(item)) ?? [];
        const depth = downstream.length === 0 ? 0 : 1 + Math.max(...downstream.map(depthOf));
        visiting.delete(item);
        depths.set(item, depth);
        return depth;
    };
    return [...items].sort((a, b) => depthOf(a) - depthOf(b));
}
