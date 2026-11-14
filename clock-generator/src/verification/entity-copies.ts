import { Config } from "../config";
import { EntityId } from "../entities/entity-id";
import { EntityMatch, matchRecordingToConfig } from "./entity-matching";
import { Recording } from "./recording";

/**
 * A build can hold a config more than once: copies of a unit that share belts (an ore line past all of them, a circuit
 * line) but not machines. A copy is found from the build's machine and inserter links: machines that an inserter
 * moves items between directly, or through a chest, are one group, as are machines that place their results there
 * themselves. Belts do not join groups, since a belt is what copies share. No item, recipe or entity name takes part.
 */

/** The build cut into groups linked by inserters or direct result targets, ordered by the lowest machine id */
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
    const recorded_machine_ids = new Set(recording.machines.map(machine => machine.id));
    const metadata = recording.config.machines;
    const configured_machines = Array.isArray(metadata) ? metadata as Pick<Config["machines"][number], "id" | "result_target">[] : [];
    const result_targets = new Map(configured_machines.map(machine => [machine.id, machine.result_target]));
    for (const machine of recording.machines) {
        const target = result_targets.get(machine.id);
        if (target === undefined || (target.type === "machine" && !recorded_machine_ids.has(target.id))) continue;
        const node = nodeOf(target);
        if (node !== null) join(`machine:${machine.id}`, node);
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
    /**
     * Where a part copy was asked for: the groups that are the part copy (none, one, or more than one, which the caller
     * refuses), each with the part it is, and the groups that are neither a whole copy nor a part copy. Their entities
     * are in `merged` only for the one part copy, when there is exactly one.
     */
    parts?: { match: EntityMatch; ids: ReadonlySet<string> }[];
    others?: Recording[];
}

/**
 * The config cut down to the entities of a part copy (`ids`, as `EntityId` names them: "machine:1", "inserter:5"): its
 * machines, inserters, chests and drills, each inserter with its id from the whole config, and every belt
 */
export function partConfigOf(config: Config, ids: ReadonlySet<string>): Config {
    return {
        ...config,
        machines: config.machines.filter(machine => ids.has(EntityId.forMachine(machine.id).id)),
        inserters: config.inserters.map((inserter, index) => ({ ...inserter, id: inserter.id ?? index + 1 }))
            .filter(inserter => ids.has(EntityId.forInserter(inserter.id).id)),
        ...(config.chests && { chests: config.chests.filter(chest => ids.has(EntityId.forChest(chest.id).id)) }),
        ...(config.drills && { drills: { ...config.drills, configs: config.drills.configs.filter(drill => ids.has(EntityId.forDrill(drill.id).id)) } }),
    };
}

/** Whether a group of the build is the part copy `part` of the config: every machine and inserter of it, and no machine more */
function matchPart(group: Recording, part: Config): EntityMatch | null {
    const match = matchRecordingToConfig(group, part);
    return match.machines.size === part.machines.length && group.machines.length === part.machines.length
        && match.unmatched_config_inserters.length === 0 ? match : null;
}

/**
 * Matches a build to a config that it may hold several times. A copy is a group of machines (see machineGroups) that
 * has a machine for every machine of the config; two or more of them are copies and each is matched to the config by
 * itself. Otherwise the build is matched as one, as it was before copies were found.
 *
 * With `parts` (the entities a part copy of the config holds, one set for each way the generator may lay it out), a
 * group that is no whole copy is matched to each part in turn (`partConfigOf`): a group with every machine and inserter
 * of a part and no machine more is a part copy. The whole copies are then counted as found, however few.
 */
export function matchCopies(recording: Recording, config: Config, parts?: readonly ReadonlySet<string>[]): CopiesMatch {
    const wanted = config.machines.length;
    const groups = machineGroups(recording);
    const matches = groups.map(group => matchRecordingToConfig(group, config));
    const copies = matches.filter(match => match.machines.size >= wanted);
    // a part copy asked for (a build of whole copies and one part copy): each group that is no whole copy is the part copy or
    // something else, and the whole copies are counted as they are, however few
    const found_parts = parts === undefined ? undefined : groups.flatMap((group, index) => {
        if (matches[index].machines.size >= wanted) return [];
        for (const ids of parts) {
            const match = matchPart(group, partConfigOf(config, ids));
            if (match) return [{ match, ids, group }];
        }
        return [];
    });
    const others = parts === undefined ? undefined
        : groups.filter((group, index) => matches[index].machines.size < wanted && !found_parts!.some(part => part.group === group));
    if (parts === undefined && copies.length < 2) {
        const whole = matchRecordingToConfig(recording, config);
        return { copies: [whole], merged: whole };
    }
    const counted = found_parts?.length === 1 ? [...copies, found_parts[0].match] : copies;
    const machines = new Map(counted.flatMap(copy => Array.from(copy.machines)));
    const inserters = new Map(counted.flatMap(copy => Array.from(copy.inserters)));
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
        ...(found_parts && { parts: found_parts.map(({ match, ids }) => ({ match, ids })), others }),
    };
}
