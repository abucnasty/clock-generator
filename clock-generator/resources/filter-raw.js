// node resources/filter-raw.js [--dump=<data-raw-dump.json>] [--version="<the game's version line>"]
//
// Reduces Factorio's data dump to what the generator reads (resources/data-filtered.json) and records the game it came
// from beside it (resources/data-version.json). How to make the dump, with the Factorio install the generator is to
// follow (a locked copy of the game's version, not the one that is played):
//
//   factorio --config <config.ini> --mod-directory <mods> --dump-data
//
// where config.ini names the install's data folder as read-data and a scratch folder as write-data (the dump lands at
// <write-data>/script-output/data-raw-dump.json), and <mods>/mod-list.json enables the mods that ship with the game
// (every folder beside base in the data folder: space-age, quality, elevated-rails, recycler), as the harness does
// (src/harness/factorio-harness.ts, prepareWorkDir). `factorio --version` gives the version line. Nothing in the
// install is written to. The dump itself is not committed (resources/.gitignore).
const fs = require("fs/promises");
const path = require("path");

const { parseLocale, buildNames } = require("./locale-names");

// The game's data folder, for the English locale files; FACTORIO_DATA_DIR names another install
const FACTORIO_DATA_DIR = process.env.FACTORIO_DATA_DIR ?? "/Applications/factorio.app/Contents/data";
// later mods win, as in the game
const LOCALE_MODS = ["core", "base", "elevated-rails", "quality", "space-age"];

const raw_list = new Set([
    "recipe",
    "mining-drill",
    "resource",
]);

// the item prototypes that are items to the generator; "tool" is empty since 2.1 (science packs are plain items)
const item_categories = new Set([
    "item",
    "module",
    "tool",
    "ammo",
    "capsule",
]);

function argValue(name) {
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main() {
    const dump = argValue("dump") ?? path.join(__dirname, "data-raw-dump.json");
    const version_line = argValue("version");
    if (!version_line) {
        throw new Error('--version="<the first line of factorio --version>" is required, e.g. --version="Version: 2.1.21 (build 87673, linux64, full)"');
    }
    const rawData = JSON.parse(await fs.readFile(dump, "utf-8"));
    const filtered = mapRawDataToFilteredFactorioData(rawData);
    const table = await readLocale(FACTORIO_DATA_DIR);
    const { names, fallbackIds, fallbackCount } = buildNames(rawData, filtered, table);
    filtered["names"] = names;
    for (const kind of ["item", "recipe"]) {
        const count = Object.keys(names[kind]).length;
        console.log(`${kind} names: ${count - fallbackCount[kind]} from the locale in ${FACTORIO_DATA_DIR}, ${fallbackCount[kind]} sentence-case fallbacks, ${count} in all`);
    }
    console.log(`The ${fallbackIds.length} ids with a fallback name: ${fallbackIds.join(", ")}`);
    await fs.writeFile(path.join(__dirname, "data-filtered.json"), JSON.stringify(filtered, null, 2));
    await fs.writeFile(path.join(__dirname, "data-version.json"), JSON.stringify(dataVersion(version_line, rawData), null, 2) + "\n");
    console.log(`Done: ${Object.keys(filtered.recipe).length} recipes, ${Object.keys(filtered.item).length} items, from ${version_line}`);
}

/** The game the data came from: its version and build, parsed from `factorio --version`, and the mods in the dump */
function dataVersion(version_line, rawData) {
    const match = /Version:\s*([\d.]+)\s*\(build\s*(\d+)(?:,\s*([^)]*))?\)/.exec(version_line);
    if (!match) {
        throw new Error(`Cannot read a version and build from "${version_line}"`);
    }
    // every mod the dump saw, from the mod-list of the run that made it, is named by the prototypes of its "mod" field
    // where the dump has one; the base game's version is the game's
    return {
        factorio_version: match[1],
        build: Number(match[2]),
        version_line,
        dumped_on: new Date().toISOString().slice(0, 10),
        recipes: Object.keys(rawData.recipe).length,
    };
}

/** The English locale of the game's mods, as `section.key` → text */
async function readLocale(dataDir) {
    try {
        await fs.access(path.join(dataDir, "base", "locale", "en"))
    } catch {
        throw new Error(`No Factorio data folder at ${dataDir}: set FACTORIO_DATA_DIR to the game's data folder (the one holding base/locale/en)`)
    }
    const table = {}
    for (const mod of LOCALE_MODS) {
        const dir = path.join(dataDir, mod, "locale", "en")
        const files = await fs.readdir(dir).catch(() => [])
        for (const file of files.filter(f => f.endsWith(".cfg")).sort()) {
            Object.assign(table, parseLocale(await fs.readFile(path.join(dir, file), "utf-8")))
        }
    }
    return table
}

function mapRawDataToFilteredFactorioData(rawData) {
    const filtered = {};

    for (const category of raw_list) {
        filtered[category] = rawData[category];
    }

    // one list of crafting categories per recipe, whichever the game's version gives: `categories` (2.1), `category`
    // (before), "crafting" when neither is named (the game's default)
    for (const recipe of Object.values(filtered.recipe)) {
        const categories = Array.isArray(recipe.categories) ? recipe.categories : recipe.category ? [recipe.category] : ["crafting"];
        delete recipe.category;
        recipe.categories = categories;
    }

    // the inserters, with only what the swing and the hand are made from
    filtered["inserter"] = {};
    for (const [name, inserter] of Object.entries(rawData.inserter ?? {})) {
        filtered["inserter"][name] = mapAsInserter(inserter);
    }

    // the qualities a build can name; the hidden one (quality-unknown) is not one of them
    filtered["quality"] = {};
    for (const [name, quality] of Object.entries(rawData.quality ?? {})) {
        if (!quality.hidden) {
            filtered["quality"][name] = { name: quality.name, level: quality.level };
        }
    }

    filtered["inserter_research"] = inserterResearch(rawData.technology ?? {});

    filtered["item"] = {};

    for (const category of item_categories) {
        for (const [itemName, itemData] of Object.entries(rawData[category] ?? {})) {
            filtered["item"][itemName] = mapAsItem(itemData);
        }
    }

    // synthetic items

    // for some reason rail is not an item in the raw data, it is only a recipe
    filtered["item"]["rail"] = {
        name: "rail",
        type: "item",
        stack_size: 100,
    };

    return filtered;
}

function mapAsInserter(struct) {
    return {
        name: struct.name,
        rotation_speed: struct.rotation_speed,
        extension_speed: struct.extension_speed,
        stack_size_bonus: struct.stack_size_bonus,
        bulk: struct.bulk,
        pickup_position: struct.pickup_position,
        insert_position: struct.insert_position,
    };
}

/**
 * What the technologies add to the hand of an inserter when all of them are researched: the sum of the modifiers of
 * every "inserter-stack-size-bonus" effect (inserters, fast and long-handed ones, stack inserters) and of every
 * "bulk-inserter-capacity-bonus" effect (the bulk inserters).
 */
function inserterResearch(technologies) {
    const total = { inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0 };
    for (const technology of Object.values(technologies)) {
        for (const effect of Array.isArray(technology.effects) ? technology.effects : []) {
            if (effect.type === "inserter-stack-size-bonus") {
                total.inserter_stack_size_bonus += effect.modifier;
            } else if (effect.type === "bulk-inserter-capacity-bonus") {
                total.bulk_inserter_capacity_bonus += effect.modifier;
            }
        }
    }
    return total;
}

function mapAsItem(struct) {
    return {
        name: struct.name,
        type: "item",
        stack_size: struct.stack_size
    };
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
