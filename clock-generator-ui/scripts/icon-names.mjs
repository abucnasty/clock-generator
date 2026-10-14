// The names FactorioIcon can be given, which decide the icons public/icons has to hold. FactorioIcon draws
// /icons/<name>.png for the recipes, items, fluids, resources and drills of the game data the page loads, and for
// the few names the page's own source spells out.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(UI_ROOT, 'src');

export const ICONS_DIR = path.join(UI_ROOT, 'public', 'icons');
const FACTORIO_DATA_FILE = path.resolve(UI_ROOT, '..', 'clock-generator', 'resources', 'data-filtered.json');

/** The file FactorioIcon loads for a name, without the .png */
function iconFileName(name) {
    return name.toLowerCase().replace(/_/g, '-');
}

/** Each name the game data offers the page: what the forms list, and what the results name an ingredient or a product by */
function dataNames(data) {
    const names = new Set([
        ...Object.keys(data.recipe),
        ...Object.keys(data.item),
        ...Object.keys(data.resource),
        ...Object.keys(data['mining-drill']),
    ]);
    for (const recipe of Object.values(data.recipe)) {
        // a recipe with no ingredients or results has {} in place of the list
        for (const product of [recipe.ingredients, recipe.results].filter(Array.isArray).flat()) {
            names.add(product.name);
        }
    }
    return names;
}

/** What a drill can put out: the resources and what mining them yields */
function minedNames(data) {
    const names = new Set(Object.keys(data.resource));
    for (const resource of Object.values(data.resource)) {
        const minable = resource.minable ?? {};
        if (minable.result) {
            names.add(minable.result);
        }
        for (const result of minable.results ?? []) {
            names.add(result.name);
        }
    }
    return names;
}

/** The names of the game the page's source spells out, like the belt and drill types and the inserter it draws */
function sourceNames(known) {
    const names = new Set();
    for (const file of readdirSync(SOURCE_DIR, { recursive: true })) {
        if (!/\.tsx?$/.test(file)) {
            continue;
        }
        const source = readFileSync(path.join(SOURCE_DIR, file), 'utf8');
        for (const [, literal] of source.matchAll(/['"`]([a-z0-9][a-z0-9_-]*)['"`]/g)) {
            if (known.has(literal)) {
                names.add(literal);
            }
        }
    }
    return names;
}

/**
 * `requested`: every icon file the page can ask for, which are the icons worth keeping.
 * `required`: the icons the page cannot do without, as it draws them for any config: the names in its own source, the
 * drills, and the resources and what they yield. The other names come from the whole game data, mods and hidden
 * recipes included, and many of them have no icon; FactorioIcon draws nothing for those.
 */
export function iconNames() {
    const data = JSON.parse(readFileSync(FACTORIO_DATA_FILE, 'utf8'));
    const names = dataNames(data);
    const required = [...sourceNames(names), ...Object.keys(data['mining-drill']), ...minedNames(data)];
    return {
        requested: new Set([...names].map(iconFileName)),
        required: new Set(required.map(iconFileName)),
    };
}
