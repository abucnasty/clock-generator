/**
 * The loops of a planner graph and its one topological order (P3 1.3): Tarjan's strongly connected components over the
 * vertices (machines and drills whole, containers and lanes per item port), the condensation, and Kahn's order of it
 * with ties broken by registry order. Linear in vertices and arcs, but for the choice of the lowest ready component at
 * each step, linear in the ready ones: the graphs have a few hundred vertices at most.
 */

/** An arc of one edge from a vertex it takes from to the vertex it drops into */
export interface Arc {
    readonly from: string;
    readonly to: string;
}

/** The strongly connected components of a graph, its loops among them, and the order of the condensed graph */
export interface Condensation {
    /** Every component, its vertices in registry order; the components in the order of their first vertex */
    readonly components: readonly (readonly string[])[];
    /** The component of each vertex, as an index into `components` */
    readonly component_of: ReadonlyMap<string, number>;
    /** The components that are loops: more than one vertex, or one with an arc to itself */
    readonly loops: readonly number[];
    /** The components in one topological order of the condensed graph */
    readonly order: readonly number[];
}

/**
 * The strongly connected components of `vertices` (in registry order: the order every tie is broken by) under `arcs`,
 * each with its vertices in registry order, in the order of their first vertex. Tarjan's algorithm, without recursion.
 */
function strongComponents(vertices: readonly string[], successors: ReadonlyMap<string, readonly string[]>): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const on_stack = new Set<string>();
    const found: string[][] = [];
    for (const root of vertices) {
        if (index.has(root)) continue;
        // each frame: a vertex and how many of its successors it has gone through
        const frames: { vertex: string; next: number }[] = [{ vertex: root, next: 0 }];
        index.set(root, index.size);
        low.set(root, index.get(root)!);
        stack.push(root);
        on_stack.add(root);
        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            const next = successors.get(frame.vertex) ?? [];
            if (frame.next < next.length) {
                const to = next[frame.next++];
                if (!index.has(to)) {
                    index.set(to, index.size);
                    low.set(to, index.get(to)!);
                    stack.push(to);
                    on_stack.add(to);
                    frames.push({ vertex: to, next: 0 });
                } else if (on_stack.has(to)) {
                    low.set(frame.vertex, Math.min(low.get(frame.vertex)!, index.get(to)!));
                }
                continue;
            }
            frames.pop();
            if (frames.length > 0) {
                const parent = frames[frames.length - 1].vertex;
                low.set(parent, Math.min(low.get(parent)!, low.get(frame.vertex)!));
            }
            if (low.get(frame.vertex) === index.get(frame.vertex)) {
                const component: string[] = [];
                let member: string;
                do {
                    member = stack.pop()!;
                    on_stack.delete(member);
                    component.push(member);
                } while (member !== frame.vertex);
                found.push(component);
            }
        }
    }
    const rank = new Map(vertices.map((vertex, at) => [vertex, at]));
    const byRank = (a: string, b: string) => rank.get(a)! - rank.get(b)!;
    return found.map(component => component.sort(byRank)).sort((a, b) => byRank(a[0], b[0]));
}

/**
 * The condensation of a graph: its strongly connected components and one topological order of them, ties broken by
 * registry order (the order of `vertices`). An arc whose end is not a vertex is a mistake of the caller.
 */
export function condense(vertices: readonly string[], arcs: readonly Arc[]): Condensation {
    const successors = new Map<string, string[]>();
    for (const arc of arcs) {
        if (!successors.has(arc.from)) successors.set(arc.from, []);
        successors.get(arc.from)!.push(arc.to);
    }
    const components = strongComponents(vertices, successors);
    const component_of = new Map<string, number>();
    components.forEach((component, at) => component.forEach(vertex => component_of.set(vertex, at)));
    const of = (vertex: string): number => {
        const at = component_of.get(vertex);
        if (at === undefined) throw new Error(`An arc ends at ${vertex}, which is no vertex of the graph`);
        return at;
    };

    const to_itself = new Set(arcs.filter(arc => arc.from === arc.to).map(arc => arc.from));
    const loops = components.flatMap((component, at) => component.length > 1 || to_itself.has(component[0]) ? [at] : []);

    // Kahn's algorithm over the condensed arcs; the components are numbered in registry order, so the lowest ready
    // number is the tie-break
    const after = components.map(() => new Set<number>());
    const before = components.map(() => 0);
    for (const arc of arcs) {
        const from = of(arc.from);
        const to = of(arc.to);
        if (from !== to && !after[from].has(to)) {
            after[from].add(to);
            before[to]++;
        }
    }
    const ready = new Set(components.flatMap((_, at) => before[at] === 0 ? [at] : []));
    const order: number[] = [];
    while (ready.size > 0) {
        const next = Math.min(...ready);
        ready.delete(next);
        order.push(next);
        for (const to of after[next]) {
            if (--before[to] === 0) ready.add(to);
        }
    }
    return { components, component_of, loops, order };
}
