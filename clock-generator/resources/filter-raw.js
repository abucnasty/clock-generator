// node resources/filter-raw.js [--dump=<data-raw-dump.json>] --weights=<item-weights.json> --version="<the game's version line>"
//
// A data refresh, in order, with the harness's install (FACTORIO_PATH in .env):
//   1. the dump: `factorio --config <config.ini> --mod-directory <mods> --dump-data`, as below;
//   2. the weights: `npm run build`, then `node resources/dump-item-weights.js <item-weights.json>`;
//   3. this script, with FACTORIO_DATA_DIR set to that install's data folder (for the locale):
//      `node resources/filter-raw.js --dump=<dump> --weights=<item-weights.json> --version="$(factorio --version | head -1)"`;
//   4. a check that what did not change in the game did not change in data-filtered.json (a diff of each key).
//
// Reduces Factorio's data dump to what the generator reads (resources/data-filtered.json) and records the game it came
// from beside it (resources/data-version.json). What is kept of a prototype is the manifest's (resources/trait-fields.json):
// each section built from a class the manifest models keeps the properties the manifest lists on that class and its
// ancestors, where the raw entry has them (their values as the dump gives them, nested ones whole), beside what this
// script derives for it (a default where the game has one, a field kept in one shape only, a section's own type). A class
// the manifest lists properties of that no section is built from is refused unless UNSECTIONED_CLASSES names it. Recipes
// and resources are kept whole: the locale names and the page read fields of a recipe that the manifest does not list,
// and a resource travels whole in a generation's results. How to make the
// dump, with the Factorio install the generator is to follow (a locked copy of the game's version, not the one that is
// played):
//
//   factorio --config <config.ini> --mod-directory <mods> --dump-data
//
// where config.ini names the install's data folder as read-data and a scratch folder as write-data (the dump lands at
// <write-data>/script-output/data-raw-dump.json), and <mods>/mod-list.json enables the mods that ship with the game
// (every folder beside base in the data folder: space-age, quality, elevated-rails, recycler), as the harness does
// (src/harness/factorio-harness.ts, prepareWorkDir). `factorio --version` gives the version line. Nothing in the
// install is written to. The dump itself is not committed (resources/.gitignore).
//
// The dump holds an item's `weight` only where a mod sets it; the game works out the rest when it loads, from the
// recipes. So the weights come from the running game of the same install: `node resources/dump-item-weights.js
// <out.json>` writes every item's weight as the game holds it, and `--weights=<out.json>` hands them to this script,
// which checks them against the weights the dump does name.
const fs = require("fs/promises");
const path = require("path");

const { parseLocale, buildNames } = require("./locale-names");

// The game's data folder, for the English locale files; FACTORIO_DATA_DIR names another install
const FACTORIO_DATA_DIR = process.env.FACTORIO_DATA_DIR ?? "/Applications/factorio.app/Contents/data";
// later mods win, as in the game; an install whose recycler is a mod folder of its own (2.1 on Linux) has the
// recycling recipes' names there
const LOCALE_MODS = ["core", "base", "elevated-rails", "quality", "recycler", "space-age"];

// the manifest: the properties the engine reads, per prototype class, each with its parent
const MANIFEST = require("./trait-fields.json");

/**
 * The properties the manifest lists for a prototype class and its ancestors, the root's first, in the manifest's order
 * within each class
 */
function manifestProperties(class_name) {
    const chain = [];
    for (let name = class_name; name !== null; name = MANIFEST.prototypes[name].parent) {
        if (!MANIFEST.prototypes[name]) {
            throw new Error(`The manifest (resources/trait-fields.json) has no prototype class ${name}`);
        }
        chain.unshift(name);
    }
    return chain.flatMap(name => MANIFEST.prototypes[name].properties);
}

/**
 * `entry` with every property the manifest lists for `class_name` (and its ancestors) that the raw prototype has and
 * `entry` does not set yet, appended after the fields `entry` derives; `omit` names the properties `entry` leaves out
 * on purpose (a field kept in one shape only, or only above a value)
 */
function withManifestFields(entry, raw, class_name, omit = []) {
    sectioned_classes.add(class_name);
    for (const property of manifestProperties(class_name)) {
        if (property in entry || omit.includes(property) || raw[property] === undefined) {
            continue;
        }
        entry[property] = LIST_PROPERTIES.includes(property) && isEmptyTable(raw[property]) ? [] : raw[property];
    }
    return entry;
}

// the manifest's properties that hold a list: the dump writes an empty Lua table as {}, which is kept as the empty list
// it is (the biter spawner's and the burner mining drill's allowed_effects)
const LIST_PROPERTIES = ["allowed_effects"];

function isEmptyTable(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

// the manifest's classes a section of data-filtered.json is built from (withManifestFields adds each), so that a class
// the manifest lists properties of is never left out unseen
const sectioned_classes = new Set();

// the manifest's classes with properties that no section is built from, each with why; any other is refused
const UNSECTIONED_CLASSES = {
    LoaderPrototype: "not modelled; listed for the planner",
    ContainerPrototype: "a chest's slots come from its config (a buffer chest's storage_size); a section for the Storage trait to read them from is to come",
    LogisticContainerPrototype: "a chest (ContainerPrototype)",
    InfinityContainerPrototype: "a chest (ContainerPrototype)",
};

/**
 * Refuses a manifest class with properties (its own or inherited) that no section of the output is built from, from it
 * or a subclass of it, unless UNSECTIONED_CLASSES names it; and an entry there that a section is built from after all
 */
function checkEveryManifestClassHasASection() {
    const reached = new Set();
    for (const class_name of sectioned_classes) {
        for (let name = class_name; name !== null; name = MANIFEST.prototypes[name].parent) {
            reached.add(name);
        }
    }
    for (const class_name of Object.keys(MANIFEST.prototypes)) {
        const unsectioned = class_name in UNSECTIONED_CLASSES;
        if (reached.has(class_name) && unsectioned) {
            throw new Error(`${class_name} is in UNSECTIONED_CLASSES, but a section is built from it`);
        }
        if (!reached.has(class_name) && !unsectioned && manifestProperties(class_name).length > 0) {
            throw new Error(`The manifest lists properties of ${class_name}, but no section is built from it: map a raw section to it, or name it in UNSECTIONED_CLASSES with why`);
        }
    }
    for (const class_name of Object.keys(UNSECTIONED_CLASSES)) {
        if (!MANIFEST.prototypes[class_name]) {
            throw new Error(`UNSECTIONED_CLASSES names ${class_name}, which the manifest does not list`);
        }
    }
}

/** Every prototype of a raw section with only the manifest's properties of its class */
function manifestSection(raw_section, class_name) {
    sectioned_classes.add(class_name);
    const section = {};
    for (const [name, prototype] of Object.entries(raw_section ?? {})) {
        section[name] = withManifestFields({}, prototype, class_name);
    }
    return section;
}

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
    const weights_file = argValue("weights");
    if (!weights_file) {
        throw new Error("--weights=<the item weights of the running game, from resources/dump-item-weights.js> is required");
    }
    filtered["item_weight"] = itemWeights(rawData, filtered, JSON.parse(await fs.readFile(weights_file, "utf-8")));
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

    // the recipes whole: the engine reads what the manifest lists, the locale names (locale-names.js) and the page read
    // `localised_name`, `hidden` and others besides
    filtered["recipe"] = rawData.recipe;
    sectioned_classes.add("RecipePrototype");
    filtered["mining-drill"] = manifestSection(rawData["mining-drill"], "MiningDrillPrototype");
    // the resources whole: a drill carries its resource into the transfer plan a generation hands back, so what is kept
    // of one is part of the results (the engine itself reads its `minable` only)
    filtered["resource"] = rawData.resource;
    sectioned_classes.add("ResourceEntityPrototype");

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
            filtered["quality"][name] = withManifestFields({ name: quality.name, level: quality.level }, quality, "QualityPrototype");
        }
    }

    filtered["inserter_research"] = inserterResearch(rawData.technology ?? {});

    // the vehicles and wagons an inserter can fill or empty, with the slots of their trunk or cargo inventory
    filtered["container"] = {};
    for (const [category, class_name] of [["car", "CarPrototype"], ["cargo-wagon", "CargoWagonPrototype"]]) {
        for (const [name, container] of Object.entries(rawData[category] ?? {})) {
            filtered["container"][name] = withManifestFields({
                name: container.name,
                type: category,
                inventory_size: container.inventory_size,
                quality_affects_inventory_size: container.quality_affects_inventory_size ?? false,
            }, container, class_name);
        }
    }

    // what a quality does to a cargo wagon's slots (the game's default is 1)
    filtered["quality_inventory"] = {};
    for (const [name, quality] of Object.entries(rawData.quality ?? {})) {
        if (!quality.hidden) {
            filtered["quality_inventory"][name] = {
                cargo_wagon_inventory_size_multiplier: quality.cargo_wagon_inventory_size_multiplier ?? 1,
            };
        }
    }

    // the rocket silos: the recipe they are fixed to, their speed, and the weight a rocket lifts (the silo's own, else the
    // game's default)
    const default_lift_weight = rawData["utility-constants"]?.default?.default_rocket_lift_weight;
    filtered["rocket_silo"] = {};
    for (const [name, silo] of Object.entries(rawData["rocket-silo"] ?? {})) {
        filtered["rocket_silo"][name] = withManifestFields({
            name: silo.name,
            fixed_recipe: silo.fixed_recipe,
            crafting_speed: silo.crafting_speed,
            module_slots: silo.module_slots ?? 0,
            lift_weight: silo.lift_weight ?? default_lift_weight,
        }, silo, "RocketSiloPrototype");
    }

    // the crafting machines a build can name as a machine: their prototype type (a furnace picks its recipe from its
    // input; an assembling machine is set to one), the crafting categories they make recipes of, and the fuel
    // categories they burn when their energy source is a burner (none for an electric one); what the simulation rule
    // of a machine follows from (src/entities/machine/machine-rule.ts). Their base crafting speed (the game's default
    // 1 when the prototype sets none) picks the machine for an older config's type (src/config/migrate-machine-type.ts).
    // A machine that places its results itself into what stands at a spot beside it (the recycler) has that spot as its
    // `vector_to_place_result`, kept where the prototype has one as a pair of numbers. The rocket silo is in
    // `rocket_silo`. The manifest's other fields follow (the energy source and usage, the modules, the effects).
    filtered["crafting_machine"] = {};
    for (const [category, class_name] of [["assembling-machine", "AssemblingMachinePrototype"], ["furnace", "FurnacePrototype"]]) {
        for (const [name, machine] of Object.entries(rawData[category] ?? {})) {
            const energy_source = machine.energy_source ?? {};
            const fuel_categories = energy_source.type !== "burner" ? []
                : Array.isArray(energy_source.fuel_categories) ? energy_source.fuel_categories
                : energy_source.fuel_category ? [energy_source.fuel_category] : ["chemical"];
            filtered["crafting_machine"][name] = withManifestFields({
                name: machine.name,
                type: category,
                crafting_categories: machine.crafting_categories ?? [],
                burner_fuel_categories: fuel_categories,
                crafting_speed: machine.crafting_speed ?? 1,
                ...(Array.isArray(machine.vector_to_place_result) && { vector_to_place_result: machine.vector_to_place_result }),
            }, machine, class_name, ["vector_to_place_result"]);
        }
    }

    // the transport belts: their speed, in tiles per tick
    filtered["transport_belt"] = manifestSection(rawData["transport-belt"], "TransportBeltPrototype");

    filtered["item"] = {};
    filtered["item_prototype"] = {};

    for (const category of item_categories) {
        for (const [itemName, itemData] of Object.entries(rawData[category] ?? {})) {
            filtered["item"][itemName] = mapAsItem(itemData);
            const fields = mapAsItemPrototype(itemData);
            if (fields) {
                filtered["item_prototype"][itemName] = fields;
            }
        }
    }

    // synthetic items

    // for some reason rail is not an item in the raw data, it is only a recipe
    filtered["item"]["rail"] = {
        name: "rail",
        type: "item",
        stack_size: 100,
    };

    checkEveryManifestClassHasASection();
    return filtered;
}

/**
 * The weight of every item the generator knows, as the running game holds it. Where the dump names a weight, the game's
 * must be that weight (the game keeps it in 1/65536 parts, so a value such as 1,000,000 / 300 can differ in its last
 * digits); an item the game has no weight for is refused.
 */
function itemWeights(rawData, filtered, game_weights) {
    const named = {};
    for (const prototypes of Object.values(rawData)) {
        for (const [name, prototype] of Object.entries(prototypes ?? {})) {
            if (prototype && typeof prototype === "object" && "stack_size" in prototype && typeof prototype.weight === "number") {
                named[name] = prototype.weight;
            }
        }
    }
    const weights = {};
    for (const name of Object.keys(filtered.item).sort()) {
        const weight = game_weights[name];
        if (typeof weight !== "number") {
            throw new Error(`The running game gave no weight for ${name}`);
        }
        if (name in named && Math.abs(named[name] - weight) > 1 / 65536) {
            throw new Error(`${name} weighs ${named[name]} in the dump and ${weight} in the game`);
        }
        weights[name] = weight;
    }
    return weights;
}

/** An inserter: its swing and its hand first, then the manifest's other fields (how it fills its hand, its filters) */
function mapAsInserter(struct) {
    return withManifestFields({
        name: struct.name,
        rotation_speed: struct.rotation_speed,
        extension_speed: struct.extension_speed,
        stack_size_bonus: struct.stack_size_bonus,
        bulk: struct.bulk,
        pickup_position: struct.pickup_position,
        insert_position: struct.insert_position,
    }, struct, "InserterPrototype");
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

/**
 * An item: its stack size, and the ticks it takes to spoil where it spoils (the prototype's `spoil_ticks`); its type is
 * "item" whatever its prototype's (a module, a tool, ...). Then the manifest's other fields: its fuel value and
 * categories where it burns, what it spoils into. Its weight is not one of them: the dump names it only where a mod sets
 * it, so every item's weight is `item_weight`'s, the running game's.
 */
function mapAsItem(struct) {
    return {
        name: struct.name,
        type: "item",
        stack_size: struct.stack_size,
        ...(struct.spoil_ticks > 0 && { spoil_ticks: struct.spoil_ticks }),
    };
}

/**
 * The manifest's other fields of an item (a fuel's value and categories, what it spoils into), beside its entry rather
 * than in it: a recipe's items travel whole in a generation's results, so an item entry keeps its shape. Not its name,
 * stack size and spoil ticks (the entry has them) and not its weight (every item's is `item_weight`, the running
 * game's); undefined for an item with none of them.
 */
function mapAsItemPrototype(struct) {
    const fields = withManifestFields({}, struct, "ItemPrototype", ["name", "type", "stack_size", "spoil_ticks", "weight"]);
    return Object.keys(fields).length > 0 ? fields : undefined;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
