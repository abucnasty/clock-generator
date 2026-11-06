/** The game data's top-level sections the generator reads; a data file without one is not the generator's */
export const ENGINE_DATA_SECTIONS = [
    'recipe', 'mining-drill', 'resource', 'inserter', 'quality', 'inserter_research', 'container', 'quality_inventory',
    'rocket_silo', 'crafting_machine', 'transport_belt', 'item', 'item_prototype', 'item_weight', 'item_order', 'names',
] as const;

/** The sections of the engine's list that the loaded data lacks */
export function missingDataSections(data: unknown): string[] {
    const present = data !== null && typeof data === 'object' ? data as Record<string, unknown> : {};
    return ENGINE_DATA_SECTIONS.filter(section => present[section] === undefined);
}

/** An unexpected error from the check, as the page keeps it for the alert and the bug report */
export interface InternalError {
    message: string;
    stack?: string;
    /** The loaded game data lacks sections the generator reads */
    dataMismatch: boolean;
}

/** The text a bug report carries: the error, its stack and the page's version */
export function bugReportText(error: InternalError, pageVersion: string): string {
    return [error.message, error.stack, `Page version: ${pageVersion}`].filter(Boolean).join('\n');
}
