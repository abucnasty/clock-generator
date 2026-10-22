import type { QualityName, SlotContainerFormData, SlotFilterFormData } from './configForm/formData';

/** The supported inventories from the game data; checked against the engine at every quality in tests. */
const WAGON_SLOTS: Record<QualityName, number> = { normal: 40, uncommon: 50, rare: 60, epic: 70, legendary: 100 };

export function containerSlotCount(chest: Pick<SlotContainerFormData, 'type'> & { quality?: QualityName }): number {
    return chest.type === 'cargo-wagon' ? WAGON_SLOTS[chest.quality ?? 'normal'] : 80;
}

/** A brush stroke changes only the chosen slots, keeping contents and other filters untouched. */
export function paintSlotFilters(filters: readonly SlotFilterFormData[], slots: readonly number[], item: string | null): SlotFilterFormData[] {
    const chosen = new Set(slots);
    return [...filters.filter(filter => !chosen.has(filter.slot)), ...(item ? [...chosen].map(slot => ({ slot, item })) : [])]
        .sort((a, b) => a.slot - b.slot);
}

export function slotRange(from: number, to: number): number[] {
    const first = Math.min(from, to);
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => first + index);
}
