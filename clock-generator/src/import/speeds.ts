/**
 * The speeds of a pasted blueprint: what each machine, drill and rocket silo makes of its own modules and of the beacons
 * around it.
 *
 * `speedsOf` takes the entities the paste dialog read, the world they stand in and the prototype rows of the game data.
 * For each crafting machine, mining drill and rocket silo it gives the crafting speed (the speed bonus of a drill), the
 * productivity that modules and beacons give, the change in energy consumption of a machine that burns nutrients, and
 * the beacons that reach it. Research and the 300% cap of productivity are not here.
 *
 * A value that no game read holds carries a mark: `unread` lists the field and a reason code for each. The codes are
 * not user text; the words are the paste dialog's. The function is pure and total: the same input gives the same output,
 * rows are sorted by entity number, and what it cannot compute is a listed problem, not a throw.
 *
 * All arithmetic is exact. Every number of the game data is read from its shortest decimal string, never from a float
 * product, with one exception: the entries of the beacon profile are snapped to their nearest 4-decimal value first, because the data file
 * carries float noise on some of them. The numbers that leave this module are fractions.
 */
import Fraction from "../data-types/fraction";
import { MiningDrillType } from "../common/entity-types";
import type { BlueprintEntityRead } from "./blueprint-entities";
import type { BuildWorld, PlacedEntity, Tile } from "./world";

// ---------------------------------------------------------------- the game data this step reads

type SpeedEffect = "consumption" | "speed" | "productivity" | "pollution" | "quality";

const EFFECTS: readonly SpeedEffect[] = ["consumption", "speed", "productivity", "pollution", "quality"];

type EffectRow = Partial<Record<SpeedEffect, number>>;

/** A quality. The multipliers the game data leaves out are read as the game's defaults. */
type QualityRow = {
    level: number;
    default_multiplier?: number;
    beacon_module_slots_bonus?: number;
    beacon_supply_area_distance_bonus?: number;
} & Partial<Record<`module_${SpeedEffect}_multiplier`, number>>;

/** A module. `<effect>_quality_multiplier` is how much of the quality's multiplier an effect takes: 1 for a benefit, else 0, when left out. */
type ModuleRow = {
    category: string;
    effect: EffectRow;
} & Partial<Record<`${SpeedEffect}_quality_multiplier`, number>>;

type BeaconRow = {
    distribution_effectivity: number;
    distribution_effectivity_bonus_per_quality_level?: number;
    supply_area_distance: number;
    module_slots: number;
    /** An effect list left out lets every effect through */
    allowed_effects?: readonly SpeedEffect[];
    /** Left out, a profile of one entry that is 1 */
    profile?: readonly number[];
    beacon_counter?: string;
    quality_affects_module_slots?: boolean;
    quality_affects_supply_area_distance?: boolean;
};

/** A crafting machine, a rocket silo or a mining drill */
type ReceiverRow = {
    crafting_speed?: number;
    /** Left out: no module slot */
    module_slots?: number;
    /** Left out: no effect on a crafting machine or a rocket silo, every effect on a mining drill */
    allowed_effects?: readonly SpeedEffect[];
    effect_receiver?: {
        base_effect?: EffectRow;
        uses_module_effects?: boolean;
        uses_beacon_effects?: boolean;
    };
    burner_fuel_categories?: readonly string[];
};

/** The sections of the game data that this step reads, with the game's own property names */
export type SpeedData = {
    quality: Readonly<Record<string, QualityRow>>;
    module: Readonly<Record<string, ModuleRow>>;
    beacon: Readonly<Record<string, BeaconRow>>;
    crafting_machine: Readonly<Record<string, ReceiverRow>>;
    rocket_silo: Readonly<Record<string, ReceiverRow>>;
    "mining-drill": Readonly<Record<string, ReceiverRow>>;
};

/** The keys of a blueprint entity that this step reads */
type SpeedEntity = Pick<BlueprintEntityRead, "entity_number" | "name" | "quality" | "requests">;

// ---------------------------------------------------------------- what comes out

type SpeedField = "crafting_speed" | "speed_bonus" | "productivity" | "energy_consumption_bonus";

/**
 * Why a value has no game read.
 * - beacon-mix: beacons of different kinds or contents reach the machine
 * - quality: a combination of qualities that no read of the game holds
 * - rounding-tie: the multiplier is a tie at the fifth decimal with an even fourth digit
 * - effect-limit: the total of an effect hit the lowest value the game allows
 * - receiver-flags: the machine ignores the modules or the beacons it has
 * - allowed-effects: a list of allowed effects dropped an effect of a module or a beacon
 * - module-request: a request for modules that the game cannot fill as written
 * - consumption-not-read: no read of the game holds a change in energy consumption
 */
type UnreadReason =
    | "beacon-mix"
    | "quality"
    | "rounding-tie"
    | "effect-limit"
    | "receiver-flags"
    | "allowed-effects"
    | "module-request"
    | "consumption-not-read";

const REASONS: readonly UnreadReason[] = [
    "beacon-mix",
    "quality",
    "rounding-tie",
    "effect-limit",
    "receiver-flags",
    "allowed-effects",
    "module-request",
    "consumption-not-read",
];

type Unread = { field: SpeedField; reason: UnreadReason };

/**
 * One row for a crafting machine, a rocket silo or a mining drill.
 * - `beacons`: the entity numbers of the beacons that count for this row, sorted
 * - `crafting_speed` (machines and the silo) or `speed_bonus` (drills; the multiplier less 1)
 * - `productivity`: percent; the machine's base effect and the productivity its modules and beacons give, with no research and no cap
 * - `energy_consumption_bonus`: percent; only for a machine that burns nutrients
 * - `unread`: sorted by field and reason; empty where every value has a game read
 */
export type SpeedRow = {
    entity_number: number;
    beacons: number[];
    crafting_speed?: Fraction;
    speed_bonus?: Fraction;
    productivity: Fraction;
    energy_consumption_bonus?: Fraction;
    unread: Unread[];
};

type SpeedProblemCode =
    /** The world has no tiles for the entity, so nothing can reach it */
    | "not-placed"
    /** The game data has no row for the entity, or the row lacks a crafting speed */
    | "no-data"
    /** A beacon whose footprint is not square */
    | "beacon-not-square"
    /** A quality that the game data does not list */
    | "unknown-quality";

type SpeedProblem = { entity_number: number; problem: SpeedProblemCode };

export type SpeedResult = { rows: SpeedRow[]; problems: SpeedProblem[] };

// ---------------------------------------------------------------- the rules that are written down once

/** How the total of an effect becomes the multiplier the game shows: half up to 4 decimals */
export const ROUNDING = { decimals: 4, tie: "half-up" } as const;

/** A beacon with no module in it counts in the number of beacons that reach a machine */
export const COUNT_EMPTY_BEACONS = true;

/** A beacon with modules that give no speed (efficiency modules) counts in the number of beacons that reach a machine */
export const COUNT_NO_SPEED_BEACONS = true;

/** The lowest total of the speed and the consumption effect */
const EFFECT_LOW = "-4/5";

/** The factor of a quality level on a machine's own speed: 1 + 0.3 for each level */
const MACHINE_QUALITY_STEP = "3/10";

/** The beacon profile is the game's 1/sqrt(n) cut to 4 decimals; the data file carries float noise on some entries */
const PROFILE_DECIMALS = 4;
const PROFILE_NOISE = 1e-9;

/** The modules a request of a machine, a beacon and a drill puts in the module inventory */
const MODULE_INVENTORY = { machine: 4, beacon: 1, drill: 2 } as const;

/** The drills that the configuration knows */
const DRILL_NAMES: readonly string[] = Object.values(MiningDrillType);

// ---------------------------------------------------------------- exact numbers

type Ratio = { n: bigint; d: bigint };

function gcd(a: bigint, b: bigint): bigint {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) [x, y] = [y, x % y];
    return x;
}

function ratio(n: bigint, d: bigint = 1n): Ratio {
    const sign = d < 0n ? -1n : 1n;
    const divisor = gcd(n, d) || 1n;
    return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

const ZERO = ratio(0n);
const ONE = ratio(1n);
const add = (a: Ratio, b: Ratio): Ratio => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a: Ratio, b: Ratio): Ratio => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a: Ratio, b: Ratio): Ratio => ratio(a.n * b.n, a.d * b.d);
const compare = (a: Ratio, b: Ratio): number => {
    const left = a.n * b.d;
    const right = b.n * a.d;
    return left < right ? -1 : left > right ? 1 : 0;
};
const isZero = (a: Ratio): boolean => a.n === 0n;

function floorOf(a: Ratio): bigint {
    const quotient = a.n / a.d;
    return a.n < 0n && a.n % a.d !== 0n ? quotient - 1n : quotient;
}

/** A fraction written as "n/d" or as a whole number */
function written(text: string): Ratio {
    const [n, d] = text.split("/");
    return ratio(BigInt(n), d === undefined ? 1n : BigInt(d));
}

/** A number of the game data, from its shortest decimal string; a number that is not finite is 0 */
function decimal(value: number): Ratio {
    if (!Number.isFinite(value)) return ZERO;
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
    if (!match) return ZERO;
    const [, sign, whole, part = "", exponent = "0"] = match;
    const digits = BigInt(whole + part);
    const scale = part.length - Number(exponent);
    const signed = sign === "-" ? -digits : digits;
    return scale >= 0 ? ratio(signed, 10n ** BigInt(scale)) : ratio(signed * 10n ** BigInt(-scale));
}

/** A profile entry: the value snapped to its nearest 4-decimal value, where it is within float noise of one */
export function profileEntry(value: number): Ratio {
    const snapped = Math.round(value * 10 ** PROFILE_DECIMALS) / 10 ** PROFILE_DECIMALS;
    return decimal(Math.abs(value - snapped) < PROFILE_NOISE ? snapped : value);
}

const SCALE = 10n ** BigInt(ROUNDING.decimals);

/** The multiplier as the game shows it: half up to the decimals of `ROUNDING` */
function rounded(value: Ratio): Ratio {
    return ratio(floorOf(add(multiply(value, ratio(SCALE)), ratio(1n, 2n))), SCALE);
}

/** True where the value is a tie at the digit after the last decimal, and the last decimal is even */
function isTieWithEvenDigit(value: Ratio): boolean {
    const scaled = multiply(value, ratio(SCALE));
    const whole = floorOf(scaled);
    return compare(subtract(scaled, ratio(whole)), ratio(1n, 2n)) === 0 && whole % 2n === 0n;
}

function toFraction(value: Ratio): Fraction {
    const safe = (x: bigint) => x >= BigInt(Number.MIN_SAFE_INTEGER) && x <= BigInt(Number.MAX_SAFE_INTEGER);
    return safe(value.n) && safe(value.d) ? new Fraction(Number(value.n), Number(value.d)) : new Fraction(Number(value.n) / Number(value.d));
}

// ---------------------------------------------------------------- reading the data and the entities

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

function rowOf<T>(section: Readonly<Record<string, T>>, name: string): T | undefined {
    return has(section, name) ? section[name] : undefined;
}

type QualityInfo = { name: string; row: QualityRow | undefined; level: number; known: boolean };

type Modules = { items: { item: string; quality: string }[]; bad: boolean };

type Effects = Record<SpeedEffect, Ratio>;

type BeaconInfo = {
    entity: PlacedEntity;
    row: BeaconRow;
    quality: QualityInfo;
    modules: Modules;
    /** A module of this beacon has an effect that the beacon's own list of allowed effects drops (not a negative quality or pollution effect) */
    dropsAnEffect: boolean;
    /** The effects of this beacon's modules that it lets through, each at the beacon's effectivity */
    passed: Effects;
    area: Tile[];
    counter: string;
    /** The module slots of the beacon at its quality */
    slots: number;
    /** It holds modules and every one is an efficiency module */
    efficiencyOnly: boolean;
    /** One of its modules has a speed effect */
    hasSpeed: boolean;
};

const zeroEffects = (): Effects => ({ consumption: ZERO, speed: ZERO, productivity: ZERO, pollution: ZERO, quality: ZERO });

function benefit(effect: SpeedEffect, value: number): boolean {
    return effect === "consumption" || effect === "pollution" ? value < 0 : value > 0;
}

export function speedsOf(entities: readonly SpeedEntity[], world: BuildWorld, data: SpeedData): SpeedResult {
    const problems = new Map<string, SpeedProblem>();
    const problem = (entity_number: number, code: SpeedProblemCode) => problems.set(`${entity_number}/${code}`, { entity_number, problem: code });

    const reads = new Map<number, SpeedEntity>();
    for (const entity of entities) if (!reads.has(entity.entity_number)) reads.set(entity.entity_number, entity);

    const qualityOf = (owner: number, name: string): QualityInfo => {
        const row = rowOf(data.quality, name);
        if (!row) problem(owner, "unknown-quality");
        return { name, row, level: row ? row.level : 0, known: row !== undefined };
    };

    /** A module's effects at a quality, each as the game data gives it, times 1 + (the quality's multiplier - 1) x the share the module takes */
    const effectsOfModule = (item: string, quality: QualityInfo): Effects => {
        const moduleRow = rowOf(data.module, item);
        const effects = zeroEffects();
        if (!moduleRow) return effects;
        for (const effect of EFFECTS) {
            const value = moduleRow.effect[effect] ?? 0;
            if (value === 0) continue;
            const share = moduleRow[`${effect}_quality_multiplier`];
            const taken = share === undefined ? (benefit(effect, value) ? ONE : ZERO) : decimal(share);
            const given = quality.row?.[`module_${effect}_multiplier`];
            const levelled = add(ONE, multiply(written(MACHINE_QUALITY_STEP), ratio(BigInt(quality.level))));
            const multiplier = given !== undefined ? decimal(given) : quality.row?.default_multiplier !== undefined ? decimal(quality.row.default_multiplier) : levelled;
            effects[effect] = multiply(decimal(value), add(ONE, multiply(subtract(multiplier, ONE), taken)));
        }
        return effects;
    };

    /**
     * The modules a request puts in the module inventory (the whole entity for a silo, which keeps no number), and whether the request is one the game
     * cannot fill as written. An item that is no module in another inventory (fuel) is left out.
     */
    const modulesOf = (read: SpeedEntity | undefined, slots: number, inventory: number | null): Modules => {
        const found: Modules = { items: [], bad: false };
        for (const request of read ? read.requests : []) {
            const isModule = has(data.module, request.item);
            if (inventory !== null && request.inventory !== inventory) {
                if (isModule) found.bad = true;
                continue;
            }
            if (!isModule) {
                if (inventory !== null) found.bad = true;
                continue;
            }
            const count = Number.isInteger(request.count) && (request.count as number) > 0 ? (request.count as number) : 1;
            for (let i = 0; i < count; i += 1) found.items.push({ item: request.item, quality: request.quality });
        }
        if (found.items.length > slots) {
            found.bad = true;
            found.items.length = Math.max(0, slots);
        }
        return found;
    };

    // ------------------------------------------------------------ the beacons
    const beacons: BeaconInfo[] = [];
    for (const entity of world.entities) {
        if (entity.prototype !== "beacon") continue;
        const row = rowOf(data.beacon, entity.name);
        if (!row) {
            problem(entity.entity_number, "no-data");
            continue;
        }
        if (!entity.placed) {
            problem(entity.entity_number, "not-placed");
            continue;
        }
        const xs = new Set(entity.tiles.map(tile => tile.x));
        const ys = new Set(entity.tiles.map(tile => tile.y));
        if (xs.size !== ys.size) {
            problem(entity.entity_number, "beacon-not-square");
            continue;
        }
        const read = reads.get(entity.entity_number);
        const quality = qualityOf(entity.entity_number, read ? read.quality : "normal");
        const slots = row.module_slots + (row.quality_affects_module_slots ? (quality.row?.beacon_module_slots_bonus ?? quality.level) : 0);
        const modules = modulesOf(read, slots, MODULE_INVENTORY.beacon);
        // A beacon prototype with no allowed_effects allows no effect (BeaconPrototype's default, api-015-005)
        const allowed = row.allowed_effects ?? [];
        const effectivity = add(
            decimal(row.distribution_effectivity),
            multiply(decimal(row.distribution_effectivity_bonus_per_quality_level ?? 0), ratio(BigInt(quality.level))),
        );
        const passed = zeroEffects();
        let dropsAnEffect = false;
        for (const held of modules.items) {
            const moduleQuality = qualityOf(entity.entity_number, held.quality);
            const effects = effectsOfModule(held.item, moduleQuality);
            for (const effect of EFFECTS) {
                if (isZero(effects[effect])) continue;
                if (allowed.includes(effect)) passed[effect] = add(passed[effect], multiply(effectivity, effects[effect]));
                else if (!((effect === "quality" || effect === "pollution") && effects[effect].n < 0n)) dropsAnEffect = true;
            }
        }
        const distance = row.supply_area_distance + (row.quality_affects_supply_area_distance ? (quality.row?.beacon_supply_area_distance_bonus ?? Math.min(64, Math.max(0, quality.level))) : 0);
        const left = Math.min(...entity.tiles.map(tile => tile.x));
        const top = Math.min(...entity.tiles.map(tile => tile.y));
        const size = xs.size;
        const area: Tile[] = [];
        for (let x = left - distance; x < left + size + distance; x += 1) {
            for (let y = top - distance; y < top + size + distance; y += 1) area.push({ x, y });
        }
        const efficiencyOnly = modules.items.length > 0 && modules.items.every(held => rowOf(data.module, held.item)?.category === "efficiency");
        const hasSpeed = modules.items.some(held => (rowOf(data.module, held.item)?.effect.speed ?? 0) !== 0);
        beacons.push({ entity, row, quality, modules, dropsAnEffect, passed, area, counter: row.beacon_counter ?? "total", slots, efficiencyOnly, hasSpeed });
    }

    // the machines, silos and drills each beacon reaches
    const reachedBy = new Map<number, BeaconInfo[]>();
    for (const beacon of beacons) {
        const seen = new Set<number>();
        for (const tile of beacon.area) {
            const found = world.entityAt(tile);
            if (!found || found.entity_number === beacon.entity.entity_number || seen.has(found.entity_number)) continue;
            seen.add(found.entity_number);
            const list = reachedBy.get(found.entity_number) ?? [];
            list.push(beacon);
            reachedBy.set(found.entity_number, list);
        }
    }

    // ------------------------------------------------------------ the rows
    const rows: SpeedRow[] = [];
    for (const entity of world.entities) {
        const kind = receiverKind(entity);
        if (!kind) continue;
        const section = kind === "silo" ? data.rocket_silo : kind === "drill" ? data["mining-drill"] : data.crafting_machine;
        const row = rowOf(section, entity.name);
        if (!row || (kind !== "drill" && row.crafting_speed === undefined)) {
            problem(entity.entity_number, "no-data");
            continue;
        }
        if (!entity.placed) {
            problem(entity.entity_number, "not-placed");
            continue;
        }
        rows.push(rowFor(entity, kind, row));
    }

    function rowFor(entity: PlacedEntity, kind: "machine" | "silo" | "drill", row: ReceiverRow): SpeedRow {
        const read = reads.get(entity.entity_number);
        const quality = qualityOf(entity.entity_number, read ? read.quality : "normal");
        const flags = row.effect_receiver ?? {};
        const useModules = flags.uses_module_effects !== false;
        const useBeacons = flags.uses_beacon_effects !== false;
        const allowed: readonly SpeedEffect[] = row.allowed_effects ?? (kind === "drill" ? EFFECTS : []);
        const speedField: SpeedField = kind === "drill" ? "speed_bonus" : "crafting_speed";
        const hasConsumptionField = (row.burner_fuel_categories ?? []).includes("nutrients");
        const fieldOf = (effect: SpeedEffect): SpeedField | undefined =>
            effect === "speed" ? speedField : effect === "productivity" ? "productivity" : effect === "consumption" && hasConsumptionField ? "energy_consumption_bonus" : undefined;
        const fields: SpeedField[] = [speedField, "productivity", ...(hasConsumptionField ? (["energy_consumption_bonus"] as const) : [])];

        const marks = new Set<string>();
        const mark = (field: SpeedField | undefined, reason: UnreadReason) => {
            if (field) marks.add(`${field}/${reason}`);
        };
        const markEffect = (effect: SpeedEffect, reason: UnreadReason) => mark(fieldOf(effect), reason);
        const markAll = (reason: UnreadReason) => fields.forEach(field => mark(field, reason));

        // the own modules
        const slots = row.module_slots ?? 0;
        const own = modulesOf(read, slots, kind === "silo" ? null : MODULE_INVENTORY[kind]);
        const ownQualities = own.items.map(held => qualityOf(entity.entity_number, held.quality));
        const ownEffects = own.items.map((held, i) => effectsOfModule(held.item, ownQualities[i]));
        if (own.bad) markAll("module-request");
        if (hasConsumptionField) mark("energy_consumption_bonus", "consumption-not-read");

        // the beacons in reach that count
        const inReach = (reachedBy.get(entity.entity_number) ?? []).filter(beacon => {
            const empty = beacon.modules.items.length === 0;
            const noSpeed = !empty && beacon.modules.items.every(held => isZero(effectsOfModule(held.item, beacon.quality)["speed"]));
            return !(empty && !COUNT_EMPTY_BEACONS) && !(noSpeed && !COUNT_NO_SPEED_BEACONS);
        });
        inReach.sort((a, b) => a.entity.entity_number - b.entity.entity_number);
        if (inReach.some(beacon => beacon.modules.bad)) markAll("module-request");

        // the flags
        if ((!useModules && own.items.length > 0) || (!useBeacons && inReach.length > 0)) {
            mark(speedField, "receiver-flags");
            mark("productivity", "receiver-flags");
        }

        // the effects: the base, the own modules, and the beacons
        const base = zeroEffects();
        for (const effect of EFFECTS) base[effect] = decimal(flags.base_effect?.[effect] ?? 0);
        const fromOwn = zeroEffects();
        if (useModules) {
            own.items.forEach((_, i) => {
                const effects = ownEffects[i];
                const dropped = EFFECTS.filter(effect => !isZero(effects[effect]) && !allowed.includes(effect));
                for (const effect of EFFECTS) {
                    if (isZero(effects[effect])) continue;
                    if (allowed.includes(effect)) fromOwn[effect] = add(fromOwn[effect], effects[effect]);
                    if (dropped.length > 0) markEffect(effect, "allowed-effects");
                }
            });
        }
        const fromBeacons = zeroEffects();
        const groups = new Map<string, BeaconInfo[]>();
        for (const beacon of inReach) {
            const key = beacon.counter === "same_type" ? beacon.entity.name : "";
            groups.set(key, [...(groups.get(key) ?? []), beacon]);
        }
        if (useBeacons) {
            for (const group of groups.values()) {
                for (const effect of EFFECTS) {
                    let sum = ZERO;
                    for (const beacon of group) {
                        const profile = beacon.row.profile ?? [1];
                        const entry = profile.length === 0 ? ONE : profileEntry(profile[Math.min(group.length, profile.length) - 1]);
                        sum = add(sum, multiply(beacon.passed[effect], entry));
                    }
                    if (isZero(sum)) continue;
                    if (allowed.includes(effect)) fromBeacons[effect] = add(fromBeacons[effect], sum);
                    else markEffect(effect, "allowed-effects");
                }
            }
            if (inReach.some(beacon => beacon.dropsAnEffect)) {
                mark(speedField, "allowed-effects");
                mark("productivity", "allowed-effects");
                mark(hasConsumptionField ? "energy_consumption_bonus" : undefined, "allowed-effects");
            }
        }
        const total = (effect: SpeedEffect) => add(add(base[effect], fromOwn[effect]), fromBeacons[effect]);

        // the multipliers: the limit, then the rounding
        const low = written(EFFECT_LOW);
        const multiplierOf = (effect: "speed" | "consumption", field: SpeedField | undefined): Ratio => {
            const effectTotal = total(effect);
            const clamped = compare(effectTotal, low) < 0;
            const multiplier = add(ONE, clamped ? low : effectTotal);
            if (clamped) mark(field, "effect-limit");
            else if (isTieWithEvenDigit(multiplier)) mark(field, "rounding-tie");
            return rounded(multiplier);
        };
        const speedMultiplier = multiplierOf("speed", speedField);
        const result: SpeedRow = {
            entity_number: entity.entity_number,
            beacons: inReach.map(beacon => beacon.entity.entity_number),
            productivity: toFraction(multiply(total("productivity"), ratio(100n))),
            unread: [],
        };
        if (kind === "drill") {
            result.speed_bonus = toFraction(subtract(speedMultiplier, ONE));
        } else {
            const machineFactor = add(ONE, multiply(written(MACHINE_QUALITY_STEP), ratio(BigInt(quality.level))));
            result.crafting_speed = toFraction(multiply(multiply(decimal(row.crafting_speed ?? 0), machineFactor), speedMultiplier));
        }
        if (hasConsumptionField) {
            result.energy_consumption_bonus = toFraction(multiply(subtract(multiplierOf("consumption", "energy_consumption_bonus"), ONE), ratio(100n)));
        }

        // the beacons that differ
        const mixed = kind === "drill" ? drillBeaconMix(inReach) : machineBeaconMix(inReach);
        if (mixed) {
            mark(speedField, "beacon-mix");
            mark(hasConsumptionField ? "energy_consumption_bonus" : undefined, "beacon-mix");
        }

        // the qualities
        const beaconModuleQualities = inReach.flatMap(beacon => beacon.modules.items.map(held => held.quality));
        const unknown = !quality.known || ownQualities.some(q => !q.known) || inReach.some(beacon => !beacon.quality.known || beacon.modules.items.some(held => !rowOf(data.quality, held.quality)));
        const ownProductivity = ownEffects.some(effects => !isZero(effects.productivity));
        let patternFails = unknown;
        let touchesBeaconsOnly = false;
        if (kind === "drill") {
            const others = [...ownQualities.map(q => q.name), ...inReach.map(beacon => beacon.quality.name), ...beaconModuleQualities];
            patternFails = patternFails || others.some(name => name !== "legendary");
        } else {
            patternFails = patternFails || !qualitiesFit(quality.name, inReach.map(beacon => beacon.quality.name), [...ownQualities.map(q => q.name), ...beaconModuleQualities]);
            touchesBeaconsOnly = inReach.some(beacon => beacon.quality.name === "epic" && beacon.modules.items.some(held => held.quality !== "normal"));
        }
        if (patternFails) {
            mark(speedField, "quality");
            if (ownProductivity) mark("productivity", "quality");
            mark(hasConsumptionField ? "energy_consumption_bonus" : undefined, "quality");
        }
        if (touchesBeaconsOnly) {
            mark(speedField, "quality");
            mark(hasConsumptionField ? "energy_consumption_bonus" : undefined, "quality");
        }

        result.unread = [...marks]
            .map(text => {
                const [field, reason] = text.split("/") as [SpeedField, UnreadReason];
                return { field, reason };
            })
            .sort((a, b) => fields.indexOf(a.field) - fields.indexOf(b.field) || REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason));
        return result;
    }

    rows.sort((a, b) => a.entity_number - b.entity_number);
    return { rows, problems: [...problems.values()].sort((a, b) => a.entity_number - b.entity_number || (a.problem < b.problem ? -1 : a.problem > b.problem ? 1 : 0)) };
}

/** What kind of receiver a placed entity is: a crafting machine, a rocket silo, a mining drill that the configuration knows, or none */
function receiverKind(entity: PlacedEntity): "machine" | "silo" | "drill" | undefined {
    if (entity.prototype === "assembling-machine" || entity.prototype === "furnace") return "machine";
    if (entity.prototype === "rocket-silo") return "silo";
    if (entity.prototype === "mining-drill" && DRILL_NAMES.includes(entity.name)) return "drill";
    return undefined;
}

const distinct = <T>(values: readonly T[]): T[] => [...new Set(values)];

const contents = (beacon: BeaconInfo): string => beacon.modules.items.map(held => `${held.item}/${held.quality}`).sort().join(",");

/**
 * Beacons of different kinds reach a machine, in a way that no read of the game holds: a beacon with modules of two names or two qualities,
 * beacons of two prototypes or two qualities, or beacons whose modules differ other than by an empty slot, an empty beacon or an efficiency-only beacon
 */
function machineBeaconMix(beacons: readonly BeaconInfo[]): boolean {
    if (distinct(beacons.map(beacon => beacon.entity.name)).length > 1 || distinct(beacons.map(beacon => beacon.quality.name)).length > 1) return true;
    if (beacons.some(beacon => distinct(beacon.modules.items.map(held => held.item)).length > 1 || distinct(beacon.modules.items.map(held => held.quality)).length > 1)) return true;
    const kept = beacons.filter(beacon => beacon.modules.items.length > 0 && !beacon.efficiencyOnly);
    return distinct(kept.map(beacon => distinct(beacon.modules.items.map(held => `${held.item}/${held.quality}`)).sort().join(","))).length > 1;
}

/** On a drill no read holds an empty slot, a mix, or a beacon with no speed effect: every beacon in reach must be full, alike and a speed beacon */
function drillBeaconMix(beacons: readonly BeaconInfo[]): boolean {
    if (beacons.some(beacon => beacon.modules.items.length < beacon.slots || !beacon.hasSpeed)) return true;
    if (beacons.some(beacon => distinct(beacon.modules.items.map(held => held.item)).length > 1 || distinct(beacon.modules.items.map(held => held.quality)).length > 1)) return true;
    return distinct(beacons.map(beacon => `${beacon.entity.name}/${beacon.quality.name}/${contents(beacon)}`)).length > 1;
}

/**
 * The qualities of a machine row fit what the game was read with: all of one base quality (normal or legendary), except at most one of the three
 * groups (the machine, the beacons, the modules of the machine and of the beacons) at one other quality
 */
function qualitiesFit(machine: string, beacons: readonly string[], modules: readonly string[]): boolean {
    const groups = [[machine], distinct(beacons), distinct(modules)].filter(group => group.length > 0);
    return ["normal", "legendary"].some(base => {
        const apart = groups.filter(group => group.length !== 1 || group[0] !== base);
        return apart.length === 0 || (apart.length === 1 && apart[0].length === 1);
    });
}
