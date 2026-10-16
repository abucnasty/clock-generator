import type { Announcements, UniqueIdentifier } from '@dnd-kit/core';

/**
 * The accessible names that are not the text on screen, in one place so the wording can be read (and changed) together.
 * A row's name is always `entityLabel`'s ("Inserter 2"), never a number of our own.
 */

/** The names of the dropdowns, each containing the visible label so a voice user can say what they see ("type") */
export const SELECT_NAMES = {
    machineType: 'Machine type',
    beltType: 'Belt type',
    beltStrategy: 'Belt strategy',
    chestType: 'Chest type',
    drillType: 'Drill type',
    targetMachine: 'Target machine',
    quickTemplates: 'Quick templates',
    comparisonOperator: 'Comparison operator',
    valueType: 'Value type',
    constantValue: 'Constant value',
    isOrIsNot: 'Is or is not',
    machineStatus: 'Machine status',
} as const;

export const BUTTON_NAMES = {
    aboutMachines: 'About machines',
    aboutDrills: 'About mining drills',
    copyBlueprintString: 'Copy blueprint string',
    blueprintCopied: 'Blueprint copied',
    closeFullscreen: 'Close fullscreen',
    removeCondition: 'Remove condition',
    removeStatusCheck: 'Remove status condition',
    removeRange: 'Remove wake window',
    close: 'Close',
    moreOptions: 'More options',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    useClockWindows: "Use the clock's wake windows",
    replaceConditions: 'Replace conditions',
    useTemplate: 'Use template',
    replaceRule: 'Replace rule',
} as const;

/** The rule editor's numbered buttons: "Remove wake window 2", "Remove group 1" */
export const removeRangeName = (n: number) => `${BUTTON_NAMES.removeRange} ${n}`;
export const removeGroupName = (n: number) => `Remove group ${n}`;

/** The rule editor's tick fields: "Start tick, wake window 1", which holds the visible label "Start tick" */
export function windowFieldName(side: 'start' | 'end', n: number): string {
    return `${side === 'start' ? 'Start tick' : 'End tick'}, wake window ${n}`;
}

/** The names of the rule editor's toggle groups, which have no visible label */
export const GROUP_NAMES = {
    joinConditions: 'Join conditions with',
    whichEnd: 'Which end',
    whichMachine: 'Which machine',
} as const;

/** Fields with no visible label of their own */
export const FIELD_NAMES = {
    blueprintString: 'Blueprint string',
    latchedMode: 'Latched',
} as const;

export const PROGRESS_NAMES = {
    generating: 'Generating clocks',
    loadingData: 'Loading Factorio data',
} as const;

export const CLOCK_TABLE_NAME = 'Clocks';

/** The box the clock table scrolls in when it is wider than the window (Show all columns) */
export const CLOCK_TABLE_REGION = 'Clock comparison';

/** The boxes that hold the charts and tables that scroll sideways below their floor, by what they hold */
export const SCROLL_REGION_NAMES = {
    fuelConsumption: 'Fuel consumption table',
    fuelClocks: 'Fuel clocks table',
    fuelTimeline: 'Fuel timeline chart',
    stateTimeline: 'State transition timeline',
    transferTimeline: 'Transfer activity timeline',
    shiftRange: 'Shift range chart',
    swingComparison: 'Swing comparison chart',
    swingPlan: 'Swing plan table',
} as const;

/** The box the install steps' wiring list scrolls in, past 8 rows */
export const WIRING_LIST_NAME = 'Wiring list';

/** The name of the help button beside a clock in the table, which says what the clock is */
export function clockHelpName(clockLabel: string): string {
    return `About ${clockLabel}`;
}

/** The (i) by a clock table header, which opens the Terms with that column's terms first: "Terms for Works?" */
export function termsHelpName(column: string): string {
    return `Terms for ${column}`;
}

/** The tab lists of Results' Details and Developer tools sections */
export const TABLIST_NAMES = {
    details: 'Details',
    developerTools: 'Developer tools',
} as const;

/** The names of the charts drawn on a canvas or in an SVG (no text of their own), each naming the clock it shows */
export const CHART_NAMES = {
    /** "Inserter 3 state timeline, 17 changes" */
    stateTimeline: (rowLabel: string, changes: number) =>
        `${rowLabel} state timeline, ${changes} ${changes === 1 ? 'change' : 'changes'}`,
    /** "Inserter 3 state the game shows, 4 changes" */
    factorioStrip: (rowLabel: string, changes: number) =>
        `${rowLabel} state the game shows, ${changes} ${changes === 1 ? 'change' : 'changes'}`,
    /** "Machine 1 fuel level over the run" */
    fuelLevel: (machineLabel: string) => `${machineLabel} fuel level over the run`,
    /** "Inserter 2 fuel clock wake windows and swings" */
    fuelClock: (inserterLabel: string) => `${inserterLabel} fuel clock wake windows and swings`,
} as const;

/** The name of a row's drag handle, "Reorder Inserter 2" */
export function reorderName(rowLabel: string): string {
    return `Reorder ${rowLabel}`;
}

/** The name of a recipe field: "Recipe, Machine 2" (the owner is the row's name, or "Target Output") */
export function recipeName(owner: string): string {
    return `Recipe, ${owner}`;
}

/** The name of the target's recipe field */
export const TARGET_RECIPE_NAME = 'Recipe, Target Output';

/** The name of the second lane's delete button, "Delete lane 2 of Belt 1" */
export function deleteLaneName(beltLabel: string, lane: number): string {
    return `Delete lane ${lane} of ${beltLabel}`;
}

/** The name of a filter slot's remove button, "Remove filter 1: iron-plate" (the slot is counted from 1) */
export function removeFilterName(slot: number, item: string): string {
    return `Remove filter ${slot}: ${item}`;
}

/**
 * What dnd-kit reads out while a row is dragged. Its defaults say "Picked up draggable item" and the row's key, a UUID.
 * This names the row the way its chip does (the labels, by key) and gives positions: "Inserter 2 is over position 3".
 */
export function reorderAnnouncements(labels: ReadonlyMap<string, string>, keys: readonly string[]): Announcements {
    const positionOf = (id: UniqueIdentifier): number => keys.indexOf(String(id)) + 1;
    const nameOf = (id: UniqueIdentifier): string => labels.get(String(id)) ?? 'The row';
    return {
        onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
        onDragOver: ({ active, over }) =>
            over
                ? `${nameOf(active.id)} is over position ${positionOf(over.id)}.`
                : `${nameOf(active.id)} is not over a position.`,
        onDragEnd: ({ active, over }) =>
            over
                ? `${nameOf(active.id)} was dropped at position ${positionOf(over.id)}.`
                : `${nameOf(active.id)} was dropped where it was, at position ${positionOf(active.id)}.`,
        onDragCancel: ({ active }) =>
            `Reordering cancelled; ${nameOf(active.id)} is back at position ${positionOf(active.id)}.`,
    };
}
