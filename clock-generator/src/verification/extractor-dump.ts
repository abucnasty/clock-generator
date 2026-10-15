import * as fs from "fs";
import * as readline from "readline";
import * as zlib from "zlib";
import { FactorioInserterState } from "../state/factorio-entity-state";
import { EndKind, RuleCountInserter, RuleCountMachine } from "../crafting/rule-count";

/**
 * Reader of the inserter cost series' extractor dumps (factorio-benchmarks, benchmarks/2026-10-12-inserter-cost-2.1.21,
 * the design-extractor mod): a `<base>.static.ndjson` with every entity of the map and a `<base>.samples.ndjson` with
 * the state of the inserters and machines of a sampled area on every tick, as change lists. It turns them into the input
 * of the rule count (rule-count.ts), reading exactly as the series' recount script does (closing/recount-2a/fuller.py,
 * the part before its per-inserter loop), so that the count made here and the series' numbers describe the same saves
 * the same way.
 *
 * The files are read as text, line by line: the static file is the whole map (60 MB for a megabase), and only a few
 * fields of it are kept. Either file may also be given gzipped, as `<base>.static.ndjson.gz`.
 */

/** What fuller.py calls a belt: ends of this kind of entity are belts */
const BELT_TYPES = new Set([
    "transport-belt", "underground-belt", "splitter", "lane-splitter", "loader", "loader-1x1", "linked-belt",
]);
/** The entity types that take a square of tiles on the map the ends of an inserter are looked up on */
const SIZED_TYPES = new Set(["assembling-machine", "furnace", "rocket-silo"]);
/** The size in tiles of a machine whose prototype line is missing from the static file, as in fuller.py */
const DEFAULT_MACHINE_SIZE = 3;

/** The game's `defines.entity_status` values of the inserter states the rule count tells apart */
const STATUS_WORKING = 1;
const STATUS_WAITING_FOR_SOURCE = 34;
const STATUS_WAITING_FOR_MORE = 35;
const STATUS_WAITING_FOR_SPACE = 36;
const STATUS_DISABLED = 59;
/** The status a change list of an inserter starts at when it has no change at index 0, as in fuller.py */
const STATUS_UNKNOWN = -1;

/**
 * An inserter of a dump: the shape the rule count takes, and the recipes of the machines at its ends, which the series
 * groups inserters by. A recipe is read from the end's static entity whether or not the machine has samples, and is ""
 * for an end that is not a machine (a belt, a chest, nothing).
 */
export interface ExtractorDumpInserter extends RuleCountInserter {
    source_recipe: string;
    sink_recipe: string;
}

export interface ExtractorDump {
    /** The base name of the files (the last part of `base`), as the series names a dump */
    source: string;
    /** The number of samples, `ticks` of the sample header; the length of every series */
    ticks: number;
    /** The minutes the samples span, (ticks - 1) / 3600 as fuller.py counts them */
    minutes: number;
    /** The inserters that have samples, in the order of the samples file */
    inserters: ExtractorDumpInserter[];
    /** The machines that have samples with products_finished (`pf`), in the order of the samples file */
    machines: RuleCountMachine[];
}

/** What is kept of an entity of the static file */
interface StaticEntity {
    type: string;
    name: string;
    x: number;
    y: number;
    recipe: string;
    /** `pf` at the start of the dump, 0 when the entity has none */
    products_finished: number;
}

/** What is kept of an inserter of the static file, for those that have samples */
interface StaticInserter {
    pickup_target: unknown;
    drop_target: unknown;
    pickup_position: unknown;
    drop_position: unknown;
    /** The item and the count of the hand at the start of the dump, when there is a hand */
    hand: { item: string; count: number } | null;
    wired: boolean;
}

/** The change lists of a sample line, as written: [index, value, index, value, ...] */
type ChangeList = readonly unknown[];

/** The truth of a JSON value as Python takes it, which fuller.py relies on for `bool(e.get('w'))` and the like */
function truthy(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (value !== null && typeof value === "object") {
        return Object.keys(value).length > 0;
    }
    return Boolean(value);
}

/** Opens a dump file as text lines, from the file itself or its gzipped copy */
function openLines(path: string): readline.Interface {
    const input = fs.existsSync(path)
        ? fs.createReadStream(path)
        : fs.createReadStream(`${path}.gz`).pipe(zlib.createGunzip());
    return readline.createInterface({ input, crlfDelay: Infinity });
}

/**
 * The value at every index from a change list ([index, value, ...], written only when the value changes), as
 * fuller.py's expand_fast reads it: the last change at or before the index, else `initial`, and whole numbers (the
 * series casts to int64, which truncates).
 */
export function expandChanges(changes: ChangeList | undefined, length: number, initial: number): number[] {
    const out = new Array<number>(length);
    let value = Math.trunc(initial);
    let next = 0;
    for (let index = 0; index < length; index++) {
        while (changes !== undefined && next + 1 < changes.length && (changes[next] as number) <= index) {
            value = Math.trunc(changes[next + 1] as number);
            next += 2;
        }
        out[index] = value;
    }
    return out;
}

/** The size in tiles of the square an entity takes on the map, or null for the entities that are not on it */
function tileSize(entity: StaticEntity, sizes: ReadonlyMap<string, number>): number | null {
    if (SIZED_TYPES.has(entity.type)) {
        return sizes.get(entity.name) ?? DEFAULT_MACHINE_SIZE;
    }
    if (BELT_TYPES.has(entity.type) || entity.type.includes("container") || entity.type === "cargo-wagon") {
        return 1;
    }
    return null;
}

function kindOf(entity: StaticEntity | undefined): EndKind {
    if (entity === undefined) {
        return "none";
    }
    if (entity.type === "assembling-machine" || entity.type === "furnace") {
        return "machine";
    }
    if (BELT_TYPES.has(entity.type)) {
        return "belt";
    }
    if (entity.type.includes("container")) {
        return "chest";
    }
    if (entity.type.includes("wagon")) {
        return "vehicle";
    }
    return "other";
}

/** The name the game gives a status code in the sample header, or "unknown" for a code the header does not name */
function statusName(code: number, header: Record<string, string>): string {
    switch (code) {
        case STATUS_WORKING:
            return FactorioInserterState.WORKING;
        case STATUS_WAITING_FOR_SOURCE:
            return FactorioInserterState.WAITING_FOR_SOURCE_ITEMS;
        case STATUS_WAITING_FOR_MORE:
            return FactorioInserterState.WAITING_FOR_MORE_ITEMS;
        case STATUS_WAITING_FOR_SPACE:
            return FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION;
        case STATUS_DISABLED:
            return FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR;
        default:
            return header[String(code)] ?? "unknown";
    }
}

/**
 * Reads a dump into the rule count's input.
 *
 * - Inserters are the ones with a `si` record in the samples, machines the ones with an `sm` record that has `pf`.
 * - An end of an inserter is the unit number in `pt`/`dt` when that is an entity of the dump, else the entity on the
 *   tile of `pp`/`dp` (machines, belts, containers and cargo wagons take the tiles of their size, the size from the
 *   prototype's `tw`). Its kind is "machine" for an assembling machine or furnace, "belt" for the belt types, "chest"
 *   for a type with "container" in it, "vehicle" for one with "wagon" in it, "none" when there is no entity, and
 *   "other" for the rest (poles, lamps, rocket silos and so on).
 * - `source_machine_id` and `sink_machine_id` are set only for an end that has DATA (an `sm` record with `pf`, as
 *   fuller.py takes its events from `fin`/`start`, which hold nothing else): they are null for a machine the samples do
 *   not cover, while `source_kind`/`sink_kind` still say "machine". An id always names a machine in `machines`. (An
 *   end that has data and is not a machine, such as a mining drill, would keep its id and its kind "other", as the
 *   series counts it; no inserter of the dumps is known to end at one.)
 * - `items` are the filter and hand items seen in the samples (`it`) and the item in the hand at the start, sorted.
 * - `wired` is a circuit wire on the entity (`w`) and the enable/disable condition on (`cb.circuit_enable_disable`).
 * - `states` are the status codes of the samples as `FactorioInserterState` values: working, waiting for source
 *   items, waiting for more items, waiting for space in the destination, disabled by control behavior. Any other code
 *   is named as the sample header names it (e.g. "no_power"), and a sample before the first status "unknown".
 * - `working` of a machine is its status code being 1, `products_finished` its `pf` as whole numbers.
 *
 * @param base the path of the files without `.static.ndjson` / `.samples.ndjson`
 */
export async function readExtractorDump(base: string): Promise<ExtractorDump> {
    const source = base.split(/[\\/]/).pop() ?? base;

    // the samples first, as they are small and tell which entities of the whole map are wanted
    let length: number | null = null;
    let statusNames: Record<string, string> = {};
    const inserter_samples = new Map<number, { s: ChangeList; h?: ChangeList; it?: ChangeList }>();
    const machine_samples = new Map<number, { s: ChangeList; pf?: ChangeList }>();
    for await (const line of openLines(`${base}.samples.ndjson`)) {
        if (!line.startsWith("{")) {
            continue;
        }
        const record = JSON.parse(line);
        if (record.k === "sh") {
            length = Number(record.ticks);
            statusNames = record.status ?? {};
        } else if (record.k === "si") {
            inserter_samples.set(record.u, record);
        } else if (record.k === "sm") {
            machine_samples.set(record.u, record);
        }
    }
    if (length === null) {
        throw new Error(`${base}.samples.ndjson has no sample header (k "sh")`);
    }

    const entities = new Map<number, StaticEntity>();
    const inserters = new Map<number, StaticInserter>();
    const sizes = new Map<string, number>();
    for await (const line of openLines(`${base}.static.ndjson`)) {
        if (line.startsWith('{"k":"e"')) {
            const e = JSON.parse(line);
            entities.set(e.u, {
                type: e.t, name: e.n, x: e.x, y: e.y, recipe: e.r ?? "", products_finished: e.pf ?? 0,
            });
            if (inserter_samples.has(e.u)) {
                inserters.set(e.u, {
                    pickup_target: e.pt,
                    drop_target: e.dt,
                    pickup_position: e.pp,
                    drop_position: e.dp,
                    hand: truthy(e.h) ? { item: e.h[0], count: e.h[1] } : null,
                    wired: truthy(e.w) && truthy(e.cb?.circuit_enable_disable),
                });
            }
        } else if (line.startsWith('{"k":"p"')) {
            const p = JSON.parse(line);
            if (p.tw !== undefined) {
                sizes.set(p.n, Math.trunc(Number(p.tw)));
            }
        }
    }

    // the tile map the ends given by a position are looked up on; a later entity takes over a tile
    const tiles = new Map<string, number>();
    for (const [unit, entity] of entities) {
        const size = tileSize(entity, sizes);
        if (size === null) {
            continue;
        }
        const x0 = Math.floor(entity.x - size / 2 + 1e-9);
        const y0 = Math.floor(entity.y - size / 2 + 1e-9);
        for (let dx = 0; dx < size; dx++) {
            for (let dy = 0; dy < size; dy++) {
                tiles.set(`${x0 + dx},${y0 + dy}`, unit);
            }
        }
    }
    const endOf = (target: unknown, position: unknown): number | null => {
        if (typeof target === "number" && Number.isInteger(target) && entities.has(target)) {
            return target;
        }
        if (Array.isArray(position) && position.length >= 2) {
            return tiles.get(`${Math.floor(position[0])},${Math.floor(position[1])}`) ?? null;
        }
        return null;
    };

    const machines: RuleCountMachine[] = [];
    const with_data = new Set<number>();
    for (const [unit, record] of machine_samples) {
        if (record.pf === undefined) {
            continue;
        }
        const entity = entities.get(unit);
        if (entity === undefined) {
            throw new Error(`${source}: machine ${unit} has samples but is not in the static file`);
        }
        with_data.add(unit);
        machines.push({
            machine_id: String(unit),
            recipe: entity.recipe,
            products_finished: expandChanges(record.pf, length, entity.products_finished),
            working: expandChanges(record.s, length, 0).map(code => code === STATUS_WORKING),
        });
    }

    const result: ExtractorDumpInserter[] = [];
    for (const [unit, record] of inserter_samples) {
        const inserter = inserters.get(unit);
        if (inserter === undefined) {
            continue;
        }
        const source_unit = endOf(inserter.pickup_target, inserter.pickup_position);
        const sink_unit = endOf(inserter.drop_target, inserter.drop_position);
        const source_entity = source_unit === null ? undefined : entities.get(source_unit);
        const sink_entity = sink_unit === null ? undefined : entities.get(sink_unit);
        const names = new Set<string>();
        for (let k = 1; k < (record.it?.length ?? 0); k += 2) {
            const name = record.it![k];
            if (typeof name === "string" && name !== "") {
                names.add(name);
            }
        }
        if (inserter.hand !== null) {
            names.add(inserter.hand.item);
        }
        result.push({
            inserter_id: String(unit),
            source_kind: kindOf(source_entity),
            sink_kind: kindOf(sink_entity),
            source_machine_id: source_unit !== null && with_data.has(source_unit) ? String(source_unit) : null,
            sink_machine_id: sink_unit !== null && with_data.has(sink_unit) ? String(sink_unit) : null,
            items: [...names].sort(),
            wired: inserter.wired,
            states: expandChanges(record.s, length, STATUS_UNKNOWN).map(code => statusName(code, statusNames)),
            held: expandChanges(record.h, length, inserter.hand?.count ?? 0),
            source_recipe: source_entity?.recipe ?? "",
            sink_recipe: sink_entity?.recipe ?? "",
        });
    }

    return { source, ticks: length, minutes: (length - 1) / 3600, inserters: result, machines };
}
