/**
 * The flows of a pasted blueprint: which items stand on each lane of each belt line, which recipe each furnace and
 * recycler has, which item each buffer chest holds, which ore each mining drill mines and where it and each recycler
 * put what they make, and the questions that the blueprint cannot answer.
 *
 * `flowsOf` reads the world (`worldOf`), the geometry (`geometryOf`), the blueprint's own entities (for a recipe, a
 * filter, a mirror) and a narrow slice of the game data. It is pure and total: the same input gives the same flows,
 * every list is sorted by a stated key, and an entity or name it cannot read is a listed case, never a throw.
 *
 * Tiles, directions and lanes are as in `world.ts`.
 */
import type { BlueprintEntityRead } from "./blueprint-entities";
import type { BuildGeometry, InserterEnds } from "./geometry";
import { BeltPiece, BuildWorld, PlacedEntity, Point, Tile, tileOf } from "./world";

/** A vector as the game data writes it: a pair, or an object with x and y */
export type FlowsVector = readonly [number, number] | { x: number; y: number };

/** One ingredient or result of a recipe, or one result of a resource; an entry with no `type` is an item */
export type FlowsEntry = { type?: string; name: string };

/** What the flows read of the game data, with the game's own names */
export type FlowsData = {
    /** The game's prototype type by entity name */
    entity_types: Readonly<Record<string, string>>;
    /** A mining drill's resource categories and where it places what it mines, facing north */
    mining_drills: Readonly<Record<string, { resource_categories: readonly string[]; vector_to_place_result: FlowsVector }>>;
    /** A resource's category (`basic-solid` where the data leaves it out) and what it gives when mined */
    resources: Readonly<Record<string, { category?: string; minable: { result?: string; results?: readonly FlowsEntry[] } }>>;
    recipes: Readonly<Record<string, { categories: readonly string[]; ingredients: readonly FlowsEntry[]; results: readonly FlowsEntry[] }>>;
    /** A crafting machine's type and crafting categories; a recycler also holds where it places its results */
    crafting_machines: Readonly<Record<string, { type: string; crafting_categories: readonly string[]; vector_to_place_result?: FlowsVector }>>;
    /** The item names (a list for the dialog: the rule itself reads names only from recipes and resources) */
    items: readonly string[];
};

/** What the user gave: an answer by question key, and the setpoint's item, taken as it is written */
export type FlowsInputs = {
    answers: Readonly<Record<string, string>>;
    setpoint?: { item?: string };
};

export type LaneSource = "drops" | "takers" | "other-lane" | "answered";

/** The items of one lane of one physical line, read as the Sidecar reads it: at the pieces inserters take from, else over the line */
export type LaneFlow = {
    /** The line's first piece (its smallest entity number) */
    line: number;
    lane: 1 | 2;
    /** Sorted */
    items: string[];
    source: LaneSource;
    /** True where the lane waits on a drill's question: its items are the takers' candidates and no question is asked for it */
    waiting: boolean;
    /** Where the lane was read: the pieces inserters take from, or the whole line when none does */
    read_at: "pickup-pieces" | "whole-line";
};

/** The items that the fixed point puts on one lane of one belt piece */
export type PieceLane = { piece: number; lane: 1 | 2; items: string[] };

export type RecipeHow = "blueprint" | "ore" | "input";

/** A furnace's or recycler's recipe, and how it was found (`via` is the ore or the item it took the recipe from) */
export type MachineRecipe = { entity_number: number; recipe: string | null; how: RecipeHow | null; via?: string };

export type ChestFlow = { entity_number: number; items: string[] };

export type TargetRef = { kind: "machine" | "chest"; entity_number: number };

export type OreStep = "set-recipe" | "next-machine" | "filters" | "setpoint" | "answered";

export type DrillFlow = {
    entity_number: number;
    name: string;
    target: TargetRef;
    /** The rule's step 1 candidates, sorted */
    candidates: string[];
    /** The ore, and the steps that gave it; null where the drill asks */
    ore: { item: string; steps: OreStep[] } | null;
};

export type LeftOutReason = "no-target" | "two-targets" | "onto-belt" | "no-ore-item" | "no-data";
export type LeftOutDrill = { entity_number: number; name: string; reason: LeftOutReason };

export type RecyclerFlow = {
    entity_number: number;
    mirrored: boolean;
    target: TargetRef | null;
    /** Why there is no target; null where there is one */
    reason: "no-target" | "two-targets" | "no-data" | null;
};

export type CircuitSet = { entity_number: number; sets: "recipe" | "filters" };

/** A value with no read of the game behind it; the words are for the dialog */
export type UnreadCode = "mirrored-recycler" | "infinity-loader" | "drop-lane-outside-pin";
export type UnreadFlow = { code: UnreadCode; entity_number: number; lane?: 1 | 2 };

export type FlowQuestion = {
    type: "drill-ore" | "lane-item";
    key: string;
    subject: { entity_number: number; lane?: 1 | 2 };
    /** Sorted; empty where the blueprint has none to offer */
    candidates: string[];
};

export type BuildFlows = {
    /** By line, then lane */
    lanes: LaneFlow[];
    /** By piece, then lane */
    pieces: PieceLane[];
    /** Each furnace and recycler, by entity number */
    machines: MachineRecipe[];
    /** Each chest with items, by entity number */
    chests: ChestFlow[];
    /** The drills that have a target, by entity number */
    drills: DrillFlow[];
    left_out_drills: LeftOutDrill[];
    recyclers: RecyclerFlow[];
    /** The entities whose recipe or filters a circuit sets (counted as having neither) */
    circuit_set: CircuitSet[];
    /** By entity number, code, lane */
    unread: UnreadFlow[];
    /** By type, entity number, lane */
    questions: FlowQuestion[];
};

// ---------------------------------------------------------------- small helpers

const SINK_TYPES: readonly string[] = ["assembling-machine", "furnace", "rocket-silo", "container", "logistic-container", "linked-container", "infinity-container", "car", "cargo-wagon"];
/** How far into the tile under a drop an entity's box has to reach for the drop to go into it: 12/256 of a tile */
const DROP_TILE_REACH = 12 / 256;
/** A list the data should hold: a value that is no list (the data's empty recipe holds an empty object) reads as empty */
const listOf = <T>(value: readonly T[] | undefined | null): readonly T[] => (Array.isArray(value) ? value : []);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedOf = (set: ReadonlySet<string>): string[] => [...set].sort(compareText);
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);
const intersect = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> => new Set([...a].filter((x) => b.has(x)));

function vectorOf(value: FlowsVector | undefined): Point | null {
    if (value === undefined) return null;
    const [x, y] = Array.isArray(value) ? value : [(value as { x: number }).x, (value as { y: number }).y];
    return isNumber(x) && isNumber(y) ? { x, y } : null;
}

/** A vector of a prototype facing north, turned to a cardinal direction */
function turned(v: Point, direction: number): Point {
    let { x, y } = v;
    for (let k = 0; k < direction / 4; k += 1) [x, y] = [-y, x];
    return { x: x + 0, y: y + 0 };
}

/** Whether a convex polygon reaches into the tile by `reach` on every side (a box that touches the edge of that area counts) */
function reaches(polygon: readonly Point[], tile: Tile, reach: number): boolean {
    const x0 = tile.x + reach, y0 = tile.y + reach, x1 = tile.x + 1 - reach, y1 = tile.y + 1 - reach;
    const square: Point[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    for (const shape of [polygon, square]) {
        for (let i = 0; i < shape.length; i += 1) {
            const p = shape[i], q = shape[(i + 1) % shape.length];
            const nx = q.y - p.y, ny = p.x - q.x;
            const along = (points: readonly Point[]) => points.map((pt) => nx * pt.x + ny * pt.y);
            const pa = along(polygon), pb = along(square);
            if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
        }
    }
    return true;
}

type Tag = "infinity-loader" | "drop-lane-outside-pin";
type Found = { how: RecipeHow; recipe: string; via?: string };

const laneKey = (piece: number, lane: number) => `${piece}:${lane}`;

/** The drill (or recycler) rule's result for one drill, before any answer */
type DrillRule = {
    entity_number: number;
    name: string;
    target: TargetRef | null;
    leftOut: LeftOutReason | null;
    /** Step 1: the item results of the resources the drill can mine */
    candidates: Set<string>;
    /** The candidates that the rule's step 2 or 3 leaves */
    final: Set<string>;
    steps: OreStep[];
};

/**
 * What one run of the fixed point gives, with the answers applied. `fills`: by question key, the lane that no drop or
 * loader feeds and one item is left for, once the other lane of its line is answered
 */
type Solved = { flows: BuildFlows; asked: ReadonlySet<string>; fills: ReadonlyMap<string, string> };

export function flowsOf(
    world: BuildWorld,
    geometry: BuildGeometry,
    entities: readonly BlueprintEntityRead[],
    inputs: FlowsInputs,
    data: FlowsData,
): BuildFlows {
    const reads = new Map<number, BlueprintEntityRead>();
    for (const e of entities) if (!reads.has(e.entity_number)) reads.set(e.entity_number, e);
    const answers = inputs.answers;
    const setpoint = typeof inputs.setpoint?.item === "string" && inputs.setpoint.item !== "" ? inputs.setpoint.item : null;

    const protoOf = (n: number): string | null => {
        const placed = world.entity(n);
        return placed ? (placed.prototype ?? own(data.entity_types, placed.name) ?? null) : null;
    };
    const isItem = (entry: FlowsEntry) => entry.type === undefined || entry.type === "item";
    const itemsOf = (recipe: string, field: "ingredients" | "results"): Set<string> => {
        const row = own(data.recipes, recipe);
        return new Set(listOf(row?.[field]).filter(isItem).map((x) => x.name));
    };

    // ------------------------------------------------------------ circuits, filters and recipes in the blueprint
    const circuitSet: CircuitSet[] = [];
    for (const e of [...reads.values()].sort((a, b) => a.entity_number - b.entity_number)) {
        if (e.control_behavior?.set_recipe === true) circuitSet.push({ entity_number: e.entity_number, sets: "recipe" });
        if (e.control_behavior?.circuit_set_filters === true) circuitSet.push({ entity_number: e.entity_number, sets: "filters" });
    }
    const circuitRecipe = new Set(circuitSet.filter((c) => c.sets === "recipe").map((c) => c.entity_number));
    const circuitFilters = new Set(circuitSet.filter((c) => c.sets === "filters").map((c) => c.entity_number));

    /** An inserter's whitelist; none without `use_filters`, with a blacklist, with no row or where a circuit sets the filters */
    const whitelist = (n: number): Set<string> | null => {
        const e = reads.get(n);
        if (!e || !e.use_filters || e.filter_mode === "blacklist" || circuitFilters.has(n)) return null;
        const set = new Set(e.filters.flatMap((f) => (f.item !== undefined ? [f.item] : [])));
        return set.size > 0 ? set : null;
    };
    const infinityFilters = (n: number): Set<string> => new Set((reads.get(n)?.infinity?.filters ?? []).map((f) => f.item));
    /** The slot filters of a chest: a wagon's or a car's `inventory.filters` (no `use_filters`) and an infinity chest's */
    const slotFilters = (n: number): Set<string> => {
        const set = infinityFilters(n);
        for (const f of reads.get(n)?.inventory?.filters ?? []) if (f.item !== undefined) set.add(f.item);
        return set;
    };
    const blueprintRecipes = new Map<number, string>();
    for (const e of world.entities) {
        if (e.kind !== "machine" && e.prototype !== "rocket-silo") continue;
        const recipe = reads.get(e.entity_number)?.recipe;
        if (recipe !== undefined && recipe !== "" && !circuitRecipe.has(e.entity_number)) blueprintRecipes.set(e.entity_number, recipe);
    }

    const categoriesOf = (machine: string): Set<string> => new Set(listOf(own(data.crafting_machines, machine)?.crafting_categories));
    /** The recipes of a machine's crafting categories whose one item ingredient is `item` */
    const furnaceRecipes = (machine: string, item: string): string[] => {
        const categories = categoriesOf(machine);
        const found: string[] = [];
        for (const [name, recipe] of Object.entries(data.recipes)) {
            if (!listOf(recipe.categories).some((c) => categories.has(c))) continue;
            const ingredients = listOf(recipe.ingredients).filter(isItem).map((x) => x.name);
            if (ingredients.length === 1 && ingredients[0] === item) found.push(name);
        }
        return found;
    };

    // ------------------------------------------------------------ inserters and their ends
    type Inserter = { n: number; pickup: Point; drop: Point; source: InserterEnds["source"]; sink: InserterEnds["sink"]; mirror: boolean };
    const inserters: Inserter[] = geometry.ends.map((end) => ({
        n: end.inserter,
        pickup: end.pickup,
        drop: end.drop,
        source: end.source,
        sink: end.sink,
        mirror: world.entity(end.inserter)?.mirror ?? false,
    }));
    const dropBasis = new Map(geometry.drops.map((d) => [d.inserter, d.line.basis]));

    // ------------------------------------------------------------ where a drill and a recycler put what they make
    const sinksAt = (point: Point): { sinks: number[]; belt: boolean } => {
        const tile = tileOf(point);
        const found = new Set<number>();
        const holder = world.entityAt(tile);
        if (holder && holder.placed && holder.prototype !== null && SINK_TYPES.includes(holder.prototype)) found.add(holder.entity_number);
        for (const v of geometry.vehicles) {
            const prototype = protoOf(v.entity_number);
            if (v.box && prototype !== null && SINK_TYPES.includes(prototype) && reaches(v.box, tile, DROP_TILE_REACH)) found.add(v.entity_number);
        }
        return { sinks: [...found].sort((a, b) => a - b), belt: holder?.kind === "belt" };
    };
    /** The drop position of a drill or a recycler: its position plus its vector, x negated when mirrored, turned, on the game's grid */
    const dropOf = (e: PlacedEntity, vector: FlowsVector | undefined): Point | null => {
        const v = vectorOf(vector);
        if (!v || ![0, 4, 8, 12].includes(e.direction)) return null;
        const t = turned({ x: e.mirror ? -v.x : v.x, y: v.y }, e.direction);
        return { x: e.position.x + t.x, y: e.position.y + t.y };
    };
    const targetKindOf = (n: number): "machine" | "chest" => (world.entity(n)?.kind === "machine" ? "machine" : "chest");

    // ------------------------------------------------------------ the drill rule (steps 1 to 4)
    const step1 = (drill: string): Set<string> => {
        const categories = new Set(listOf(own(data.mining_drills, drill)?.resource_categories));
        const out = new Set<string>();
        for (const resource of Object.values(data.resources)) {
            if (!categories.has(resource.category ?? "basic-solid")) continue;
            if (typeof resource.minable?.result === "string") out.add(resource.minable.result);
            for (const r of listOf(resource.minable?.results)) if (isItem(r)) out.add(r.name);
        }
        return out;
    };
    /** A furnace or recycler: the candidates that are the one item ingredient of a recipe of its categories with an item of `itemset` among its results */
    const furnaceForm = (candidates: ReadonlySet<string>, machine: string, itemset: ReadonlySet<string>): Set<string> => {
        const out = new Set<string>();
        if (itemset.size === 0) return out;
        const categories = categoriesOf(machine);
        for (const recipe of Object.values(data.recipes)) {
            if (!listOf(recipe.categories).some((c) => categories.has(c))) continue;
            const ingredients = listOf(recipe.ingredients).filter(isItem).map((x) => x.name);
            if (ingredients.length === 1 && candidates.has(ingredients[0]) && listOf(recipe.results).filter(isItem).some((r) => itemset.has(r.name))) out.add(ingredients[0]);
        }
        return out;
    };
    const settle = (name: string, target: number): { candidates: Set<string>; final: Set<string>; steps: OreStep[] } => {
        const candidates = step1(name);
        const placed = world.entity(target)!;
        const recipe = blueprintRecipes.get(target);
        if (placed.kind === "machine" && recipe !== undefined) {
            return { candidates, final: intersect(candidates, itemsOf(recipe, "ingredients")), steps: ["set-recipe"] };
        }
        const isFurnace = placed.prototype === "furnace";
        if (placed.kind === "machine" && !isFurnace) return { candidates, final: new Set(), steps: [] };
        const nextMachine = new Set<string>();
        const filters = new Set<string>();
        for (const ins of inserters) {
            if (ins.source?.entity_number !== target) continue;
            const wl = whitelist(ins.n);
            if (wl) for (const x of wl) filters.add(x);
            const sink = ins.sink;
            const sinkRecipe = sink && sink.target === "machine" ? blueprintRecipes.get(sink.entity_number) : undefined;
            if (sinkRecipe !== undefined) {
                const ingredients = itemsOf(sinkRecipe, "ingredients");
                for (const x of wl ? intersect(ingredients, wl) : ingredients) nextMachine.add(x);
            }
            if (sink && sink.target === "chest") for (const x of slotFilters(sink.entity_number)) filters.add(x);
        }
        if (placed.kind === "chest") for (const x of slotFilters(target)) filters.add(x);
        const sources: [OreStep, ReadonlySet<string>][] = [
            ["next-machine", nextMachine],
            ["filters", filters],
            ["setpoint", setpoint === null ? new Set() : new Set([setpoint])],
        ];
        const per: [OreStep, Set<string>][] = sources.map(([step, set]) => [step, placed.kind === "machine" ? furnaceForm(candidates, placed.name, set) : intersect(candidates, set)]);
        const given = per.filter(([, set]) => set.size > 0);
        const final = given.length === 0 ? new Set<string>() : given.map(([, set]) => set).reduce((a, b) => intersect(a, b));
        return { candidates, final, steps: given.map(([step]) => step) };
    };

    const drillRules: DrillRule[] = [];
    for (const e of world.entities) {
        if (e.prototype !== "mining-drill") continue;
        const row = own(data.mining_drills, e.name);
        const base = { entity_number: e.entity_number, name: e.name, target: null as TargetRef | null, candidates: new Set<string>(), final: new Set<string>(), steps: [] as OreStep[] };
        if (!row) {
            drillRules.push({ ...base, leftOut: "no-data" });
            continue;
        }
        const candidates = step1(e.name);
        if (candidates.size === 0) {
            drillRules.push({ ...base, leftOut: "no-ore-item" });
            continue;
        }
        const drop = dropOf(e, row.vector_to_place_result);
        if (!drop) {
            drillRules.push({ ...base, candidates, leftOut: "no-target" });
            continue;
        }
        const { sinks, belt } = sinksAt(drop);
        if (sinks.length !== 1) {
            drillRules.push({ ...base, candidates, leftOut: sinks.length > 1 ? "two-targets" : belt ? "onto-belt" : "no-target" });
            continue;
        }
        const settled = settle(e.name, sinks[0]);
        drillRules.push({ ...base, candidates, final: settled.final, steps: settled.steps, target: { kind: targetKindOf(sinks[0]), entity_number: sinks[0] }, leftOut: null });
    }

    const recyclers: RecyclerFlow[] = [];
    for (const e of world.entities) {
        if (e.prototype !== "furnace") continue;
        const vector = own(data.crafting_machines, e.name)?.vector_to_place_result;
        if (vector === undefined) continue;
        const drop = dropOf(e, vector);
        if (!drop) {
            recyclers.push({ entity_number: e.entity_number, mirrored: e.mirror, target: null, reason: "no-data" });
            continue;
        }
        const { sinks } = sinksAt(drop);
        recyclers.push({
            entity_number: e.entity_number,
            mirrored: e.mirror,
            target: sinks.length === 1 ? { kind: targetKindOf(sinks[0]), entity_number: sinks[0] } : null,
            reason: sinks.length === 1 ? null : sinks.length > 1 ? "two-targets" : "no-target",
        });
    }

    // ------------------------------------------------------------ the lines that inserters touch
    const lineOfPiece = new Map<number, number>();
    for (const line of geometry.lines) for (const p of line.pieces) lineOfPiece.set(p, line.first);
    const touched = new Set<number>();
    for (const ins of inserters) {
        for (const end of [ins.source, ins.sink]) {
            if (end && end.target === "belt") {
                const line = lineOfPiece.get(end.entity_number);
                if (line !== undefined) touched.add(line);
            }
        }
    }
    const readLines = geometry.lines.filter((l) => touched.has(l.first));

    // ------------------------------------------------------------ one run of the fixed point, with the answers given so far
    function solve(applied: ReadonlyMap<string, string>, filled: ReadonlyMap<string, string>): Solved {
        const recipe = new Map<number, Found>();
        const lane = new Map<string, Set<string>>();
        // what drops and loaders put on each lane: an answer or a fill is no drop, so it feeds nothing
        const dropped = new Map<string, Set<string>>();
        const chest = new Map<number, Set<string>>();
        const tags = new Map<string, Set<Tag>>();
        let changes = 0;
        const grow = (set: Set<string>, items: Iterable<string>) => {
            for (const x of items) {
                if (!set.has(x)) {
                    set.add(x);
                    changes += 1;
                }
            }
        };
        const chestSet = (n: number) => {
            let set = chest.get(n);
            if (!set) chest.set(n, (set = new Set()));
            return set;
        };
        const laneSet = (key: string) => {
            let set = lane.get(key);
            if (!set) lane.set(key, (set = new Set()));
            return set;
        };
        const tag = (key: string, value: Tag) => {
            let set = tags.get(key);
            if (!set) tags.set(key, (set = new Set()));
            if (!set.has(value)) {
                set.add(value);
                changes += 1;
            }
        };

        for (const [n, r] of blueprintRecipes) recipe.set(n, { how: "blueprint", recipe: r });

        // a drill's ore: by the rule or by an answer
        const oreOf = new Map<number, { item: string; steps: OreStep[] }>();
        for (const d of drillRules) {
            if (d.target === null) continue;
            const answer = applied.get(`drill-ore:${d.entity_number}`);
            if (answer !== undefined) oreOf.set(d.entity_number, { item: answer, steps: ["answered"] });
            else if (d.final.size === 1) oreOf.set(d.entity_number, { item: [...d.final][0], steps: d.steps });
        }
        for (const d of drillRules) {
            const ore = oreOf.get(d.entity_number);
            if (d.target === null || !ore) continue;
            const target = world.entity(d.target.entity_number)!;
            if (target.prototype === "furnace") {
                const found = furnaceRecipes(target.name, ore.item);
                if (found.length === 1 && !recipe.has(target.entity_number)) recipe.set(target.entity_number, { how: "ore", recipe: found[0], via: ore.item });
            } else if (target.kind === "chest") {
                grow(chestSet(target.entity_number), [ore.item]);
            }
        }

        // an answered lane, and a filled one, goes onto the pieces its line is read at
        for (const line of geometry.lines) {
            for (const l of [1, 2] as const) {
                const answer = applied.get(`lane-item:${line.first}:${l}`) ?? filled.get(`lane-item:${line.first}:${l}`);
                if (answer === undefined) continue;
                const at = line.pickups.length > 0 ? line.pickups.map((p) => p.piece) : line.pieces;
                for (const p of at) grow(laneSet(laneKey(p, l)), [answer]);
            }
        }

        const products = (n: number): Set<string> | null => {
            const r = recipe.get(n);
            return r ? itemsOf(r.recipe, "results") : null;
        };
        const ingredients = (n: number): Set<string> | null => {
            const r = recipe.get(n);
            return r ? itemsOf(r.recipe, "ingredients") : null;
        };
        const beltItems = (n: number): Set<string> | null => {
            const set = new Set<string>();
            for (const l of [1, 2]) for (const x of lane.get(laneKey(n, l)) ?? []) set.add(x);
            return set.size > 0 ? set : null;
        };
        const sourceItems = (ins: Inserter): Set<string> | null => {
            const src = ins.source;
            if (!src) return null;
            if (src.target === "machine") return products(src.entity_number);
            if (src.target === "chest") {
                if (protoOf(src.entity_number) === "infinity-container") {
                    const f = infinityFilters(src.entity_number);
                    return f.size > 0 ? f : null;
                }
                return chest.get(src.entity_number) ?? null;
            }
            return world.piece(src.entity_number) ? beltItems(src.entity_number) : null;
        };
        const sinkAccepts = (ins: Inserter): Set<string> | null => (ins.sink && ins.sink.target === "machine" ? ingredients(ins.sink.entity_number) : null);
        const handItems = (ins: Inserter): Set<string> | null => {
            let candidates: Set<string> | null = null;
            for (const part of [whitelist(ins.n), sourceItems(ins), sinkAccepts(ins)]) {
                if (part === null) continue;
                candidates = candidates === null ? new Set(part) : intersect(candidates, part);
            }
            return candidates;
        };

        /** Puts items on a lane of a piece and on every lane that lane runs onto, side loads landing as the world gives them */
        const push = (piece: BeltPiece, l: number, items: ReadonlySet<string>, mark: Tag | null, seen: Set<string>) => {
            const key = laneKey(piece.entity_number, l);
            if (seen.has(key)) return;
            seen.add(key);
            grow(laneSet(key), items);
            let own = dropped.get(key);
            if (!own) dropped.set(key, (own = new Set()));
            grow(own, items);
            if (mark) tag(key, mark);
            for (const next of world.lineAfter(piece)) {
                if (piece.kind === "underground" && piece.end === "input") {
                    push(next, l, items, mark, seen);
                    continue;
                }
                const side = piece.side_loads.find((s) => s.receiver === next.entity_number);
                if (side) {
                    if (side.passing.includes(l as 1 | 2)) push(next, side.lane, items, mark, seen);
                } else {
                    push(next, l, items, mark, seen);
                }
            }
        };

        for (;;) {
            const before = changes;
            // drops onto belts: an inserter puts its hand items on the drop lane only when they are one item
            for (const ins of inserters) {
                if (!ins.sink || ins.sink.target !== "belt") continue;
                const piece = world.piece(ins.sink.entity_number);
                if (!piece) continue;
                const hand = handItems(ins);
                if (!hand || hand.size !== 1) continue;
                const landing = world.laneOfDrop(ins.drop, piece, ins.mirror);
                if (!landing) continue;
                push(piece, landing.line, hand, landing.mark !== null && dropBasis.get(ins.n) === "unread" ? "drop-lane-outside-pin" : null, new Set());
            }
            // loaders taking out of an infinity chest onto a belt: the chest's filter items on both lanes of what follows
            for (const piece of world.pieces) {
                if (piece.kind !== "loader" || piece.end !== "output" || !piece.loader || piece.loader.chest === null) continue;
                if (protoOf(piece.loader.chest) !== "infinity-container") continue;
                const f = infinityFilters(piece.loader.chest);
                if (f.size === 0) continue;
                for (const next of world.lineAfter(piece)) for (const l of [1, 2]) push(next, l, f, "infinity-loader", new Set());
            }
            // buffer chests and furnaces, from their inserters
            for (const ins of inserters) {
                const { sink, source } = ins;
                const hand = handItems(ins);
                if (sink && sink.target === "chest" && protoOf(sink.entity_number) !== "infinity-container" && hand && hand.size > 0) grow(chestSet(sink.entity_number), hand);
                if (sink && protoOf(sink.entity_number) === "furnace" && !recipe.has(sink.entity_number)) {
                    let give = sourceItems(ins);
                    const wl = whitelist(ins.n);
                    if (wl) give = give === null ? wl : intersect(give, wl);
                    if (give && give.size === 1) {
                        const item = [...give][0];
                        const found = furnaceRecipes(sink.name, item);
                        if (found.length === 1) {
                            recipe.set(sink.entity_number, { how: "input", recipe: found[0], via: item });
                            changes += 1;
                        }
                    }
                }
                if (source && source.target === "chest" && protoOf(source.entity_number) !== "infinity-container") {
                    const wl = whitelist(ins.n);
                    const accepts = sinkAccepts(ins);
                    if (wl && wl.size === 1) grow(chestSet(source.entity_number), wl);
                    else if (accepts && accepts.size === 1) grow(chestSet(source.entity_number), accepts);
                }
            }
            if (changes === before) break;
        }

        // ------------------------------------------------------ reading the lanes
        const drillsOpen = new Set(drillRules.filter((d) => d.target !== null && !oreOf.has(d.entity_number)).map((d) => d.target!.entity_number));
        const fedByOpenDrill = (start: number): boolean => {
            const seen = new Set<number>();
            const walk = (n: number): boolean => {
                if (drillsOpen.has(n)) return true;
                if (seen.has(n)) return false;
                seen.add(n);
                return inserters.some((ins) => ins.sink?.entity_number === n && ins.source !== null && walk(ins.source.entity_number));
            };
            return walk(start);
        };

        const fills = new Map<string, string>();
        const lanes: LaneFlow[] = [];
        const unread: UnreadFlow[] = [];
        const questions: FlowQuestion[] = [];
        for (const line of readLines) {
            const own2 = new Set(line.pieces);
            const pickupPieces = line.pickups.map((p) => p.piece);
            const waiting = inserters.some((ins) => ins.sink?.target === "belt" && own2.has(ins.sink.entity_number) && ins.source !== null && fedByOpenDrill(ins.source.entity_number));
            const takers = new Set<string>();
            for (const ins of inserters) {
                if (ins.source?.target !== "belt" || !own2.has(ins.source.entity_number)) continue;
                const c = whitelist(ins.n) ?? sinkAccepts(ins);
                if (c) for (const x of c) takers.add(x);
            }
            // fed by a drop or a loader: an answer or a fill on a lane feeds nothing
            const fed = line.pieces.some((p) => [1, 2].some((l) => (dropped.get(laneKey(p, l))?.size ?? 0) > 0));
            for (const l of [1, 2] as const) {
                const key = `lane-item:${line.first}:${l}`;
                const answer = applied.get(key);
                const union = (pieces: readonly number[]) => {
                    const set = new Set<string>();
                    for (const p of pieces) for (const x of lane.get(laneKey(p, l)) ?? []) set.add(x);
                    return set;
                };
                const atPick = union(pickupPieces);
                const readAt: LaneFlow["read_at"] = atPick.size > 0 ? "pickup-pieces" : "whole-line";
                const droppedAt = (pieces: readonly number[]) => {
                    const set = new Set<string>();
                    for (const p of pieces) for (const x of dropped.get(laneKey(p, l)) ?? []) set.add(x);
                    return set;
                };
                const readPieces = atPick.size > 0 ? pickupPieces : line.pieces;
                let items: Set<string>;
                let source: LaneSource;
                let wait = false;
                if (answer !== undefined) {
                    items = new Set([answer]);
                    source = "answered";
                } else {
                    const atPickDropped = droppedAt(pickupPieces);
                    const found = atPickDropped.size > 0 ? atPickDropped : droppedAt(line.pieces);
                    const otherAnswer = applied.get(`lane-item:${line.first}:${3 - l}`);
                    if (found.size > 0) {
                        items = found;
                        source = "drops";
                        const marks = new Set<Tag>();
                        for (const p of readPieces) for (const t of tags.get(laneKey(p, l)) ?? []) marks.add(t);
                        for (const code of [...marks].sort(compareText)) unread.push({ code, entity_number: line.first, lane: l });
                    } else if (fed) {
                        items = new Set();
                        source = "other-lane";
                    } else if (otherAnswer !== undefined && !waiting) {
                        // nothing drops onto the line and the other lane is answered: this lane holds what the takers can still take
                        const left = [...takers].filter((x) => x !== otherAnswer);
                        items = new Set(left);
                        if (left.length === 0) source = "other-lane";
                        else {
                            source = "takers";
                            if (left.length === 1) fills.set(key, left[0]);
                        }
                    } else {
                        items = takers;
                        source = "takers";
                        wait = waiting;
                    }
                }
                lanes.push({ line: line.first, lane: l, items: sortedOf(items), source, waiting: wait, read_at: readAt });
                if (source !== "answered" && source !== "other-lane" && !wait && items.size !== 1) {
                    questions.push({ type: "lane-item", key, subject: { entity_number: line.first, lane: l }, candidates: sortedOf(items) });
                }
            }
        }
        for (const r of recyclers) if (r.mirrored) unread.push({ code: "mirrored-recycler", entity_number: r.entity_number });

        const drills: DrillFlow[] = [];
        const leftOut: LeftOutDrill[] = [];
        for (const d of drillRules) {
            if (d.target === null) {
                leftOut.push({ entity_number: d.entity_number, name: d.name, reason: d.leftOut! });
                continue;
            }
            const ore = oreOf.get(d.entity_number) ?? null;
            drills.push({ entity_number: d.entity_number, name: d.name, target: d.target, candidates: sortedOf(d.candidates), ore });
            if (!ore) {
                questions.push({
                    type: "drill-ore",
                    key: `drill-ore:${d.entity_number}`,
                    subject: { entity_number: d.entity_number },
                    candidates: sortedOf(d.final.size > 1 ? d.final : d.candidates),
                });
            }
        }

        const pieces: PieceLane[] = [...lane.entries()]
            .filter(([, set]) => set.size > 0)
            .map(([key, set]) => {
                const [piece, l] = key.split(":").map(Number);
                return { piece, lane: l as 1 | 2, items: sortedOf(set) };
            })
            .sort((a, b) => a.piece - b.piece || a.lane - b.lane);
        const machines: MachineRecipe[] = world.entities
            .filter((e) => e.prototype === "furnace")
            .map((e) => {
                const found = recipe.get(e.entity_number);
                return found
                    ? { entity_number: e.entity_number, recipe: found.recipe, how: found.how, ...(found.via !== undefined ? { via: found.via } : {}) }
                    : { entity_number: e.entity_number, recipe: null, how: null };
            });
        const chests: ChestFlow[] = [...chest.entries()].filter(([, set]) => set.size > 0).map(([n, set]) => ({ entity_number: n, items: sortedOf(set) })).sort((a, b) => a.entity_number - b.entity_number);

        questions.sort((a, b) => compareText(a.type, b.type) || a.subject.entity_number - b.subject.entity_number || (a.subject.lane ?? 0) - (b.subject.lane ?? 0));
        unread.sort((a, b) => a.entity_number - b.entity_number || compareText(a.code, b.code) || (a.lane ?? 0) - (b.lane ?? 0));
        const flows: BuildFlows = {
            lanes: lanes.sort((a, b) => a.line - b.line || a.lane - b.lane),
            pieces,
            machines,
            chests,
            drills,
            left_out_drills: leftOut,
            recyclers,
            circuit_set: circuitSet,
            unread,
            questions,
        };
        return { flows, asked: new Set(questions.map((q) => q.key)), fills };
    }

    // an answer counts only for a key that is asked; one answer can make another key appear, so this repeats until none is added.
    // A fill is read from the last run and put on its lane in the next, as an answer is, until the fills it reads are the fills it was given.
    const applied = new Map<string, string>();
    let filled: ReadonlyMap<string, string> = new Map();
    const seen = new Set<string>();
    for (;;) {
        const solved = solve(applied, filled);
        const added = Object.keys(answers)
            .filter((key) => !applied.has(key) && solved.asked.has(key) && typeof answers[key] === "string")
            .sort(compareText);
        const settled = solved.fills.size === filled.size && [...solved.fills].every(([key, item]) => filled.get(key) === item);
        const state = JSON.stringify([[...applied], [...solved.fills], added]);
        if ((added.length === 0 && settled) || seen.has(state)) return solved.flows;
        seen.add(state);
        for (const key of added) applied.set(key, answers[key]);
        filled = solved.fills;
    }
}
