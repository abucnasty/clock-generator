import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';

type EntityRef = { type: 'machine' | 'belt' | 'chest'; id: number };

function getSourceItems(
    source: EntityRef,
    machines: MachineFormData[],
    belts: BeltFormData[],
    chests: ChestFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
): string[] {
    if (source.type === 'machine') {
        const m = machines.find(m => m.id === source.id);
        if (m?.recipe && getRecipeInfo) return getRecipeInfo(m.recipe)?.results ?? [];
    } else if (source.type === 'belt') {
        const b = belts.find(b => b.id === source.id);
        if (b) return b.lanes.map(l => l.ingredient).filter(Boolean);
    } else if (source.type === 'chest') {
        const c = chests.find(c => c.id === source.id);
        if (c) {
            if (isBufferChest(c) && c.item_filter) return [c.item_filter];
            if (isInfinityChest(c)) return c.item_filter.map(f => f.item_name).filter(Boolean);
        }
    }
    return [];
}

function getSinkNeeds(
    sink: EntityRef,
    sourceItems: string[],
    machines: MachineFormData[],
    chests: ChestFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
): string[] {
    if (sink.type === 'machine') {
        const m = machines.find(m => m.id === sink.id);
        if (m?.recipe && getRecipeInfo) return getRecipeInfo(m.recipe)?.ingredients ?? [];
    } else if (sink.type === 'belt') {
        return sourceItems;
    } else if (sink.type === 'chest') {
        const c = chests.find(c => c.id === sink.id);
        if (c) {
            if (isBufferChest(c) && c.item_filter) return [c.item_filter];
            if (isInfinityChest(c)) return c.item_filter.map(f => f.item_name).filter(Boolean);
            return sourceItems;
        }
        return sourceItems;
    }
    return [];
}

/**
 * Infers the items an inserter automatically transfers based on its source and sink
 * entities, without requiring an explicit filter to be set. Mirrors the in-game
 * automatic item detection behaviour.
 */
export function inferInserterItems(
    inserter: InserterFormData,
    machines: MachineFormData[],
    belts: BeltFormData[],
    chests: ChestFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
): string[] {
    const sourceItems = getSourceItems(inserter.source, machines, belts, chests, getRecipeInfo);
    const sinkNeeds = getSinkNeeds(inserter.sink, sourceItems, machines, chests, getRecipeInfo);

    if (sinkNeeds.length === 0) return sourceItems;
    return sourceItems.filter(item => sinkNeeds.includes(item));
}
