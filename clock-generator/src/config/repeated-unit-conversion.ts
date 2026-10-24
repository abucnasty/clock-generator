import { Config, ConfigSchema } from './schema';
import { findRepeatedUnits, validateCopies } from './copies-validator';
import { CopiesError } from './errors';
import { fraction } from '../data-types/fraction';
import { orderByMachineDependencies } from '../common/order-by-machine-dependencies';

export type ConversionEntityKind = 'machines' | 'inserters' | 'belts' | 'chests' | 'drills';
export interface RetainedConversionEntity { sourceIndex: number; sourceId?: number; resultId: number }
export type RetainedConversionEntities = Record<ConversionEntityKind, RetainedConversionEntity[]>;
export type RepeatedUnitConversionReasonCode = 'invalid-config' | 'invalid-references' | 'not-repeated'
    | 'unassigned-entities' | 'nonuniform-units' | 'unsupported-boundary' | 'unsupported-order'
    | 'copies-not-representable' | 'candidate-still-repeated';
export interface RepeatedUnitConversionReason { code: RepeatedUnitConversionReasonCode; message: string }
export interface RepeatedUnitConversionPlan {
    kind: 'available'; sourceConfigKey: string; multiplicity: number; previousCopies: number; copies: number;
    candidate: Config; retained: RetainedConversionEntities;
}
export type RepeatedUnitConversionResult = RepeatedUnitConversionPlan
    | { kind: 'unavailable'; reason: RepeatedUnitConversionReason };

const kinds: ConversionEntityKind[] = ['machines', 'inserters', 'belts', 'chests', 'drills'];
type Row = { id?: number };
type NodeKind = 'machine' | 'chest' | 'drill';
type End = Config['inserters'][number]['source'];
const keyOf = (kind: string, id: number): string => `${kind}:${id}`;
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
class Refusal extends Error {
    constructor(readonly code: RepeatedUnitConversionReasonCode, message: string) { super(message); }
}
function refuse(code: RepeatedUnitConversionReasonCode, message: string): never { throw new Refusal(code, message); }

/** Preserve property presence and ordered arrays; canonicalize only object-key order. */
function canonical(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function clone<T>(value: T): T {
    if (Array.isArray(value)) return value.map(clone) as T;
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])) as T;
    }
    return value;
}
/** Zod strips unknown keys. Check coverage without adopting its normalized output. */
function supported(source: unknown, parsed: unknown): boolean {
    if (source === null || typeof source !== 'object') return typeof source !== 'number' || Number.isFinite(source);
    if (parsed === null || typeof parsed !== 'object') return false;
    return Object.keys(source).every(key => own(parsed, key)
        && supported((source as Record<string, unknown>)[key], (parsed as Record<string, unknown>)[key]));
}
function arrays(config: Config): Record<ConversionEntityKind, Row[]> {
    return { machines: config.machines, inserters: config.inserters, belts: config.belts,
        chests: config.chests ?? [], drills: config.drills?.configs ?? [] };
}
interface Component { nodes: Set<string>; inserters: number[]; minimumMachine: number }
interface Analysis {
    rows: Record<ConversionEntityKind, Row[]>;
    ids: Record<ConversionEntityKind, Map<number, number>>;
    components: Component[];
    componentOf: Map<string, number>;
    users: Map<string, Set<number>>;
}

/** Validate every reference and assign every row, including machine-free subsystems. */
function analyze(config: Config): Analysis {
    const parsed = ConfigSchema.safeParse(config);
    if (!parsed.success || !supported(config, parsed.data)) {
        refuse('invalid-config', 'The selection contains invalid or unsupported configuration fields.');
    }
    const rows = arrays(config);
    const ids = {} as Analysis['ids'];
    for (const kind of kinds) {
        ids[kind] = new Map();
        let previous = 0;
        rows[kind].forEach((row, index) => {
            const id = row.id ?? index + 1;
            if (ids[kind].has(id)) refuse('invalid-references', `Duplicate ${kind} ID ${id}.`);
            ids[kind].set(id, index);
            if (id <= previous) refuse('unsupported-order', 'Entity IDs must increase in their original row order.');
            previous = id;
        });
    }
    const endpointKind = (end: End): ConversionEntityKind => end.type === 'machine' ? 'machines' : end.type === 'belt' ? 'belts' : 'chests';
    const checkEnd = (end: End): void => {
        const index = ids[endpointKind(end)].get(end.id);
        if (index === undefined) refuse('invalid-references', `Missing ${end.type} ${end.id}.`);
        if (end.type === 'belt') {
            const lane = end.near_lane ?? end.drop?.lane;
            if (lane !== undefined && lane > config.belts[index].lanes.length) {
                refuse('invalid-references', `Belt ${end.id} does not contain lane ${lane}.`);
            }
        }
    };
    config.inserters.forEach(ins => { checkEnd(ins.source); checkEnd(ins.sink); });
    const parent = new Map<string, string>();
    config.machines.forEach(row => parent.set(keyOf('machine', row.id), keyOf('machine', row.id)));
    config.chests?.filter(row => row.type === 'buffer-chest').forEach(row => parent.set(keyOf('chest', row.id), keyOf('chest', row.id)));
    config.drills?.configs.forEach(row => parent.set(keyOf('drill', row.id), keyOf('drill', row.id)));
    const find = (key: string): string => {
        const next = parent.get(key)!;
        if (next === key) return key;
        const root = find(next);
        parent.set(key, root);
        return root;
    };
    const join = (a: string, b: string): void => { parent.set(find(a), find(b)); };
    config.inserters.forEach(ins => {
        const a = keyOf(ins.source.type, ins.source.id), b = keyOf(ins.sink.type, ins.sink.id);
        if (parent.has(a) && parent.has(b)) join(a, b);
    });
    config.drills?.configs.forEach(drill => {
        // the copies of a drill into a chest are not converted (yet): the conversion follows a drill to its machine
        if (drill.target.type !== 'machine') refuse('unsupported-boundary', 'A drill into a chest is not supported in a repeated unit.');
        if (!ids.machines.has(drill.target.id)) refuse('invalid-references', `Missing drill target ${drill.target.id}.`);
        join(keyOf('drill', drill.id), keyOf('machine', drill.target.id));
    });
    const groups = new Map<string, Set<string>>();
    for (const key of parent.keys()) {
        const root = find(key);
        if (!groups.has(root)) groups.set(root, new Set());
        groups.get(root)!.add(key);
    }
    const components: Component[] = [...groups.values()].map(nodes => {
        const machines = config.machines.filter(row => nodes.has(keyOf('machine', row.id)));
        if (machines.length === 0) refuse('unassigned-entities', 'A buffer chest or drill belongs to a subsystem without a machine.');
        return { nodes, inserters: [], minimumMachine: Math.min(...machines.map(row => row.id)) };
    });
    const componentOf = new Map<string, number>();
    components.forEach((component, index) => component.nodes.forEach(key => componentOf.set(key, index)));
    const users = new Map<string, Set<number>>();
    config.belts.forEach(row => users.set(keyOf('belt', row.id), new Set()));
    config.chests?.filter(row => row.type === 'infinity-chest').forEach(row => users.set(keyOf('chest', row.id), new Set()));
    config.inserters.forEach((ins, index) => {
        const ends = [ins.source, ins.sink];
        const touching = ends.map(end => componentOf.get(keyOf(end.type, end.id))).filter((it): it is number => it !== undefined);
        if (touching.length === 0) refuse('unassigned-entities', 'An inserter belongs to a subsystem without a machine.');
        const component = touching[0];
        if (touching.some(it => it !== component)) throw new Error('Incomplete component union');
        components[component].inserters.push(index);
        ends.forEach(end => users.get(keyOf(end.type, end.id))?.add(component));
        if (ins.sink.type === 'chest' && users.has(keyOf('chest', ins.sink.id))) {
            refuse('unsupported-boundary', 'Infinity chests are supported only as external sources.');
        }
    });
    for (const [key, usedBy] of users) {
        if (usedBy.size === 0) refuse('unassigned-entities', 'An unreferenced belt or infinity chest cannot be assigned to a complete unit.');
        if (key.startsWith('belt:')) {
            const belt = config.belts[ids.belts.get(Number(key.slice(5)))!];
            if (belt.strategy === 'export') refuse('unsupported-boundary', 'Export belts have fixed external demand and cannot be converted automatically.');
            if (usedBy.size > 1 && config.inserters.some(ins => ins.sink.type === 'belt' && ins.sink.id === belt.id && ins.sink.drop !== undefined)) {
                refuse('unsupported-boundary', 'A shared belt has coupled drop coordinates. Select one complete unit in Factorio.');
            }
        }
    }
    return { rows, ids, components, componentOf, users };
}

type Place = { x: number; y: number } | undefined;

/**
 * The witness explicitly labels every local member and every private resource alias. Where the members stand is no part of
 * it (copies stand apart); it comes back beside it, in the order of the witness, for the gap between copies.
 */
function witness(config: Config, analysis: Analysis, component: Component): { proof: unknown; places: Place[] } {
    const local = new Map<string, string>();
    const members = (kind: NodeKind, rows: { id: number }[]): { id: number }[] => rows.filter(row => component.nodes.has(keyOf(kind, row.id)));
    const machines = members('machine', config.machines);
    const chests = members('chest', config.chests ?? []);
    const drills = members('drill', config.drills?.configs ?? []);
    ([['machine', machines], ['chest', chests], ['drill', drills]] as const).forEach(([kind, rows]) =>
        rows.forEach((row, index) => local.set(keyOf(kind, row.id), keyOf(kind, index))));
    const privateRoles = new Map<string, string>();
    const resource = (key: string): Row => {
        const [kind, id] = key.split(':');
        const category = kind === 'belt' ? 'belts' : 'chests';
        return analysis.rows[category][analysis.ids[category].get(Number(id))!];
    };
    const places: Place[] = [];
    const withoutId = (row: Row): unknown => {
        const { id: _id, position: _position, ...rest } = row as Row & { position?: { x: number; y: number } };
        return { ownIdPresent: own(row, 'id'), record: rest };
    };
    const placed = (rows: Row[]): void => rows.forEach(row => places.push((row as Row & { position?: { x: number; y: number } }).position));
    const end = (endpoint: End): unknown => {
        const key = keyOf(endpoint.type, endpoint.id);
        let label: unknown = local.get(key);
        if (label === undefined) {
            if (analysis.users.get(key)!.size > 1) label = { shared: key, record: resource(key) };
            else {
                if (!privateRoles.has(key)) {
                    const roleIndex = [...privateRoles.keys()].filter(it => it.startsWith(`${endpoint.type}:`)).length;
                    privateRoles.set(key, keyOf(endpoint.type, roleIndex));
                }
                label = { private: privateRoles.get(key) };
            }
        }
        return { ...endpoint, id: label };
    };
    // Compare the order the simulator actually executes, rather than incidental Sidecar export order.
    // Stable ties still distinguish competing inserters; filter, rule and resource order stay intact.
    const executionOrder = orderByMachineDependencies(component.inserters,
        index => {
            const source = config.inserters[index].source;
            return source.type === 'machine' ? keyOf(source.type, source.id) : undefined;
        },
        index => {
            const sink = config.inserters[index].sink;
            return keyOf(sink.type, sink.id);
        });
    placed(machines); placed(chests); placed(drills);
    placed(executionOrder.map(index => config.inserters[index]));
    const inserters = executionOrder.map(index => {
        const ins = config.inserters[index];
        return withoutId({ ...ins, source: end(ins.source), sink: end(ins.sink) } as Row);
    });
    const proof = {
        machines: machines.map(withoutId), chests: chests.map(withoutId),
        drills: drills.map(row => {
            const drill = row as NonNullable<Config['drills']>['configs'][number];
            return withoutId({ ...drill, target: { ...drill.target, id: local.get(keyOf('machine', drill.target.id)) } } as Row);
        }), inserters,
        // Preserve private resource execution order as well as encounter-based aliasing.
        privateResources: (['belts', 'chests'] as const).map(kind => analysis.rows[kind].flatMap(row => {
            const key = keyOf(kind === 'belts' ? 'belt' : 'chest', row.id!);
            return privateRoles.has(key) ? [{ role: privateRoles.get(key), record: withoutId(row) }] : [];
        })),
    };
    return { proof, places };
}
function equalWitness(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a), other = Object.keys(b);
    return keys.length === other.length && keys.every(key => own(b, key)
        && equalWitness((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

/**
 * Where the next copy stands from the one before it: the same step from every member of a unit to its counterpart in the
 * next, for every unit of every group. None when a member has no place or the steps differ.
 */
function copyOffsetOf(groups: Iterable<{ places: Place[] }[]>, multiplicity: number): { x: number; y: number } | undefined {
    let offset: { x: number; y: number } | undefined;
    for (const group of groups) {
        const step = group.length / multiplicity;
        for (let unit = 0; unit < step; unit++) {
            for (let copy = 1; copy < multiplicity; copy++) {
                const before = group[unit + (copy - 1) * step].places, after = group[unit + copy * step].places;
                for (let member = 0; member < before.length; member++) {
                    const a = before[member], b = after[member];
                    if (a === undefined || b === undefined) return undefined;
                    const moved = { x: Number((b.x - a.x).toFixed(6)), y: Number((b.y - a.y).toFixed(6)) };
                    if (offset === undefined) offset = moved;
                    else if (offset.x !== moved.x || offset.y !== moved.y) return undefined;
                }
            }
        }
    }
    return offset !== undefined && (offset.x !== 0 || offset.y !== 0) ? offset : undefined;
}

function multipliedCopies(copies: number, multiplicity: number): number {
    const source = fraction(copies), exact = source.multiply(multiplicity);
    const safe = (value: typeof source): boolean => Number.isSafeInteger(value.getNumerator) && Number.isSafeInteger(value.getDenominator);
    if (!safe(source) || !safe(exact)
        || BigInt(exact.getNumerator) * BigInt(source.getDenominator)
            !== BigInt(source.getNumerator) * BigInt(multiplicity) * BigInt(exact.getDenominator)) {
        refuse('copies-not-representable', 'The multiplied Copies value cannot be represented exactly.');
    }
    const value = exact.toDecimal(), roundtrip = fraction(value);
    if (!Number.isFinite(value) || value <= 0 || !safe(roundtrip)
        || BigInt(roundtrip.getNumerator) * BigInt(exact.getDenominator)
            !== BigInt(exact.getNumerator) * BigInt(roundtrip.getDenominator)) {
        refuse('copies-not-representable', 'The multiplied Copies value cannot be represented exactly.');
    }
    return value;
}

/** A sufficient ordered structural proof; ordinary candidate planning remains a separate worker Check. */
export function planRepeatedUnitConversion(config: Config): RepeatedUnitConversionResult {
    try {
        const analysis = analyze(config);
        const groups = new Map<string, { component: Component; witness: unknown; places: Place[] }[]>();
        for (const component of analysis.components) {
            const { proof, places } = witness(config, analysis, component), signature = canonical(proof);
            const group = groups.get(signature) ?? [];
            if (group.length > 0 && !equalWitness(group[0].witness, proof)) {
                refuse('nonuniform-units', 'Complete ordered unit correspondence could not be verified.');
            }
            group.push({ component, witness: proof, places });
            groups.set(signature, group);
        }
        const multiplicity = [...groups.values()].reduce((value, group) => gcd(value, group.length), 0);
        if (multiplicity <= 1) {
            const detected = findRepeatedUnits(config).gcd > 1;
            refuse(detected ? 'nonuniform-units' : 'not-repeated', detected
                ? 'The complete ordered units differ in their wiring, resources or configuration.' : 'No complete repeated modeled unit was found.');
        }
        const keptNodes = new Set<string>(), keptInserters = new Set<number>();
        for (const group of groups.values()) {
            group.sort((a, b) => a.component.minimumMachine - b.component.minimumMachine);
            group.slice(0, group.length / multiplicity).forEach(({ component }) => {
                component.nodes.forEach(key => keptNodes.add(key));
                component.inserters.forEach(index => keptInserters.add(index));
            });
        }
        const keptResources = new Set<string>();
        keptInserters.forEach(index => {
            const ins = config.inserters[index];
            [ins.source, ins.sink].forEach(end => keptResources.add(keyOf(end.type, end.id)));
        });
        const retained = {} as RetainedConversionEntities;
        const maps = {} as Record<ConversionEntityKind, Map<number, number>>;
        for (const kind of kinds) {
            retained[kind] = [];
            maps[kind] = new Map();
            analysis.rows[kind].forEach((row, sourceIndex) => {
                const id = row.id ?? sourceIndex + 1;
                const key = keyOf(kind === 'machines' ? 'machine' : kind === 'drills' ? 'drill' : kind === 'belts' ? 'belt' : 'chest', id);
                const keep = kind === 'inserters' ? keptInserters.has(sourceIndex) : keptNodes.has(key) || keptResources.has(key);
                if (!keep) return;
                const resultId = retained[kind].length + 1;
                retained[kind].push({ sourceIndex, ...(own(row, 'id') ? { sourceId: row.id } : {}), resultId });
                maps[kind].set(id, resultId);
            });
        }
        const mapped = (kind: ConversionEntityKind, id: number): number => {
            const value = maps[kind].get(id);
            if (value === undefined) throw new Error(`Incomplete retained ${kind} reference ${id}`);
            return value;
        };
        const endpoint = (end: End): End => ({ ...end, id: mapped(end.type === 'machine' ? 'machines' : end.type === 'belt' ? 'belts' : 'chests', end.id) });
        const candidate = clone(config);
        candidate.machines = retained.machines.map(it => ({ ...candidate.machines[it.sourceIndex], id: it.resultId }));
        candidate.inserters = retained.inserters.map(it => {
            const row = candidate.inserters[it.sourceIndex];
            return { ...row, id: it.resultId, source: endpoint(row.source), sink: endpoint(row.sink) };
        });
        candidate.belts = retained.belts.map(it => ({ ...candidate.belts[it.sourceIndex], id: it.resultId }));
        if (candidate.chests) candidate.chests = retained.chests.map(it => ({ ...candidate.chests![it.sourceIndex], id: it.resultId }));
        if (candidate.drills) candidate.drills.configs = retained.drills.map(it => {
            const row = candidate.drills!.configs[it.sourceIndex];
            return { ...row, id: it.resultId, target: { ...row.target, id: mapped('machines', row.target.id) } };
        });
        const copies = multipliedCopies(config.target_output.copies, multiplicity);
        candidate.target_output.copies = copies;
        // where the next copy stands, read from the places of the copies; a config that had copies already says nothing of it
        const offset = config.target_output.copies === 1 ? copyOffsetOf(groups.values(), multiplicity) : undefined;
        delete candidate.target_output.copy_offset;
        if (offset !== undefined) candidate.target_output.copy_offset = offset;
        if (!ConfigSchema.safeParse(candidate).success) refuse('copies-not-representable', 'The multiplied Copies value is outside the supported schema.');
        analyze(candidate);
        try { validateCopies(candidate); } catch (error) {
            if (!(error instanceof CopiesError)) throw error;
            refuse('candidate-still-repeated', 'The retained composition still contains repetition under the existing Copies check.');
        }
        return { kind: 'available', sourceConfigKey: JSON.stringify(config), multiplicity,
            previousCopies: config.target_output.copies, copies, candidate, retained };
    } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        return { kind: 'unavailable', reason: { code: error.code, message: error.message } };
    }
}
