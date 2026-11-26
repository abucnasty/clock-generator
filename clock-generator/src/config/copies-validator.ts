import { BeltConfig, ChestConfig, Config, InserterConfig, MiningDrillConfig } from './schema';
import { CopiesUnit } from './errors';
import { assertInsertersInScope } from './inserter-scope';
import { machineRuleOf } from './machine-prototype';
import { unitsMakeTheirShare } from './speed-as-capacity';

// ============================================================================
// Units of a build
// ============================================================================
//
// A config describes ONE unit and `setpoint.copies` says how many identical units exist. A config that itself
// holds several identical units (each with its own machines and inserters) is clocked as it is given, every inserter
// where it stands: the site offers the one unit with `copies` where the conversion can make it
// (repeated-unit-conversion.ts), and says how the units differ where it cannot.
//
// A unit is a connected component of the graph whose nodes are the machines, the buffer chests and the mining drills,
// and whose edges are the inserters between two nodes and the drill-to-machine and drill-to-chest links. Infinity chests (mocks of an
// always-available source) and belts do not join units: belts are shared between the units on purpose.
//
// Two units are identical when they have the same signature: a canonical string of their nodes and of every inserter
// touching them, where belts are described by their spec (not their id) and nodes by their place in the canonical
// order (not their id). The canonical order sorts the nodes by their spec and the specs of their inserters and falls
// back to the id order only to break exact ties. Two units that differ only in the wiring order of otherwise
// identical machines may therefore be told apart or not; either is acceptable, because the check only has to catch
// the common mistake of a config that was written out copy by copy.
//
// The config holds copies when the greatest common divisor g of the number of components of each signature is above 1:
// it is g copies of a smaller unit. Components that merely repeat are fine when some signature has another count
// (two cable casters and one plastic plant are one unit of a build: {A, A, B} has a divisor of 1).
//
// Where the signatures give no copies, they are made again without machine and drill speeds: copies of a build often differ
// only in a beacon's rounded speed bonus. Units that match then are copies where each makes its share of what the build needs
// (speed-as-capacity.ts); a slower unit that does not keeps a signature of its own.

type NodeKind = 'machine' | 'chest' | 'drill';

interface UnitNode {
    key: string;
    kind: NodeKind;
    id: number;
    spec: string;
}

/** One end of an edge: a node of the unit, or something outside it (a belt, an infinity chest) by its spec */
type EdgeEnd = { node: string } | { outside: string };

interface UnitEdge {
    from: EdgeEnd;
    to: EdgeEnd;
    label: string;
}

/** A connected component of the build and its signature */
export interface BuildUnit {
    /** The ids of the machines of the unit, ascending */
    machine_ids: number[];
    /** Two units with the same signature are identical */
    signature: string;
}

export interface RepeatedUnits {
    /** Every unit found that has a machine, ordered by its lowest machine id */
    units: BuildUnit[];
    /** The greatest common divisor of the number of units of each signature; above 1 means copies were written out */
    gcd: number;
    /** The identical copies when gcd is above 1, with the machine ids of each; empty otherwise */
    copies: CopiesUnit[];
}

const nodeKey = (kind: NodeKind, id: number): string => `${kind}:${id}`;

// The rule is a stand-in for what the prototype decides (recipe selection, the modelled burner's energy usage and fuel):
// it holds while one prototype has each rule's burner (the biochamber alone burns nutrients). The recycler's places-results
// is not in the key either. Keying on the traits waits until after the R4 replay, as it may change which units match.
function machineSpec(machine: Config['machines'][number], with_speed = true): string {
    return `machine|${machine.recipe}|${with_speed ? machine.crafting_speed : ''}|${machine.productivity}|${machineRuleOf(machine)}|${machine.fuel ?? ''}|${machine.energy_consumption_bonus ?? ''}`;
}

function chestSpec(chest: ChestConfig): string {
    if (chest.type === 'buffer-chest') {
        return `chest|${chest.type}|${chest.storage_size}|${chest.item_filter}`;
    }
    if (chest.type === 'infinity-chest') {
        return `chest|${chest.type}|${JSON.stringify(chest.item_filter)}|${chest.remove_unfiltered_items ?? false}`;
    }
    // where it stands is not a setting: copies of a build differ in it
    const { id: _id, position: _position, ...settings } = chest;
    return `chest|${chest.type}|${JSON.stringify(settings)}`;
}

function drillSpec(drill: MiningDrillConfig, with_speed = true): string {
    return `drill|${drill.type}|${drill.mined_item_name}|${with_speed ? drill.speed_bonus : ''}|${JSON.stringify(drill.overrides ?? null)}`;
}

function beltSpec(belt: BeltConfig | undefined, nearLane: number | undefined): string {
    if (belt === undefined) {
        return 'belt|unknown';
    }
    return `belt|${belt.type}|${belt.strategy ?? 'normal'}|${JSON.stringify(belt.lanes)}|${nearLane ?? ''}`;
}

function inserterLabel(inserter: InserterConfig): string {
    const filters = [...(inserter.filters ?? [])].sort().join(',');
    return `inserter|${inserter.prototype ?? ''}|${inserter.quality ?? ''}|${inserter.stack_size ?? ''}|${filters}|${JSON.stringify(inserter.overrides ?? null)}`;
}

/** The unit-node an inserter endpoint refers to, or the spec of what is outside the units */
function endOfInserter(config: Config, end: InserterConfig['source'], nodes: Map<string, UnitNode>): EdgeEnd {
    if (end.type === 'machine') {
        return { node: nodeKey('machine', end.id) };
    }
    if (end.type === 'chest') {
        const key = nodeKey('chest', end.id);
        if (nodes.has(key)) {
            return { node: key };
        }
        const chest = config.chests?.find(it => it.id === end.id);
        return { outside: chest === undefined ? 'chest|unknown' : chestSpec(chest) };
    }
    return { outside: beltSpec(config.belts.find(it => it.id === end.id), end.near_lane) };
}

/** Unit nodes, edges and the components they form; without speed, machine and drill speeds are left out of the node specs */
function unitsOf(config: Config, with_speed = true): { nodes: UnitNode[]; edges: UnitEdge[]; components: UnitNode[][] } {
    const nodes = new Map<string, UnitNode>();
    for (const machine of config.machines) {
        const key = nodeKey('machine', machine.id);
        nodes.set(key, { key, kind: 'machine', id: machine.id, spec: machineSpec(machine, with_speed) });
    }
    for (const chest of config.chests ?? []) {
        // a chest that holds what it holds is part of a unit; an infinity chest is a supply or a sink outside it
        if (chest.type !== 'infinity-chest') {
            const key = nodeKey('chest', chest.id);
            nodes.set(key, { key, kind: 'chest', id: chest.id, spec: chestSpec(chest) });
        }
    }
    for (const drill of config.drills?.configs ?? []) {
        const key = nodeKey('drill', drill.id);
        nodes.set(key, { key, kind: 'drill', id: drill.id, spec: drillSpec(drill, with_speed) });
    }

    const edges: UnitEdge[] = [];
    for (const inserter of config.inserters) {
        edges.push({
            from: endOfInserter(config, inserter.source, nodes),
            to: endOfInserter(config, inserter.sink, nodes),
            label: inserterLabel(inserter),
        });
    }
    for (const drill of config.drills?.configs ?? []) {
        // into a machine, or into a chest: a chest that holds what it holds is a node, an infinity chest is outside
        const to = drill.target.type === 'chest' ? endOfInserter(config, drill.target, nodes) : { node: nodeKey('machine', drill.target.id) };
        edges.push({ from: { node: nodeKey('drill', drill.id) }, to, label: 'mines-into' });
    }

    // Union-find over the edges whose both ends are nodes.
    const parent = new Map<string, string>([...nodes.keys()].map(key => [key, key]));
    const find = (key: string): string => {
        let root = key;
        while (parent.get(root) !== root) {
            root = parent.get(root)!;
        }
        parent.set(key, root);
        return root;
    };
    for (const edge of edges) {
        if ('node' in edge.from && 'node' in edge.to && nodes.has(edge.from.node) && nodes.has(edge.to.node)) {
            parent.set(find(edge.from.node), find(edge.to.node));
        }
    }
    const byRoot = new Map<string, UnitNode[]>();
    for (const node of nodes.values()) {
        const root = find(node.key);
        byRoot.set(root, [...(byRoot.get(root) ?? []), node]);
    }
    return { nodes: [...nodes.values()], edges, components: [...byRoot.values()] };
}

/** The edges that touch the node, each described from the node's point of view with the other end by its spec */
function incidentEdges(node: UnitNode, edges: UnitEdge[], describeNode: (key: string) => string): string[] {
    const describe = (end: EdgeEnd): string => 'node' in end
        ? (end.node === node.key ? 'self' : describeNode(end.node))
        : end.outside;
    return edges
        .filter(edge => ('node' in edge.from && edge.from.node === node.key) || ('node' in edge.to && edge.to.node === node.key))
        .map(edge => `${edge.label}>${describe(edge.from)}>${describe(edge.to)}`)
        .sort();
}

function signatureOf(component: UnitNode[], edges: UnitEdge[], nodes: Map<string, UnitNode>): string {
    // First pass: a node is described by its spec and the specs of its inserters, with the other nodes by spec only.
    const specOf = (key: string): string => nodes.get(key)!.spec;
    const firstPass = new Map(component.map(node =>
        [node.key, `${node.spec}{${incidentEdges(node, edges, specOf).join(';')}}`] as const));
    const ordered = [...component].sort((a, b) =>
        firstPass.get(a.key)!.localeCompare(firstPass.get(b.key)!) || a.id - b.id);
    // Second pass: the wiring by place in that order, so that ids play no part.
    const place = new Map(ordered.map((node, index) => [node.key, index] as const));
    const placeOf = (key: string): string => `#${place.get(key)}`;
    return ordered
        .map(node => `${node.spec}{${incidentEdges(node, edges, placeOf).join(';')}}`)
        .join('\n');
}

function greatestCommonDivisor(a: number, b: number): number {
    return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** How units are compared: with speed, a machine's or drill's speed is part of the signature; as capacity (the default), units that
 * match only without their speeds are copies where each makes its share (speed-as-capacity.ts), once the signatures with speed find none */
export type UnitSpeed = 'with-speed' | 'as-capacity';

/**
 * Finds out whether the config holds several identical units of a build. Returns the units found and, when the
 * config is that many copies of a smaller unit, the copies with the machine ids of each.
 *
 * Where the signatures with speed give no copies, the units are compared again without machine and drill speeds (`speed`
 * `as-capacity`, the default): of the units that match then, each one that makes its share of every producer group the set holds
 * counts as one signature, and each other keeps its own. Those sets are used where they give copies.
 */
export function findRepeatedUnits(config: Config, speed: UnitSpeed = 'as-capacity'): RepeatedUnits {
    const { nodes, edges, components } = unitsOf(config);
    const nodeMap = new Map(nodes.map(node => [node.key, node] as const));
    const machineIdsOf = (component: UnitNode[]) => component.filter(node => node.kind === 'machine').map(node => node.id).sort((a, b) => a - b);
    const found = components
        .map(component => ({ machine_ids: machineIdsOf(component), component }))
        .filter(it => it.machine_ids.length > 0)
        .sort((a, b) => a.machine_ids[0] - b.machine_ids[0])
        .map(it => ({ unit: { machine_ids: it.machine_ids, signature: signatureOf(it.component, edges, nodeMap) }, component: it.component }));
    const units: BuildUnit[] = found.map(it => it.unit);

    const groupsOf = (key: (unit: BuildUnit, index: number) => string) => {
        const out = new Map<string, BuildUnit[]>();
        units.forEach((unit, index) => out.set(key(unit, index), [...(out.get(key(unit, index)) ?? []), unit]));
        return out;
    };
    const gcdOf = (groups: Map<string, BuildUnit[]>) => [...groups.values()].reduce((g, group) => greatestCommonDivisor(g, group.length), 0) || 1;
    let bySignature = groupsOf(unit => unit.signature);
    let gcd = gcdOf(bySignature);
    if (gcd <= 1 && speed === 'as-capacity' && units.length > 1) {
        // the same components, their signatures without speed: each set of units that match then, split by whether each makes its share
        const loose = unitsOf(config, false);
        const looseMap = new Map(loose.nodes.map(node => [node.key, node] as const));
        const looseSignature = new Map(loose.components.filter(component => component.some(node => node.kind === 'machine'))
            .map(component => [machineIdsOf(component).join(','), signatureOf(component, loose.edges, looseMap)] as const));
        const sets = new Map<string, number[]>();
        units.forEach((unit, index) => {
            const key = looseSignature.get(unit.machine_ids.join(',')) ?? unit.signature;
            sets.set(key, [...(sets.get(key) ?? []), index]);
        });
        const keyOfUnit = new Map<number, string>();
        for (const [key, members] of sets) {
            const makes = unitsMakeTheirShare(config, members.map(index => found[index].component
                .filter(node => node.kind === 'machine' || node.kind === 'drill').map(node => node.key)));
            members.forEach((index, at) => keyOfUnit.set(index, makes[at] ? `capacity|${key}` : `own|${units[index].signature}`));
        }
        const regrouped = groupsOf((_, index) => keyOfUnit.get(index)!);
        const regrouped_gcd = gcdOf(regrouped);
        if (regrouped_gcd > 1) {
            bySignature = regrouped;
            gcd = regrouped_gcd;
        }
    }
    if (gcd <= 1) {
        return { units, gcd, copies: [] };
    }

    // Copy k takes the k-th share of the units of every signature, in the order of their lowest machine id.
    const copies: CopiesUnit[] = Array.from({ length: gcd }, () => ({ machine_ids: [] as number[] }));
    for (const group of bySignature.values()) {
        const share = group.length / gcd;
        group.forEach((unit, index) => copies[Math.floor(index / share)].machine_ids.push(...unit.machine_ids));
    }
    copies.forEach(copy => copy.machine_ids.sort((a, b) => a - b));
    return { units, gcd, copies };
}

/**
 * Checks what a build of copies needs of its inserters (`assertInsertersInScope`). A config that holds several identical
 * units of a build is not refused: it is clocked as given (`findRepeatedUnits` names its copies).
 */
export function validateCopies(config: Config): void {
    assertInsertersInScope(config);
}
