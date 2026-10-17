import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { DROP_BELT_READ_ONLY, effectiveInserterStackSize, hasImportedBeltDrops } from '../inserterMetadata';
import { entityLabel } from '../entityLabel';
import { nextId } from './edits';
import {
    BELT_FORM_DEFAULT_STACK_SIZE,
    BELT_FORM_DEFAULT_TYPE,
    type BeltFormData,
    type BeltLaneFormData,
    type ConfigFormData,
    type InfinityChestFormData,
    type InserterFormData,
} from './formData';

/** The most common belt type of the form, for a belt the fix adds */
function inferBeltType(prev: ConfigFormData): BeltFormData['type'] {
    if (prev.belts.length === 0) return BELT_FORM_DEFAULT_TYPE;
    const counts = new Map<string, number>();
    for (const belt of prev.belts) {
        counts.set(belt.type, (counts.get(belt.type) ?? 0) + 1);
    }
    let best: BeltFormData['type'] = BELT_FORM_DEFAULT_TYPE;
    let max = 0;
    for (const [type, count] of counts) {
        if (count > max) { max = count; best = type as BeltFormData['type']; }
    }
    return best;
}

/** The most common inserter stack size of the form, for an inserter the fix adds */
function inferStackSize(prev: ConfigFormData): number {
    if (prev.inserters.length === 0) return BELT_FORM_DEFAULT_STACK_SIZE;
    const counts = new Map<number, number>();
    for (const ins of prev.inserters) {
        const size = effectiveInserterStackSize(ins);
        if (Number.isFinite(size)) counts.set(size, (counts.get(size) ?? 0) + 1);
    }
    let best = BELT_FORM_DEFAULT_STACK_SIZE;
    let max = 0;
    for (const [size, count] of counts) {
        if (count > max) { max = count; best = size; }
    }
    return best;
}

/** Why an offered repair cannot change this build's imported geometry. */
export function inserterFixProblem(config: Pick<ConfigFormData, 'inserters' | 'belts'>, fix: InserterFixOption, issue?: InserterCoverageIssue): string | null {
    const beltId = fix.type === 'add_lane_to_existing_belt' ? fix.belt_id
        : fix.type === 'existing_connection' && fix.endpoint_type === 'belt' && issue?.kind === 'missing_output_inserter' ? fix.endpoint_id : null;
    return beltId !== null && config.belts.some(belt => belt.id === beltId)
        && hasImportedBeltDrops(config.inserters, beltId)
        ? `${entityLabel('belt', beltId)}: ${DROP_BELT_READ_ONLY}` : null;
}

/** Adds the inserter, belt lane, belt or chest that the chosen fix calls for. */
export function applyInserterFix(
    prev: ConfigFormData,
    issue: InserterCoverageIssue,
    fix: InserterFixOption,
): ConfigFormData {
    if (inserterFixProblem(prev, fix, issue)) return prev;
    if (fix.type === 'review_filters') return prev;
    if (fix.type === 'existing_connection') {
        const entities = fix.endpoint_type === 'machine' ? prev.machines : fix.endpoint_type === 'belt' ? prev.belts : prev.chests;
        if (!entities.some(entity => entity.id === fix.endpoint_id) || !prev.machines.some(machine => machine.id === issue.machine_id)) return prev;
        const endpoint = { type: fix.endpoint_type, id: fix.endpoint_id };
        const machine = { type: 'machine' as const, id: issue.machine_id };
        const source = issue.kind === 'missing_input_inserter' ? endpoint : machine;
        const sink = issue.kind === 'missing_input_inserter' ? machine : endpoint;
        if (prev.inserters.some(ins => ins.source.type === source.type && ins.source.id === source.id && ins.sink.type === sink.type && ins.sink.id === sink.id)) return prev;
        return { ...prev, inserters: [...prev.inserters, {
            id: nextId(prev, 'inserters'), _uuid: crypto.randomUUID(), source, sink, stack_size: inferStackSize(prev),
        }] };
    }
    // ── machine → machine inserter (highest priority, no new belt/chest) ─
    if (fix.type === 'machine_to_machine') {
        const stackSize = inferStackSize(prev);
        const newInserter: InserterFormData = {
            id: nextId(prev, 'inserters'),
            _uuid: crypto.randomUUID(),
            source: { type: 'machine', id: fix.source_machine_id },
            sink: { type: 'machine', id: issue.machine_id },
            stack_size: stackSize,
        };
        return {
            ...prev,
            inserters: [...prev.inserters, newInserter],
        };
    }

    // ── add lane to existing belt (input only, no new inserter needed) ─
    if (fix.type === 'add_lane_to_existing_belt') {
        const beltIdx = prev.belts.findIndex((b) => b.id === fix.belt_id);
        if (beltIdx === -1 || prev.belts[beltIdx].lanes.length >= 2) return prev;
        const belt = prev.belts[beltIdx];
        const laneStackSize = belt.lanes[0]?.stack_size ?? BELT_FORM_DEFAULT_STACK_SIZE;
        const updatedBelt: BeltFormData = {
            ...belt,
            lanes: [
                belt.lanes[0],
                { ingredient: fix.item_name, stack_size: laneStackSize },
            ] as [BeltLaneFormData, BeltLaneFormData],
        };
        return {
            ...prev,
            belts: prev.belts.map((b, i) => (i === beltIdx ? updatedBelt : b)),
        };
    }

    const stackSize = inferStackSize(prev);

    // ── new belt + new inserter ───────────────────────────────────────
    if (fix.type === 'new_belt') {
        const newBeltId = nextId(prev, 'belts');
        const newBelt: BeltFormData = {
            id: newBeltId,
            _uuid: crypto.randomUUID(),
            type: inferBeltType(prev),
            lanes: [{ ingredient: fix.item_name, stack_size: BELT_FORM_DEFAULT_STACK_SIZE }] as [BeltLaneFormData],
        };
        const newInserter: InserterFormData = issue.kind === 'missing_input_inserter'
            ? { id: nextId(prev, 'inserters'), _uuid: crypto.randomUUID(), source: { type: 'belt', id: newBeltId }, sink: { type: 'machine', id: issue.machine_id }, stack_size: stackSize }
            : { id: nextId(prev, 'inserters'), _uuid: crypto.randomUUID(), source: { type: 'machine', id: issue.machine_id }, sink: { type: 'belt', id: newBeltId }, stack_size: stackSize };
        return {
            ...prev,
            belts: [...prev.belts, newBelt],
            inserters: [...prev.inserters, newInserter],
        };
    }

    // ── infinity chest + new inserter ────────────────────────────────
    if (fix.type === 'infinity_chest') {
        const newChestId = nextId(prev, 'chests');
        const newChest: InfinityChestFormData = {
            type: ChestType.INFINITY_CHEST,
            id: newChestId,
            _uuid: crypto.randomUUID(),
            item_filter: [{ item_name: fix.item_name, request_count: 100 }],
        };
        const newInserter: InserterFormData = issue.kind === 'missing_input_inserter'
            ? { id: nextId(prev, 'inserters'), _uuid: crypto.randomUUID(), source: { type: 'chest', id: newChestId }, sink: { type: 'machine', id: issue.machine_id }, stack_size: stackSize }
            : { id: nextId(prev, 'inserters'), _uuid: crypto.randomUUID(), source: { type: 'machine', id: issue.machine_id }, sink: { type: 'chest', id: newChestId }, stack_size: stackSize };
        return {
            ...prev,
            chests: [...prev.chests, newChest],
            inserters: [...prev.inserters, newInserter],
        };
    }

    return prev;
}
