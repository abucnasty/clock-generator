import { decodeBlueprintFileBrowser } from "../blueprints/serde-browser";
import {
    BlueprintEntityRead,
    FilterRead,
    InfinityFilterRead,
    InfinityRead,
    InventoryRead,
    RequestRead,
    SplitterFilterRead,
} from "./blueprint-entities";

/**
 * Why a pasted text gives no entities to read. The kinds are codes: the words the user reads are the paste dialog's.
 * - not-a-blueprint: the text is not a blueprint string, or holds a blueprint the import cannot read
 * - book: a blueprint book
 * - planner: an upgrade planner or a deconstruction planner
 * - no-entities: a blueprint with no entities
 * - game-version: a blueprint of a game before version 2.0
 */
type DecodeProblem = "not-a-blueprint" | "book" | "planner" | "no-entities" | "game-version";

/** The four 16-bit parts of the game version that a blueprint carries as one number */
type GameVersion = { major: number; minor: number; patch: number; build: number };

export type DecodeOutcome =
    | { kind: "problem"; problem: DecodeProblem }
    | { kind: "blueprint"; version: GameVersion | null; entities: BlueprintEntityRead[] };

type Json = Record<string, unknown>;

/** A part of the blueprint is not what the game writes; caught in `decodeBlueprint` and never seen outside it */
class Refused extends Error {}

const PART = 2 ** 16;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** The value of a key the record has itself, so that a key like `constructor` is not read from the prototype */
function field(record: Json, key: string): unknown {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

const has = (record: Json, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

function refuse(): never {
    throw new Refused();
}

function requireNumber(value: unknown): number {
    return typeof value === "number" ? value : refuse();
}

function requireString(value: unknown): string {
    return typeof value === "string" ? value : refuse();
}

function requireRecord(value: unknown): Json {
    return isRecord(value) ? value : refuse();
}

function requireList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : refuse();
}

/** A key that may be left out: the value when it is there, and it must have the type the reader gives */
function optional<T>(record: Json, key: string, read: (value: unknown) => T): T | undefined {
    return has(record, key) ? read(record[key]) : undefined;
}

const requireBoolean = (value: unknown): boolean => (typeof value === "boolean" ? value : refuse());

const compareNumbers = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function readRequests(value: unknown): RequestRead[] {
    const rows: RequestRead[] = [];
    for (const raw of requireList(value)) {
        const row = requireRecord(raw);
        const id = requireRecord(field(row, "id"));
        const item = requireString(field(id, "name"));
        const quality = optional(id, "quality", requireString) ?? "normal";
        const slots = optional(row, "items", requireRecord);
        for (const rawSlot of slots ? optional(slots, "in_inventory", requireList) ?? [] : []) {
            const slot = requireRecord(rawSlot);
            const count = optional(slot, "count", requireNumber);
            rows.push({
                item,
                quality,
                inventory: requireNumber(field(slot, "inventory")),
                stack: requireNumber(field(slot, "stack")),
                ...(count !== undefined ? { count } : {}),
            });
        }
    }
    return rows.sort((a, b) => compareNumbers(a.inventory, b.inventory) || compareNumbers(a.stack, b.stack) || compareText(a.item, b.item));
}

function readFilters(value: unknown): FilterRead[] {
    return requireList(value).map(raw => {
        const row = requireRecord(raw);
        const item = optional(row, "name", requireString);
        const comparator = optional(row, "comparator", requireString);
        return {
            index: requireNumber(field(row, "index")),
            ...(item !== undefined ? { item } : {}),
            quality: optional(row, "quality", requireString) ?? "normal",
            ...(comparator !== undefined ? { comparator } : {}),
        };
    }).sort((a, b) => compareNumbers(a.index, b.index));
}

/** The chest shape of `infinity_settings`; the rows with an index come first, by index, and the others keep their order */
function readInfinity(settings: Json): InfinityRead {
    const rows: InfinityFilterRead[] = (optional(settings, "filters", requireList) ?? []).map(raw => {
        const row = requireRecord(raw);
        const index = optional(row, "index", requireNumber);
        const count = optional(row, "count", requireNumber);
        const mode = optional(row, "mode", requireString);
        return {
            item: requireString(field(row, "name")),
            quality: optional(row, "quality", requireString) ?? "normal",
            ...(index !== undefined ? { index } : {}),
            ...(count !== undefined ? { count } : {}),
            ...(mode !== undefined ? { mode } : {}),
        };
    });
    const indexed = rows.filter(row => row.index !== undefined).sort((a, b) => compareNumbers(a.index as number, b.index as number));
    return {
        filters: [...indexed, ...rows.filter(row => row.index === undefined)],
        remove_unfiltered_items: optional(settings, "remove_unfiltered_items", requireBoolean) ?? false,
    };
}

function readInventory(inventory: Json): InventoryRead {
    const bar = optional(inventory, "bar", requireNumber);
    return {
        filters: optional(inventory, "filters", readFilters) ?? [],
        ...(bar !== undefined ? { bar } : {}),
    };
}

function readSplitterFilter(value: unknown): SplitterFilterRead {
    const filter = requireRecord(value);
    const item = optional(filter, "name", requireString);
    const comparator = optional(filter, "comparator", requireString);
    return {
        ...(item !== undefined ? { item } : {}),
        quality: optional(filter, "quality", requireString) ?? "normal",
        ...(comparator !== undefined ? { comparator } : {}),
    };
}

/** An inventory key of an entity: null is what the game writes for a vehicle with nothing in it, and gives no field */
function readInventoryKey(entity: Json, key: string): InventoryRead | undefined {
    const value = field(entity, key);
    return value === undefined || value === null ? undefined : readInventory(requireRecord(value));
}

function readEntity(raw: unknown): BlueprintEntityRead {
    const entity = requireRecord(raw);
    const position = requireRecord(field(entity, "position"));
    const entityNumber = field(entity, "entity_number");
    if (!Number.isInteger(entityNumber)) refuse();

    const recipe = optional(entity, "recipe", requireString);
    const recipeQuality = optional(entity, "recipe_quality", requireString);
    const filterMode = optional(entity, "filter_mode", requireString);
    const overrideStackSize = optional(entity, "override_stack_size", requireNumber);
    const bar = optional(entity, "bar", requireNumber);
    const settings = optional(entity, "infinity_settings", requireRecord);
    // the fluid shape, of an infinity pipe, has a name: its settings are not read
    const infinity = settings && !has(settings, "name") ? readInfinity(settings) : undefined;
    // both inventory keys are read, so that a wrong one is refused, though only one is kept
    const wagonInventory = readInventoryKey(entity, "inventory");
    const trunkInventory = readInventoryKey(entity, "trunk_inventory");
    const inventory = wagonInventory ?? trunkInventory;
    const orientation = optional(entity, "orientation", requireNumber);
    const type = optional(entity, "type", requireString);
    const inputPriority = optional(entity, "input_priority", requireString);
    const outputPriority = optional(entity, "output_priority", requireString);
    const filter = optional(entity, "filter", readSplitterFilter);
    const controlBehavior = optional(entity, "control_behavior", requireRecord);

    return {
        entity_number: entityNumber as number,
        name: requireString(field(entity, "name")),
        position: { x: requireNumber(field(position, "x")), y: requireNumber(field(position, "y")) },
        direction: optional(entity, "direction", requireNumber) ?? 0,
        mirror: optional(entity, "mirror", requireBoolean) ?? false,
        quality: optional(entity, "quality", requireString) ?? "normal",
        ...(recipe !== undefined ? { recipe } : {}),
        ...(recipeQuality !== undefined ? { recipe_quality: recipeQuality } : {}),
        requests: optional(entity, "items", readRequests) ?? [],
        filters: optional(entity, "filters", readFilters) ?? [],
        use_filters: optional(entity, "use_filters", requireBoolean) ?? false,
        ...(filterMode !== undefined ? { filter_mode: filterMode } : {}),
        ...(overrideStackSize !== undefined ? { override_stack_size: overrideStackSize } : {}),
        ...(bar !== undefined ? { bar } : {}),
        ...(infinity !== undefined ? { infinity } : {}),
        ...(inventory !== undefined ? { inventory } : {}),
        ...(orientation !== undefined ? { orientation } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(inputPriority !== undefined ? { input_priority: inputPriority } : {}),
        ...(outputPriority !== undefined ? { output_priority: outputPriority } : {}),
        ...(filter !== undefined ? { filter } : {}),
        ...(controlBehavior !== undefined ? { control_behavior: controlBehavior } : {}),
    };
}

/**
 * The game version in a blueprint is one number: the four 16-bit parts, major first. The parts come by division, which
 * is exact up to 2^53, and not by bit operators, which work on 32 bits.
 */
function readVersion(value: unknown): GameVersion {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) refuse();
    return {
        major: Math.floor(value / PART ** 3),
        minor: Math.floor(value / PART ** 2) % PART,
        patch: Math.floor(value / PART) % PART,
        build: value % PART,
    };
}

function readBlueprint(blueprint: Json): DecodeOutcome {
    const version = optional(blueprint, "version", readVersion) ?? null;
    if (version !== null && version.major < 2) return { kind: "problem", problem: "game-version" };
    const raw = optional(blueprint, "entities", requireList) ?? [];
    const entities = raw.map(readEntity).sort((a, b) => compareNumbers(a.entity_number, b.entity_number));
    if (entities.length === 0) return { kind: "problem", problem: "no-entities" };
    return { kind: "blueprint", version, entities };
}

/**
 * The entities of a pasted blueprint string, or the reason it has none. It takes no game data and does not know what
 * kind of thing an entity is. It never throws: any text gives an outcome, and the same text gives the same outcome.
 * Safe to run in a web worker.
 */
export function decodeBlueprint(text: string): DecodeOutcome {
    try {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!trimmed.startsWith("0")) return { kind: "problem", problem: "not-a-blueprint" };
        const file: unknown = decodeBlueprintFileBrowser(trimmed);
        if (!isRecord(file)) return { kind: "problem", problem: "not-a-blueprint" };
        if (has(file, "blueprint_book")) return { kind: "problem", problem: "book" };
        if (has(file, "upgrade_planner") || has(file, "deconstruction_planner")) return { kind: "problem", problem: "planner" };
        const blueprint = field(file, "blueprint");
        if (!isRecord(blueprint)) return { kind: "problem", problem: "not-a-blueprint" };
        return readBlueprint(blueprint);
    } catch {
        // a string that does not decode, or a blueprint with a part the import does not read
        return { kind: "problem", problem: "not-a-blueprint" };
    }
}
