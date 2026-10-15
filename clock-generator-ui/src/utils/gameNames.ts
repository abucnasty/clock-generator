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

/**
 * Text the engine wrote with ids in it, with each known id said as its game name: "Machine 1 (logistic-science-pack)" is
 * "Machine 1 (Logistic science pack)", and "needs iron-plate" is "needs Iron plate". An id of one word is named only in
 * brackets, so that "inserter" in a sentence stays a word; anything unknown is left as it is.
 */
export function nameIdsInText(names: GameNames, text: string): string {
    const known = (id: string) => Object.hasOwn(names.recipe, id) || Object.hasOwn(names.item, id);
    return text.replace(/\(([^()]+)\)|\b[a-z0-9]+(?:[-_][a-z0-9]+)+\b/g, (whole, inner: string | undefined) => {
        if (inner !== undefined) return known(inner) ? `(${recipeName(names, inner)})` : whole;
        return known(whole) ? recipeName(names, whole) : whole;
    });
}

/** A name with its id after it for a hover, "Iron plate (iron-plate)"; the id alone when it has no other name */
export function nameWithId(name: string, id: string): string {
    return name === id ? id : `${name} (${id})`;
}

/** Ids of mods and the editor, which no build is made of: Editor Extensions, Recipe Calculator, Region Cloner and the parameter signals */
const INTERNAL_ID = /^(ee-|rcalc-|region-cloner_|parameter-)/;

/**
 * The ids a picker offers: without the mod and internal ids, and without those in `hidden` (the data's hidden entries).
 * A build that already holds one still shows it; the picker keeps its chosen value.
 */
export function pickerIds(ids: readonly string[], hidden: ReadonlySet<string> = new Set()): string[] {
    return ids.filter((id) => !INTERNAL_ID.test(id) && !hidden.has(id));
}

/** The ids of the recipes the game data marks `hidden`, in the data's order */
export function hiddenRecipeIds(recipes: Record<string, { hidden?: boolean }> | undefined): string[] {
    return Object.entries(recipes ?? {}).filter(([, recipe]) => recipe.hidden === true).map(([id]) => id);
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
