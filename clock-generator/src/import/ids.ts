/**
 * The ids of a pasted blueprint: the numbers that the build's configuration gives its machines, belts, chests, drills
 * and inserters, by the rule that the Sidecar's export numbers a selection by.
 *
 * `idsOf` reads the world (`worldOf`), the blueprint's own entities (for an assembling machine's recipe), the geometry
 * (`geometryOf`: the two ends of each inserter and the belt lines), the flows (`flowsOf`: the items of each lane, the
 * recipe of each furnace, the items of each buffer chest, the target and ore of each drill) and a narrow slice of the
 * game data. It is pure and total: the same input gives the same ids, every list is sorted by a stated key, and a
 * malformed input is a listed problem, never a throw.
 *
 * The base order is the entity number: the blueprint keeps no other. A belt id belongs to one or more lines, in the
 * order of the line's smallest piece number. The ids are final only when no question of the flows is open.
 */
import type { BlueprintEntityRead } from "./blueprint-entities";
import type { BuildFlows, LaneFlow } from "./flows";
import type { BuildGeometry, BeltLine } from "./geometry";
import type { BuildWorld, PlacedEntity } from "./world";

/** What the ids read of one crafting machine of the game data: its type, its burner and the subgroup of the machine (or of the item that places it) */
export type IdsMachineData = {
    type: string;
    burner_fuel_categories: readonly string[];
    subgroup: string;
};

/** What the ids read of the game data, by crafting machine name */
export type IdsData = {
    crafting_machines: Readonly<Record<string, IdsMachineData>>;
};

/** A machine or a chest, as the target of a drill, an inserter end or a result */
export type TargetId = { type: "machine" | "chest"; id: number };

export type MachineId = {
    id: number;
    entity_number: number;
    name: string;
    /** Where a machine that places its results itself puts them: a machine id, else a chest id, else none */
    result_target: TargetId | null;
};

export type BeltLane = { ingredient: string };

/** A belt id: the lines that carry the same items on the same lanes */
export type BeltId = {
    id: number;
    /** The sorted item set, joined by `|`, then `#`, then the item of lane 1, `|`, the item of lane 2 */
    signature: string;
    /** The first line's smallest piece number, then the others', sorted */
    lines: number[];
    first_line: number;
    /** The sorted item set */
    items: string[];
    /** The lanes in the export's form: one per item where no lane has an item; lane 2 alone; else lane 1 and lane 2 (`ingredient` is "" where lane 2 has none) */
    lanes: BeltLane[];
    /** The transport line of each listed lane: `[1, 2]`, `[2]`, or none where the lanes are items of splitter or loader lines */
    lane_lines: (1 | 2)[] | null;
};

export type ChestId = {
    id: number;
    entity_number: number;
    name: string;
    /** `infinity-chest` or `buffer-chest`; a car's or tank's prototype name; `cargo-wagon`; `rocket-silo` */
    chest_type: string;
    /** The items that the flows give a buffer chest; empty for the others */
    items: string[];
};

export type DrillId = { id: number; entity_number: number; name: string; target: TargetId };

export type EndId = { type: "machine" | "belt" | "chest"; id: number };

export type InserterId = { id: number; entity_number: number; source: EndId; sink: EndId };

export type LeftOutInserter = { entity_number: number; end: "pickup" | "drop" };

export type LeftOutDrillReason = "no-ore" | "target-has-no-id";
export type LeftOutDrillId = { entity_number: number; name: string; reason: LeftOutDrillReason };

/** The ways this import differs from the export that a build can show; the code names the case, `lane` the lane of a line */
export type DifferenceCode = "crusher" | "splitter-drop" | "splitter-or-loader-lane";
export type IdsDifference = { code: DifferenceCode; entity_number: number; lane?: 1 | 2 };

export type IdsProblemCode = "bad-input" | "bad-entry" | "no-machine-data";
export type IdsProblem = { code: IdsProblemCode; entity_number?: number; name?: string };

/** Why a line has no belt id: a lane whose item is a question, no item on it, or no value of the flows */
export type LineWhy = "open" | "no-item" | "no-value";
export type LineId = { line: number; belt: number | null; why: LineWhy | null };

export type BuildIds = {
    /** By entity number (the id counts up in that order) */
    machines: MachineId[];
    /** By id */
    belts: BeltId[];
    /** By entity number */
    chests: ChestId[];
    /** By entity number */
    drills: DrillId[];
    /** By entity number */
    inserters: InserterId[];
    /** By entity number */
    left_out_inserters: LeftOutInserter[];
    /** By entity number */
    left_out_drills: LeftOutDrillId[];
    /** By line: the belt id of each belt line, or why it has none */
    lines: LineId[];
    /** By entity number, then code, then lane */
    differences: IdsDifference[];
    /** By code, then entity number */
    problems: IdsProblem[];
    /** True when no question of the flows is open: the ids move when an answer is given while it is false */
    final: boolean;
};

// ---------------------------------------------------------------- small helpers

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byNumber = (a: number, b: number) => a - b;
const listOf = <T>(value: readonly T[] | undefined | null): readonly T[] => (Array.isArray(value) ? value : []);
const own = <T>(record: Readonly<Record<string, T>> | undefined | null, key: string): T | undefined =>
    record !== undefined && record !== null && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The game's subgroups whose crafting machines the export numbers */
const EXPORT_SUBGROUPS: readonly string[] = ["smelting-machine", "production-machine", "agriculture"];
/** Of the agriculture machines the export numbers those that burn this fuel category */
const NUTRIENTS = "nutrients";
const MACHINE_TYPES: readonly string[] = ["assembling-machine", "furnace"];
/** The belt pieces whose lanes carry an item that sets lane 1 or 2; a splitter's or loader's lines only name the item */
const LANE_PIECE_TYPES: readonly string[] = ["transport-belt", "underground-belt"];
const BUFFER_CHEST_TYPES: readonly string[] = ["container", "logistic-container"];

const emptyIds = (problems: IdsProblem[]): BuildIds => ({
    machines: [],
    belts: [],
    chests: [],
    drills: [],
    inserters: [],
    left_out_inserters: [],
    left_out_drills: [],
    lines: [],
    differences: [],
    problems,
    final: false,
});

/**
 * The machine rule of the export: an entity of type assembling machine or furnace whose subgroup is a smelting machine,
 * a production machine, or an agriculture machine that burns nutrients, and that has a recipe. Whether it has a recipe
 * is for the caller.
 */
export function numbersMachine(row: IdsMachineData): boolean {
    if (!MACHINE_TYPES.includes(row.type)) return false;
    if (!EXPORT_SUBGROUPS.includes(row.subgroup)) return false;
    if (row.subgroup === "agriculture" && !listOf(row.burner_fuel_categories).includes(NUTRIENTS)) return false;
    return true;
}

/**
 * The ids of a build. A machine is numbered by the entity number, a belt by the smallest piece number of its first line,
 * a chest, a drill and an inserter by the entity number.
 */
export function idsOf(
    world: BuildWorld,
    entities: readonly BlueprintEntityRead[],
    geometry: BuildGeometry,
    flows: BuildFlows,
    data: IdsData,
): BuildIds {
    try {
        const sound = soundOf(world, entities, geometry, flows, data);
        if ("problems" in sound) return emptyIds(sound.problems.sort((x, y) => compareText(x.code, y.code) || compareText(x.name ?? "", y.name ?? "")));
        const result = numbered(sound.world, sound.entities, sound.geometry, sound.flows, sound.data);
        result.problems = [...sound.skipped, ...result.problems].sort((a, b) => compareText(a.code, b.code) || compareText(a.name ?? "", b.name ?? "") || (a.entity_number ?? 0) - (b.entity_number ?? 0));
        return result;
    } catch {
        return emptyIds([{ code: "bad-input" }]);
    }
}

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);
const isLane = (value: unknown): value is 1 | 2 => value === 1 || value === 2;
const areNumbers = (value: unknown): boolean => Array.isArray(value) && value.every(isNumber);
const areTexts = (value: unknown): boolean => Array.isArray(value) && value.every((x) => typeof x === "string");
const isEnd = (value: unknown): boolean => value === null || value === undefined || (isRecord(value) && isNumber(value.entity_number) && (value.target === "machine" || value.target === "belt" || value.target === "chest"));

type Sound = { world: BuildWorld; entities: BlueprintEntityRead[]; geometry: BuildGeometry; flows: BuildFlows; data: IdsData; skipped: IdsProblem[] };

/**
 * The input with each malformed entry of a list left out and listed (`bad-entry`, the list's name and the entity number
 * where it has one), or the problems alone where an argument is missing or is no record or list (`bad-input`).
 */
function soundOf(world: BuildWorld, entities: readonly BlueprintEntityRead[], geometry: BuildGeometry, flows: BuildFlows, data: IdsData): Sound | { problems: IdsProblem[] } {
    const missing: IdsProblem[] = [];
    const need = (ok: boolean, name: string) => {
        if (!ok) missing.push({ code: "bad-input", name });
    };
    need(isRecord(world) && Array.isArray(world.entities) && typeof world.entity === "function" && typeof world.piece === "function", "world");
    need(Array.isArray(entities), "entities");
    need(isRecord(geometry) && Array.isArray(geometry.ends) && Array.isArray(geometry.lines), "geometry");
    const lists = ["lanes", "pieces", "machines", "chests", "drills", "recyclers", "circuit_set", "questions"] as const;
    need(isRecord(flows) && lists.every((name) => Array.isArray(flows[name])), "flows");
    need(isRecord(data), "data");
    if (missing.length > 0) return { problems: missing };

    const skipped: IdsProblem[] = [];
    const keep = <T>(list: readonly T[], name: string, ok: (entry: Record_) => boolean): T[] =>
        list.filter((entry) => {
            if (isRecord(entry) && ok(entry)) return true;
            skipped.push({ code: "bad-entry", name, ...(isRecord(entry) && isNumber(entry.entity_number) ? { entity_number: entry.entity_number } : {}) });
            return false;
        });
    const cleanFlows: BuildFlows = {
        ...flows,
        lanes: keep(flows.lanes, "flows.lanes", (l) => isNumber(l.line) && isLane(l.lane) && areTexts(l.items)),
        pieces: keep(flows.pieces, "flows.pieces", (p) => isNumber(p.piece) && isLane(p.lane) && areTexts(p.items)),
        machines: keep(flows.machines, "flows.machines", (m) => isNumber(m.entity_number)),
        chests: keep(flows.chests, "flows.chests", (c) => isNumber(c.entity_number) && areTexts(c.items)),
        drills: keep(flows.drills, "flows.drills", (d) => isNumber(d.entity_number) && isRecord(d.target) && isNumber(d.target.entity_number)),
        recyclers: keep(flows.recyclers, "flows.recyclers", (r) => isNumber(r.entity_number) && (r.target === null || r.target === undefined || (isRecord(r.target) && isNumber(r.target.entity_number)))),
        circuit_set: keep(flows.circuit_set, "flows.circuit_set", (c) => isNumber(c.entity_number)),
        questions: keep(flows.questions, "flows.questions", (q) => typeof q.key === "string"),
    };
    const cleanGeometry: BuildGeometry = {
        ...geometry,
        ends: keep(geometry.ends, "geometry.ends", (e) => isNumber(e.inserter) && isEnd(e.source) && isEnd(e.sink)),
        lines: keep(geometry.lines, "geometry.lines", (l) => isNumber(l.first) && areNumbers(l.pieces)),
    };
    const cleanWorld: BuildWorld = { ...world, entities: keep(world.entities, "world.entities", (e) => isNumber(e.entity_number) && typeof e.name === "string") };
    const cleanEntities = keep(entities, "entities", (e) => isNumber(e.entity_number));
    const cleanData: IdsData = { crafting_machines: isRecord(data.crafting_machines) ? data.crafting_machines : {} };
    if (!isRecord(data.crafting_machines)) skipped.push({ code: "bad-input", name: "data.crafting_machines" });
    return { world: cleanWorld, entities: cleanEntities, geometry: cleanGeometry, flows: cleanFlows, data: cleanData, skipped };
}

function numbered(world: BuildWorld, entities: readonly BlueprintEntityRead[], geometry: BuildGeometry, flows: BuildFlows, data: IdsData): BuildIds {
    const problems: IdsProblem[] = [];
    const differences: IdsDifference[] = [];
    const placed: PlacedEntity[] = [...world.entities].sort((a, b) => a.entity_number - b.entity_number);

    const recipeOf = new Map<number, string>();
    for (const e of entities) {
        if (e !== null && typeof e === "object" && isNumber(e.entity_number) && typeof e.recipe === "string" && e.recipe !== "" && !recipeOf.has(e.entity_number)) recipeOf.set(e.entity_number, e.recipe);
    }
    const circuitRecipe = new Set(flows.circuit_set.filter((c) => c.sets === "recipe").map((c) => c.entity_number));
    const furnaceRecipe = new Map<number, string>();
    for (const m of flows.machines) if (typeof m.recipe === "string" && m.recipe !== "") furnaceRecipe.set(m.entity_number, m.recipe);

    // ------------------------------------------------------------ machines
    const machineIds = new Map<number, number>();
    const machines: MachineId[] = [];
    for (const e of placed) {
        if (e.kind !== "machine") continue;
        if (e.prototype === null || !MACHINE_TYPES.includes(e.prototype)) continue;
        const row = own(data.crafting_machines, e.name);
        if (row === undefined) {
            problems.push({ code: "no-machine-data", entity_number: e.entity_number, name: e.name });
            continue;
        }
        const hasRecipe = !circuitRecipe.has(e.entity_number) && (e.prototype === "furnace" ? furnaceRecipe.has(e.entity_number) : recipeOf.has(e.entity_number));
        if (!hasRecipe) continue;
        if (!numbersMachine({ ...row, type: e.prototype })) {
            // an electric machine that a rule by type and burner alone would number, and the export leaves out by its subgroup
            const burner = listOf(row.burner_fuel_categories);
            if (!EXPORT_SUBGROUPS.includes(row.subgroup) && (burner.length === 0 || burner.includes(NUTRIENTS))) differences.push({ code: "crusher", entity_number: e.entity_number });
            continue;
        }
        const id = machines.length + 1;
        machineIds.set(e.entity_number, id);
        machines.push({ id, entity_number: e.entity_number, name: e.name, result_target: null });
    }

    // ------------------------------------------------------------ chests
    const chestItems = new Map<number, string[]>();
    for (const c of flows.chests) chestItems.set(c.entity_number, [...listOf(c.items)].sort(compareText));
    const chestIds = new Map<number, number>();
    const chests: ChestId[] = [];
    for (const e of placed) {
        if (e.kind !== "chest" || e.prototype === null) continue;
        let chestType: string | null = null;
        let items: string[] = [];
        if (e.prototype === "infinity-container") chestType = "infinity-chest";
        else if (e.prototype === "car") chestType = e.name;
        else if (e.prototype === "cargo-wagon") chestType = "cargo-wagon";
        else if (e.prototype === "rocket-silo") chestType = "rocket-silo";
        else if (BUFFER_CHEST_TYPES.includes(e.prototype)) {
            items = chestItems.get(e.entity_number) ?? [];
            // the export's chest has one item: with two or more the item is not known, as where its inserters leave a chest unresolved
            if (items.length === 1) chestType = "buffer-chest";
        }
        if (chestType === null) continue;
        const id = chests.length + 1;
        chestIds.set(e.entity_number, id);
        chests.push({ id, entity_number: e.entity_number, name: e.name, chest_type: chestType, items });
    }

    // a machine that places its results itself: a machine id, else a chest id, else none
    const targetOf = (entityNumber: number): TargetId | null => {
        const machine = machineIds.get(entityNumber);
        if (machine !== undefined) return { type: "machine", id: machine };
        const chest = chestIds.get(entityNumber);
        return chest !== undefined ? { type: "chest", id: chest } : null;
    };
    const resultOf = new Map<number, number>();
    for (const r of flows.recyclers) if (r.target !== null && r.target !== undefined) resultOf.set(r.entity_number, r.target.entity_number);
    for (const m of machines) {
        const target = resultOf.get(m.entity_number);
        m.result_target = target === undefined ? null : targetOf(target);
    }

    // ------------------------------------------------------------ belts
    const laneOf = new Map<string, LaneFlow>();
    for (const l of flows.lanes) laneOf.set(`${l.line}:${l.lane}`, l);
    const pieceItems = new Map<string, Set<string>>();
    for (const p of flows.pieces) {
        const key = `${p.piece}:${p.lane}`;
        let set = pieceItems.get(key);
        if (!set) pieceItems.set(key, (set = new Set()));
        for (const x of listOf(p.items)) set.add(x);
    }
    const questionKeys = new Set(flows.questions.map((q) => q.key));
    const pieceType = (n: number): string | null => world.entity(n)?.prototype ?? null;

    const lines: BeltLine[] = [...geometry.lines].sort((a, b) => a.first - b.first);
    const signatureToBelt = new Map<string, BeltId>();
    const belts: BeltId[] = [];
    const lineIds: LineId[] = [];
    for (const line of lines) {
        const laneFlows = ([1, 2] as const).map((lane) => laneOf.get(`${line.first}:${lane}`));
        if (laneFlows.every((l) => l === undefined)) {
            lineIds.push({ line: line.first, belt: null, why: "no-value" });
            continue;
        }
        // a lane waits on a question, or is one
        const open = ([1, 2] as const).some((lane, i) => {
            const flow = laneFlows[i];
            if (questionKeys.has(`lane-item:${line.first}:${lane}`)) return true;
            if (flow === undefined) return false;
            return flow.waiting || (flow.source !== "answered" && flow.source !== "other-lane" && listOf(flow.items).length !== 1);
        });
        if (open) {
            lineIds.push({ line: line.first, belt: null, why: "open" });
            continue;
        }

        // the item set: whatever the flows put on any piece or lane of the line, and each lane's own item
        const set = new Set<string>();
        for (const piece of line.pieces) for (const lane of [1, 2]) for (const x of pieceItems.get(`${piece}:${lane}`) ?? []) set.add(x);
        const laneItem: (string | null)[] = [null, null];
        ([1, 2] as const).forEach((lane, i) => {
            const flow = laneFlows[i];
            const items = flow === undefined ? [] : listOf(flow.items);
            if (items.length !== 1) return;
            const item = items[0];
            set.add(item);
            // the export reads lane 1 and 2 on belts and underground belts only: an item seen on splitter or loader pieces alone names no lane
            let atBelt = false;
            let atOther = false;
            for (const piece of line.pieces) {
                if (!pieceItems.get(`${piece}:${lane}`)?.has(item)) continue;
                if (LANE_PIECE_TYPES.includes(pieceType(piece) ?? "")) atBelt = true;
                else atOther = true;
            }
            if (atOther && !atBelt) differences.push({ code: "splitter-or-loader-lane", entity_number: line.first, lane });
            else laneItem[i] = item;
        });
        if (set.size === 0) {
            lineIds.push({ line: line.first, belt: null, why: "no-item" });
            continue;
        }
        const items = [...set].sort(compareText);
        const [lane1, lane2] = laneItem;
        const signature = `${items.join("|")}#${lane1 ?? ""}|${lane2 ?? ""}`;
        let belt = signatureToBelt.get(signature);
        if (belt === undefined) {
            let lanes: BeltLane[];
            let laneLines: (1 | 2)[] | null;
            if (lane1 === null && lane2 === null) {
                lanes = items.map((ingredient) => ({ ingredient }));
                laneLines = null;
            } else if (lane1 === null) {
                lanes = [{ ingredient: lane2 as string }];
                laneLines = [2];
            } else {
                lanes = [{ ingredient: lane1 }, { ingredient: lane2 ?? "" }];
                laneLines = [1, 2];
            }
            belt = { id: belts.length + 1, signature, lines: [], first_line: line.first, items, lanes, lane_lines: laneLines };
            signatureToBelt.set(signature, belt);
            belts.push(belt);
        }
        belt.lines.push(line.first);
        lineIds.push({ line: line.first, belt: belt.id, why: null });
    }
    for (const belt of belts) belt.lines.sort(byNumber);
    const beltOfPiece = new Map<number, number>();
    for (const line of lines) {
        const id = lineIds.find((l) => l.line === line.first)?.belt;
        if (id !== null && id !== undefined) for (const piece of line.pieces) beltOfPiece.set(piece, id);
    }

    // ------------------------------------------------------------ drills
    const drills: DrillId[] = [];
    const leftOutDrills: LeftOutDrillId[] = [];
    for (const d of [...flows.drills].sort((a, b) => a.entity_number - b.entity_number)) {
        if (d.ore === null || d.ore === undefined) {
            leftOutDrills.push({ entity_number: d.entity_number, name: d.name, reason: "no-ore" });
            continue;
        }
        const target = targetOf(d.target.entity_number);
        if (target === null) {
            leftOutDrills.push({ entity_number: d.entity_number, name: d.name, reason: "target-has-no-id" });
            continue;
        }
        drills.push({ id: drills.length + 1, entity_number: d.entity_number, name: d.name, target });
    }

    // ------------------------------------------------------------ inserters
    const endId = (end: BuildGeometry["ends"][number]["source"]): EndId | null => {
        if (end === null || end === undefined) return null;
        if (end.target === "belt") {
            const belt = beltOfPiece.get(end.entity_number);
            return belt === undefined ? null : { type: "belt", id: belt };
        }
        if (end.target === "chest") {
            const chest = chestIds.get(end.entity_number);
            return chest === undefined ? null : { type: "chest", id: chest };
        }
        const machine = machineIds.get(end.entity_number);
        return machine === undefined ? null : { type: "machine", id: machine };
    };
    const inserters: InserterId[] = [];
    const leftOut: LeftOutInserter[] = [];
    for (const end of [...geometry.ends].sort((a, b) => a.inserter - b.inserter)) {
        const source = endId(end.source);
        const sink = endId(end.sink);
        if (end.sink?.target === "belt" && world.piece(end.sink.entity_number)?.kind === "splitter") differences.push({ code: "splitter-drop", entity_number: end.inserter });
        if (source === null) leftOut.push({ entity_number: end.inserter, end: "pickup" });
        else if (sink === null) leftOut.push({ entity_number: end.inserter, end: "drop" });
        else inserters.push({ id: inserters.length + 1, entity_number: end.inserter, source, sink });
    }

    differences.sort((a, b) => a.entity_number - b.entity_number || compareText(a.code, b.code) || (a.lane ?? 0) - (b.lane ?? 0));
    problems.sort((a, b) => compareText(a.code, b.code) || (a.entity_number ?? 0) - (b.entity_number ?? 0));
    return {
        machines,
        belts,
        chests,
        drills,
        inserters,
        left_out_inserters: leftOut,
        left_out_drills: leftOutDrills,
        lines: lineIds,
        differences,
        problems,
        final: flows.questions.length === 0,
    };
}
