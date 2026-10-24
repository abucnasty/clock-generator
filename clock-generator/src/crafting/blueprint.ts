import { FactorioBlueprint, BlueprintBuilder } from "../blueprints/blueprint";
import { Direction, Entity as CircuitEntity, fitPlayerDescription, Position, SignalId, Wire, WireConnection } from "../blueprints/components";
import { DeciderCombinatorEntity } from "../blueprints/entity/decider-combinator";
import { ArithmeticCombinatorEntity } from "../blueprints/entity/arithmetic-combinator";
import { ConstantCombinatorEntity } from "../blueprints/entity/constant-combinator";
import { Duration, OpenRange } from "../data-types";
import { ReadableEntityRegistry, Inserter, EntityId, Entity } from "../entities";
import { InventoryTransfer } from "./sequence/inventory-transfer";
import { InventoryTransferHistory } from "./sequence/inventory-transfer-history";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { InserterClock } from "./sequence/unplanned-inserter-clock";
import {
    chestDrillDescriptionLines, clockDescriptionLines, deciderWindows, formatRate, generatorDescriptionLines, itemIcons, lockFilterDescription, PART_OF_THE_CLOCK,
    plannedDescriptionLines, shownPeriodTicks, turnLine, unplannedDescriptionLines,
} from "./descriptions";
import { GENERATOR } from "../generator";
import { GROUP_GAP_TILES, placeByTurns, TurnGroup, turnTicks } from "./turn-groups";
import { FactorioDataService } from "../data/factorio-data-service";

/** The config's inserters and drills that are not among those with windows: no combinator switches them on */
function notClocked(entity_registry: ReadableEntityRegistry, clocked: EntityId[]): { inserters: number[]; drills: number[] } {
    const on_the_clock = new Set(clocked.map(it => it.id));
    const numbers = (is: (entity: Entity) => boolean) => entity_registry.getAll()
        .filter(entity => is(entity) && !on_the_clock.has(entity.entity_id.id))
        .map(entity => entity.entity_id.number)
        .sort((a, b) => a - b);
    return { inserters: numbers(Entity.isInserter), drills: numbers(Entity.isDrill) };
}

/** What the lines of an enabling combinator say about the clock it reads */
interface PeriodText {
    /** The period as its lines give it (shownPeriodTicks) */
    ticks: string;
    /** The scale of a subtick clock, whose windows are in 1/scale ticks */
    subtick_scale?: number;
}

function createDeciderCombinatorForTransfers(
    inventory_transfers: InventoryTransfer[],
    entity_id: EntityId,
    entity_registry: ReadableEntityRegistry,
    cycle: CraftingCyclePlan,
    cycles_in_period: number,
    period: PeriodText,
    position: Position,
    mapRanges: (ranges: OpenRange[]) => OpenRange[] = ranges => ranges,
    modulo?: { split: ModuloRanges; signal: SignalId },
    inserter_clock?: InserterClock,
    /** The entities with the same windows, which are wired to this combinator too */
    merged_entity_ids: EntityId[] = [],
    /** The line that says which group's turn the combinator stands first in, for the first combinator of a group */
    turn_line?: string,
): { combinator: DeciderCombinatorEntity; inserter_ids: number[] } {
    const entity = entity_registry.getEntityByIdOrThrow(entity_id)
    let description_lines: string[] = []

    const swing_counts = cycle.entity_transfer_map.get(entity_id);

    const items = new Set<string>();

    if (Entity.isInserter(entity)) {
        entity.filtered_items.forEach(item_name => items.add(item_name));
    } else if (Entity.isDrill(entity)) {
        items.add(entity.item.name);
    } else {
        throw new Error(`Entity ${entity_id} is not an inserter or drill`);
    }

    const entity_ids = [entity_id, ...merged_entity_ids];
    // the entities that share a decider carry the items of all of them
    for (const merged_id of merged_entity_ids) {
        const merged = entity_registry.getEntityById(merged_id);
        if (merged !== null && Entity.isInserter(merged)) merged.filtered_items.forEach(item_name => items.add(item_name));
        else if (merged !== null && Entity.isDrill(merged)) items.add(merged.item.name);
    }
    const ranges = mapRanges(OpenRange.reduceRanges(inventory_transfers.map(transfer => transfer.tick_range)));

    if (swing_counts) {
        description_lines = plannedDescriptionLines(
            entity_ids,
            entity_registry,
            items,
            entity_ids.flatMap(id => {
                const counts = cycle.entity_transfer_map.get(id);
                return counts === undefined ? [] : [{ entity_id: id, swings: counts.total_transfer_count.multiply(cycles_in_period) }];
            }),
            deciderWindows(ranges, clockValueRanges, modulo ? { modulus: modulo.split.modulus, signal: modulo.signal } : undefined, period.subtick_scale),
            period.ticks,
        );
    }

    if (!swing_counts && inserter_clock && Entity.isInserter(entity)) {
        // the window repeats every modulus ticks on the clock, or on the modulo the decider reads when that is its length
        const signal = modulo && modulo.split.modulus === inserter_clock.modulus ? modulo.signal : SignalId.clock;
        const [window] = clockValueRanges(wholeRanges([inserter_clock.window]));
        description_lines = unplannedDescriptionLines(entity_ids, entity_registry, items, inserter_clock, window, signal);
    }

    if (!swing_counts && Entity.isDrill(entity)) {
        // a drill into a chest: its windows are made from the takes out of the chest, outside the swing counts
        description_lines = chestDrillDescriptionLines(entity_ids, entity_registry, items,
            deciderWindows(ranges, clockValueRanges, modulo ? { modulus: modulo.split.modulus, signal: modulo.signal } : undefined, period.subtick_scale),
            period.ticks);
    }

    // after the lines that say what it switches on and when; the lines Factorio keeps are the first ones
    if (turn_line !== undefined && description_lines.length > 0) {
        description_lines.splice(Math.min(2, description_lines.length), 0, turn_line);
    }

    const outputs = Array.from(items).map(item_name => SignalId.item(item_name));

    const decider = (modulo
        ? DeciderCombinatorEntity.fromSignalRanges([
            { signal: modulo.signal, ranges: clockValueRanges(modulo.split.repeating) },
            { signal: SignalId.clock, ranges: clockValueRanges(modulo.split.remaining) },
        ], outputs)
        : DeciderCombinatorEntity.fromRanges(SignalId.clock, clockValueRanges(ranges), outputs))
        .setPosition(position)
        .setMultiLinePlayerDescription(description_lines);

    // the inserters or drills its description names, which are wired to it
    const named = description_lines.length > 0 ? entity_ids.map(it => it.number) : [];
    const inserter_ids = Entity.isInserter(entity) ? named : [];
    if (named.length > 0) {
        const ascending = named.slice().sort((a, b) => a - b);
        decider.setTags(Entity.isInserter(entity) ? { inserters: ascending } : { drills: ascending });
    }
    return { combinator: decider.build(), inserter_ids }
}

/**
 * The rate the clock was made for, so a blueprint says what it is meant to deliver:
 * "Target: 265 [item=agricultural-science-pack] per second over 5 copies (53 each)"
 */
function targetRateDescription(cycle: CraftingCyclePlan): string {
    const target = cycle.production_rate;
    const item_icon = SignalId.toDescriptionString(SignalId.item(target.total_production_rate.item));
    const total = formatRate(target.total_production_rate.amount_per_second.toDecimal());
    if (target.copies === 1) {
        return `Target: ${total} ${item_icon} per second`;
    }
    const each = formatRate(target.machine_production_rate.amount_per_second.toDecimal());
    return `Target: ${total} ${item_icon} per second over ${target.copies} copies (${each} each)`;
}

/**
 * A clock for a fractional period p/q ticks: a normal clock counts p ticks, and two arithmetic
 * combinators turn that into (clock * q) % p, the position in the period in 1/q-tick units.
 * The pattern wraps seamlessly because the clock period p times q is a multiple of p.
 */
export interface SubtickClock {
    /** p: clock period in ticks, and the modulo applied to the subtick clock */
    period_ticks: number;
    /** q: how many scaled units make one tick */
    scale: number;
}

/** Ticks added between the clock and the deciders by the multiply and modulo combinators */
const SUBTICK_CLOCK_EXTRA_LATENCY_TICKS = 2;

/**
 * Every clock counts from 1, not 0: a decider reads an absent signal as 0, so a window from 0 would still enable
 * its inserter with the clock switched off. The decider that counts a clock outputs 1 where the count starts over
 * and adds 1 to each modulo of the count (see DeciderCombinatorEntity.clock), and the filter after the subtick clock
 * adds 1 to it. Each modulo and the subtick clock is a tick behind the count: that tick makes up for the one the
 * decider adds, so each is its position in its modulus plus 1 and nothing has to be shifted.
 * The windows stay 0-based positions in the period; only the constants of the deciders are this much more.
 */
const CLOCK_FIRST_VALUE = 1;

/** Windows of 0-based positions as the values of the clock, or of a modulo of it, they are open for */
function clockValueRanges(ranges: OpenRange[]): OpenRange[] {
    return ranges.map(range => OpenRange.from(range.start_inclusive + CLOCK_FIRST_VALUE, range.end_inclusive + CLOCK_FIRST_VALUE));
}

/** How far a wire reaches between two combinators, in tiles, with some margin under the 9 of a copper wire */
export const WIRE_REACH_TILES = 8;

/**
 * Red wires from the lock to each of the receivers, in order along the row of combinators. A wire does not reach
 * further than WIRE_REACH_TILES, so the lock passes by the combinators between two receivers that are further apart:
 * the lock signal reaches their inputs too, where nothing reads it.
 */
export function lockWires(lock: ConstantCombinatorEntity, receivers: CircuitEntity[], row: CircuitEntity[]): WireConnection[] {
    const distance = (a: CircuitEntity, b: CircuitEntity) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    const wires: WireConnection[] = [];
    let last: CircuitEntity = lock;
    const connect = (to: CircuitEntity) => {
        wires.push(Wire.red(last === lock ? Wire.circuit(lock) : Wire.input(last), Wire.input(to)));
        last = to;
    };
    for (const receiver of receivers.slice().sort((a, b) => a.position.x - b.position.x)) {
        while (distance(last, receiver) > WIRE_REACH_TILES) {
            // the furthest combinator on the way that this wire reaches
            const hop = row
                .filter(entity => entity.position.x > last.position.x && distance(last, entity) <= WIRE_REACH_TILES)
                .sort((a, b) => b.position.x - a.position.x)[0];
            if (hop === undefined || hop === last) {
                throw new Error(`The lock does not reach the combinator at (${receiver.position.x}, ${receiver.position.y})`);
            }
            connect(hop);
        }
        connect(receiver);
    }
    return wires;
}

/** Decider constants are whole numbers; fractional bounds (from a fractional period's wrap) are rounded inward */
function wholeRanges(ranges: OpenRange[]): OpenRange[] {
    return ranges
        .map(range => OpenRange.from(Math.ceil(range.start_inclusive - 1e-9), Math.floor(range.end_inclusive + 1e-9)))
        .filter(range => range.start_inclusive <= range.end_inclusive);
}

/** A decider's clock windows as the part repeating every `modulus` ticks plus the remaining windows */
interface ModuloRanges {
    modulus: number;
    /** Positions in [0, modulus) enabled in every repeat */
    repeating: OpenRange[];
    /** Clock windows not covered by the repeating part */
    remaining: OpenRange[];
}

function maskRuns(mask: Uint8Array, length: number): OpenRange[] {
    const runs: OpenRange[] = [];
    let start = -1;
    for (let i = 0; i <= length; i++) {
        if (i < length && mask[i]) {
            if (start < 0) {
                start = i;
            }
        } else if (start >= 0) {
            runs.push(OpenRange.from(start, i - 1));
            start = -1;
        }
    }
    return runs;
}

/**
 * The split of whole-tick windows in a whole-tick period that needs the fewest decider conditions, or null when
 * no divisor of the period beats listing every window. Long periods (a high LCM) mostly repeat every crafting cycle.
 */
export function splitRepeatingRanges(ranges: OpenRange[], period: number): ModuloRanges | null {
    if (!Number.isInteger(period) || ranges.length < 2) {
        return null;
    }
    const mask = new Uint8Array(period);
    for (const range of ranges) {
        for (let tick = Math.max(0, range.start_inclusive); tick <= Math.min(period - 1, range.end_inclusive); tick++) {
            mask[tick] = 1;
        }
    }
    let best: ModuloRanges | null = null;
    let best_count = maskRuns(mask, period).length;
    for (let modulus = 1; modulus < period; modulus++) {
        if (period % modulus !== 0) {
            continue;
        }
        const repeating_mask = new Uint8Array(modulus);
        for (let position = 0; position < modulus; position++) {
            let every = 1;
            for (let tick = position; tick < period && every; tick += modulus) {
                every = mask[tick];
            }
            repeating_mask[position] = every;
        }
        const repeating = maskRuns(repeating_mask, modulus);
        if (repeating.length === 0 || repeating.length >= best_count) {
            continue;
        }
        const remaining_mask = mask.map((enabled, tick) => enabled && !repeating_mask[tick % modulus] ? 1 : 0);
        const remaining = maskRuns(remaining_mask, period);
        if (repeating.length + remaining.length < best_count) {
            best = { modulus, repeating, remaining };
            best_count = repeating.length + remaining.length;
        }
    }
    return best;
}

/** The signal one clock for the period and the fuel clocks counts on, which leaves the clock signal for the clock of the period */
const MERGED_CLOCK_SIGNAL = SignalId.virtual("signal-T");

/** The largest count a signal holds */
const MAX_SIGNAL_VALUE = 2 ** 31 - 1;

/**
 * Ticks one clock has to count to hold a whole number of periods and of every fuel clock: their least common
 * multiple. Null when the period is not a whole number of ticks or the count does not fit a signal.
 */
export function mergedClockTicks(period: number, fuel_clock_ticks: number[]): number | null {
    if (!Number.isInteger(period) || fuel_clock_ticks.some(ticks => !Number.isInteger(ticks) || ticks < 1)) {
        return null;
    }
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    let merged = period;
    for (const ticks of fuel_clock_ticks) {
        merged = merged / gcd(merged, ticks) * ticks;
        if (merged > MAX_SIGNAL_VALUE) {
            return null;
        }
    }
    return merged;
}

/** Whole-tick windows that run past the end of the period, carried over to its start */
function wrapRangesIntoPeriod(ranges: OpenRange[], period: number): OpenRange[] {
    if (!Number.isInteger(period)) {
        return ranges;
    }
    return OpenRange.reduceRanges(ranges.flatMap(range => range.end_inclusive < period || range.start_inclusive >= period
        ? [range]
        : [OpenRange.from(range.start_inclusive, period - 1), OpenRange.from(0, range.end_inclusive - period)]));
}

/**
 * Windows in ticks of the p/q period, as 0-based positions of the subtick clock shifted back by the extra combinator
 * latency. The count is its position plus the first value, a tick ahead, which makes up for one tick of the latency.
 */
function subtickRanges(ranges: OpenRange[], clock: SubtickClock): OpenRange[] {
    const { period_ticks: p, scale: q } = clock;
    const latency_ticks = SUBTICK_CLOCK_EXTRA_LATENCY_TICKS - CLOCK_FIRST_VALUE;
    const scaled: OpenRange[] = [];
    for (const range of ranges) {
        const start = range.start_inclusive * q - latency_ticks * q;
        const end = range.end_inclusive * q - latency_ticks * q;
        const wrapped_start = ((start % p) + p) % p;
        const wrapped_end = wrapped_start + (end - start);
        if (wrapped_end >= p) {
            scaled.push(OpenRange.from(wrapped_start, p - 1));
            scaled.push(OpenRange.from(0, wrapped_end - p));
        } else {
            scaled.push(OpenRange.from(wrapped_start, wrapped_end));
        }
    }
    return OpenRange.reduceRanges(wholeRanges(scaled));
}

/** What the combinators of a clock blueprint do, as data, for what builds it to read instead of their descriptions */
export interface ClockSchedule {
    /**
     * Ticks the clock counts before it starts over: the period, the whole ticks of a subtick clock, or the count of a
     * clock merged with fuel clocks. The game counts only its whole part.
     */
    counted_ticks: number;
    /** Each combinator that enables inserters, by its entity number in the blueprint, with the config ids of those inserters */
    inserter_combinators: { entity_number: number; inserter_ids: number[] }[];
}

/** A clock blueprint, whether some of its windows are checked against a modulo of the clock, and its schedule */
export interface SignalPerInserterBlueprint {
    blueprint: FactorioBlueprint;
    /** Some window repeats within the period and is checked against the clock modulo its length: a modulo clock */
    modulo: boolean;
    schedule: ClockSchedule;
}

export function createSignalPerInserterBlueprint(
    final_output_item_name: string,
    cycle: CraftingCyclePlan,
    total_duration: Duration,
    /** The whole number of crafting cycles the period is made of (the recipe LCM), which the swings of a cycle are multiplied by */
    cycles_in_period: number,
    history: InventoryTransferHistory,
    entityRegistry: ReadableEntityRegistry,
    subtick_clock?: SubtickClock,
    use_modulo: boolean = false,
    inserter_clocks: ReadonlyMap<string, InserterClock> = new Map(),
    /**
     * The groups that take turns in the windows (the grouped hands rule's): the combinators stand in a block for each group,
     * in the order of its turn, with a gap between the blocks, and the first of each says when its turn is. Where there are
     * none, or the clock is a subtick clock, the combinators stand in one row in the order of their entity ids.
     */
    turns: readonly TurnGroup[] = [],
): SignalPerInserterBlueprint {

    const inventory_transfers = history.getAllTransfers()

    // the game draws the icon in a label too: "[item=iron-plate] Iron plate clock"
    let blueprint_label = `${itemIcons([final_output_item_name])} ${FactorioDataService.itemDisplayName(final_output_item_name)} clock`
    let x = 0.5;


    // Fuel inserters are on clocks of their own, one per interval. One clock counts as many periods as it takes for
    // every fuel clock to fit a whole number of times, on a signal of its own, and a modulo of it gives the clock of
    // the period (on the clock signal, so everything that reads the clock is as without fuel) and each fuel clock.
    // A subtick clock, or a count too long for a signal, keeps separate fuel clocks instead.
    const fuel_inserter_clocks = Array.from(inserter_clocks.values())
        .filter(inserter_clock => inserter_clock.own_clock)
        .sort((a, b) => a.inserter_id.number - b.inserter_id.number);
    const fuel_moduli = Array.from(new Set(fuel_inserter_clocks.map(inserter_clock => inserter_clock.modulus))).sort((a, b) => a - b);
    const merged_clock_ticks = subtick_clock || fuel_moduli.length === 0 ? null : mergedClockTicks(total_duration.ticks, fuel_moduli);
    // the clock of the period is a modulo of the one clock, unless every fuel clock already fits the period
    const period_modulus = merged_clock_ticks !== null && merged_clock_ticks !== total_duration.ticks ? total_duration.ticks : null;
    const counted_signal = period_modulus === null ? SignalId.clock : MERGED_CLOCK_SIGNAL;
    const counted_ticks = merged_clock_ticks ?? (subtick_clock ? subtick_clock.period_ticks : total_duration.ticks);

    const clock_x = x;
    const period: PeriodText = {
        ticks: shownPeriodTicks(total_duration.ticks, subtick_clock !== undefined),
        ...(subtick_clock ? { subtick_scale: subtick_clock.scale } : {}),
    };

    const subtick_combinators = subtick_clock ? [
        ArithmeticCombinatorEntity.withConstant({
            input: SignalId.clock,
            operation: "*",
            constant: subtick_clock.scale,
            output: SignalId.clock,
            position: Position.fromXY(x += 1, 0),
            description: [`${PART_OF_THE_CLOCK} Subtick clock: ${SignalId.toDescriptionString(SignalId.clock)} × ${subtick_clock.scale}`],
        }),
        ArithmeticCombinatorEntity.withConstant({
            input: SignalId.clock,
            operation: "%",
            constant: subtick_clock.period_ticks,
            output: SignalId.clock,
            position: Position.fromXY(x += 1, 0),
            description: [`${PART_OF_THE_CLOCK} Subtick clock: ${SignalId.toDescriptionString(SignalId.clock)} mod ${subtick_clock.period_ticks}, the position in 1/${subtick_clock.scale} ticks`],
        }),
    ] : [];

    const deciderCombinatorEntities: DeciderCombinatorEntity[] = []
    // the config ids of the inserters each schedule combinator enables
    const inserters_of = new Map<DeciderCombinatorEntity, number[]>();

    const sortedEntityIds = Array.from(inventory_transfers.keys()).sort((a, b) => a.id.localeCompare(b.id));

    // a window that runs past the end of the period carries on at its start
    const wholeRangesInPeriod = (ranges: OpenRange[]) => wrapRangesIntoPeriod(wholeRanges(ranges), total_duration.ticks);
    const splits = new Map(sortedEntityIds.map(entityId => [entityId, subtick_clock || !use_modulo ? null : splitRepeatingRanges(
        wholeRangesInPeriod(OpenRange.reduceRanges(inventory_transfers.get(entityId)!.map(transfer => transfer.tick_range))),
        total_duration.ticks,
    )] as const));
    const split_moduli = Array.from(splits.values()).flatMap(split => split ? [split.modulus] : []);
    const merged_moduli = merged_clock_ticks === null ? [] : fuel_moduli.concat(period_modulus ?? []);
    const moduli = Array.from(new Set(split_moduli.concat(merged_moduli))).sort((a, b) => a - b);
    const modulo_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(letter => `signal-${letter}` !== MERGED_CLOCK_SIGNAL.name);
    const modulo_signals = new Map(moduli.map((modulus, index) => [
        modulus,
        // the clock of the period is on the clock signal, where everything that reads the clock expects it
        modulus === period_modulus ? SignalId.clock : SignalId.virtual(`signal-${modulo_letters[index % modulo_letters.length]}`),
    ] as const));
    const fuel_clocks_by_modulus = new Map<number, InserterClock[]>();
    fuel_inserter_clocks.forEach(inserter_clock =>
        fuel_clocks_by_modulus.set(inserter_clock.modulus, (fuel_clocks_by_modulus.get(inserter_clock.modulus) ?? []).concat(inserter_clock)));
    const moduloDescription = (modulus: number): string[] =>
        [`${PART_OF_THE_CLOCK} ${SignalId.toDescriptionString(modulo_signals.get(modulus)!)} = ${SignalId.toDescriptionString(counted_signal)} mod ${modulus}`];
    const modulo_combinators = moduli.map(modulus => ArithmeticCombinatorEntity.withConstant({
        input: counted_signal,
        operation: "%",
        constant: modulus,
        output: modulo_signals.get(modulus)!,
        position: Position.fromXY(x += 1, 0),
        description: moduloDescription(modulus),
    }));

    // The clock's network carries the count and every modulo of it, which count from 1 as well; the subtick clock is
    // on a network of its own
    const clock = DeciderCombinatorEntity
        .clock(counted_ticks, counted_signal, Array.from(modulo_signals.values()))
        .setPosition(Position.fromXY(clock_x, 0))
        .setDirection(Direction.SOUTH)
        .setMultiLinePlayerDescription(clockDescriptionLines({
            item_name: final_output_item_name,
            items_per_second: cycle.production_rate.total_production_rate.amount_per_second.toDecimal(),
            copies: cycle.production_rate.copies,
            period_text: subtick_clock
                ? `Period ${period.ticks} ticks; counts ${CLOCK_FIRST_VALUE}–${subtick_clock.period_ticks} (${subtick_clock.scale} periods), read in 1/${subtick_clock.scale} ticks`
                : !Number.isInteger(total_duration.ticks)
                    ? `Period ${period.ticks} ticks (${formatRate(total_duration.ticks)} rounded down: runs a little fast); counts ${CLOCK_FIRST_VALUE}–${period.ticks}`
                    : period_modulus !== null
                        ? `Period ${period.ticks} ticks; counts ${CLOCK_FIRST_VALUE}–${merged_clock_ticks} on ${SignalId.toDescriptionString(counted_signal)} (${merged_clock_ticks! / total_duration.ticks} periods, for the fuel clocks); ${SignalId.toDescriptionString(SignalId.clock)} = that mod ${total_duration.ticks}`
                        : `Period ${period.ticks} ticks; counts ${CLOCK_FIRST_VALUE}–${counted_ticks}`,
            drills: sortedEntityIds.some(entityId => EntityId.isDrill(entityId)),
            not_clocked: notClocked(entityRegistry, [
                ...sortedEntityIds.flatMap(entityId => [entityId, ...(history.merged_entities.get(entityId.id) ?? [])]),
                ...fuel_inserter_clocks.map(inserter_clock => inserter_clock.inserter_id),
            ]),
        }))
        .setTags({ generator: { ...GENERATOR } })
        .build();

    // One lock for every clock, under the clock: switched on, it stops them and the filters pass nothing
    const lock = ConstantCombinatorEntity.lock({
        position: Position.fromXY(clock.position.x, 1.5),
        description: [
            "Clock lock: switch on to stop every clock; no inserter or drill is enabled while it is on. Off by default. Switching off starts the clocks again from the beginning, and the first period after may be a tick off",
        ],
    });

    // Every combinator that reads the clock does so through a filter after its network, so the lock reaches them all
    const main_filter = DeciderCombinatorEntity
        .lockFilter(subtick_clock ? [SignalId.clock] : [])
        .setPosition(Position.fromXY(x += 1, 0))
        .setMultiLinePlayerDescription(lockFilterDescription("clock"))
        .build();

    // Where each decider stands. Only where the windows are in groups that take turns does the order change: the deciders of a group
    // stand together, the groups in the order of their turns, a gap between them. The entities, and so the order they are built in
    // (which decides which of two inserters enabled in one tick is updated first), stay in the order of the ids.
    const placed_groups = subtick_clock ? null : placeByTurns(
        sortedEntityIds.map(entityId => [entityId.id, ...(history.merged_entities.get(entityId.id) ?? []).map(it => it.id)]), turns);
    const x_of = new Map<EntityId, number>();
    const turn_lines = new Map<EntityId, string>();
    if (placed_groups === null) {
        sortedEntityIds.forEach(entityId => x_of.set(entityId, x += 1));
    } else {
        const labelled = placed_groups.filter(group => group.turn !== null).length;
        placed_groups.forEach((group, index) => {
            if (index > 0) {
                x += GROUP_GAP_TILES;
            }
            group.deciders.forEach(decider => x_of.set(sortedEntityIds[decider], x += 1));
            if (group.turn !== null) {
                const windows = group.deciders.flatMap(decider => wholeRangesInPeriod(inventory_transfers.get(sortedEntityIds[decider])!.map(transfer => transfer.tick_range)));
                const { start, end } = turnTicks(turns[group.turn].start, windows, total_duration.ticks);
                const ticks = end < total_duration.ticks
                    ? [OpenRange.from(start, end)]
                    : [OpenRange.from(start, total_duration.ticks - 1), OpenRange.from(0, end - total_duration.ticks)];
                turn_lines.set(sortedEntityIds[group.deciders[0]], turnLine(index + 1, labelled, clockValueRanges(ticks), period.ticks));
            }
        });
    }

    sortedEntityIds.forEach(entityId => {
        const transfers = inventory_transfers.get(entityId)!;
        const split = splits.get(entityId);
        const { combinator, inserter_ids } = createDeciderCombinatorForTransfers(
            transfers,
            entityId,
            entityRegistry,
            cycle,
            cycles_in_period,
            period,
            Position.fromXY(x_of.get(entityId)!, 0),
            subtick_clock ? ranges => subtickRanges(ranges, subtick_clock) : wholeRangesInPeriod,
            split ? { split, signal: modulo_signals.get(split.modulus)! } : undefined,
            inserter_clocks.get(entityId.id),
            history.merged_entities.get(entityId.id),
            turn_lines.get(entityId),
        );
        deciderCombinatorEntities.push(combinator);
        inserters_of.set(combinator, inserter_ids);
    })

    // A decider per fuel clock and window, which the fuel inserters with that window share. It reads the modulo of
    // the one clock when there is one, else a fuel clock of its own on a network of its own.
    const fuel_clocks = fuel_clocks_by_modulus;
    const fuel_combinators: DeciderCombinatorEntity[] = [];
    // the combinators the lock reaches: every clock and the filter after it
    const lock_receivers: CircuitEntity[] = [clock, main_filter];
    const fuel_wires: ReturnType<typeof Wire.green>[] = [];
    fuel_moduli.forEach(modulus => {
        const fuel_clock_signal = merged_clock_ticks === null ? undefined : modulo_signals.get(modulus)!;
        const window_deciders: DeciderCombinatorEntity[] = [];
        const inserters_by_window = new Map<string, { inserter_clock: InserterClock; inserters: Inserter[] }>();
        for (const inserter_clock of fuel_clocks.get(modulus) ?? []) {
            const window_key = `${inserter_clock.window.start_inclusive}-${inserter_clock.window.end_inclusive}`;
            const inserter = entityRegistry.getEntityById(inserter_clock.inserter_id);
            if (inserter === null || !Entity.isInserter(inserter)) {
                continue;
            }
            const shared = inserters_by_window.get(window_key) ?? { inserter_clock, inserters: [] };
            shared.inserters.push(inserter);
            inserters_by_window.set(window_key, shared);
        }
        for (const { inserter_clock, inserters } of inserters_by_window.values()) {
            const inserter = inserters[0];
            const items = new Set(inserter.filtered_items);
            const window = wholeRanges([inserter_clock.window]);
            const window_decider = DeciderCombinatorEntity
                .fromRanges(
                    fuel_clock_signal ?? SignalId.clock,
                    clockValueRanges(window),
                    Array.from(items).map(item_name => SignalId.item(item_name)),
                )
                .setPosition(Position.fromXY(x += 1, 0))
                .setMultiLinePlayerDescription(unplannedDescriptionLines(inserters.map(it => it.entity_id), entityRegistry, items, inserter_clock,
                    clockValueRanges(window)[0], fuel_clock_signal ?? null))
                .setTags({ inserters: inserters.map(it => it.entity_id.number).sort((a, b) => a - b) })
                .build();
            window_deciders.push(window_decider);
            inserters_of.set(window_decider, inserters.map(it => it.entity_id.number));
        }
        if (fuel_clock_signal) {
            // wired with the other deciders, to the network that carries every modulo of the clock
            // not push(...window_deciders): a big clock has more deciders than a worker's stack takes arguments
            for (const decider of window_deciders) {
                deciderCombinatorEntities.push(decider);
            }
            return;
        }
        const fuel_clock = DeciderCombinatorEntity
            .clock(modulus)
            .setPosition(Position.fromXY(x += 1, 0))
            .setDirection(Direction.SOUTH)
            .setMultiLinePlayerDescription([`${PART_OF_THE_CLOCK} Fuel clock: counts ${CLOCK_FIRST_VALUE}–${modulus}`])
            .build();
        const fuel_filter = DeciderCombinatorEntity
            .lockFilter()
            .setPosition(Position.fromXY(x += 1, 0))
            .setMultiLinePlayerDescription(lockFilterDescription("fuel clock"))
            .build();
        fuel_combinators.push(fuel_clock, fuel_filter, ...window_deciders);
        fuel_wires.push(
            Wire.green(Wire.input(fuel_clock), Wire.output(fuel_clock)),
            Wire.green(Wire.output(fuel_clock), Wire.input(fuel_filter)),
            // the window deciders sit before the fuel clock, so the nearest one comes first
            ...Wire.greenChain([Wire.output(fuel_filter), ...window_deciders.slice().reverse().map(Wire.input)]),
        );
        lock_receivers.push(fuel_clock, fuel_filter);
    });

    // all green: clock self loop; with a subtick clock: clock -> multiply, multiply -> modulo;
    // with modulo combinators: clock and every modulo input and output on one network;
    // then the output of the last of them -> the filter, and the filter output chained through every decider input,
    // since deciders must not read the clock itself.
    // all red: the lock into the clock and every filter
    const { input, output } = Wire;
    const wires = [Wire.green(input(clock), output(clock))];
    let clock_network_output = output(clock);
    if (subtick_clock) {
        const [multiply, modulo] = subtick_combinators;
        wires.push(
            Wire.green(output(clock), input(multiply)),
            Wire.green(output(multiply), input(modulo)),
        );
        clock_network_output = output(modulo);
    } else if (modulo_combinators.length > 0) {
        wires.push(
            Wire.green(input(clock), output(modulo_combinators[0])),
            Wire.green(output(clock), input(modulo_combinators[0])),
            ...Wire.greenChain(modulo_combinators.map(input)),
            ...Wire.greenChain(modulo_combinators.map(output)),
        );
        clock_network_output = output(modulo_combinators[modulo_combinators.length - 1]);
    }
    wires.push(
        Wire.green(clock_network_output, input(main_filter)),
        // along the row, so that each wire is as short as the next combinator stands (the groups' blocks are not in the order of the ids)
        ...Wire.greenChain([output(main_filter), ...deciderCombinatorEntities.slice().sort((a, b) => a.position.x - b.position.x).map(input)]),
        ...lockWires(lock, lock_receivers, [clock, ...subtick_combinators, ...modulo_combinators, main_filter, ...deciderCombinatorEntities, ...fuel_combinators]),
    );

    const modulo = split_moduli.length > 0;
    if (modulo) {
        blueprint_label += " (modulo clock)";
    }

    const entities = [
        clock,
        lock,
        ...subtick_combinators,
        ...modulo_combinators,
        main_filter,
        ...deciderCombinatorEntities,
        ...fuel_combinators,
    ];
    const blueprint = new BlueprintBuilder()
        .setLabel(blueprint_label)
        // the game keeps 500 bytes of a blueprint's description too (recorded in Factorio 2.1.21)
        .setDescription(fitPlayerDescription([targetRateDescription(cycle), `Clock period: ${formatRate(total_duration.ticks)} ticks`, ...generatorDescriptionLines()]))
        .setEntities(entities)
        .setWires(wires.concat(fuel_wires))
        .build();
    // entities are numbered from 1 in the order they are set
    const inserter_combinators = entities.flatMap((entity, index) => {
        const inserter_ids = inserters_of.get(entity as DeciderCombinatorEntity) ?? [];
        return inserter_ids.length > 0 ? [{ entity_number: index + 1, inserter_ids }] : [];
    });
    return { blueprint, modulo, schedule: { counted_ticks, inserter_combinators } };
}