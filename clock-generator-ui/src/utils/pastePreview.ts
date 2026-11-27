import type { ResearchBlock } from 'clock-generator/browser';
import type { ConfigFormData } from './configForm/formData';
import type { TargetValues } from './pasteTarget';
import type { PastedEntities } from '../worker/types';

export type PasteCategory = 'machines' | 'drills' | 'inserters' | 'belts' | 'chests';
export interface ImportSelections extends Record<PasteCategory, boolean> { target: boolean }
export interface PasteReferenceWarning {
    ownerType: 'inserter' | 'drill';
    ownerId: number;
    slot: 'source' | 'sink' | 'target';
    endpointType: 'machine' | 'belt' | 'chest';
    endpointId: number;
    direction: 'incoming-to-retained' | 'retained-to-replaced';
    destinationExists: boolean;
}
const categories: PasteCategory[] = ['machines', 'drills', 'inserters', 'belts', 'chests'];
const endpointCategory = { machine: 'machines', belt: 'belts', chest: 'chests' } as const;
const replacesCategory = (incoming: PastedEntities, selections: ImportSelections, category: PasteCategory) =>
    selections[category] && incoming[category].length > 0;

/** Mirrors Apply's selected-and-nonempty replacement rule without changing either input. */
export function pastePreview(current: ConfigFormData, incoming: PastedEntities, selections: ImportSelections) {
    const existing = { ...current, drills: current.drills?.configs ?? [] };
    const replacing = (category: PasteCategory) => replacesCategory(incoming, selections, category);
    const counts = categories.map(category => ({
        category,
        current: existing[category].length,
        incoming: incoming[category].length,
        result: replacing(category) ? incoming[category].length : existing[category].length,
        replacing: replacing(category),
    }));
    const resultIds = Object.fromEntries(categories.map(category => [category,
        new Set((replacing(category) ? incoming[category] : existing[category]).map(entity => entity.id)),
    ])) as Record<PasteCategory, Set<number>>;
    const crossings: PasteReferenceWarning[] = [];
    const inspect = (ownerType: 'inserter' | 'drill', ownerId: number, slot: PasteReferenceWarning['slot'], endpoint: { type: PasteReferenceWarning['endpointType']; id: number }) => {
        if (endpoint.id === 0) return;
        const ownerReplaced = replacing(ownerType === 'inserter' ? 'inserters' : 'drills');
        const category = endpointCategory[endpoint.type];
        if (ownerReplaced === replacing(category)) return;
        crossings.push({ ownerType, ownerId, slot, endpointType: endpoint.type, endpointId: endpoint.id,
            direction: ownerReplaced ? 'incoming-to-retained' : 'retained-to-replaced',
            destinationExists: resultIds[category].has(endpoint.id) });
    };
    const inserters = replacing('inserters')
        ? incoming.inserters.map((inserter, index) => ({ ...inserter, id: inserter.id ?? index + 1 }))
        : existing.inserters;
    const drills = replacing('drills') ? incoming.drills : existing.drills;
    for (const drill of [...drills].sort((a, b) => a.id - b.id)) inspect('drill', drill.id, 'target', drill.target);
    for (const inserter of [...inserters].sort((a, b) => a.id - b.id)) {
        inspect('inserter', inserter.id, 'source', inserter.source);
        inspect('inserter', inserter.id, 'sink', inserter.sink);
    }
    const spatialCrossing = crossings.find(crossing => crossing.ownerType === 'inserter'
        && inserters.some(inserter => inserter.id === crossing.ownerId && inserter.sink.type === 'belt' && inserter.sink.drop !== undefined));
    const geometryProblem = spatialCrossing
        ? `Inserter ${spatialCrossing.ownerId} has an imported drop position tied to its route. Import its inserters and referenced entities together, or open a complete edited configuration file; this selection would reuse geometry with different entities.`
        : null;
    return { counts, crossings, geometryProblem };
}

/** What a pasted blueprint adds to a paste: the research its values were made with, and the step from one copy to the next */
interface BlueprintPaste {
    research: ResearchBlock;
    copy_offset: { x: number; y: number } | null;
}

/**
 * The research block a paste writes: its base names only the rows the paste writes, so a later profile leaves the rows the
 * user kept as they are. Null where the paste writes none of the rows research gives a value to.
 */
function researchOfPaste(block: ResearchBlock, incoming: PastedEntities, replacing: (category: PasteCategory) => boolean): ResearchBlock | null {
    const ids = (category: PasteCategory) => new Set(replacing(category) ? incoming[category].map(row => row.id) : []);
    const [machines, drills, inserters, belts, chests] = (['machines', 'drills', 'inserters', 'belts', 'chests'] as const).map(ids);
    if (machines.size + drills.size + inserters.size + belts.size + chests.size === 0) return null;
    return {
        ...block,
        base: {
            machines: block.base.machines.filter(row => machines.has(row.id)),
            drills: block.base.drills.filter(row => drills.has(row.id)),
            silos: block.base.silos.filter(row => chests.has(row.id)),
            inserters: block.base.inserters.filter(row => inserters.has(row.id)),
            belts: block.base.belts.filter(row => belts.has(row.id)),
        },
    };
}

/** The setpoint with the step from one copy to the next that the blueprint gives; with none, the step of an earlier build does not stay */
function withCopyOffset<Setpoint extends { copy_offset?: { x: number; y: number } }>(setpoint: Setpoint, offset: { x: number; y: number } | null): Setpoint {
    const kept = { ...setpoint };
    delete kept.copy_offset;
    return offset ? { ...kept, copy_offset: { ...offset } } : kept;
}

/**
 * Apply the exact preview policy as one edit, leaving retained form rows and their UI identity untouched. A pasted
 * blueprint also writes its research block and the step between copies, and marks its machines as the blueprint's.
 */
export function applyPaste(current: ConfigFormData, incoming: PastedEntities, selections: ImportSelections,
    target?: TargetValues, blueprint?: BlueprintPaste): ConfigFormData {
    const replacing = (category: PasteCategory) => replacesCategory(incoming, selections, category);
    const withUuid = <T,>(row: T) => ({ ...row, _uuid: crypto.randomUUID() });
    const setpoint = selections.target && target ? target : current.setpoint;
    const research = blueprint ? researchOfPaste(blueprint.research, incoming, replacing) : null;
    const sourceOf = (id: number) => blueprint ? 'blueprint' as const : incoming.picked_machines?.includes(id) ? 'recipe' as const : 'sidecar' as const;
    // a block describes the rows a blueprint gave: rows from another source leave no block behind
    const rest = { ...current };
    if (!blueprint && categories.some(replacing)) delete rest.research;
    return {
        ...rest,
        setpoint: blueprint ? withCopyOffset(setpoint, blueprint.copy_offset) : setpoint,
        ...(research !== null && { research }),
        machines: replacing('machines')
            ? incoming.machines.map(row => withUuid({ ...row, ...(row.prototype !== undefined && { _prototype_source: sourceOf(row.id) }) }))
            : current.machines,
        inserters: replacing('inserters')
            ? incoming.inserters.map((row, index) => withUuid({ ...row, id: row.id ?? index + 1 }))
            : current.inserters,
        belts: replacing('belts') ? incoming.belts.map(withUuid) : current.belts,
        chests: replacing('chests') ? incoming.chests.map(withUuid) : current.chests,
        ...(replacing('drills') && { drills: { configs: incoming.drills.map(withUuid) } }),
    };
}
