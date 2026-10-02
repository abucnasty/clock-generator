import { Config } from "../config";
import { Recording } from "./recording";

export interface EntityMatch {
    /** recorded machine id -> config machine id */
    machines: Map<number, number>;
    /** recorded inserter id -> config inserter id */
    inserters: Map<number, number>;
    unmatched_recorded_machines: number[];
    unmatched_config_machines: number[];
    unmatched_recorded_inserters: number[];
    unmatched_config_inserters: number[];
}

type Endpoint = { type: "machine" | "belt" | "chest"; id: number };

const MAX_MACHINE_MAPPINGS = 5000;

function beltKey(lanes: { ingredient: string }[]): string {
    return Array.from(new Set(lanes.map(l => l.ingredient).filter(Boolean))).sort().join("|");
}

function filterKey(filters: string[] | undefined): string {
    return Array.from(new Set(filters ?? [])).sort().join("|");
}

function permutations<T>(items: T[], size: number): T[][] {
    if (size === 0) return [[]];
    return items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)], size - 1).map(rest => [item, ...rest])
    );
}

function cartesian<T>(groups: T[][]): T[][] {
    return groups.reduce<T[][]>((acc, group) => acc.flatMap(prefix => group.map(item => [...prefix, item])), [[]]);
}

/**
 * Matches recorded entities to config entities by structure rather than id, because in-game
 * selection order rarely matches the order ids were assigned in the config.
 * Machines are matched by recipe; identical-recipe machines are disambiguated by whichever
 * assignment lets the most inserters (source, sink, items) line up.
 */
export function matchRecordingToConfig(recording: Recording, config: Config): EntityMatch {
    const config_inserters = config.inserters.map((ins, index) => ({ ...ins, id: ins.id ?? index + 1 }));
    const config_belt_keys = new Map(config.belts.map(b => [b.id, beltKey(b.lanes)]));
    const recorded_belt_keys = new Map(recording.config.belts.map(b => [b.id, beltKey(b.lanes)]));

    const recipes = Array.from(new Set(recording.machines.map(m => m.recipe)));
    const groups = recipes.map(recipe => {
        const recorded = recording.machines.filter(m => m.recipe === recipe).map(m => m.id);
        const configured = config.machines.filter(m => m.recipe === recipe).map(m => m.id);
        const size = Math.min(recorded.length, configured.length);
        return { recorded: recorded.slice(0, size), options: permutations(configured, size) };
    });

    const mapping_count = groups.reduce((n, g) => n * g.options.length, 1);
    const candidate_mappings: Map<number, number>[] = (mapping_count <= MAX_MACHINE_MAPPINGS
        ? cartesian(groups.map(g => g.options))
        : [groups.map(g => g.options[0])]
    ).map(choice => {
        const mapping = new Map<number, number>();
        choice.forEach((assigned, group_index) => {
            groups[group_index].recorded.forEach((recorded_id, i) => mapping.set(recorded_id, assigned[i]));
        });
        return mapping;
    });

    // an output belt is often empty when selected, so the sidecar can't export (or id) it; only belt sources need lane contents
    const configEndpointKey = (endpoint: Endpoint, role: "source" | "sink"): string => {
        if (endpoint.type === "machine") return `machine:${endpoint.id}`;
        if (endpoint.type === "belt") return role === "sink" ? "belt" : `belt:${config_belt_keys.get(endpoint.id) ?? endpoint.id}`;
        return "chest";
    };
    const recordedEndpointKey = (endpoint: Endpoint, role: "source" | "sink", machine_mapping: Map<number, number>): string => {
        if (endpoint.type === "machine") return `machine:${machine_mapping.get(endpoint.id) ?? `unmapped-${endpoint.id}`}`;
        if (endpoint.type === "belt") return role === "sink" ? "belt" : `belt:${recorded_belt_keys.get(endpoint.id) ?? endpoint.id}`;
        return "chest";
    };

    const config_keys = config_inserters.map(ins => ({
        id: ins.id,
        key: `${configEndpointKey(ins.source, "source")}>${configEndpointKey(ins.sink, "sink")}#${filterKey(ins.filters)}`,
        unfiltered_key: `${configEndpointKey(ins.source, "source")}>${configEndpointKey(ins.sink, "sink")}`,
        has_filters: (ins.filters ?? []).length > 0,
    }));
    const recordedEndpoints = (ins: Recording["inserters"][number], mapping: Map<number, number>): string =>
        `${recordedEndpointKey(ins.source, "source", mapping)}>${recordedEndpointKey(ins.sink, "sink", mapping)}`;
    const recordedKey = (ins: Recording["inserters"][number], mapping: Map<number, number>): string => {
        const filters = recording.config.inserters[ins.id - 1]?.filters;
        return `${recordedEndpoints(ins, mapping)}#${filterKey(filters)}`;
    };

    const assignInserters = (mapping: Map<number, number>): Map<number, number> => {
        const used = new Set<number>();
        const assigned = new Map<number, number>();
        for (const ins of recording.inserters) {
            const key = recordedKey(ins, mapping);
            const match = config_keys.find(c => c.key === key && !used.has(c.id));
            if (match) {
                used.add(match.id);
                assigned.set(ins.id, match.id);
            }
        }
        // config inserters without filters pick up whatever their source offers, so match them on endpoints only
        for (const ins of recording.inserters) {
            if (assigned.has(ins.id)) continue;
            const endpoints = recordedEndpoints(ins, mapping);
            const match = config_keys.find(c => !c.has_filters && c.unfiltered_key === endpoints && !used.has(c.id));
            if (match) {
                used.add(match.id);
                assigned.set(ins.id, match.id);
            }
        }
        return assigned;
    };

    let best_mapping = candidate_mappings[0] ?? new Map<number, number>();
    let best_inserters = assignInserters(best_mapping);
    for (const mapping of candidate_mappings.slice(1)) {
        const inserters = assignInserters(mapping);
        if (inserters.size > best_inserters.size) {
            best_mapping = mapping;
            best_inserters = inserters;
        }
    }

    const mapped_config_machines = new Set(best_mapping.values());
    const mapped_config_inserters = new Set(best_inserters.values());
    return {
        machines: best_mapping,
        inserters: best_inserters,
        unmatched_recorded_machines: recording.machines.map(m => m.id).filter(id => !best_mapping.has(id)),
        unmatched_config_machines: config.machines.map(m => m.id).filter(id => !mapped_config_machines.has(id)),
        unmatched_recorded_inserters: recording.inserters.map(i => i.id).filter(id => !best_inserters.has(id)),
        unmatched_config_inserters: config_inserters.map(i => i.id).filter(id => !mapped_config_inserters.has(id)),
    };
}
