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
])

const item_categories = new Set([
    "item",
    "module",
    "tool",
    "ammo",
    "capsule",
])

async function main() {
    const data = await fs.readFile("./data-raw-dump.json")
    const rawData = JSON.parse(data.toString("utf-8"))

    try {
        const filtered = mapRawDataToFilteredFactorioData(rawData)
        const table = await readLocale(FACTORIO_DATA_DIR)
        const { names, fallbackIds } = buildNames(rawData, filtered, table)
        filtered["names"] = names
        console.log(`${Object.keys(names.item).length} item and ${Object.keys(names.recipe).length} recipe names from the locale in ${FACTORIO_DATA_DIR}`)
        console.log(`${fallbackIds.length} ids have no locale text and get a sentence-case name: ${fallbackIds.join(", ")}`)
        await fs.writeFile("./data-filtered.json", JSON.stringify(filtered, null, 2))
        console.log("Done")
    } catch (err) {
        console.error(err)
        process.exitCode = 1
    }
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
    const filtered = {}

    for (const category of raw_list) {
        filtered[category] = rawData[category];
    }

    filtered["item"] = {}

    for (const category of item_categories) {
        for (const [itemName, itemData] of Object.entries(rawData[category])) {
            filtered["item"][itemName] = mapAsItem(itemData);
        }
    }

    // synthetic items

    // for some reason rail is not an item in the raw data, it is only a recipe
    filtered["item"]["rail"] = {
        name: "rail",
        type: "item",
        stack_size: 100,
    }

    return filtered;
}

function mapAsItem(struct) {
    return {
        name: struct.name,
        type: "item",
        stack_size: struct.stack_size
    }
}


main()