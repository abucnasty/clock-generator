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
