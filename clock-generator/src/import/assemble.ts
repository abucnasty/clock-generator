/**
 * The last step of the import: it runs the steps in their order (decode, world, geometry, flows, speeds, ids), builds
 * each step's slice of the game data from `FactorioData`, and writes the five lists of the configuration from what the
 * steps give, in the configuration's own types. It also gives the research block, the questions, the notes, the counts
 * of what is read and what is not, and what the layout view can draw.
 *
 * It writes the fields that the Sidecar's export wrote, by the export's rules, with three changes: no `sidecar_version`,
 * no `pickup_warnings` (a refused pickup is its unsupported capture and a note), and no `sink.drop` or `output_belt`.
 */
import * as O from "fp-ts/Option";
import type { BeltConfig, ChestConfig, InserterConfig, MachineConfiguration, MiningDrillConfig } from "../config/schema";
import type { ResearchBase } from "../config/research-block";
import { suggestedTargetOf } from "../config/suggested-target";
import type { FactorioData } from "../data/factorio-data-types";
import { applyResearch } from "./apply-research";
import type { BlueprintEntityRead, FilterRead } from "./blueprint-entities";
import { decodeBlueprint } from "./decode";
import { flowsOf, type BuildFlows, type FlowsData, type FlowsInputs } from "./flows";
import { geometryOf, type Basis, type Based, type BuildGeometry, type GeometryData, type GeometryRow, type PickupProblem } from "./geometry";
import { idsOf, type BeltId, type BuildIds, type DrillId, type IdsData, type InserterId } from "./ids";
import type { DropLane, DropPosition, GeometryNoteField, ImportBuild, ImportEntity, ImportList, ImportSpeed, ImportInputs, ImportNote, ImportOutcome, ImportQuestion, NoteCode, OutputLine, QuestionKind, ReadKind } from "./outcome";
import { isPleaseCheck, READ_KINDS, SHARING_ANSWERS } from "./outcome";
import { placesOf, questionLayoutOf } from "./question-layout";
import { speedsOf, type SpeedData, type SpeedResult } from "./speeds";
import { throttlesOf } from "./throttles";
import { worldOf, type BuildWorld, type PrototypeRow, type WorldData, type WorldProblemCode } from "./world";

// ---------------------------------------------------------------- the data each step takes, from the game data

/** The effects a module or a beacon can give, as the speeds' data names them */
type SpeedEffectName = NonNullable<SpeedData["beacon"][string]["allowed_effects"]>[number];

const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
    record !== undefined && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

/** The world's rows: each entity's game type and size, and an underground belt's reach */
export function worldDataOf(data: FactorioData): WorldData {
    const rows: Record<string, PrototypeRow> = {};
    for (const [name, footprint] of Object.entries(data.entity_footprint ?? {})) {
        const row: PrototypeRow = { type: footprint.type, tile_width: footprint.tile_width, tile_height: footprint.tile_height };
        const reach = (own(data.underground_belt, name) as { max_distance?: number } | undefined)?.max_distance;
        if (reach !== undefined) row.max_distance = reach;
        rows[name] = row;
    }
    return rows;
}

/** The geometry's rows: each entity's game type and box, an inserter's two vectors, a belt piece's speed */
export function geometryDataOf(data: FactorioData): GeometryData {
    const rows: Record<string, GeometryRow> = {};
    for (const [name, footprint] of Object.entries(data.entity_footprint ?? {})) {
        const row: GeometryRow = { type: footprint.type };
        if (footprint.collision_box) row.collision_box = footprint.collision_box;
        const inserter = own(data.inserter, name);
        if (inserter) {
            row.pickup_position = inserter.pickup_position;
            row.insert_position = inserter.insert_position;
        }
        for (const section of [data.transport_belt, data.underground_belt, data.splitter, data.loader] as Readonly<Record<string, { speed?: number }>>[]) {
            const speed = own(section, name)?.speed;
            if (speed !== undefined) row.speed = speed;
        }
        rows[name] = row;
    }
    return rows;
}

/** The flows' slice: the types, the drills, the resources, the recipes, the crafting machines and the item names */
export function flowsDataOf(data: FactorioData): FlowsData {
    const drills = data["mining-drill"];
    const resources = data.resource;
    return {
        entity_types: Object.fromEntries(Object.entries(data.entity_footprint ?? {}).map(([name, row]) => [name, row.type])),
        mining_drills: Object.fromEntries(Object.entries(drills).map(([name, row]) => [name, { resource_categories: row.resource_categories, vector_to_place_result: row.vector_to_place_result }])),
        resources: Object.fromEntries(Object.entries(resources).map(([name, row]) => [name, { ...("category" in row && typeof row.category === "string" ? { category: row.category } : {}), minable: row.minable }])),
        recipes: Object.fromEntries(Object.entries(data.recipe).map(([name, row]) => [name, { categories: row.categories, ingredients: row.ingredients, results: row.results }])),
        crafting_machines: Object.fromEntries(Object.entries(data.crafting_machine).map(([name, row]) => [name, {
            type: row.type,
            crafting_categories: row.crafting_categories,
            ...(row.vector_to_place_result ? { vector_to_place_result: row.vector_to_place_result } : {}),
        }])),
        items: Object.keys(data.item),
    };
}

/** An effect list as the step reads it: the game may write one effect alone, which is a list of that one */
function effectListOf<T extends { allowed_effects?: string | readonly string[] }>(rows: Readonly<Record<string, T>>): Record<string, Omit<T, "allowed_effects"> & { allowed_effects?: SpeedEffectName[] }> {
    return Object.fromEntries(Object.entries(rows).map(([name, row]) => {
        const { allowed_effects, ...rest } = row;
        const list = allowed_effects === undefined ? undefined : (typeof allowed_effects === "string" ? [allowed_effects] : [...allowed_effects]) as SpeedEffectName[];
        return [name, { ...rest, ...(list !== undefined && { allowed_effects: list }) }];
    }));
}

/** The speeds' slice: the game data's own sections */
export function speedDataOf(data: FactorioData): SpeedData {
    return {
        quality: data.quality,
        module: data.module,
        beacon: effectListOf(data.beacon),
        crafting_machine: effectListOf(data.crafting_machine),
        rocket_silo: effectListOf(data.rocket_silo),
        "mining-drill": effectListOf(data["mining-drill"]),
    };
}

/** The ids' slice: each crafting machine's type, burner fuel categories and subgroup, as the game data holds them */
export function idsDataOf(data: FactorioData): IdsData {
    return {
        crafting_machines: Object.fromEntries(Object.entries(data.crafting_machine).map(([name, row]) => [name, {
            type: row.type,
            burner_fuel_categories: row.burner_fuel_categories ?? [],
            subgroup: row.subgroup,
        }])),
    };
}

// ---------------------------------------------------------------- the notes each step's codes give

type SpeedUnreadReason = SpeedResult["rows"][number]["unread"][number]["reason"];
type SpeedProblemCode = SpeedResult["problems"][number]["problem"];

/** Every code of each step has its note: these records fail to compile when a step gains a code */
export const WORLD_NOTES: Record<WorldProblemCode, NoteCode> = {
    "unknown-name": "world:unknown-name", "bad-entity": "world:bad-entity", "duplicate-number": "world:duplicate-number", "no-size": "world:no-size", "bad-direction": "world:bad-direction",
    "bad-type": "world:bad-type", "no-reach": "world:no-reach", "off-grid": "world:off-grid", overlap: "world:overlap",
};
export const GEOMETRY_NOTES: Record<BuildGeometry["problems"][number]["code"], NoteCode> = {
    "no-vectors": "geometry:no-vectors", "bad-direction": "geometry:bad-direction", "no-box": "geometry:no-box", "bad-orientation": "geometry:bad-orientation",
};
export const FLOWS_UNREAD_NOTES: Record<BuildFlows["unread"][number]["code"], NoteCode> = {
    "mirrored-recycler": "flows:mirrored-recycler", "infinity-loader": "flows:infinity-loader", "drop-lane-outside-pin": "flows:drop-lane-outside-pin",
};
export const CIRCUIT_NOTES: Record<BuildFlows["circuit_set"][number]["sets"], NoteCode> = { recipe: "circuit:recipe", filters: "circuit:filters" };
export const LEFT_OUT_DRILL_NOTES: Record<BuildFlows["left_out_drills"][number]["reason"], NoteCode> = {
    "no-target": "drill:no-target", "two-targets": "drill:two-targets", "onto-belt": "drill:onto-belt", "no-ore-item": "drill:no-ore-item", "no-data": "drill:no-data",
};
export const RECYCLER_NOTES: Record<NonNullable<BuildFlows["recyclers"][number]["reason"]>, NoteCode> = {
    "no-target": "recycler:no-target", "two-targets": "recycler:two-targets", "no-data": "recycler:no-data",
};
export const SPEED_UNREAD_NOTES: Record<SpeedUnreadReason, NoteCode> = {
    "beacon-mix": "speeds:beacon-mix", quality: "speeds:quality", "rounding-tie": "speeds:rounding-tie", "effect-limit": "speeds:effect-limit",
    "receiver-flags": "speeds:receiver-flags", "allowed-effects": "speeds:allowed-effects", "module-request": "speeds:module-request",
    "consumption-not-read": "speeds:consumption-not-read",
};
export const SPEED_PROBLEM_NOTES: Record<SpeedProblemCode, NoteCode> = {
    "not-placed": "speeds-problem:not-placed", "no-data": "speeds-problem:no-data", "beacon-not-square": "speeds-problem:beacon-not-square", "unknown-quality": "speeds-problem:unknown-quality",
};
export const ID_DIFFERENCE_NOTES: Record<BuildIds["differences"][number]["code"], NoteCode> = {
    crusher: "ids:crusher", "splitter-drop": "ids:splitter-drop", "splitter-or-loader-lane": "ids:splitter-or-loader-lane",
};
export const LEFT_OUT_INSERTER_NOTES: Record<BuildIds["left_out_inserters"][number]["end"], NoteCode> = { pickup: "inserter-left-out:pickup", drop: "inserter-left-out:drop" };
export const LEFT_OUT_DRILL_ID_NOTES: Record<BuildIds["left_out_drills"][number]["reason"], NoteCode> = { "no-ore": "drill-left-out:no-ore", "target-has-no-id": "drill-left-out:target-has-no-id" };
export const ID_PROBLEM_NOTES: Record<BuildIds["problems"][number]["code"], NoteCode> = {
    "bad-input": "ids-problem:bad-input", "bad-entry": "ids-problem:bad-entry", "no-machine-data": "ids-problem:no-machine-data",
};
/** The reasons a belt pickup is refused: the geometry's problems, and a pickup that another belt side-loads onto */
export type PickupRefusal = PickupProblem | "side-loaded";
export const PICKUP_NOTES: Record<PickupRefusal, NoteCode> = {
    bend: "pickup:bend", splitter: "pickup:splitter", unsupported: "pickup:unsupported", inline: "pickup:inline", "side-loaded": "pickup:side-loaded",
};

// ---------------------------------------------------------------- small helpers

const byNumber = (a: number, b: number) => a - b;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The game's filters that block a slot: no item may go into it */
const BLOCKING_FILTERS: readonly string[] = ["no-item", "deconstruction-planner"];
const QUESTION_ORDER: readonly QuestionKind[] = ["drill-ore", "lane-item", "lane-export", "lane-sharing"];
const SPEED_LISTS: readonly ImportSpeed["list"][] = ["machines", "drills", "chests"];
const MACHINE_TYPES: readonly string[] = ["assembling-machine", "furnace"];
const CHEST_TYPES: readonly string[] = ["container", "logistic-container", "linked-container", "infinity-container"];
const VEHICLE_TYPES: readonly string[] = ["car", "cargo-wagon"];
const BELT_TYPES: readonly string[] = ["transport-belt", "underground-belt", "splitter", "loader", "loader-1x1"];
const BEACON_TYPES: readonly string[] = ["beacon"];
const DRILL_TYPES: readonly string[] = ["mining-drill"];
const INSERTER_TYPES: readonly string[] = ["inserter"];

/** The kind `read` counts an entity of this game type as; null for a type the import does not read */
function readKindOf(type: string | null): Exclude<ReadKind, "belt"> | null {
    if (type === null) return null;
    if (MACHINE_TYPES.includes(type)) return "machine";
    if (type === "rocket-silo") return "rocket-silo";
    if (DRILL_TYPES.includes(type)) return "drill";
    if (INSERTER_TYPES.includes(type)) return "inserter";
    if (CHEST_TYPES.includes(type)) return "chest";
    if (VEHICLE_TYPES.includes(type)) return "vehicle";
    if (BEACON_TYPES.includes(type)) return "beacon";
    return null;
}

const position = (e: BlueprintEntityRead) => ({ x: e.position.x, y: e.position.y });

/** Collects notes once each, and sorts them by entity number, code, lane and field */
class Notes {
    private readonly byKey = new Map<string, ImportNote>();
    add(code: NoteCode, entity_number: number, extra: { lane?: 1 | 2; field?: string; value?: number } = {}): void {
        const key = `${entity_number}|${code}|${extra.lane ?? ""}|${extra.field ?? ""}`;
        if (this.byKey.has(key)) return;
        this.byKey.set(key, {
            code, entity_number,
            ...(extra.lane !== undefined && { lane: extra.lane }),
            ...(extra.field !== undefined && { field: extra.field }),
            ...(extra.value !== undefined && { value: extra.value }),
            please_check: isPleaseCheck(code),
        });
    }
    /** A note for a value whose basis is not a read of the game */
    based(basis: Basis, field: GeometryNoteField, entity_number: number, lane?: 1 | 2): void {
        const code = basisCode(basis, field);
        if (code !== null) this.add(code, entity_number, lane === undefined ? {} : { lane });
    }
    list(): ImportNote[] {
        return [...this.byKey.values()].sort((a, b) =>
            a.entity_number - b.entity_number || compareText(a.code, b.code) || (a.lane ?? 0) - (b.lane ?? 0) || compareText(a.field ?? "", b.field ?? ""));
    }
}

function basisCode(basis: Basis, field: GeometryNoteField): NoteCode | null {
    return basis === "game" ? null : (`${basis}:${field}` as NoteCode);
}

/** The basis of a set of values: the first that is not a read of the game, else game */
const worstOf = (...bases: Basis[]): Basis[] => [...new Set(bases.filter((basis) => basis !== "game"))];

/** The one value all give, else `unknown` */
const mergedOf = <T>(values: readonly T[], unknown: T): T => (values.every((v) => v === values[0]) ? values[0] : unknown);

/** A filter row with an item, or a note for one without */
function itemsOfFilters(rows: readonly FilterRead[] | undefined, onMissing: () => void): FilterRead[] {
    const out: FilterRead[] = [];
    for (const row of [...(rows ?? [])].sort((a, b) => a.index - b.index)) {
        if (row.item === undefined || row.item === "") onMissing();
        else out.push(row);
    }
    return out;
}

// ---------------------------------------------------------------- the import

/** The build of a pasted blueprint, or why there is none. Pure: it reads only its arguments. */
export function assembleImport(text: string, inputs: ImportInputs, data: FactorioData): ImportOutcome {
    const decoded = decodeBlueprint(text);
    if (decoded.kind === "problem") return { kind: "problem", problem: decoded.problem };
    return assemble(decoded.entities, inputs, data);
}

function assemble(entities: readonly BlueprintEntityRead[], inputs: ImportInputs, data: FactorioData): ImportBuild {
    // (a) each step's data, built from the game data and typed as the step takes it
    const worldData: WorldData = worldDataOf(data);
    const geometryData: GeometryData = geometryDataOf(data);
    const flowsData: FlowsData = flowsDataOf(data);
    const speedData: SpeedData = speedDataOf(data);
    const idsData: IdsData = idsDataOf(data);

    const answers = inputs.answers ?? {};
    const flowsInputs: FlowsInputs = { answers, ...(inputs.setpoint?.item !== undefined && { setpoint: { item: inputs.setpoint.item } }) };
    const world: BuildWorld = worldOf(entities, worldData);
    const geometry: BuildGeometry = geometryOf(world, entities, geometryData);
    const flows: BuildFlows = flowsOf(world, geometry, entities, flowsInputs, flowsData);
    const speeds: SpeedResult = speedsOf(entities, world, speedData);
    const ids: BuildIds = idsOf(world, entities, geometry, flows, idsData);
    // the inserters that empty a lane into a voiding chest: left out, and the lane they empty is asked the rate it exports at (a line whose item is still asked may give either lane)
    const throttles = throttlesOf(world, geometry, entities, (first) => {
        const line = ids.lines.find((l) => l.line === first);
        return line?.why === "open" ? [1, 2] : (ids.belts.find((b) => b.id === line?.belt)?.lane_lines ?? []);
    });

    const notes = new Notes();
    const entityOf = new Map(entities.map((e) => [e.entity_number, e]));
    const speedOf = new Map(speeds.rows.map((row) => [row.entity_number, row]));
    const lineOf = new Map(geometry.lines.map((line) => [line.first, line]));
    const pickupOf = new Map(geometry.pickups.map((p) => [p.inserter, p]));
    const dropOf = new Map(geometry.drops.map((d) => [d.inserter, d]));
    const endsOf = new Map(geometry.ends.map((e) => [e.inserter, e]));

    // ------------------------------------------------ the questions: the flows' two kinds and the sharing of a line
    const places = placesOf(world, geometry, DRILL_TYPES);
    const { drillPlaces, armLines, beltPlaces, lineOfPiece } = places;

    const questions: ImportQuestion[] = flows.questions.map((q) => ({
        key: q.key,
        kind: q.type,
        subject: {
            label: q.type === "drill-ore" ? `Drill ${drillPlaces.get(q.subject.entity_number) ?? q.subject.entity_number}` : `Belt ${beltPlaces.get(q.subject.entity_number) ?? q.subject.entity_number}`,
            entity_number: q.subject.entity_number,
            ...(q.subject.lane !== undefined && { lane: q.subject.lane }),
        },
        candidates: [...q.candidates],
    }));

    // (f) where the blueprint cannot show whether the copies share a line, and the user has more than one copy, it asks
    const copies = inputs.setpoint?.copies ?? 1;
    const sharingAnswer = new Map<number, (typeof SHARING_ANSWERS)[number]>();
    for (const first of armLines) {
        const line = lineOf.get(first)!;
        if (!line.sharing.some((s) => s.basis === "default") || !(copies > 1)) continue;
        const key = `lane-sharing:${first}`;
        const answer = own(answers, key);
        if (answer !== undefined && (SHARING_ANSWERS as readonly string[]).includes(answer)) {
            sharingAnswer.set(first, answer as (typeof SHARING_ANSWERS)[number]);
            continue;
        }
        questions.push({ key, kind: "lane-sharing", subject: { label: `Belt ${beltPlaces.get(first)}`, entity_number: first }, candidates: [...SHARING_ANSWERS] });
    }
    // the lanes that a throttle empties: each asks how many items a second leave it; an answer above 0 makes the lane an export at that rate
    const throttleLanes = [...new Set(throttles.map((t) => `${t.line}:${t.lane}`))].map((key) => key.split(":").map(Number) as [number, 1 | 2]);
    const rateOf = new Map<string, number>();
    for (const [first, lane] of throttleLanes) {
        const key = `lane-export:${first}:${lane}`;
        const text = own(answers, key);
        const answer = text === undefined ? NaN : Number(text);
        if (Number.isFinite(answer) && answer > 0) {
            rateOf.set(`${first}:${lane}`, answer);
            continue;
        }
        const flow = flows.lanes.find((l) => l.line === first && l.lane === lane);
        const item = flow !== undefined && !flow.waiting && flow.items.length === 1 ? flow.items[0] : "";
        questions.push({ key, kind: "lane-export", subject: { label: `Belt ${beltPlaces.get(first)}`, entity_number: first, lane, item }, candidates: [] });
    }
    const asksRate = (first: number, lane: number) => throttleLanes.some(([f, l]) => f === first && l === lane);
    questions.sort((a, b) => QUESTION_ORDER.indexOf(a.kind) - QUESTION_ORDER.indexOf(b.kind) || a.subject.entity_number - b.subject.entity_number || (a.subject.lane ?? 0) - (b.subject.lane ?? 0));

    // ------------------------------------------------ machines
    const furnaceRecipe = new Map(flows.machines.filter((m) => m.recipe !== null).map((m) => [m.entity_number, m.recipe as string]));
    const recipeOfMachine = (n: number): string => {
        const placed = world.entity(n);
        return (placed?.prototype === "furnace" ? furnaceRecipe.get(n) : entityOf.get(n)?.recipe) ?? "";
    };
    const percent = (value: { toDecimal(): number } | undefined): number => (value === undefined ? 0 : value.toDecimal());
    const machines: MachineConfiguration[] = ids.machines.map((m) => {
        const e = entityOf.get(m.entity_number)!;
        const row = speedOf.get(m.entity_number);
        const crafting_speed = row?.crafting_speed?.toDecimal() ?? own(data.crafting_machine, e.name)?.crafting_speed ?? 1;
        return {
            id: m.id,
            recipe: recipeOfMachine(m.entity_number),
            productivity: percent(row?.productivity),
            crafting_speed,
            ...(row?.energy_consumption_bonus !== undefined && { energy_consumption_bonus: row.energy_consumption_bonus.toDecimal() }),
            prototype: e.name,
            quality: e.quality as MachineConfiguration["quality"],
            recipe_quality: (e.recipe_quality ?? "normal") as MachineConfiguration["recipe_quality"],
            position: position(e),
            ...(m.result_target !== null && { result_target: m.result_target }),
        } as MachineConfiguration;
    });

    // ------------------------------------------------ drills (g)
    const drillFlow = new Map(flows.drills.map((d) => [d.entity_number, d]));
    const drillRow = (d: DrillId): MiningDrillConfig => {
        const e = entityOf.get(d.entity_number)!;
        const row = speedOf.get(d.entity_number);
        return {
            id: d.id,
            type: e.name as MiningDrillConfig["type"],
            mined_item_name: drillFlow.get(d.entity_number)?.ore?.item ?? "",
            speed_bonus: row?.speed_bonus?.toDecimal() ?? 0,
            productivity: percent(row?.productivity),
            target: d.target,
            position: position(e),
            direction: e.direction,
        };
    };
    const drills: MiningDrillConfig[] = ids.drills.map(drillRow);

    // ------------------------------------------------ belts (d): each id is one physical line (the merge below is of that one line)
    const beltRow = (b: BeltId): BeltConfig => {
        const lines = b.lines.map((n) => lineOf.get(n)).filter((l): l is NonNullable<typeof l> => l !== undefined);
        const first = lineOf.get(b.first_line) ?? lines[0];
        const pickups = lines.flatMap((l) => l.pickups);
        const flowsOfLines = lines.map((l) => l.flow_direction).filter((f): f is Based<number | null> => f !== null);
        const flowValues = flowsOfLines.map((f) => f.value);
        const flow = flowValues.length > 0 ? mergedOf<number | null>(flowValues, null) : null;
        const lanes = b.lanes.map((lane, index) => {
            const line = b.lane_lines?.[index] ?? null;
            const out: Record<string, unknown> = { ingredient: lane.ingredient, stack_size: 1 };
            const rate = line === null ? undefined : lines.map((l) => rateOf.get(`${l.first}:${line}`)).find((r) => r !== undefined);
            const asked = line !== null && lines.some((l) => asksRate(l.first, line));
            if (rate !== undefined) out.consumption_per_second = rate;
            if (pickups.length > 0 && !asked) {
                out.lane_end = { kind: line === null ? "unknown" : mergedOf(pickups.map((p) => p.lane_ends[line - 1].value), "unknown") };
            }
            if (line !== null) {
                const values = lines.map((l) => sharingAnswer.get(l.first) ?? (l.sharing[line - 1].basis === "default" ? null : l.sharing[line - 1].value));
                if (values.every((v) => v !== null)) out.sharing = mergedOf(values, "shared");
            }
            return out;
        });
        return {
            id: b.id,
            type: first.belt_type.value,
            ...(flow !== null && { flow_direction: flow }),
            lanes,
            ...(lanes.some((l) => l.consumption_per_second !== undefined) && { strategy: "export" }),
        } as unknown as BeltConfig;
    };
    const belts: BeltConfig[] = ids.belts.map(beltRow);

    // ------------------------------------------------ a buffer chest whose limit leaves it no slot: left out, with the inserters at it
    const storageOf = (e: BlueprintEntityRead): number => e.bar ?? e.inventory?.bar ?? (own(data.chest, e.name) as { inventory_size?: number } | undefined)?.inventory_size ?? 0;
    const noSlots = new Set(ids.chests.filter((c) => c.chest_type === "buffer-chest" && storageOf(entityOf.get(c.entity_number)!) <= 0).map((c) => c.id));
    for (const c of ids.chests) if (noSlots.has(c.id)) notes.add("chest:no-slots", c.entity_number);
    const atNoSlots = (end: { type: string; id: number }) => end.type === "chest" && noSlots.has(end.id);
    // a throttle and its chest are left out too
    const throttleInserters = new Set(throttles.map((t) => t.inserter));
    const throttleChests = new Set(throttles.map((t) => t.chest));
    for (const t of throttles) {
        notes.add("inserter-left-out:throttle", t.inserter);
        notes.add("chest:throttle", t.chest);
    }
    const keptInserters = ids.inserters.filter((i) => {
        if (atNoSlots(i.source)) notes.add(LEFT_OUT_INSERTER_NOTES.pickup, i.entity_number);
        if (atNoSlots(i.sink)) notes.add(LEFT_OUT_INSERTER_NOTES.drop, i.entity_number);
        return !atNoSlots(i.source) && !atNoSlots(i.sink) && !throttleInserters.has(i.entity_number);
    });
    const keptChests = ids.chests.filter((c) => !noSlots.has(c.id) && !throttleChests.has(c.entity_number));

    // ------------------------------------------------ inserters (b, e)
    const inserterRow = (i: InserterId, notes: Notes): InserterConfig => {
        const e = entityOf.get(i.entity_number)!;
        let source: Record<string, unknown> = { type: i.source.type, id: i.source.id };
        if (i.source.type === "belt") {
            const pickup = pickupOf.get(i.entity_number);
            const piece = pickup === undefined ? undefined : world.entity(pickup.piece);
            const entity_type = piece?.prototype ?? undefined;
            const layout = pickup?.pickup_layout.value ?? null;
            const length = pickup?.pickup_length.value ?? null;
            let refusal: PickupRefusal | null = pickup?.supply_problem.value ?? pickup?.problem.value ?? null;
            if (length === null || layout === null || entity_type === undefined) refusal ??= "unsupported";
            source = {
                ...source,
                ...(pickup?.near_lane.value != null && { near_lane: pickup.near_lane.value }),
                ...(length !== null && { pickup_length: length }),
                ...(layout !== null && { pickup_layout: layout }),
                pickup_capture: refusal === null
                    ? { status: "supported", model: "belt", model_version: layout === "bend-right-upstream" ? 3 : 2, entity_type, entity_name: piece!.name }
                    : { status: "unsupported", ...(entity_type !== undefined && { entity_type }), ...(piece !== undefined && { entity_name: piece.name }), reason: refusal },
            };
            if (refusal !== null) notes.add(PICKUP_NOTES[refusal], i.entity_number);
            if (pickup) {
                for (const basis of worstOf(pickup.near_lane.basis, pickup.pickup_length.basis, pickup.pickup_layout.basis, pickup.problem.basis, pickup.supply_problem.basis)) notes.based(basis, "pickup", i.entity_number);
            }
        }
        let sink: Record<string, unknown> = { type: i.sink.type, id: i.sink.id };
        if (i.sink.type === "belt") {
            const drop = dropOf.get(i.entity_number);
            if (drop) {
                const tiles = drop.side_load_tiles.value;
                sink = { ...sink, ...(tiles !== null && { drop_capture: { status: "side-loaded", tiles } }), belt_direction: drop.belt_direction.value };
                if (tiles !== null) notes.add("drop:side-loaded", i.entity_number, { value: tiles });
                notes.based(drop.side_load_tiles.basis, "side-load-tiles", i.entity_number);
                notes.based(drop.belt_direction.basis, "belt-direction", i.entity_number);
                // a drop's line carries one note: on a curve or an underground end it is the flows' note on the line
                const line = lineOfPiece.get(drop.piece);
                const pinned = flows.unread.some((u) => u.code === "drop-lane-outside-pin" && u.entity_number === line);
                if (!pinned) notes.based(drop.line.basis, "drop-line", i.entity_number);
            }
        }
        const ends = endsOf.get(i.entity_number);
        if (ends) notes.based(ends.basis, "inserter-ends", i.entity_number);
        const filters = e.use_filters ? itemsOfFilters(e.filters, () => notes.add("filter-no-item:filters", e.entity_number)).map((row) => row.item as string) : [];
        return {
            id: i.id,
            source,
            sink,
            prototype: e.name,
            quality: e.quality,
            ...(filters.length > 0 && { filters }),
            ...(filters.length > 0 && e.filter_mode === "blacklist" && { filter_mode: "blacklist" }),
            position: position(e),
            direction: e.direction,
        } as unknown as InserterConfig;
    };
    const inserters: InserterConfig[] = keptInserters.map((i) => inserterRow(i, notes));

    // ------------------------------------------------ chests (b)
    const slotFiltersOf = (e: BlueprintEntityRead) => itemsOfFilters(e.inventory?.filters, () => notes.add("filter-no-item:inventory", e.entity_number))
        .map((row) => (BLOCKING_FILTERS.includes(row.item as string) ? { slot: row.index, blocked: true as const } : { slot: row.index, item: row.item as string }));
    const chests: ChestConfig[] = keptChests.map((c): ChestConfig => {
        const e = entityOf.get(c.entity_number)!;
        if (c.chest_type === "infinity-chest") {
            const filters = [...(e.infinity?.filters ?? [])].map((f) => ({ item_name: f.item, request_count: f.count ?? 0 })).sort((a, b) => compareText(a.item_name, b.item_name));
            return { type: "infinity-chest", id: c.id, ...(filters.length > 0 && { item_filter: filters }), remove_unfiltered_items: e.infinity?.remove_unfiltered_items === true, position: position(e) } as ChestConfig;
        }
        if (c.chest_type === "rocket-silo") {
            const row = speedOf.get(c.entity_number);
            return {
                type: "rocket-silo", id: c.id,
                recipe_quality: (e.recipe_quality ?? "normal") as "normal",
                ...(row?.crafting_speed !== undefined && { crafting_speed: row.crafting_speed.toDecimal() }),
                productivity: percent(row?.productivity),
                position: position(e),
            };
        }
        if (c.chest_type === "cargo-wagon" || c.chest_type === "car" || c.chest_type === "tank") {
            const slot_filters = slotFiltersOf(e);
            return {
                type: c.chest_type,
                id: c.id,
                ...(c.chest_type === "cargo-wagon" && { quality: e.quality }),
                ...(slot_filters.length > 0 && { slot_filters }),
                position: position(e),
            } as ChestConfig;
        }
        return { type: "buffer-chest", id: c.id, storage_size: storageOf(e), item_filter: c.items[0] ?? "", prototype: e.name, position: position(e) };
    });

    // ------------------------------------------------ the filters that are not written: a splitter's or loader's with no item
    for (const e of entities) {
        const type = world.entity(e.entity_number)?.prototype ?? null;
        if (type === "splitter" && e.filter !== undefined && (e.filter.item === undefined || e.filter.item === "")) notes.add("filter-no-item:splitter", e.entity_number);
        if ((type === "loader" || type === "loader-1x1") && e.filters.some((f) => f.item === undefined || f.item === "")) notes.add("filter-no-item:filters", e.entity_number);
    }

    // ------------------------------------------------ the bases of the belts' values (i)
    for (const b of ids.belts) {
        for (const n of b.lines) {
            const line = lineOf.get(n);
            if (!line) continue;
            notes.based(line.belt_type.basis, "belt-type", n);
            if (line.flow_direction) notes.based(line.flow_direction.basis, "flow-direction", n);
            for (const p of line.pickups) {
                // a lane that a throttle empties is asked its rate, and has no end to note
                if (!asksRate(n, 1)) notes.based(p.lane_ends[0].basis, "lane-end", n, 1);
                if (!asksRate(n, 2)) notes.based(p.lane_ends[1].basis, "lane-end", n, 2);
            }
            ([1, 2] as const).forEach((lane) => {
                if (line.sharing[lane - 1].basis === "unread" && !sharingAnswer.has(n)) notes.based("unread", "sharing", n, lane);
            });
        }
    }
    if (geometry.copy_offset.value !== null) notes.based(geometry.copy_offset.basis, "copy-offset", 0);

    // ------------------------------------------------ the steps' own notes (i)
    for (const p of world.problems) notes.add(WORLD_NOTES[p.code], p.entity_number);
    for (const p of geometry.problems) notes.add(GEOMETRY_NOTES[p.code], p.entity_number);
    for (const u of flows.unread) notes.add(FLOWS_UNREAD_NOTES[u.code], u.entity_number, u.lane === undefined ? {} : { lane: u.lane });
    for (const c of flows.circuit_set) notes.add(CIRCUIT_NOTES[c.sets], c.entity_number);
    for (const d of flows.left_out_drills) notes.add(LEFT_OUT_DRILL_NOTES[d.reason], d.entity_number);
    for (const r of flows.recyclers) if (r.reason !== null) notes.add(RECYCLER_NOTES[r.reason], r.entity_number);
    for (const row of speeds.rows) for (const u of row.unread) notes.add(SPEED_UNREAD_NOTES[u.reason], row.entity_number, { field: u.field });
    for (const p of speeds.problems) notes.add(SPEED_PROBLEM_NOTES[p.problem], p.entity_number);
    for (const d of ids.differences) notes.add(ID_DIFFERENCE_NOTES[d.code], d.entity_number, d.lane === undefined ? {} : { lane: d.lane });
    for (const p of ids.problems) notes.add(ID_PROBLEM_NOTES[p.code], p.entity_number ?? 0);
    // what the ids leave out is final only once no question is open: before, it is what waits on an answer
    if (ids.final) {
        for (const i of ids.left_out_inserters) notes.add(LEFT_OUT_INSERTER_NOTES[i.end], i.entity_number);
        for (const d of ids.left_out_drills) notes.add(LEFT_OUT_DRILL_ID_NOTES[d.reason], d.entity_number);
    }

    // ------------------------------------------------ research (h): the base, then the profile's numbers on it
    const base: ResearchBase = {
        machines: machines.map((m) => ({ id: m.id, recipe: m.recipe, productivity: m.productivity })),
        drills: drills.map((d) => ({ id: d.id, productivity: d.productivity })),
        silos: chests.flatMap((c) => {
            if (c.type !== "rocket-silo") return [];
            const e = entityOf.get(keptChests.find((x) => x.id === c.id)!.entity_number)!;
            const recipe = e.recipe ?? own(data.rocket_silo, e.name)?.fixed_recipe ?? "";
            return [{ id: c.id, recipe, productivity: c.productivity ?? 0 }];
        }),
        inserters: keptInserters.map((i) => {
            const override = entityOf.get(i.entity_number)?.override_stack_size;
            return { id: i.id, ...(override !== undefined && override > 0 && { stack_size: override }) };
        }),
        belts: belts.map((b) => ({ id: b.id })),
    };
    const researched = applyResearch({ machines, drills: { configs: drills }, inserters, belts, chests }, base, inputs.research, data);

    // ------------------------------------------------ the setpoint the machines suggest (g)
    const listed = researched.build;
    const suggested = suggestedTargetOf(undefined, listed.machines, { inserters: listed.inserters, belts: listed.belts }, { chests: listed.chests ?? [], drills: listed.drills?.configs ?? [] });

    // ------------------------------------------------ what is read and what is not
    const counts = new Map<ReadKind, number>();
    const ignored = new Map<string, number>();
    for (const e of world.entities) {
        const kind = readKindOf(e.prototype);
        if (kind !== null) counts.set(kind, (counts.get(kind) ?? 0) + 1);
        else if (e.prototype === null || !BELT_TYPES.includes(e.prototype)) ignored.set(e.name, (ignored.get(e.name) ?? 0) + 1);
    }
    if (geometry.lines.length > 0) counts.set("belt", geometry.lines.length);

    // ------------------------------------------------ the layout view's values, not written
    const drop_lanes: DropLane[] = geometry.drops.map((d) => ({ inserter: d.inserter, piece: d.piece, line: d.line.value }));
    const drop_positions: DropPosition[] = geometry.drops.map((d) => ({ inserter: d.inserter, x: endsOf.get(d.inserter)!.drop.x, y: endsOf.get(d.inserter)!.drop.y }));
    const outputFirsts = [...new Set(geometry.drops.map((d) => lineOfPiece.get(d.piece)).filter((n): n is number => n !== undefined))].sort(byNumber);
    const output_lines: OutputLine[] = outputFirsts.map((first) => ({ first, pieces: [...lineOf.get(first)!.pieces] }));
    // the lines, the drills and the inserters by number, and the rows the open questions keep out of the lists: built by the code of the written rows, with notes of no list
    const numbered = questionLayoutOf({ world, geometry, flows, ids, places, entityOf, keptInserters, keptChests });
    const unlisted = new Notes();
    const held_back = {
        belts: numbered.held.belts.map((b) => beltRow({ id: b.place, signature: "", lines: [b.first], first_line: b.first, items: [], lanes: b.items.map((ingredient) => ({ ingredient })), lane_lines: [1, 2] })),
        inserters: numbered.held.inserters.map((i) => inserterRow(i, unlisted)),
        drills: numbered.held.drills.map(drillRow),
    };

    // ------------------------------------------------ each entity by its number, and the row of the lists it is
    const rowOf = new Map<number, { list: ImportList; id: number }>();
    for (const m of ids.machines) rowOf.set(m.entity_number, { list: "machines", id: m.id });
    for (const d of ids.drills) rowOf.set(d.entity_number, { list: "drills", id: d.id });
    for (const i of keptInserters) rowOf.set(i.entity_number, { list: "inserters", id: i.id });
    for (const c of keptChests) rowOf.set(c.entity_number, { list: "chests", id: c.id });
    for (const b of ids.belts) for (const n of b.lines) for (const piece of lineOf.get(n)?.pieces ?? []) if (!rowOf.has(piece)) rowOf.set(piece, { list: "belts", id: b.id });
    const importEntities: ImportEntity[] = [...entities].sort((a, b) => a.entity_number - b.entity_number).map((e) => {
        const row = rowOf.get(e.entity_number);
        return { entity_number: e.entity_number, name: e.name, ...(row !== undefined && { row }) };
    });

    // ------------------------------------------------ what each productivity is made of, for the dialog to show
    const modulesIn = (e: BlueprintEntityRead) => e.requests.filter((r) => own(data.module, r.item) !== undefined)
        .reduce((sum, r) => sum + (Number.isInteger(r.count) && (r.count as number) > 0 ? (r.count as number) : 1), 0);
    const baseEffect = (row: { effect_receiver?: { base_effect?: { productivity?: number } } } | undefined) => 100 * (row?.effect_receiver?.base_effect?.productivity ?? 0);
    const bonuses = inputs.research.bonuses;
    const capOf = (recipe: string) => 100 * (own(data.recipe, recipe)?.maximum_productivity ?? 3);
    const speedRow = (list: ImportSpeed["list"], id: number, n: number, base: number, research: number, cap: number | null): ImportSpeed => {
        const total = percent(speedOf.get(n)?.productivity);
        return { list, id, beacons: speedOf.get(n)?.beacons.length ?? 0, modules: modulesIn(entityOf.get(n)!), productivity: { base, modules: total - base, research, cap } };
    };
    const importSpeeds: ImportSpeed[] = [
        ...ids.machines.map((m) => {
            const recipe = recipeOfMachine(m.entity_number);
            return speedRow("machines", m.id, m.entity_number, baseEffect(own(data.crafting_machine, entityOf.get(m.entity_number)!.name)), own(bonuses.recipes, recipe)?.productivity_bonus ?? 0, capOf(recipe));
        }),
        ...ids.drills.map((d) => speedRow("drills", d.id, d.entity_number, baseEffect(own(data["mining-drill"], entityOf.get(d.entity_number)!.name)), bonuses.mining_drill_productivity_bonus, null)),
        ...keptChests.filter((c) => c.chest_type === "rocket-silo").map((c) => {
            const recipe = researched.block.base.silos.find((s) => s.id === c.id)?.recipe ?? "";
            return speedRow("chests", c.id, c.entity_number, baseEffect(own(data.rocket_silo, entityOf.get(c.entity_number)!.name)), own(bonuses.recipes, recipe)?.productivity_bonus ?? 0, capOf(recipe));
        }),
    ].sort((a, b) => SPEED_LISTS.indexOf(a.list) - SPEED_LISTS.indexOf(b.list) || a.id - b.id);

    return {
        kind: "build",
        machines: listed.machines,
        drills: listed.drills?.configs ?? [],
        inserters: listed.inserters,
        belts: listed.belts,
        chests: listed.chests ?? [],
        suggested_target: O.toNullable(suggested),
        copy_offset: geometry.copy_offset.value === null ? null : { x: geometry.copy_offset.value.x, y: geometry.copy_offset.value.y },
        research: researched.block,
        questions,
        notes: notes.list(),
        read: READ_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map((name) => ({ name, count: counts.get(name)! })),
        ignored: [...ignored.entries()].sort((a, b) => compareText(a[0], b[0])).map(([name, count]) => ({ name, count })),
        layout: { drop_lanes, drop_positions, output_lines, lines: numbered.lines, drills: numbered.drills, inserter_lines: numbered.inserter_lines, held_back },
        entities: importEntities,
        speeds: importSpeeds,
    };
}
