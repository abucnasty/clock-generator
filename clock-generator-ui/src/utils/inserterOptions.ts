import { TargetType } from 'clock-generator/light';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from './configForm/formData';
import { containerItems, isBufferChest, isContainerChest, isInfinityChest, machineIconName } from './configForm/formData';
import { chestLabel, entityLabel } from './entityLabel';
import type { EntitySelectorOption } from './entitySelector';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { drillItemsInto, sourceItemsOf } from './inferInserterItems';

export interface EntityOption extends EntitySelectorOption {
    type: InserterFormData['source']['type'];
}

/**
 * One option list for the live row and the draft dialog, with in-game names supplied by the caller. A container lists
 * what it holds and what the drills that drop into it mine, and with `inserters` and `getRecipeInfo` what its incoming
 * inserters bring too.
 */
export function entityOptionsOf(machines: MachineFormData[], belts: BeltFormData[], chests: ChestFormData[], labels: { recipe: (id: string) => string; item: (id: string) => string },
    context?: { inserters?: InserterFormData[]; getRecipeInfo?: (name: string) => RecipeInfo | null; drills?: readonly DrillFormData[] }): EntityOption[] {
    return [
        ...machines.map(m => ({ type: TargetType.MACHINE, id: m.id, label: entityLabel('machine', m.id), icon: machineIconName(m), sublabel: m.recipe ? labels.recipe(m.recipe) : 'No recipe', ingredientIcons: m.recipe ? [m.recipe] : undefined })),
        ...belts.map(b => ({ type: TargetType.BELT, id: b.id, label: entityLabel('belt', b.id), icon: b.type, ingredientIcons: b.lanes.map(l => l.ingredient).filter(Boolean), belt: b })),
        ...chests.map(c => {
            const items = isBufferChest(c) ? (c.item_filter ? [c.item_filter] : []) : isInfinityChest(c) ? c.item_filter.map(f => f.item_name).filter(Boolean)
                : context?.getRecipeInfo ? sourceItemsOf({ type: 'chest', id: c.id }, machines, belts, chests, context.getRecipeInfo, context.inserters, context.drills)
                : [...new Set([...containerItems(c), ...drillItemsInto(c.id, context?.drills)])];
            return { type: TargetType.CHEST, id: c.id, label: chestLabel(c), icon: isInfinityChest(c) ? 'infinity-chest' : isContainerChest(c) ? c.type : 'steel-chest', sublabel: isInfinityChest(c) && c.remove_unfiltered_items ? (items.length ? `${items.map(labels.item).join(', ')} · removes unfiltered items` : 'Removes all incoming items') : items.length ? items.map(labels.item).join(', ') : isBufferChest(c) ? 'No item filter' : isContainerChest(c) ? 'No items inferred' : 'No filters', ingredientIcons: items.length ? items : undefined };
        }),
    ];
}

export function findOption(options: EntityOption[], type: EntityOption['type'], id: number): EntityOption | undefined {
    return options.find(o => o.type === type && o.id === id);
}

/** Clearing is Automatic; the number field validates positive integers without a hidden capacity fallback. */
export function stackSizeFrom(value: number | null | undefined): number | undefined {
    return value == null ? undefined : Math.trunc(value);
}
