/**
 * The in-game English names of items and recipes, and the search over them. The names come from the `names` key of
 * data-filtered.json (made when the game data is dumped); the config and every JSON keep the ids.
 */

/** The names by id: items (fluids and entities too) and recipes apart, as a recipe and an item of one id can differ */
export interface GameNames {
    item: Record<string, string>;
    recipe: Record<string, string>;
}

/** No names: every id shows as itself */
export const NO_NAMES: GameNames = { item: {}, recipe: {} };

/** Only the table's own entries, so that `constructor` or `__proto__` come back as typed */
function own(table: Record<string, string>, id: string): string | undefined {
    return Object.hasOwn(table, id) ? table[id] : undefined;
}

/** The name of an item, fluid or entity id; the id itself when it has none */
export function itemName(names: GameNames, id: string): string {
    return own(names.item, id) ?? id;
}

/** The name of a recipe id, else of the item of that id, else the id itself */
export function recipeName(names: GameNames, id: string): string {
    return own(names.recipe, id) ?? own(names.item, id) ?? id;
}

/** The name of an icon's id, which is an item or a recipe: the item's, else the recipe's, else the id */
export function iconName(names: GameNames, id: string): string {
    return own(names.item, id) ?? own(names.recipe, id) ?? id;
}

/** A name with its id after it for a hover, "Iron plate (iron-plate)"; the id alone when it has no other name */
export function nameWithId(name: string, id: string): string {
    return name === id ? id : `${name} (${id})`;
}

/** Lower case, with dashes, underscores and punctuation as single spaces: "Fluoroketone (Cold)" and `fluoroketone-cold` agree */
export function normalizeForSearch(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function words(query: string): string[] {
    const normalized = normalizeForSearch(query);
    return normalized === '' ? [] : normalized.split(' ');
}

/** Whether every word of the query is in the name or the id, in any order; an empty query matches everything */
export function matchesQuery(query: string, id: string, name: string): boolean {
    const haystack = `${normalizeForSearch(name)} ${normalizeForSearch(id)}`;
    return words(query).every((word) => haystack.includes(word));
}

/** How good a match is, lower is better: the whole name or id, the name's start, the id's start, a later word of the name, anywhere */
function matchTier(query: string, id: string, name: string): number {
    const normalizedName = normalizeForSearch(name);
    const normalizedId = normalizeForSearch(id);
    if (normalizedName === query || normalizedId === query) return 0;
    if (normalizedName.startsWith(query)) return 1;
    if (normalizedId.startsWith(query)) return 2;
    if (` ${normalizedName}`.includes(` ${query}`)) return 3;
    return 4;
}

/**
 * The ids that match the query, best first (see `matchTier`); ids of one tier keep their order. An empty query
 * returns every id in its order. `label` gives an id's name.
 */
export function searchIds(query: string, ids: readonly string[], label: (id: string) => string): string[] {
    const normalized = normalizeForSearch(query);
    if (normalized === '') return [...ids];
    const tiers: string[][] = [[], [], [], [], []];
    for (const id of ids) {
        const name = label(id);
        if (matchesQuery(normalized, id, name)) tiers[matchTier(normalized, id, name)].push(id);
    }
    return tiers.flat();
}

/**
 * What a typed entry stores: an id as it is; text equal (as normalized) to exactly one id or one id's name, that id;
 * anything else as typed, so the engine still says the recipe is unknown. Empty or blank input gives ''.
 */
export function resolveTyped(input: string, ids: readonly string[], label: (id: string) => string): string {
    const typed = input.trim();
    if (typed === '' || ids.includes(typed)) return typed;
    const normalized = normalizeForSearch(typed);
    const byId = ids.filter((id) => normalizeForSearch(id) === normalized);
    if (byId.length === 1) return byId[0];
    const byName = ids.filter((id) => normalizeForSearch(label(id)) === normalized);
    if (byName.length === 1) return byName[0];
    return typed;
}
