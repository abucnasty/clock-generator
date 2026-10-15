// The in-game English names of the items and recipes in data-filtered.json, read from the game's locale files when the
// data is dumped (filter-raw.js). Kept apart from the dump so that a test can reach it: no file access here.

/** The prototype types whose entries are items, in the order an id is looked up in; then fluids and the entities the page lists */
const ITEM_TYPES = [
    "item",
    "module",
    "tool",
    "ammo",
    "capsule",
    "gun",
    "armor",
    "repair-tool",
    "rail-planner",
    "item-with-entity-data",
    "space-platform-starter-pack",
    "blueprint",
    "blueprint-book",
    "deconstruction-item",
    "upgrade-item",
    "copy-paste-tool",
    "selection-tool",
    "spidertron-remote",
    "fluid",
    "resource",
    "mining-drill",
];

/** The locale sections an item, fluid or entity id is named in, in the order the game looks */
const ITEM_SECTIONS = ["item-name", "fluid-name", "entity-name", "equipment-name"];

/**
 * A locale file as `section.key` → text. A `[section]` line sets the section; `key=value` splits at the first `=`.
 * Comments (`;`, `#`), blank lines and keys before the first section are skipped. Values are kept as written.
 * @param {string} cfgText
 * @returns {Record<string, string>}
 */
function parseLocale(cfgText) {
    const table = {};
    let section = null;
    for (const rawLine of cfgText.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
        const header = /^\[([^\]]+)\]$/.exec(trimmed);
        if (header) {
            section = header[1];
            continue;
        }
        const at = line.indexOf("=");
        if (section === null || at < 0) continue;
        table[`${section}.${line.slice(0, at).trim()}`] = line.slice(at + 1);
    }
    return table;
}

const MACRO_SECTIONS = { ITEM: "item-name", FLUID: "fluid-name", ENTITY: "entity-name", EQUIPMENT: "equipment-name" };

/**
 * The text of a game `LocalisedString`: a string is itself; a list is `[key, ...params]`, where the key `""` joins its
 * params and any other key is looked up in `table`, with `__1__`, `__2__`… replaced by the params and `__ITEM__x__`,
 * `__FLUID__x__`, `__ENTITY__x__`, `__EQUIPMENT__x__` by the names of `x` (the id itself if it has none).
 * @param {unknown} localised
 * @param {Record<string, string>} table
 * @returns {string | null} null when the key or any param has no text, so the caller can fall back
 */
function evaluateLocalised(localised, table) {
    if (typeof localised === "string") return localised;
    if (typeof localised === "number" || typeof localised === "boolean") return String(localised);
    if (!Array.isArray(localised) || localised.length === 0 || typeof localised[0] !== "string") return null;
    const [key, ...rawParams] = localised;
    const params = [];
    for (const param of rawParams) {
        const text = evaluateLocalised(param, table);
        if (text === null) return null;
        params.push(text);
    }
    if (key === "") return params.join("");
    if (!Object.prototype.hasOwnProperty.call(table, key)) return null;
    let missing = false;
    const text = table[key].replace(/__(\d+)__|__(ITEM|FLUID|ENTITY|EQUIPMENT)__(.+?)__/g, (_, index, kind, id) => {
        if (index !== undefined) {
            const param = params[Number(index) - 1];
            if (param === undefined) missing = true;
            return param ?? "";
        }
        const sectionKey = `${MACRO_SECTIONS[kind]}.${id}`;
        return Object.prototype.hasOwnProperty.call(table, sectionKey) ? table[sectionKey] : id;
    });
    return missing ? null : text;
}

/**
 * The fallback for an id the locale has no text for: first letter upper case, `-` and `_` to spaces
 * @param {string} id
 */
function sentenceCase(id) {
    const spaced = id.replace(/[-_]/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * The names of every item and recipe id the page can show, as two tables, the way the game names them.
 * @param {Record<string, Record<string, any>>} raw the game's `--dump-data` output
 * @param {Record<string, Record<string, any>>} filtered what filter-raw.js keeps of it
 * @param {Record<string, string>} table the parsed locale
 * @returns {{ names: { item: Record<string, string>, recipe: Record<string, string> }, fallbackIds: string[] }}
 */
function buildNames(raw, filtered, table) {
    const lookup = (key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null);

    /** The locale name of an item, fluid or entity id, or null */
    function itemText(id) {
        for (const type of ITEM_TYPES) {
            const prototype = raw[type]?.[id];
            if (prototype?.localised_name !== undefined) {
                const text = evaluateLocalised(prototype.localised_name, table);
                if (text !== null) return text;
            }
        }
        for (const section of ITEM_SECTIONS) {
            const text = lookup(`${section}.${id}`);
            if (text !== null) return text;
        }
        return null;
    }

    /** The locale name of a recipe: its own, else `recipe-name.<id>`, else its main product's, else its only result's */
    function recipeText(id, recipe) {
        if (recipe?.localised_name !== undefined) {
            const text = evaluateLocalised(recipe.localised_name, table);
            if (text !== null) return text;
        }
        const own = lookup(`recipe-name.${id}`);
        if (own !== null) return own;
        if (typeof recipe?.main_product === "string" && recipe.main_product !== "") return itemText(recipe.main_product);
        const results = listOf(recipe?.results);
        if (results.length === 1 && typeof results[0]?.name === "string") return itemText(results[0].name);
        return null;
    }

    const itemIds = new Set([
        ...Object.keys(filtered.item ?? {}),
        ...Object.keys(filtered.resource ?? {}),
        ...Object.keys(filtered["mining-drill"] ?? {}),
    ]);
    for (const recipe of Object.values(filtered.recipe ?? {})) {
        for (const entry of [...listOf(recipe?.ingredients), ...listOf(recipe?.results)]) {
            if (typeof entry?.name === "string") itemIds.add(entry.name);
        }
    }

    const fallbackIds = new Set();
    const named = (id, text) => {
        if (text !== null) return text;
        fallbackIds.add(id);
        return sentenceCase(id);
    };

    const item = {};
    for (const id of [...itemIds].sort()) item[id] = named(id, itemText(id));
    const recipe = {};
    for (const id of Object.keys(filtered.recipe ?? {}).sort()) recipe[id] = named(id, recipeText(id, filtered.recipe[id]));

    return { names: { item, recipe }, fallbackIds: [...fallbackIds].sort() };
}

module.exports = { parseLocale, evaluateLocalised, buildNames };
