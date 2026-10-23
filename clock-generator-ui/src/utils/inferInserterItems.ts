import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { containerItems, isBufferChest, isInfinityChest, isRocketSilo } from './configForm/formData';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import type { CraftingMachineData } from '../worker/types';
import { burnsNutrients, NO_CRAFTING_MACHINES } from './machinePrototype';

type EntityRef = { type: 'machine' | 'belt' | 'chest'; id: number };

/**
 * What the drills that drop into a chest put into it: each one's resource, as the engine's `itemsPutInto` adds it. The
 * form names a drill's resource by the item it mines (every solid resource of the game data mines the item of its own
 * name, which `drillItemsInto.test.ts` checks).
 */
export function drillItemsInto(chestId: number, drills: readonly DrillFormData[] = []): string[] {
    return [...new Set(drills.filter(drill => drill.target.type === 'chest' && drill.target.id === chestId && drill.mined_item_name)
        .map(drill => drill.mined_item_name))];
}

export function sourceItemsOf(
    source: EntityRef,
    machines: MachineFormData[],
    belts: BeltFormData[],
    chests: ChestFormData[],
    getRecipeInfo?: (name: string) => RecipeInfo | null,
    inserters: InserterFormData[] = [],
    /** The drills: a container holds what the ones that drop into it mine */
    drills: readonly DrillFormData[] = [],
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
                // Match the engine's container supply: configured items plus what incoming inserters and drills can bring.
                const items = new Set([...containerItems(c), ...drillItemsInto(c.id, drills)].filter(Boolean));
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
    craftingMachines: CraftingMachineData = NO_CRAFTING_MACHINES,
): string[] {
    if (sink.type === 'machine') {
        const m = machines.find(m => m.id === sink.id);
        if (m?.recipe && getRecipeInfo) {
            const ingredients = getRecipeInfo(m.recipe)?.ingredients ?? [];
            // Fuel is accepted separately from recipe inputs, including recipes that produce their own nutrients.
            const fuel = m.fuel ?? (burnsNutrients(m, craftingMachines) ? 'nutrients' : undefined);
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
    /** The crafting machines of the game data: a machine burning nutrients takes them as fuel */
    craftingMachines: CraftingMachineData = NO_CRAFTING_MACHINES,
    /** The drills: a container holds what the ones that drop into it mine */
    drills: readonly DrillFormData[] = [],
): string[] {
    const sourceItems = sourceItemsOf(inserter.source, machines, belts, chests, getRecipeInfo, inserters, drills);
    const chest = inserter.sink.type === 'chest' ? chests.find(chest => chest.id === inserter.sink.id) : undefined;
    if (chest && isInfinityChest(chest) && !chest.remove_unfiltered_items && !chest.item_filter.some(filter => filter.item_name)) return [];
    const sinkNeeds = getSinkNeeds(inserter.sink, sourceItems, machines, chests, getRecipeInfo, craftingMachines);

    if (sinkNeeds.length === 0) return sourceItems;
    return sourceItems.filter(item => sinkNeeds.includes(item));
}

/** Items available to rule expressions at either end, including a machine's inputs and outputs. */
export function itemsAround(inserter: InserterFormData, machines: MachineFormData[], belts: BeltFormData[], chests: ChestFormData[], getRecipeInfo?: (name: string) => RecipeInfo | null, inserters: InserterFormData[] = [],
    craftingMachines: CraftingMachineData = NO_CRAFTING_MACHINES, drills: readonly DrillFormData[] = []): string[] {
    const items = new Set<string>();
    for (const ref of [inserter.source, inserter.sink]) {
        sourceItemsOf(ref, machines, belts, chests, getRecipeInfo, inserters, drills).forEach(item => items.add(item));
        if (ref.type === 'machine') {
            const machine = machines.find(m => m.id === ref.id);
            if (machine?.recipe) getRecipeInfo?.(machine.recipe)?.ingredients.forEach(item => items.add(item));
            const fuel = machine?.fuel ?? (machine && burnsNutrients(machine, craftingMachines) ? 'nutrients' : undefined);
            if (fuel) items.add(fuel);
        }
    }
    return [...items];
}
