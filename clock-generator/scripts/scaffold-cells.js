// Which entity of a scaffold blueprint is `inserter:N` of its config, found without a game: the scaffold is read as the
// sidecar reads a build (what stands at the pickup and at the drop of each inserter of the cell), and the generator's
// own matcher (src/verification/entity-matching.ts) lays that against the config, as it does for a recording.
// Used by export-clock.js, which writes the result as the cells.json that tools/place-clocks.js reads.
//
//   const { cellOf } = require("./scaffold-cells");
//   const cell = cellOf({ blueprint: <decoded blueprint file>, config, name, clock_file, anchor: [0, 0] });
//   cell.cell      { name, config, problems, instances: [[ax, ay]], inserters: { "<id>": { name, offset, wired, has_wire } } }
//   cell.matched   how many of the config's inserters were found in the scaffold
//
// An inserter is of the cell when one of its ends is a crafting machine (the harness's rule); what stands at an end is
// found by position, with the blueprint's own coordinates. Where two entities fit one config inserter equally well (two
// machines of one recipe fed alike), the matcher's choice is taken, as in the game tests.
const path = require("path"), fs = require("fs");
const { ROOT, dist } = require("./lib");

const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "resources", "data-filtered.json"), "utf-8"));

/** Width and height in tiles of what a blueprint can hold, facing north; the default is one tile */
const SIZES = {
    "assembling-machine-1": [3, 3], "assembling-machine-2": [3, 3], "assembling-machine-3": [3, 3], "chemical-plant": [3, 3],
    "centrifuge": [3, 3], "biochamber": [3, 3], "electric-furnace": [3, 3], "beacon": [3, 3], "lab": [3, 3],
    "oil-refinery": [5, 5], "foundry": [5, 5], "electromagnetic-plant": [5, 5], "cryogenic-plant": [5, 5], "captive-biter-spawner": [5, 5],
    "stone-furnace": [2, 2], "steel-furnace": [2, 2], "recycler": [2, 4], "crusher": [2, 3], "rocket-silo": [9, 9],
    // vehicles: the collision box facing north (width, length); a vehicle faces by its orientation, not by a direction
    "car": [1.4, 3], "tank": [1.8, 3.8], "cargo-wagon": [1.4, 5.4],
};
const VEHICLES = new Set(["car", "tank", "cargo-wagon"]);
const BELT_NAME = /(transport-belt|underground-belt|splitter|loader)$/;

/** The direction of a blueprint entity as a unit vector (0 north, 4 east, 8 south, 12 west) */
function vectorOf(direction = 0) {
    return [[0, -1], [1, 0], [0, 1], [-1, 0]][(Math.round(direction / 4) % 4 + 4) % 4];
}

/** [x, y] turned from facing north to a direction */
function turned([x, y], direction = 0) {
    switch ((Math.round(direction / 4) % 4 + 4) % 4) {
        case 1: return [-y, x];
        case 2: return [-x, -y];
        case 3: return [y, -x];
        default: return [x, y];
    }
}

/** The box an entity takes, as [x0, y0, x1, y1] */
function boxOf(entity) {
    let [w, h] = SIZES[entity.name] ?? [1, 1];
    const quarter = VEHICLES.has(entity.name) ? Math.round((entity.orientation ?? 0) * 4) % 2 === 1 : Math.round((entity.direction ?? 0) / 4) % 2 === 1;
    if (entity.name === "splitter") [w, h] = [2, 1];
    if (/loader$/.test(entity.name)) [w, h] = [1, 2];
    if (quarter) [w, h] = [h, w];
    return [entity.position.x - w / 2, entity.position.y - h / 2, entity.position.x + w / 2, entity.position.y + h / 2];
}

const itemsOfRecipe = (recipe, field) => (DATA.recipe[recipe]?.[field] ?? []).filter(it => it.type === "item").map(it => it.name);

/** The kind of end an entity is for the matcher: "machine", "belt", "chest", or "other" */
function kindOf(entity) {
    if (entity === undefined) return "other";
    if (DATA.crafting_machine[entity.name] !== undefined) return "machine";
    if (BELT_NAME.test(entity.name)) return "belt";
    if (/chest$/.test(entity.name) || VEHICLES.has(entity.name) || entity.name === "rocket-silo") return "chest";
    return "other";
}

/** The type the config gives a chest end */
function chestTypeOf(entity) {
    if (entity.name === "infinity-chest" || entity.name === "rocket-silo" || VEHICLES.has(entity.name)) return entity.name;
    return "buffer-chest";
}

/** The decoded blueprint's entities that the cell is made of, with the maps to find an end by position */
function layoutOf(blueprint) {
    const entities = blueprint.blueprint?.entities;
    if (!Array.isArray(entities)) throw new Error("the scaffold is not a blueprint with entities");
    const boxes = entities.map(boxOf);
    const at = (x, y) => {
        // the last entity listed takes the tile, as in the game's own order of building
        for (let i = entities.length - 1; i >= 0; i--) {
            const [x0, y0, x1, y1] = boxes[i];
            if (x > x0 && x < x1 && y > y0 && y < y1) return entities[i];
        }
        return undefined;
    };
    return { entities, at };
}

/** The pickup and the drop point of an inserter of the blueprint */
function endsOf(inserter) {
    const prototype = DATA.inserter[inserter.name];
    if (prototype === undefined) return null;
    const [px, py] = turned(prototype.pickup_position ?? [0, -1], inserter.direction);
    const [dx, dy] = turned(prototype.insert_position ?? [0, 1.2], inserter.direction);
    const { x, y } = inserter.position;
    return { pickup: [x + px, y + py], drop: [x + dx, y + dy] };
}

/**
 * The items each belt carries, found from what is put on it: an infinity chest's filters and a machine's products, by an
 * inserter or a loader, and then on along the belt (and past an underground belt's far end and a splitter)
 */
function beltItems(layout, ends) {
    const { entities, at } = layout;
    const items = new Map(); // entity -> Set
    const itemsFor = entity => items.get(entity) ?? items.set(entity, new Set()).get(entity);
    const offered = entity => {
        if (entity === undefined) return [];
        if (entity.name === "infinity-chest") return (entity.infinity_settings?.filters ?? []).map(filter => filter.name);
        if (kindOf(entity) === "machine") return itemsOfRecipe(entity.recipe, "results");
        if (kindOf(entity) === "belt") return [...itemsFor(entity)];
        return [];
    };
    const feeds = []; // [from, to]: what is offered by `from` is put on the belt `to`
    for (const inserter of entities) {
        const found = ends.get(inserter);
        if (found === undefined) continue;
        const to = at(...found.drop);
        if (kindOf(to) === "belt") feeds.push([at(...found.pickup), to]);
    }
    for (const loader of entities.filter(entity => /loader$/.test(entity.name))) {
        const [vx, vy] = vectorOf(loader.direction);
        const behind = at(loader.position.x - 1.5 * vx, loader.position.y - 1.5 * vy);
        const ahead = at(loader.position.x + 1.5 * vx, loader.position.y + 1.5 * vy);
        if (kindOf(ahead) === "belt") feeds.push([behind, ahead]);
    }
    // where the items on a belt go next
    const onward = new Map();
    const next = (entity, targets) => onward.set(entity, [...(onward.get(entity) ?? []), ...targets.filter(it => kindOf(it) === "belt" && it !== entity)]);
    for (const belt of entities.filter(entity => kindOf(entity) === "belt")) {
        const [vx, vy] = vectorOf(belt.direction);
        const [x, y] = [belt.position.x, belt.position.y];
        if (belt.name.endsWith("underground-belt") && belt.type === "input") {
            const partner = entities.filter(other => other.name === belt.name && other.type === "output" && (other.direction ?? 0) === (belt.direction ?? 0)
                && Math.abs((other.position.x - x) * vy - (other.position.y - y) * vx) < 0.01 && (other.position.x - x) * vx + (other.position.y - y) * vy > 0)
                .sort((a, b) => Math.hypot(a.position.x - x, a.position.y - y) - Math.hypot(b.position.x - x, b.position.y - y))[0];
            next(belt, [partner]);
        } else if (belt.name.endsWith("splitter")) {
            const [sx, sy] = [Math.abs(vy) * 0.5, Math.abs(vx) * 0.5];
            next(belt, [at(x + sx + vx, y + sy + vy), at(x - sx + vx, y - sy + vy)]);
        } else if (!/loader$/.test(belt.name)) {
            const front = at(x + vx, y + vy);
            // a belt that faces this one head on does not take its items
            const [fx, fy] = vectorOf(front?.direction);
            if (!(front && !/loader$/.test(front.name) && fx === -vx && fy === -vy)) next(belt, [front]);
        }
    }
    for (let changed = true; changed;) {
        changed = false;
        for (const [from, to] of feeds) {
            for (const item of offered(from)) if (!itemsFor(to).has(item)) { itemsFor(to).add(item); changed = true; }
        }
        for (const [from, targets] of onward) {
            for (const target of targets) for (const item of itemsFor(from)) if (!itemsFor(target).has(item)) { itemsFor(target).add(item); changed = true; }
        }
    }
    return items;
}

/** Whether a blueprint inserter has a wire, and whether it is enabled by a circuit condition */
function wiringOf(blueprint, inserter) {
    const has_wire = (blueprint.blueprint.wires ?? []).some(([a, ca, b, cb]) =>
        (a === inserter.entity_number && (ca === 1 || ca === 2)) || (b === inserter.entity_number && (cb === 1 || cb === 2)));
    return { has_wire, wired: has_wire && Boolean(inserter.control_behavior?.circuit_enable_disable) };
}

/**
 * The scaffold read as a build: the machines and inserters of the cell with what is at each end, as the recorder's
 * `describe` gives them (src/harness/factorio-harness.ts reads that into a recording without samples)
 */
function describeBuild(blueprint, config) {
    const layout = layoutOf(blueprint);
    const { entities, at } = layout;
    const inserters = entities.filter(entity => DATA.inserter[entity.name] !== undefined);
    const ends = new Map(inserters.map(inserter => [inserter, endsOf(inserter)]));
    const items = beltItems(layout, ends);
    const problems = [];

    // machines: those with a recipe; a furnace has none in a blueprint, so it takes the recipe the config gives its kind
    const configured = config.machines.map(machine => ({ recipe: machine.recipe, prototype: machine.prototype }));
    const recipeOf = machine => {
        if (machine.recipe) return machine.recipe;
        const kin = configured.filter(it => it.prototype === machine.name || it.prototype === undefined);
        const recipes = [...new Set((kin.some(it => it.prototype === machine.name) ? kin.filter(it => it.prototype === machine.name) : kin)
            .map(it => it.recipe).filter(recipe => (DATA.recipe[recipe]?.categories ?? []).some(c => (DATA.crafting_machine[machine.name]?.crafting_categories ?? []).includes(c))))];
        if (recipes.length !== 1) problems.push(`${machine.name} at ${machine.position.x},${machine.position.y} has no recipe in the scaffold and the config gives ${recipes.length === 0 ? "none" : "several"} for it`);
        return recipes[0] ?? "";
    };
    const machines = entities.filter(entity => kindOf(entity) === "machine").map(machine => ({ entity: machine, recipe: recipeOf(machine) })).filter(it => it.recipe !== "");
    const machine_ids = new Map(machines.map((it, index) => [it.entity, index + 1]));

    const belts = [], belt_ids = new Map(), chests = [], chest_ids = new Map();
    const closestBelt = entity => {
        const carried = [...(items.get(entity) ?? [])];
        const key = lanes => lanes.map(lane => lane.ingredient).filter(Boolean);
        let best = null;
        for (const belt of config.belts) {
            const given = key(belt.lanes);
            const apart = given.filter(item => !carried.includes(item)).length + carried.filter(item => !given.includes(item)).length;
            if (best === null || apart < best.apart) best = { apart, lanes: belt.lanes.map(lane => ({ ingredient: lane.ingredient ?? "" })) };
        }
        return best !== null && carried.length > 0 ? best.lanes : carried.map(ingredient => ({ ingredient }));
    };
    const endOf = (entity, role) => {
        const kind = kindOf(entity);
        if (kind === "machine") return machine_ids.has(entity) ? { type: "machine", id: machine_ids.get(entity) } : null;
        if (kind === "belt") {
            if (!belt_ids.has(entity)) {
                belt_ids.set(entity, belts.length + 1);
                belts.push({ id: belts.length + 1, lanes: role === "source" ? closestBelt(entity) : [] });
            }
            return { type: "belt", id: belt_ids.get(entity) };
        }
        if (kind === "chest") {
            if (!chest_ids.has(entity)) {
                chest_ids.set(entity, chests.length + 1);
                chests.push({ id: chests.length + 1, type: chestTypeOf(entity) });
            }
            return { type: "chest", id: chest_ids.get(entity) };
        }
        return null;
    };

    const recorded = [];
    for (const inserter of inserters) {
        const found = ends.get(inserter);
        const [pickup, drop] = [at(...found.pickup), at(...found.drop)];
        if (kindOf(pickup) !== "machine" && kindOf(drop) !== "machine") continue;
        const source = endOf(pickup, "source"), sink = endOf(drop, "sink");
        if (source === null || sink === null) continue;
        recorded.push({ entity: inserter, source, sink, filters: (inserter.filters ?? []).map(filter => filter.name).filter(Boolean) });
    }
    const described = {
        format: "clock-generator-recording", version: 1, start_game_tick: 0, sample_count: 0,
        config: {
            machines: machines.map(it => ({ id: machine_ids.get(it.entity), recipe: it.recipe, position: it.entity.position })),
            belts, chests,
            inserters: recorded.map(it => ({ source: it.source, sink: it.sink, filters: it.filters })),
        },
        inserters: recorded.map((it, index) => ({
            id: index + 1, unit_number: it.entity.entity_number, name: it.entity.name, source: it.source, sink: it.sink, stack_size: 1,
            samples: { held_count: [], held_item: [], status: [] },
        })),
        machines: machines.map(it => ({
            id: machine_ids.get(it.entity), unit_number: it.entity.entity_number, name: it.entity.name, recipe: it.recipe,
            samples: { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} },
        })),
    };
    return { described, problems, by_recorded: new Map(recorded.map((it, index) => [index + 1, it.entity])) };
}

/**
 * The cell of a scaffold for tools/place-clocks.js: the config's inserter ids with the scaffold inserter behind each,
 * where it stands (offset from the anchor, which is the blueprint's own origin moved by `anchor`) and whether it is wired
 *
 * @param options {blueprint (decoded file), config, name, clock_file (the clock's file name in a clocks folder), anchor: [x, y]}
 */
function cellOf(options) {
    const { parseRecording } = dist("verification/recording.js");
    const { matchRecordingToConfig } = dist("verification/entity-matching.js");
    const { config, blueprint, name, clock_file, anchor = [0, 0] } = options;
    const { described, problems, by_recorded } = describeBuild(blueprint, config);
    const match = matchRecordingToConfig(parseRecording(described), config);
    const inserters = {};
    for (const [recorded_id, config_id] of match.inserters) {
        const entity = by_recorded.get(recorded_id);
        inserters[config_id] = { name: entity.name, offset: [entity.position.x - anchor[0], entity.position.y - anchor[1]], ...wiringOf(blueprint, entity) };
    }
    if (match.unmatched_config_inserters.length > 0) {
        problems.push(`inserter${match.unmatched_config_inserters.length > 1 ? "s" : ""} ${match.unmatched_config_inserters.join(", ")} of the config ${match.unmatched_config_inserters.length > 1 ? "have" : "has"} no inserter in the scaffold`);
    }
    if (match.unmatched_config_machines.length > 0) {
        problems.push(`machine${match.unmatched_config_machines.length > 1 ? "s" : ""} ${match.unmatched_config_machines.join(", ")} of the config ${match.unmatched_config_machines.length > 1 ? "have" : "has"} no machine in the scaffold`);
    }
    return {
        cell: { name, config: clock_file, problems, instances: [anchor], inserters },
        matched: match.inserters.size,
        unmatched_config_inserters: match.unmatched_config_inserters,
    };
}

module.exports = { cellOf };
