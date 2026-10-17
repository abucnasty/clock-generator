import type { BeltFormData } from './configForm/formData';

export type SelectorEntityType = 'machine' | 'inserter' | 'drill' | 'belt' | 'chest';
export interface EntitySelectorOption {
    type: SelectorEntityType;
    id: number;
    label: string;
    icon: string;
    sublabel?: string;
    ingredientIcons?: string[];
    belt?: BeltFormData;
}
export const ENTITY_TYPE_LABELS: Record<SelectorEntityType, string> = { machine: 'Machines', inserter: 'Inserters', drill: 'Mining drills', belt: 'Belts', chest: 'Chests' };
export const ENTITY_TYPE_ORDER: SelectorEntityType[] = ['machine', 'inserter', 'drill', 'belt', 'chest'];
export const entitySelectorKey = (option: Pick<EntitySelectorOption, 'type' | 'id'>) => `${option.type}:${option.id}`;
export const entitySelectorLabel = (option: EntitySelectorOption) => option.sublabel ? `${option.label} - ${option.sublabel}` : option.label;
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Search only the popup choices: the current value keeps its identity until the user chooses another entity. */
export function searchEntityOptions<T extends EntitySelectorOption>(options: readonly T[], query: string, itemLabel: (id: string) => string): T[] {
    const search = normalize(query.trim());
    return options.filter(option => normalize([
        option.label, option.sublabel, option.icon, ...(option.ingredientIcons ?? []), ...(option.ingredientIcons ?? []).map(itemLabel),
    ].filter(Boolean).join(' ')).includes(search)).sort((a, b) => ENTITY_TYPE_ORDER.indexOf(a.type) - ENTITY_TYPE_ORDER.indexOf(b.type) || a.id - b.id);
}
