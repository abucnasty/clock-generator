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
        ? `Inserter ${spatialCrossing.ownerId} has an imported drop position tied to its route. Import its inserters and referenced entities together, or open a complete edited build file; this selection would reuse geometry with different entities.`
        : null;
    return { counts, crossings, geometryProblem };
}

/** Apply the exact preview policy as one edit, leaving retained form rows and their UI identity untouched. */
export function applyPaste(current: ConfigFormData, incoming: PastedEntities, selections: ImportSelections,
    target?: TargetValues, miningProductivityLevel?: number): ConfigFormData {
    const replacing = (category: PasteCategory) => replacesCategory(incoming, selections, category);
    const withUuid = <T,>(row: T) => ({ ...row, _uuid: crypto.randomUUID() });
    return {
        ...current,
        target_output: selections.target && target ? target : current.target_output,
        machines: replacing('machines') ? incoming.machines.map(withUuid) : current.machines,
        inserters: replacing('inserters')
            ? incoming.inserters.map((row, index) => withUuid({ ...row, id: row.id ?? index + 1 }))
            : current.inserters,
        belts: replacing('belts') ? incoming.belts.map(withUuid) : current.belts,
        chests: replacing('chests') ? incoming.chests.map(withUuid) : current.chests,
        ...(replacing('drills') && { drills: {
            mining_productivity_level: miningProductivityLevel ?? current.drills?.mining_productivity_level ?? 0,
            configs: incoming.drills.map(withUuid),
        } }),
    };
}
