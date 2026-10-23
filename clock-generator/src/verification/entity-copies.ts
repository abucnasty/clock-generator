import { Config } from "../config";
import { EntityMatch, matchRecordingToConfig } from "./entity-matching";
import { Recording } from "./recording";

/**
 * A build can hold a config more than once: copies of a unit that share belts (an ore line past all of them, a circuit
 * line) but not machines. A copy is found from the build's machines and inserters alone: machines that an inserter
 * moves items between directly, or through a chest, are one group, and belts do not join groups, since a belt is what
 * copies share. No name of an item, recipe or entity takes part.
 */

/** The build cut into groups of machines linked by inserters, each with its machines, the inserters on them and their chests; by the lowest machine id */
export function machineGroups(recording: Recording): Recording[] {
    const parent = new Map<string, string>();
    const find = (node: string): string => {
        let root = parent.get(node) ?? node;
        parent.set(node, root);
        while (root !== (parent.get(root) ?? root)) {
            root = parent.get(root)!;
        }
        parent.set(node, root);
        return root;
    };
    const join = (a: string, b: string) => {
        const [root_a, root_b] = [find(a), find(b)];
        if (root_a !== root_b) {
            parent.set(root_b, root_a);
        }
    };
    const nodeOf = (end: { type: string; id: number }): string | null =>
        end.type === "machine" ? `machine:${end.id}` : end.type === "chest" ? `chest:${end.id}` : null;

    for (const machine of recording.machines) {
        find(`machine:${machine.id}`);
    }
    for (const inserter of recording.inserters) {
        const nodes = [nodeOf(inserter.source), nodeOf(inserter.sink)].filter((node): node is string => node !== null);
        nodes.slice(1).forEach(node => join(nodes[0], node));
    }

    const groups = new Map<string, { machines: Recording["machines"]; inserters: Recording["inserters"] }>();
    const groupOf = (root: string) => {
        let group = groups.get(root);
        if (!group) {
            group = { machines: [], inserters: [] };
            groups.set(root, group);
        }
        return group;
    };
    for (const machine of recording.machines) {
        groupOf(find(`machine:${machine.id}`)).machines.push(machine);
    }
    for (const inserter of recording.inserters) {
        const node = nodeOf(inserter.source) ?? nodeOf(inserter.sink);
        if (node !== null) {
            groupOf(find(node)).inserters.push(inserter);
        }
    }
    return Array.from(groups.values())
        .filter(group => group.machines.length > 0)
        .sort((a, b) => Math.min(...a.machines.map(m => m.id)) - Math.min(...b.machines.map(m => m.id)))
        .map(group => ({ ...recording, machines: group.machines, inserters: group.inserters }));
}

export interface CopiesMatch {
    /** One match per copy of the config in the build, in the order of their lowest machine ids; one entry for a build that holds the config once (or in no way that separates) */
    copies: EntityMatch[];
    /** All the copies' matches in one: every recorded id is in one copy only, so the maps are their union */
    merged: EntityMatch;
}

/**
 * Matches a build to a config that it may hold several times. A copy is a group of machines (see machineGroups) that
 * has a machine for every machine of the config; two or more of them are copies and each is matched to the config by
 * itself. Otherwise the build is matched as one, as it was before copies were found.
 */
export function matchCopies(recording: Recording, config: Config): CopiesMatch {
    const wanted = config.machines.length;
    const matches = machineGroups(recording).map(group => matchRecordingToConfig(group, config));
    const copies = matches.filter(match => match.machines.size >= wanted);
    if (copies.length < 2) {
        const whole = matchRecordingToConfig(recording, config);
        return { copies: [whole], merged: whole };
    }
    const machines = new Map(copies.flatMap(copy => Array.from(copy.machines)));
    const inserters = new Map(copies.flatMap(copy => Array.from(copy.inserters)));
    const mapped_config_machines = new Set(machines.values());
    return {
        copies,
        merged: {
            machines,
            inserters,
            unmatched_recorded_machines: recording.machines.map(m => m.id).filter(id => !machines.has(id)),
            unmatched_config_machines: config.machines.map(m => m.id).filter(id => !mapped_config_machines.has(id)),
            unmatched_recorded_inserters: recording.inserters.map(i => i.id).filter(id => !inserters.has(id)),
            // a config inserter is unmatched when some copy lacks it
            unmatched_config_inserters: Array.from(new Set(copies.flatMap(copy => copy.unmatched_config_inserters))),
        },
    };
}
