import { BLOCKED_SLOT_MARKERS } from 'clock-generator/light';
import type { BlockedSlotMarker, QualityName, SlotContainerFormData, SlotFilterFormData } from './configForm/formData';

/** The supported inventories from the game data; checked against the engine at every quality in tests. */
const WAGON_SLOTS: Record<QualityName, number> = { normal: 40, uncommon: 50, rare: 60, epic: 70, legendary: 100 };

export function containerSlotCount(chest: Pick<SlotContainerFormData, 'type'> & { quality?: QualityName }): number {
    return chest.type === 'cargo-wagon' ? WAGON_SLOTS[chest.quality ?? 'normal'] : 80;
}

/** The game's markers that block a slot, which the grid offers as brushes; No item stands for a slot blocked in the config */
export const BLOCK_MARKERS: readonly BlockedSlotMarker[] = BLOCKED_SLOT_MARKERS;

export function isBlockMarker(item: string | null | undefined): item is BlockedSlotMarker {
    return (BLOCK_MARKERS as readonly (string | null | undefined)[]).includes(item);
}

/** A slot filtered to an item, or blocked when the item is a marker: the config's `blocked: true`, the marker kept for the grid */
function slotFilterOf(slot: number, item: string): SlotFilterFormData {
    return isBlockMarker(item) ? { slot, blocked: true, _marker: item } : { slot, item };
}

/** What a slot's filter shows: its item, or the marker painted on a blocked slot (No item when not known) */
export function shownSlotFilter(filter: SlotFilterFormData): string {
    return filter.blocked ? filter._marker ?? BLOCK_MARKERS[0] : filter.item;
}

/** Slot filters as the form keeps them, from a config or a saved build that may name a marker as a slot's item */
export function formSlotFilters<T extends { slot: number; item?: string; blocked?: true }>(filters: readonly T[]): (T | SlotFilterFormData)[] {
    return filters.map(filter => filter.item !== undefined && isBlockMarker(filter.item) ? slotFilterOf(filter.slot, filter.item) : filter);
}

/** A brush stroke changes only the chosen slots, keeping contents and other filters untouched. */
export function paintSlotFilters(filters: readonly SlotFilterFormData[], slots: readonly number[], item: string | null): SlotFilterFormData[] {
    const chosen = new Set(slots);
    return [...filters.filter(filter => !chosen.has(filter.slot)), ...(item ? [...chosen].map(slot => slotFilterOf(slot, item)) : [])]
        .sort((a, b) => a.slot - b.slot);
}

export function slotRange(from: number, to: number): number[] {
    const first = Math.min(from, to);
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => first + index);
}

/** The slots of an inventory: filtered to an item, blocked, and free (unfiltered, taking any item); slots past its last are not counted */
interface SlotCounts { filtered: number; blocked: number; free: number }

export function slotCounts(filters: readonly SlotFilterFormData[], count: number): SlotCounts {
    const inside = new Map(filters
        .filter(filter => Number.isInteger(filter.slot) && filter.slot >= 1 && filter.slot <= count && (filter.blocked || filter.item.trim() !== ''))
        .map(filter => [filter.slot, filter]));
    const blocked = [...inside.values()].filter(filter => filter.blocked).length;
    return { filtered: inside.size - blocked, blocked, free: count - inside.size };
}

/** The one count the row and the grid both show: "30 filtered · 10 blocked · 0 free" */
export function slotCountsText({ filtered, blocked, free }: SlotCounts): string {
    return `${filtered} filtered · ${blocked} blocked · ${free} free`;
}
