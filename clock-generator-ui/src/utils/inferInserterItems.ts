import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { containerItems, isBufferChest, isInfinityChest, isRocketSilo } from './configForm/formData';
import type { RecipeInfo } from '../hooks/useSimulationWorker';

type EntityRef = { type: 'machine' | 'belt' | 'chest'; id: number };

export function sourceItemsOf(
    source: EntityRef,
    machines: MachineFormData[],
    belts: BeltFormData[],
    chests: ChestFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
    inserters: InserterFormData[] = [],
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
            if (isInfinityChest(c)) return c.item_filter.filter(filter => filter.request_count > 0).map(f => f.item_name).filter(Boolean);
            if (!isBufferChest(c)) {
                // Match the engine's container supply: configured items plus what incoming inserters can bring.
                const items = new Set(containerItems(c).filter(Boolean));
                for (const incoming of inserters) {
                    if (incoming.sink.type !== 'chest' || incoming.sink.id !== c.id) continue;
                    if (incoming.filters?.length) {
                        if (incoming.filter_mode !== 'blacklist') incoming.filters.filter(Boolean).forEach(item => items.add(item));
                    } else {
                        // Container-to-container supply uses the source's starting contents, as the engine does.
                        const sourceChest = incoming.source.type === 'chest' ? chests.find(chest => chest.id === incoming.source.id) : undefined;
                        const supplied = sourceChest && !isBufferChest(sourceChest) && !isInfinityChest(sourceChest)
                            ? (sourceChest.contents ?? []).map(content => content.item)
                            : sourceItemsOf(incoming.source, machines, belts, chests, getRecipeInfo);
                        supplied.filter(Boolean).forEach(item => items.add(item));
                    }
                }
                // At normal recipe quality, rocket-part ingredients stay in the silo's input inventory.
                const inputs = isRocketSilo(c) && (c.recipe_quality ?? 'normal') === 'normal'
                    ? getRecipeInfo?.('rocket-part')?.ingredients ?? [] : [];
                return [...items].filter(item => !inputs.includes(item));
            }
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
        if (m?.recipe && getRecipeInfo) {
            const ingredients = getRecipeInfo(m.recipe)?.ingredients ?? [];
            // Fuel is accepted separately from recipe inputs, including recipes that produce their own nutrients.
            const fuel = m.fuel ?? (m.type === 'biochamber' ? 'nutrients' : undefined);
            return [...new Set([...ingredients, ...(fuel ? [fuel] : [])])];
        }
    } else if (sink.type === 'belt') {
        return sourceItems;
    } else if (sink.type === 'chest') {
        const c = chests.find(c => c.id === sink.id);
        if (c) {
            if (isBufferChest(c) && c.item_filter) return [c.item_filter];
            if (isInfinityChest(c)) return c.remove_unfiltered_items ? sourceItems : c.item_filter.map(f => f.item_name).filter(Boolean);
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
    inserters: InserterFormData[] = [],
): string[] {
    const sourceItems = sourceItemsOf(inserter.source, machines, belts, chests, getRecipeInfo, inserters);
    const chest = inserter.sink.type === 'chest' ? chests.find(chest => chest.id === inserter.sink.id) : undefined;
    if (chest && isInfinityChest(chest) && !chest.remove_unfiltered_items && !chest.item_filter.some(filter => filter.item_name)) return [];
    const sinkNeeds = getSinkNeeds(inserter.sink, sourceItems, machines, chests, getRecipeInfo);

    if (sinkNeeds.length === 0) return sourceItems;
    return sourceItems.filter(item => sinkNeeds.includes(item));
}

/** Items available to rule expressions at either end, including a machine's inputs and outputs. */
export function itemsAround(inserter: InserterFormData, machines: MachineFormData[], belts: BeltFormData[], chests: ChestFormData[], getRecipeInfo?: (name: string) => RecipeInfo | null, inserters: InserterFormData[] = []): string[] {
    const items = new Set<string>();
    for (const ref of [inserter.source, inserter.sink]) {
        sourceItemsOf(ref, machines, belts, chests, getRecipeInfo, inserters).forEach(item => items.add(item));
        if (ref.type === 'machine') {
            const machine = machines.find(m => m.id === ref.id);
            if (machine?.recipe) getRecipeInfo?.(machine.recipe)?.ingredients.forEach(item => items.add(item));
            const fuel = machine?.fuel ?? (machine?.type === 'biochamber' ? 'nutrients' : undefined);
            if (fuel) items.add(fuel);
        }
    }
    return [...items];
}
