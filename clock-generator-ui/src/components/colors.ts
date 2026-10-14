/**
 * Shared color utilities for timeline visualizations.
 * Uses a colorblind-friendly palette based on Wong (2011).
 */

import { StatusCategory, InserterStatus, MachineStatus, DrillStatus, EntityType } from 'clock-generator/light';

// Colorblind-friendly palette (Wong, 2011)
export const COLOR_BLIND_PALETTE = {
    blue: "#0072B2",
    orange: "#E69F00",
    yellow: "#F0E442",
    green: "#009E73",
    skyBlue: "#56B4E9",
    vermillion: "#D55E00",
    reddishPurple: "#CC79A7",
    darkGrey: "#585858",
    lightGrey: "#AAAAAA",
    white: "#FFFFFF",
} as const;

/**
 * The track under the marks of both timelines. Every colour drawn on it needs 3:1 (WCAG 1.4.11);
 * colors.test.ts checks it.
 */
export const TIMELINE_TRACK_COLOR = '#1b1b1b';

/** Disabled grey: darkGrey (#585858) was 1.5:1 on the old track; this is 3.48:1 on TIMELINE_TRACK_COLOR */
const DISABLED_GREY = '#707070';

/**
 * Item colours of the Transfer chart. Kept apart from the state colours (no green, yellow or grey), each at least 3:1
 * on the track and distinct for colour-blind viewers. The numbers are in docs/ux-rework/specs/2.10-timelines.md.
 */
const ITEM_COLORS = ['#E0298B', '#8BE3F9', '#E9C9C4', '#873DF5', '#8B92F9', '#BC884E'] as const;

/** Items beyond this many share a colour with an earlier one */
export const ITEM_COLOR_COUNT = ITEM_COLORS.length;

/** One colour per distinct item, in alphabetical order, repeating after ITEM_COLORS.length items */
export function itemColorMap(itemNames: Iterable<string>): Map<string, string> {
    const colorMap = new Map<string, string>();
    [...new Set(itemNames)].sort().forEach((item, index) => {
        colorMap.set(item, ITEM_COLORS[index % ITEM_COLORS.length]);
    });
    return colorMap;
}

// Status category colors (colorblind-friendly)
export const CATEGORY_COLORS: Record<StatusCategory, string> = {
    [StatusCategory.ACTIVE]: COLOR_BLIND_PALETTE.green,       // actively working
    [StatusCategory.WAITING]: COLOR_BLIND_PALETTE.yellow,     // waiting for something
    [StatusCategory.BLOCKED]: COLOR_BLIND_PALETTE.reddishPurple,     // blocked/cannot proceed
    [StatusCategory.DISABLED]: DISABLED_GREY,  // disabled by control
    [StatusCategory.IDLE]: COLOR_BLIND_PALETTE.lightGrey,     // nothing to do
};

// Detailed status colors for inserters
export const INSERTER_STATUS_COLORS: Record<InserterStatus, string> = {
    [InserterStatus.PICKUP]: COLOR_BLIND_PALETTE.green,        // picking up items
    [InserterStatus.DROP_OFF]: COLOR_BLIND_PALETTE.skyBlue,       // dropping items
    [InserterStatus.SWING]: COLOR_BLIND_PALETTE.blue,        // in motion
    [InserterStatus.IDLE]: COLOR_BLIND_PALETTE.lightGrey,     // waiting
    [InserterStatus.DISABLED]: DISABLED_GREY,  // disabled
    [InserterStatus.TARGET_FULL]: COLOR_BLIND_PALETTE.reddishPurple, // waiting for sink (chest) to have space
    [InserterStatus.WAITING_FOR_SINK]: COLOR_BLIND_PALETTE.vermillion, // a partly filled hand waits for the machine to take its item again
};

// Detailed status colors for machines
export const MACHINE_STATUS_COLORS: Record<MachineStatus, string> = {
    [MachineStatus.WORKING]: COLOR_BLIND_PALETTE.green,      // actively crafting
    [MachineStatus.INGREDIENT_SHORTAGE]: COLOR_BLIND_PALETTE.yellow, // waiting for ingredients
    [MachineStatus.NO_FUEL]: COLOR_BLIND_PALETTE.orange, // waiting for fuel
    [MachineStatus.OUTPUT_FULL]: COLOR_BLIND_PALETTE.reddishPurple, // output blocked
};

// Detailed status colors for drills
export const DRILL_STATUS_COLORS: Record<DrillStatus, string> = {
    [DrillStatus.WORKING]: COLOR_BLIND_PALETTE.green,      // actively mining
    [DrillStatus.DISABLED]: DISABLED_GREY,  // disabled
};

/**
 * Get color for a specific status based on entity type (detailed view)
 */
export function getStatusColor(
    entityType: EntityType,
    status: string
): string {
    switch (entityType) {
        case EntityType.INSERTER:
            return INSERTER_STATUS_COLORS[status as InserterStatus] ?? INSERTER_STATUS_COLORS.IDLE;
        case EntityType.MACHINE:
            return MACHINE_STATUS_COLORS[status as MachineStatus] ?? MACHINE_STATUS_COLORS.WORKING;
        case EntityType.DRILL:
            return DRILL_STATUS_COLORS[status as DrillStatus] ?? DRILL_STATUS_COLORS.WORKING;
        default:
            return COLOR_BLIND_PALETTE.blue;
    }
}

/**
 * Get color for a status category (simplified view)
 */
export function getCategoryColor(category: StatusCategory): string {
    return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.IDLE;
}

/**
 * Reason icon mappings for formatted display
 */
const REASON_ICONS: { pattern: RegExp; icon: string; label: string }[] = [
    { pattern: /clock/i, icon: '⏱', label: 'Clock signal' },
    { pattern: /inventory full|output full|blocked/i, icon: '📦', label: 'Inventory full' },
    { pattern: /waiting|ingredient|shortage/i, icon: '⏳', label: 'Waiting' },
    { pattern: /complete|done|finished/i, icon: '✅', label: 'Complete' },
    { pattern: /forced/i, icon: '⚡', label: 'Forced' },
    { pattern: /pickup/i, icon: '🔼', label: 'Pickup' },
    { pattern: /drop/i, icon: '🔽', label: 'Drop' },
    { pattern: /disabled/i, icon: '🚫', label: 'Disabled' },
    { pattern: /enabled/i, icon: '✓', label: 'Enabled' },
];

/**
 * Format a transition reason with an appropriate icon
 */
export function formatTransitionReason(reason: string): { icon: string; text: string } {
    for (const { pattern, icon } of REASON_ICONS) {
        if (pattern.test(reason)) {
            // Capitalize first letter
            const text = reason.charAt(0).toUpperCase() + reason.slice(1);
            return { icon, text };
        }
    }
    // Default formatting
    return { 
        icon: '→', 
        text: reason.charAt(0).toUpperCase() + reason.slice(1) 
    };
}

/**
 * Get human-readable label for a status
 */
export function getStatusLabel(status: string): string {
    // Convert from UPPER_SNAKE_CASE to Title Case
    return status
        .split('_')
        .map(word => word.charAt(0) + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Get human-readable label for a category
 */
export function getCategoryLabel(category: StatusCategory): string {
    return getStatusLabel(category);
}

/** The state an entity shows in Factorio, by the game's own name; the same colours as the simulator's phases they match */
const FACTORIO_STATE_COLORS: Record<string, string> = {
    working: COLOR_BLIND_PALETTE.green,
    waiting_for_source_items: COLOR_BLIND_PALETTE.lightGrey,
    waiting_for_more_items: COLOR_BLIND_PALETTE.skyBlue,
    waiting_for_space_in_destination: COLOR_BLIND_PALETTE.reddishPurple,
    disabled_by_control_behavior: DISABLED_GREY,
    item_ingredient_shortage: COLOR_BLIND_PALETTE.yellow,
    full_output: COLOR_BLIND_PALETTE.vermillion,
    no_fuel: COLOR_BLIND_PALETTE.orange,
};

/** The distinct states, in the legend order of the table above, then any state it does not know, first seen first */
export function factorioStatesIn(states: Iterable<string>): string[] {
    const seen = new Set(states);
    const known = Object.keys(FACTORIO_STATE_COLORS).filter(state => seen.has(state));
    return [...known, ...[...seen].filter(state => !(state in FACTORIO_STATE_COLORS))];
}

export function getFactorioStateColor(state: string): string {
    return FACTORIO_STATE_COLORS[state] ?? COLOR_BLIND_PALETTE.white;
}

/** "waiting_for_space_in_destination" as the game's tooltip shows it: "Waiting for space in destination" */
export function getFactorioStateLabel(state: string): string {
    const words = state.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}
